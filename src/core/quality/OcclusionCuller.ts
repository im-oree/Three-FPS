/**
 * OcclusionCuller.ts — hide objects that are behind big solid things.
 *
 * Frustum culling answers "is it in front of the camera?". It cannot answer
 * "is it behind a warehouse?", so on a map like Firing Range — where the
 * player usually stands in a compound surrounded by large opaque buildings —
 * a large fraction of what survives frustum culling is drawn and then
 * completely overwritten by a wall two metres away. That work is pure waste,
 * and on a fill-rate-bound integrated GPU it is the expensive kind of waste.
 *
 * APPROACH: CPU shadow-frustum occlusion against a handful of authored
 * occluders. Real GPU occlusion queries (WebGL2 ANY_SAMPLES_PASSED) return
 * results a frame or two late, need per-object query objects, and stall the
 * pipeline when read back badly — a poor trade on the hardware this targets.
 * Instead, each large building registers a convex box occluder; for each
 * camera we build the "shadow volume" behind that box (the region it hides)
 * and test candidate bounding spheres against it.
 *
 * The test is deliberately CONSERVATIVE — it only ever hides something it can
 * prove is fully behind an occluder, because a false positive is a visible
 * hole in the world while a false negative merely costs a draw call. Proof
 * comes from a separating-plane argument: build the planes joining the camera
 * to the occluder box's silhouette edges, plus the box's own far plane; a
 * sphere entirely inside all of them is provably hidden.
 *
 * Cost: O(occluders x candidates) plane tests, with occluders capped to the
 * few nearest. With ~12 occluders and ~120 candidates that is a few thousand
 * dot products a frame — trivially cheaper than the draw calls it removes.
 */
import * as THREE from 'three';

export interface OcclusionCandidate {
  object: THREE.Object3D;
  sphere: THREE.Sphere;
  /** Set by the culler; consumed by FrustumCullingManager. */
  occluded: boolean;
}

interface Occluder {
  box: THREE.Box3;
  /** Longest half-extent; used to rank "which occluders matter here". */
  extent: number;
  center: THREE.Vector3;
}

const MAX_ACTIVE_OCCLUDERS = 10;

export class OcclusionCuller {
  private readonly occluders: Occluder[] = [];
  private readonly active: Occluder[] = [];
  private enabled = true;

  /** Scratch, reused every frame — this class allocates nothing per frame. */
  private readonly corners: THREE.Vector3[] = Array.from(
    { length: 8 }, () => new THREE.Vector3(),
  );
  private readonly planeNormals: THREE.Vector3[] = Array.from(
    { length: 6 }, () => new THREE.Vector3(),
  );
  private readonly planeConstants: number[] = [0, 0, 0, 0, 0, 0];
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();

  /**
   * Register a solid, opaque, world-space box as an occluder. Only large
   * closed volumes belong here (warehouses, containers, the bunker): a
   * fence or a tree hides nothing reliably and would only cost tests.
   */
  addOccluder(box: THREE.Box3): void {
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    this.occluders.push({
      box: box.clone(),
      extent: Math.max(size.x, size.y, size.z) * 0.5,
      center,
    });
  }

  clear(): void {
    this.occluders.length = 0;
    this.active.length = 0;
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  get isEnabled(): boolean { return this.enabled; }
  get occluderCount(): number { return this.occluders.length; }

  /**
   * Choose the occluders worth testing from this viewpoint. An occluder far
   * away subtends a small angle and hides almost nothing, so rank by
   * "apparent size" = extent / distance and keep the best few.
   */
  prepare(cameraPosition: THREE.Vector3): void {
    this.active.length = 0;
    if (!this.enabled || this.occluders.length === 0) return;
    // Insertion sort into a fixed-size top-N — no allocation, no full sort.
    const scores: number[] = [];
    for (const occ of this.occluders) {
      const dist = occ.center.distanceTo(cameraPosition);
      // Inside or touching the box: it cannot occlude anything coherently.
      if (dist < occ.extent * 1.05) continue;
      const score = occ.extent / dist;
      if (score < 0.055) continue; // subtends too little to be worth testing
      let i = this.active.length;
      while (i > 0 && scores[i - 1] < score) i -= 1;
      if (i >= MAX_ACTIVE_OCCLUDERS) continue;
      this.active.splice(i, 0, occ);
      scores.splice(i, 0, score);
      if (this.active.length > MAX_ACTIVE_OCCLUDERS) {
        this.active.length = MAX_ACTIVE_OCCLUDERS;
        scores.length = MAX_ACTIVE_OCCLUDERS;
      }
    }
  }

  /**
   * True when `sphere` is provably hidden from `cameraPosition` by a single
   * registered occluder.
   *
   * Single-occluder only, by design: proving that an object is hidden by the
   * UNION of two boxes requires merging their shadow volumes, which is both
   * fiddly and rarely worth it — the big buildings that matter here occlude
   * on their own.
   */
  isOccluded(sphere: THREE.Sphere, cameraPosition: THREE.Vector3): boolean {
    if (!this.enabled || this.active.length === 0) return false;
    for (const occ of this.active) {
      // Cheap reject: anything nearer the camera than the occluder's closest
      // point cannot be behind it.
      if (sphere.center.distanceTo(cameraPosition)
        <= occ.center.distanceTo(cameraPosition) - occ.extent) continue;
      if (this.behindOccluder(occ, sphere, cameraPosition)) return true;
    }
    return false;
  }

  /**
   * Build the occluder's shadow volume from its SILHOUETTE EDGES and test the
   * sphere against it.
   *
   * The volume behind a convex box, seen from a point, is bounded by the
   * planes that contain the eye and each silhouette edge — an edge where one
   * adjacent face points towards the eye and the other away. For an
   * axis-aligned box there are 4 such edges seen face-on and 6 seen from a
   * corner, so six preallocated planes always suffice.
   *
   * (An earlier attempt used the box's own face planes translated to pass
   * through the eye. That is much cheaper but simply wrong: for a box at the
   * origin seen from -Z it yields the halfspace x >= 0 instead of the true
   * 9x + z + 10 >= 0, so it rejects almost everything genuinely hidden. It
   * never produced a false positive, which is exactly why it was invisible —
   * the culler just silently never fired.)
   */
  private behindOccluder(
    occ: Occluder, sphere: THREE.Sphere, eye: THREE.Vector3,
  ): boolean {
    const { min, max } = occ.box;
    const c = this.corners;
    c[0].set(min.x, min.y, min.z); c[1].set(max.x, min.y, min.z);
    c[2].set(min.x, max.y, min.z); c[3].set(max.x, max.y, min.z);
    c[4].set(min.x, min.y, max.z); c[5].set(max.x, min.y, max.z);
    c[6].set(min.x, max.y, max.z); c[7].set(max.x, max.y, max.z);

    // Face f is front-facing when the eye is outside its plane.
    const front0 = eye.x < min.x;  // -X
    const front1 = eye.x > max.x;  // +X
    const front2 = eye.y < min.y;  // -Y
    const front3 = eye.y > max.y;  // +Y
    const front4 = eye.z < min.z;  // -Z
    const front5 = eye.z > max.z;  // +Z
    // Eye inside the slab on all three axes = inside the box: no shadow.
    if (!front0 && !front1 && !front2 && !front3 && !front4 && !front5) return false;
    const faceFront = [front0, front1, front2, front3, front4, front5];

    let planeCount = 0;
    const addEdgePlane = (i0: number, i1: number): void => {
      if (planeCount >= 6) return;
      const a = c[i0];
      const b = c[i1];
      // n = edgeDir x (a - eye): perpendicular to both the edge and the line
      // of sight to it, i.e. the plane through the eye containing the edge.
      this.tmpA.copy(b).sub(a);                  // edge direction
      this.tmpB.copy(a).sub(eye);                // eye -> edge
      this.tmpC.crossVectors(this.tmpA, this.tmpB);
      const len = this.tmpC.length();
      if (len < 1e-9) return;                    // eye is on the edge's line
      this.tmpC.multiplyScalar(1 / len);
      let d = -this.tmpC.dot(eye);
      // Orient inward: the box's centre must be on the positive side.
      if (this.tmpC.dot(occ.center) + d < 0) {
        this.tmpC.multiplyScalar(-1);
        d = -d;
      }
      this.planeNormals[planeCount].copy(this.tmpC);
      this.planeConstants[planeCount] = d;
      planeCount += 1;
    };

    // The 12 edges, each with the two faces that share it. An edge is on the
    // silhouette when exactly one of those faces is front-facing.
    const EDGES = OcclusionCuller.EDGES;
    for (let e = 0; e < 12; e += 1) {
      const edge = EDGES[e];
      if (faceFront[edge[2]] !== faceFront[edge[3]]) addEdgePlane(edge[0], edge[1]);
    }
    if (planeCount < 3) return false;

    // The sphere must be fully inside every silhouette plane.
    for (let i = 0; i < planeCount; i += 1) {
      if (this.planeNormals[i].dot(sphere.center) + this.planeConstants[i] < sphere.radius) {
        return false;
      }
    }

    // ...and strictly BEYOND the box, not merely inside the (unbounded) cone.
    this.tmpA.copy(sphere.center).sub(eye);
    const dist = this.tmpA.length();
    if (dist < 1e-4) return false;
    this.tmpA.multiplyScalar(1 / dist);
    let farthest = -Infinity;
    for (let i = 0; i < 8; i += 1) {
      const d = this.tmpB.copy(c[i]).sub(eye).dot(this.tmpA);
      if (d > farthest) farthest = d;
    }
    return dist - sphere.radius > farthest;
  }

  /** [corner0, corner1, faceA, faceB] for each of the box's 12 edges.
   *  Corner index bits: 1 = max X, 2 = max Y, 4 = max Z.
   *  Face order: 0 -X, 1 +X, 2 -Y, 3 +Y, 4 -Z, 5 +Z. */
  private static readonly EDGES: ReadonlyArray<readonly [number, number, number, number]> = [
    // along X — bounded by a Y face and a Z face
    [0, 1, 2, 4], [2, 3, 3, 4], [4, 5, 2, 5], [6, 7, 3, 5],
    // along Y — bounded by an X face and a Z face
    [0, 2, 0, 4], [1, 3, 1, 4], [4, 6, 0, 5], [5, 7, 1, 5],
    // along Z — bounded by an X face and a Y face
    [0, 4, 0, 2], [1, 5, 1, 2], [2, 6, 0, 3], [3, 7, 1, 3],
  ];

  getStats(): { registered: number; active: number; enabled: boolean } {
    return {
      registered: this.occluders.length,
      active: this.active.length,
      enabled: this.enabled,
    };
  }
}

export default OcclusionCuller;
