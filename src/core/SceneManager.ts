/**
 * SceneManager.ts — owns the active THREE.Scene and the single
 * THREE.PerspectiveCamera, and supports swapping scenes (Document 4's
 * LevelLoader will call setScene(); Document 2's TestArena already does).
 *
 * Document 1's temporary verification scene (spinning cube) was removed here
 * in Document 2, as its TEMPORARY marker promised. The default scene is now an
 * empty stage; content is supplied by whoever calls setScene().
 */
import * as THREE from 'three';
import { CAMERA } from '../utils/Constants';
import { FrustumCullingManager } from './FrustumCullingManager';
import type Clock from './Clock';

export class SceneManager {
  private scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  /** Global multi-camera union culling (see FrustumCullingManager). Owned
   *  here so it exists for — and ticks in — EVERY scene, present and future.
   *  The main camera is registered once for the manager's whole lifetime;
   *  secondary cameras (minimap/tablet capture, cinematics) push/pop. */
  readonly culling: FrustumCullingManager;

  constructor(_clock: Clock) {
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.DEFAULT_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA.NEAR,
      CAMERA.FAR,
    );
    // Neutral start pose; Document 2's PlayerCamera takes over per-frame
    // control of this same camera instance (ownership stays here).
    this.camera.position.set(CAMERA.VERIFY_POSITION.x, CAMERA.VERIFY_POSITION.y, CAMERA.VERIFY_POSITION.z);
    this.camera.lookAt(0, 0, 0);
    this.camera.rotation.order = 'YXZ';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10131a);
    // Document 2.5 §3.1: ViewmodelRigRoot is a CHILD of this camera, so the
    // camera must live in the scene graph for its subtree to render.
    this.scene.add(this.camera);

    this.culling = new FrustumCullingManager();
    // The main camera is an active camera for the manager's entire life.
    this.culling.pushCamera(this.camera);
  }

  /** Per-frame tick, called by the Engine JUST before the render passes so
   *  every registered camera has already been positioned for this frame
   *  and the culling union is exact. */
  update(_dt: number): void {
    this.culling.update();
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /** Replace the active scene (level loading seam). The camera (and with it
   *  the whole viewmodel subtree) travels across scene swaps. */
  setScene(newScene: THREE.Scene): void {
    newScene.add(this.camera);
    this.scene = newScene;
    // Old scene's culling registrations die with it; anything visible-false
    // is restored first so leaked references never stay hidden.
    this.culling.clearEntries();
  }

  /** Called by Renderer's resize handler to keep projection undistorted. */
  setCameraAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

export default SceneManager;
