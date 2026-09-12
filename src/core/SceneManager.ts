/**
 * SceneManager.ts — owns the active THREE.Scene and the single
 * THREE.PerspectiveCamera, and supports swapping scenes later (Document 4's
 * LevelLoader will call setScene()).
 */
import * as THREE from 'three';
import { CAMERA, CLOCK, TEMP_SCENE } from '../utils/Constants';
import type Clock from './Clock';

export class SceneManager {
  private scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock: Clock;

  // TEMPORARY — pipeline verification only. Remove/replace in Document 2
  // (movement testing arena) and Document 4 (real levels).
  private tempCube: THREE.Mesh | null = null;

  constructor(clock: Clock) {
    this.clock = clock;
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.DEFAULT_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA.NEAR,
      CAMERA.FAR,
    );
    // Document 1: static verification framing. Document 2 hands the camera to
    // PlayerCamera and removes this pose.
    this.camera.position.set(CAMERA.VERIFY_POSITION.x, CAMERA.VERIFY_POSITION.y, CAMERA.VERIFY_POSITION.z);
    this.camera.lookAt(0, 0, 0);

    this.scene = this.buildVerificationScene();
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /** Replace the active scene (Document 4 level loading seam). */
  setScene(newScene: THREE.Scene): void {
    this.scene = newScene;
    this.tempCube = null;
  }

  /** Called by Renderer's resize handler to keep projection undistorted. */
  setCameraAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Per-frame hook. Document 1 uses it solely to spin the temporary test cube
   * through the fixed-timestep accumulator (proves Clock.stepFixed works and
   * that animation is delta-time driven, not per-frame hardcoded).
   */
  update(_dt: number): void {
    // TEMPORARY — pipeline verification only (see Section 6.2 of Document 1).
    if (!this.tempCube) return;
    this.clock.stepFixed(CLOCK.FIXED_DT, (fixedDt) => {
      const cube = this.tempCube;
      if (!cube) return;
      cube.rotation.y += TEMP_SCENE.CUBE_SPIN_RAD_PER_SEC * fixedDt;
      cube.rotation.x += TEMP_SCENE.CUBE_SPIN_RAD_PER_SEC * 0.6 * fixedDt;
    });
  }

  // TEMPORARY — pipeline verification only. Remove/replace in Document 2
  // (movement testing arena) and Document 4 (real levels).
  private buildVerificationScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10131a);

    // Soft ambient fill.
    const ambient = new THREE.AmbientLight(TEMP_SCENE.AMBIENT_COLOR, TEMP_SCENE.AMBIENT_INTENSITY);
    scene.add(ambient);

    // The "sun": directional, shadow-casting, frustum tightly fitted to the
    // ~20x20 unit test area (Three's defaults would give blurry shadows).
    const sun = new THREE.DirectionalLight(TEMP_SCENE.SUN_COLOR, TEMP_SCENE.SUN_INTENSITY);
    sun.position.set(TEMP_SCENE.SUN_POSITION.x, TEMP_SCENE.SUN_POSITION.y, TEMP_SCENE.SUN_POSITION.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(TEMP_SCENE.SHADOW_MAP_SIZE, TEMP_SCENE.SHADOW_MAP_SIZE);
    sun.shadow.camera.left = TEMP_SCENE.SHADOW_BOUNDS.left;
    sun.shadow.camera.right = TEMP_SCENE.SHADOW_BOUNDS.right;
    sun.shadow.camera.top = TEMP_SCENE.SHADOW_BOUNDS.top;
    sun.shadow.camera.bottom = TEMP_SCENE.SHADOW_BOUNDS.bottom;
    sun.shadow.camera.near = TEMP_SCENE.SHADOW_BOUNDS.near;
    sun.shadow.camera.far = TEMP_SCENE.SHADOW_BOUNDS.far;
    scene.add(sun);

    // Ground plane receiving shadows.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(TEMP_SCENE.GROUND_SIZE, TEMP_SCENE.GROUND_SIZE),
      new THREE.MeshStandardMaterial({ color: TEMP_SCENE.GROUND_COLOR, roughness: 0.95, metalness: 0.0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Spinning shadow-casting cube.
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(TEMP_SCENE.CUBE_SIZE, TEMP_SCENE.CUBE_SIZE, TEMP_SCENE.CUBE_SIZE),
      new THREE.MeshStandardMaterial({ color: TEMP_SCENE.CUBE_COLOR, roughness: 0.5, metalness: 0.15 }),
    );
    cube.position.y = TEMP_SCENE.CUBE_HEIGHT;
    cube.castShadow = true;
    scene.add(cube);
    this.tempCube = cube;

    return scene;
  }
}

export default SceneManager;
