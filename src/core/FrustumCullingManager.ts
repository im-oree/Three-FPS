/**
 * FrustumCullingManager.ts — GLOBAL, scene-agnostic visibility culling,
 * owned by SceneManager so it is present in (and ticks for) EVERY scene.
 *
 * Why this exists when three.js already frustum-culls per object at render
 * time:
 *
 * 1. MULTI-CAMERA UNION. The game renders from more than the main camera:
 *    the live minimap/tablet top-down capture camera is a second active
 *    camera, and cinematics can register more. Three culls per camera per
 *    render — it can never answer "is this object visible to ANY active
 *    camera?", which is what real systems need to skip per-frame work
 *    (crane sway animators, prop light updates, future NPC ticks) and to
 *    drop objects from every render PASS at once (a hidden object also
 *    leaves the shadow map pass, which per-render culling never does).
 *
 * 2. DISTANCE BANDS. Editorial control three does not give: "small dressing
 *    props need not exist beyond 90 m" — with the union rule below this is
 *    still capture-safe, because the top-down capture camera registers
 *    itself while it renders and its own distance/frustum test counts.
 *
 * Union semantics: an entry is VISIBLE when at least ONE registered camera
 * passes BOTH its frustum test and its distance-band test; hidden only when
 * every active camera rejects it. Cameras are pushed/popped (the capture
 * camera exists only for the frame its capture runs), so the union is
 * re-evaluated against exactly the cameras that will render this frame.
 *
 * Cost: N entries × C cameras × 6 plane tests, all out of precomputed
 * world-space bounding spheres — nothing is re-derived per frame, no
 * allocation beyond per-camera frustum refresh. Margins around spheres
 * guard against edge pop without hysteresis state.
 *
 * Ownership contract: the manager OWNS `object.visible` of everything
 * registered with it. Don't hand it objects another system toggles.
 */
import * as THREE from 'three';

export interface CullingEntryOptions {
  /** World-space bounds. Auto-derived from the object graph when omitted. */
  readonly boundingSphere?: THREE.Sphere;
  /** Extra metres around the sphere so grazing-edge pop can't occur. */
  readonly margin?: number;
  /** Distance band in metres; undefined/0 = frustum-only. */
  readonly maxDistance?: number;
  /** Fired only on transitions — the integration seam for skip-work wins. */
  readonly onVisibilityChange?: (visible: boolean) => void;
  /** Debug label for stats dumps. */
  readonly id?: string;
}

export interface CullingHandle {
  /** Current union-visibility as of the last update tick. */
  isVisible(): boolean;
  /** Remove from the manager; the object is left VISIBLE (safe default). */
  release(): void;
}

interface CullingEntry {
  object: THREE.Object3D;
  sphere: THREE.Sphere;
  margin: number;
  maxDistance: number;
  onVisibilityChange?: (visible: boolean) => void;
  id: string;
  visible: boolean;
}

const DEFAULT_MARGIN = 0.75;

export interface CullingCameraOptions {
  /** Strategic/capture cameras (top-down tablet sat-map) want full detail
   *  inside their frustum regardless of altitude: skip the band test. */
  readonly ignoreDistanceBands?: boolean;
}

export class FrustumCullingManager {
  private readonly entries: CullingEntry[] = [];
  private readonly cameras = new Map<THREE.Camera, number>();
  private readonly frustums = new Map<THREE.Camera, THREE.Frustum>();
  private readonly camPositions = new Map<THREE.Camera, THREE.Vector3>();
  private readonly camFlags = new Map<THREE.Camera, CullingCameraOptions>();
  private readonly projScreen = new THREE.Matrix4();
  private readonly testSphere = new THREE.Sphere();
  private enabled = true;

  /** Register a camera that renders (or will render this frame). Returns a
   *  release function; refcounted so independent systems can share one. */
  pushCamera(camera: THREE.Camera, options: CullingCameraOptions = {}): () => void {
    const count = (this.cameras.get(camera) ?? 0) + 1;
    this.cameras.set(camera, count);
    if (count === 1) {
      this.frustums.set(camera, new THREE.Frustum());
      this.camPositions.set(camera, new THREE.Vector3());
      this.camFlags.set(camera, options);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.cameras.get(camera) ?? 1) - 1;
      if (remaining <= 0) {
        this.cameras.delete(camera);
        this.frustums.delete(camera);
        this.camPositions.delete(camera);
        this.camFlags.delete(camera);
      } else {
        this.cameras.set(camera, remaining);
      }
    };
  }

  /** Register an object with auto-derived world-space bounds. */
  register(object: THREE.Object3D, options: CullingEntryOptions = {}): CullingHandle {
    object.updateWorldMatrix(true, true);
    const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
    return this.registerSphere(object, options.boundingSphere ?? sphere, options);
  }

  /** Register an object against bounds the caller controls — REQUIRED for
   *  InstancedMesh (their geometry box ignores instances) and for groups
   *  whose contents grow after registration. The sphere object is stored
   *  by reference: mutate it later to move/reshape the bounds, no re-register. */
  registerSphere(
    object: THREE.Object3D,
    boundingSphere: THREE.Sphere,
    options: CullingEntryOptions = {},
  ): CullingHandle {
    const entry: CullingEntry = {
      object,
      sphere: boundingSphere,
      margin: options.margin ?? DEFAULT_MARGIN,
      maxDistance: options.maxDistance ?? 0,
      onVisibilityChange: options.onVisibilityChange,
      id: options.id ?? object.name ?? 'object',
      visible: true,
    };
    this.entries.push(entry);
    const manager = this;
    let released = false;
    return {
      isVisible: () => entry.visible,
      release(): void {
        if (released) return;
        released = true;
        const idx = manager.entries.indexOf(entry);
        if (idx >= 0) manager.entries.splice(idx, 1);
        entry.visible = true;
        if (!entry.object.visible) entry.object.visible = true;
        entry.onVisibilityChange?.(true);
      },
    };
  }

  /** Drop every entry (scene swap seam — cameras stay registered). */
  clearEntries(): void {
    for (const entry of this.entries) {
      if (!entry.object.visible) {
        entry.object.visible = true;
        entry.onVisibilityChange?.(true);
      }
    }
    this.entries.length = 0;
  }

  /** Per-frame union recompute. SceneManager ticks this just before render,
   *  after every camera has been positioned for the frame. */
  update(): void {
    if (!this.enabled || this.entries.length === 0) return;
    const { frustums, camPositions, projScreen, testSphere } = this;
    for (const [camera, frustum] of frustums) {
      camera.updateMatrixWorld();
      projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen);
      camera.getWorldPosition(camPositions.get(camera) ?? new THREE.Vector3());
    }
    for (const entry of this.entries) {
      let visible = false;
      for (const [camera, frustum] of frustums) {
        if (entry.maxDistance > 0 && !this.camFlags.get(camera)?.ignoreDistanceBands) {
          const camPos = camPositions.get(camera);
          if (camPos) {
            const distance = camPos.distanceTo(entry.sphere.center) - entry.sphere.radius;
            if (distance > entry.maxDistance + entry.margin) continue;
          }
        }
        testSphere.copy(entry.sphere);
        testSphere.radius += entry.margin;
        if (frustum.intersectsSphere(testSphere)) { visible = true; break; }
      }
      if (visible !== entry.visible) {
        entry.visible = visible;
        entry.object.visible = visible;
        entry.onVisibilityChange?.(visible);
      }
    }
  }

  /** Synchronous alias of update() — for capture code that pushes a camera
   *  and must have the union correct THIS frame before it renders. */
  flushNow(): void {
    this.update();
  }

  /** Master switch: when disabled, every entry is forced visible. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      for (const entry of this.entries) {
        if (!entry.visible) {
          entry.visible = true;
          entry.object.visible = true;
          entry.onVisibilityChange?.(true);
        }
      }
    }
  }

  getStats(): { cameras: number; registered: number; visible: number; hidden: number } {
    let visible = 0;
    for (const entry of this.entries) if (entry.visible) visible += 1;
    return {
      cameras: this.cameras.size,
      registered: this.entries.length,
      visible,
      hidden: this.entries.length - visible,
    };
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Debug/verification: per-entry snapshot (id, sphere, visibility). */
  debugDump(): Array<{ id: string; visible: boolean; center: [number, number, number]; radius: number; maxDistance: number }> {
    return this.entries.map((e) => ({
      id: e.id,
      visible: e.visible,
      center: [
        Math.round(e.sphere.center.x * 10) / 10,
        Math.round(e.sphere.center.y * 10) / 10,
        Math.round(e.sphere.center.z * 10) / 10,
      ],
      radius: Math.round(e.sphere.radius * 10) / 10,
      maxDistance: e.maxDistance,
    }));
  }
}

export default FrustumCullingManager;
