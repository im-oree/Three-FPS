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
import type Clock from './Clock';

export class SceneManager {
  private scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

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
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /** Replace the active scene (level loading seam). */
  setScene(newScene: THREE.Scene): void {
    this.scene = newScene;
  }

  /** Called by Renderer's resize handler to keep projection undistorted. */
  setCameraAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

export default SceneManager;
