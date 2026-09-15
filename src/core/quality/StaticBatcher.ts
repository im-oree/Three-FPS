/**
 * StaticBatcher.ts — merges static scenery into a few big meshes, and builds
 * a cheap far-distance LOD for each merge while it is at it.
 *
 * WHY THIS IS THE BIGGEST SINGLE WIN HERE
 * A census of Firing Range found 1687 individual meshes under PropPool and
 * 1274 draw calls per frame. Almost none of that is geometry cost — the whole
 * map is only ~400k triangles, which any GPU eats — it is PER-DRAW CPU cost:
 * for every call the driver validates state, rebinds buffers and uniforms,
 * and issues a command. On a 6th-gen i5 with integrated graphics that is
 * roughly 5-15 microseconds each, so ~1300 calls can burn 8-15 ms of CPU
 * before a single useful pixel is shaded. At a 16.6 ms budget for 60 fps,
 * draw-call overhead alone was eating the entire frame.
 *
 * Buildings are the worst offenders because each one is assembled from dozens
 * of kit panels (BuildingKit) and each panel is its own Mesh. Those panels
 * never move relative to one another, so keeping them separate buys nothing
 * at runtime — it is purely an artefact of how the model was authored.
 *
 * WHAT IT DOES
 *   1. Collects every static mesh handed to it, keyed by MATERIAL (only
 *      same-material geometry can share a draw call) and by SPATIAL CELL.
 *   2. Merges each (material, cell) bucket into one BufferGeometry.
 *   3. Builds a decimated copy of that merged geometry by vertex clustering,
 *      and wraps both in a THREE.LOD so distant cells cost less vertex work.
 *
 * WHY SPATIAL CELLS RATHER THAN ONE MESH PER MATERIAL
 * Merging the whole map per material would give the minimum draw-call count
 * and the WORST culling: one mesh spanning the map is always on screen, so
 * every triangle is submitted always. Cells keep merges local, so a merged
 * cell behind the player is culled as a unit. Cell size is the knob that
 * trades those off and it comes from the quality preset.
 *
 * CORRECTNESS RULES (why some things are deliberately NOT batched)
 *   - Anything that moves, animates, or is toggled individually: batching
 *     freezes world transforms into vertices, so a batched object can never
 *     move again. Wind-swaying palms, dynamic barrels and doors stay out.
 *   - Transparent materials: merging breaks per-object back-to-front sorting.
 *   - InstancedMesh: already one draw call; merging would make it worse.
 *   - Collision is completely untouched. Rapier colliders are built from
 *     catalog data against world transforms and never read the render graph,
 *     so batching cannot change what the player walks into or shoots.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface StaticBatcherOptions {
  /** Spatial cell edge length in metres. */
  cellSize?: number;
  /** Distance at which the simplified LOD takes over. 0 = no LOD. */
  lodDistance?: number;
  /**
   * Vertex-weld grid as a fraction of each merged cell's bounding-box
   * diagonal. 0 disables decimation. ~0.02-0.05 keeps silhouettes.
   */
  lodStrength?: number;
  /** Below this triangle count a bucket is left alone (merging is pointless). */
  minTrianglesToMerge?: number;
}

interface Bucket {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  castShadow: boolean;
  receiveShadow: boolean;
  layer: number;
}

export interface BatchResult {
  /** Objects to add to the scene (THREE.Mesh or THREE.LOD). */
  readonly objects: THREE.Object3D[];
  /** Source objects that were consumed and should be removed/hidden. */
  readonly consumed: THREE.Object3D[];
  readonly stats: {
    sourceMeshes: number;
    batches: number;
    drawCallsSaved: number;
    triangles: number;
    lodTriangles: number;
  };
}

export class StaticBatcher {
  private readonly cellSize: number;
  private readonly lodDistance: number;
  private readonly lodStrength: number;
  private readonly minTrianglesToMerge: number;
  private readonly buckets = new Map<string, Bucket>();
  private readonly sources: THREE.Object3D[] = [];
  private readonly materialKeys = new Map<THREE.Material, string>();
  private readonly owned: Array<THREE.BufferGeometry> = [];

  constructor(options: StaticBatcherOptions = {}) {
    this.cellSize = options.cellSize ?? 24;
    this.lodDistance = options.lodDistance ?? 70;
    this.lodStrength = options.lodStrength ?? 0.03;
    this.minTrianglesToMerge = options.minTrianglesToMerge ?? 0;
  }

  /**
   * Walk a subtree and take every mesh that is safe to batch.
   * `skip` lets a caller protect nodes it still needs to control per-object.
   */
  collect(root: THREE.Object3D, skip?: (o: THREE.Object3D) => boolean): number {
    let taken = 0;
    root.updateWorldMatrix(true, true);
    const walk = (node: THREE.Object3D): void => {
      if (skip?.(node)) return;
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh) {
        if (this.accept(mesh)) taken += 1;
      }
      // A mesh can have mesh children; keep walking regardless.
      for (const child of node.children) walk(child);
    };
    walk(root);
    return taken;
  }

  /** Test-and-take a single mesh. Returns false when it must stay separate. */
  private accept(mesh: THREE.Mesh): boolean {
    if (!mesh.geometry || !mesh.visible) return false;
    const material = mesh.material;
    if (Array.isArray(material)) return false;      // multi-material: skip
    if (!material) return false;
    if (material.transparent) return false;          // sort order matters
    const pos = mesh.geometry.attributes.position;
    if (!pos) return false;

    mesh.updateWorldMatrix(true, false);
    const key = this.bucketKey(mesh, material);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        material,
        geometries: [],
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        layer: mesh.layers.mask,
      };
      this.buckets.set(key, bucket);
    }

    // Bake the world transform into a copy of the geometry. Only position +
    // normal survive: UVs are unused by these untextured flat-shaded
    // materials, and mergeGeometries REQUIRES identical attribute sets.
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone());
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(mesh.matrixWorld);
    bucket.geometries.push(geo);
    this.sources.push(mesh);
    return true;
  }

  /** Bucket identity: same material AND same spatial cell AND same flags. */
  private bucketKey(mesh: THREE.Mesh, material: THREE.Material): string {
    let matKey = this.materialKeys.get(material);
    if (!matKey) {
      matKey = String(this.materialKeys.size);
      this.materialKeys.set(material, matKey);
    }
    const p = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const cx = Math.floor(p.x / this.cellSize);
    const cy = Math.floor(p.y / this.cellSize);
    const cz = Math.floor(p.z / this.cellSize);
    const flags = `${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}${mesh.layers.mask}`;
    return `${matKey}|${cx},${cy},${cz}|${flags}`;
  }

  /** Merge everything collected. The batcher is single-use per level. */
  build(): BatchResult {
    const objects: THREE.Object3D[] = [];
    let triangles = 0;
    let lodTriangles = 0;
    let batches = 0;
    let mergedSources = 0;

    for (const bucket of this.buckets.values()) {
      if (bucket.geometries.length < 2) {
        // A lone mesh in a cell saves nothing by being "merged"; leave the
        // original in place and drop our copy.
        for (const g of bucket.geometries) g.dispose();
        continue;
      }
      const merged = mergeGeometries(bucket.geometries, false);
      for (const g of bucket.geometries) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const triCount = merged.attributes.position.count / 3;
      if (triCount < this.minTrianglesToMerge) { merged.dispose(); continue; }

      mergedSources += bucket.geometries.length;
      triangles += triCount;
      this.owned.push(merged);

      const near = new THREE.Mesh(merged, bucket.material);
      near.castShadow = bucket.castShadow;
      near.receiveShadow = bucket.receiveShadow;
      near.layers.mask = bucket.layer;
      near.name = 'Batch';
      // World transforms are baked into the vertices, so the batch itself
      // sits at the origin with an identity matrix — and never needs
      // updating again.
      near.matrixAutoUpdate = false;
      near.updateMatrix();

      const simplified = this.lodStrength > 0
        ? this.decimate(merged, this.lodStrength)
        : null;

      // THREE.LOD switches on distance to the node's ORIGIN, which is only a
      // sane proxy for "how far away is this object" when the object is small
      // relative to that distance. A merged cell can be tens of metres across
      // — the Shipment ground batch is 54 m wide — so the player can stand ON
      // a batch whose centre is 30 m away and see it snap to its lowest
      // level. Only attach an LOD when the cell is small enough for the
      // centre-distance test to mean something.
      // mergeGeometries does NOT compute bounds, so this must be explicit —
      // reading .boundingSphere directly would be null here and silently
      // disable every LOD (radius 0 fails the size test below).
      if (!merged.boundingSphere) merged.computeBoundingSphere();
      const lodRadius = merged.boundingSphere?.radius ?? 0;
      const lodWorthwhile = simplified !== null
        && this.lodDistance > 0
        && lodRadius > 0
        // Require the swap distance to clear the cell's own radius with
        // margin, so no part of the geometry is ever nearer than the
        // distance at which we claim it is far away.
        && this.lodDistance > lodRadius * 1.75;

      if (lodWorthwhile && simplified) {
        const lod = new THREE.LOD();
        lod.autoUpdate = false; // we drive update() ourselves, once per frame
        const far = new THREE.Mesh(simplified, bucket.material);
        far.castShadow = false; // distant batches never cast: invisible saving
        far.receiveShadow = bucket.receiveShadow;
        far.layers.mask = bucket.layer;
        far.name = 'BatchLOD';
        far.matrixAutoUpdate = false;
        far.updateMatrix();
        lod.addLevel(near, 0);
        lod.addLevel(far, this.lodDistance);
        // LOD picks a level by distance to the OBJECT's origin. Vertices are
        // in world space, so the origin is meaningless — park the LOD node at
        // the batch's real centre so the distance test is about the geometry.
        const centre = merged.boundingSphere?.center ?? new THREE.Vector3();
        lod.position.copy(centre);
        near.position.copy(centre).multiplyScalar(-1);
        near.updateMatrix();
        far.position.copy(centre).multiplyScalar(-1);
        far.updateMatrix();
        lod.name = 'BatchLOD_Group';
        objects.push(lod);
        this.owned.push(simplified);
        lodTriangles += simplified.attributes.position.count / 3;
      } else {
        // Decimated but rejected (cell too large for a centre-distance test):
        // free it here rather than tracking an orphan in `owned`.
        if (simplified) simplified.dispose();
        objects.push(near);
      }
      batches += 1;
    }

    return {
      objects,
      consumed: this.sources.slice(),
      stats: {
        sourceMeshes: mergedSources,
        batches,
        drawCallsSaved: Math.max(0, mergedSources - batches),
        triangles: Math.round(triangles),
        lodTriangles: Math.round(lodTriangles),
      },
    };
  }

  /**
   * Vertex-cluster decimation.
   *
   * Quadric-error simplification gives better results but needs a half-edge
   * structure and is far too slow to run on the main thread at load time for
   * every cell. Vertex clustering is O(n): snap every vertex to a 3D grid,
   * then drop triangles whose corners collapsed onto the same cell. At the
   * distances this LOD is used (>40 m) the difference is not perceptible,
   * and it typically removes 40-70% of triangles from these kit-built
   * structures because so much of their geometry is small repeated detail
   * (ribs, studs, rungs) that merges away entirely.
   */
  private decimate(geometry: THREE.BufferGeometry, strength: number): THREE.BufferGeometry | null {
    const pos = geometry.attributes.position;
    const nrm = geometry.attributes.normal;
    const box = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
      pos as THREE.BufferAttribute,
    );
    const size = new THREE.Vector3();
    box.getSize(size);
    const grid = size.length() * strength;
    if (!(grid > 0)) return null;

    const outPos: number[] = [];
    const outNrm: number[] = [];
    const keyOf = (x: number, y: number, z: number): string =>
      `${Math.round(x / grid)},${Math.round(y / grid)},${Math.round(z / grid)}`;

    for (let i = 0; i < pos.count; i += 3) {
      const ax = pos.getX(i); const ay = pos.getY(i); const az = pos.getZ(i);
      const bx = pos.getX(i + 1); const by = pos.getY(i + 1); const bz = pos.getZ(i + 1);
      const cx = pos.getX(i + 2); const cy = pos.getY(i + 2); const cz = pos.getZ(i + 2);
      const ka = keyOf(ax, ay, az);
      const kb = keyOf(bx, by, bz);
      const kc = keyOf(cx, cy, cz);
      // Degenerate after snapping → the triangle is below the grid size and
      // contributes nothing at LOD distance.
      if (ka === kb || kb === kc || ka === kc) continue;
      outPos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      if (nrm) {
        outNrm.push(
          nrm.getX(i), nrm.getY(i), nrm.getZ(i),
          nrm.getX(i + 1), nrm.getY(i + 1), nrm.getZ(i + 1),
          nrm.getX(i + 2), nrm.getY(i + 2), nrm.getZ(i + 2),
        );
      }
    }
    // Not enough was removed to be worth a second geometry + LOD switch.
    if (outPos.length === 0 || outPos.length > pos.count * 3 * 0.82) return null;

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    if (outNrm.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(outNrm, 3));
    else out.computeVertexNormals();
    out.computeBoundingSphere();
    return out;
  }

  /** Release every geometry this batcher created (level unload). */
  dispose(): void {
    for (const g of this.owned) g.dispose();
    this.owned.length = 0;
    this.buckets.clear();
    this.sources.length = 0;
    this.materialKeys.clear();
  }
}

export default StaticBatcher;
