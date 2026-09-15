/**
 * LiveMinimapCapture.ts — the REAL map on the minimap, live.
 *
 * A top-down orthographic camera follows the player and renders the actual
 * world scene into a scissored corner of the default framebuffer once per
 * minimap tick; the HUD minimap's Canvas2D then copies that region into the
 * dish circle with drawImage (a zero-cost GPU-resident readback — no
 * readPixels/GPU stalls anywhere in the pipeline).
 *
 * Why live instead of a baked per-map PNG (the user call): a baked image is
 * a) large in RAM at the resolution a minimap deserves, b) stale the moment
 * a level changes, c) can't move with the player. The live capture is always
 * correct on EVERY map — including maps built at runtime by the map builder
 * — and shows actual world state (smoke above a grenade spot, the airstrike
 * jet crossing, other characters) for free.
 *
 * Render hygiene: fog is temporarily nulled during the capture or the
 * top-down view would be one grey wash; the sky/background is replaced with
 * the tactical dark dish backdrop; only the WORLD layer renders (no
 * viewmodel arms, no character silhouette in 1PS).
 *
 * Rotation: the camera's up vector IS the map's "up". Fixed-north keeps
 * (0,0,-1); rotate-with-player sets up = the player's forward vector, which
 * makes the player marker permanently face up while the world spins beneath
 * them — exactly the COD "rotate map" option.
 */
import * as THREE from 'three';
import { LAYER } from '../../core/RenderLayers';
import type { FrustumCullingManager } from '../../core/FrustumCullingManager';

export interface MinimapObserver {
  readonly x: number;
  readonly z: number;
  /** Radians, three.js yaw convention (0 = looking down -Z). */
  readonly yaw: number;
}

/** Device-pixel rect in the framebuffer, GL convention (origin bottom-left). */
export interface CaptureRect {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

const CAPTURE_HEIGHT = 130;
const DISH_BACKDROP = new THREE.Color(0x0a0d12);

/** Capture-pass scene-light tune: the tactical dish reads far better with
 *  the HDRI ambient knocked down (full IBL washes the asphalt texture into
 *  a bright noisy sheet at 130 m altitude). Saved and restored per pass. */
const CAPTURE_ENVIRONMENT_INTENSITY = 0.25;

export class LiveMinimapCapture {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 500);
  private readonly savedClear = new THREE.Color();
  private readonly up = new THREE.Vector3();
  private readonly culling: FrustumCullingManager | null;

  constructor(culling: FrustumCullingManager | null = null) {
    this.culling = culling;
    this.camera.layers.set(LAYER.WORLD);
    // Skin-mounted points (muzzle tanks etc.) on other layers never matter here.
  }

  /** The capture camera must COUNT as an active camera for the frame of the
   *  capture or the union could hide things standing outside the player's
   *  frustum yet inside the top-down view. Pushed, flushed, released. */
  private beginCapturePass(): () => void {
    if (!this.culling) return () => undefined;
    // Tactical capture: detail bands are for the gameplay camera; the
    // sat-view wants every prop inside its frustum, altitude be damned.
    const release = this.culling.pushCamera(this.camera, { ignoreDistanceBands: true });
    this.culling.flushNow();
    return release;
  }

  /** Dim the HDRI/ambient contribution for the duration of the capture. */
  private beginLightPass(scene: THREE.Scene): () => void {
    const saved = scene.environmentIntensity;
    scene.environmentIntensity = Math.min(saved, CAPTURE_ENVIRONMENT_INTENSITY);
    return () => { scene.environmentIntensity = saved; };
  }

  /**
   * One synchronous capture pass. Must run AFTER the main scene render inside
   * the same frame, before the framebuffer composited out (post-render hook),
   * so the minimap canvas can drawImage() it immediately afterwards.
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    observer: MinimapObserver,
    radiusMeters: number,
    rotateWithPlayer: boolean,
    rect: CaptureRect,
  ): void {
    if (radiusMeters <= 0 || rect.size <= 2) return;
    const cam = this.camera;
    cam.left = -radiusMeters;
    cam.right = radiusMeters;
    cam.top = radiusMeters;
    cam.bottom = -radiusMeters;
    cam.updateProjectionMatrix();

    cam.position.set(observer.x, CAPTURE_HEIGHT, observer.z);
    if (rotateWithPlayer) {
      // up = player forward in three.js yaw: forward = (−sin y, 0, −cos y),
      // which is exactly world "north on screen" = the direction the marker
      // points. The world thus spins under a fixed up-pointing marker.
      this.up.set(-Math.sin(observer.yaw), 0, -Math.cos(observer.yaw));
    } else {
      this.up.set(0, 0, -1); // fixed-north
    }
    cam.up.copy(this.up);
    cam.lookAt(observer.x, 0, observer.z);

    // --- swap atmosphere for the tactical pass ---------------------------
    const savedFog = scene.fog;
    const savedBackground = scene.background;
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedClear);
    scene.fog = null;
    scene.background = null;
    renderer.setClearColor(DISH_BACKDROP, 1);

    const savedViewport = new THREE.Vector4();
    renderer.getViewport(savedViewport);
    const savedScissor = new THREE.Vector4();
    renderer.getScissor(savedScissor);
    const savedScissorTest = renderer.getScissorTest();
    const savedAutoClear = renderer.autoClear;
    const savedRT = renderer.getRenderTarget();

    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(rect.x, rect.y, rect.size, rect.size);
    renderer.setViewport(rect.x, rect.y, rect.size, rect.size);
    renderer.clear(true, true, false);
    const releaseCamera = this.beginCapturePass();
    const releaseLight = this.beginLightPass(scene);
    renderer.render(scene, cam);
    releaseLight();
    releaseCamera();

    // --- restore -----------------------------------------------------------
    renderer.setRenderTarget(savedRT);
    renderer.setViewport(savedViewport);
    renderer.setScissor(savedScissor);
    renderer.setScissorTest(savedScissorTest);
    renderer.autoClear = savedAutoClear;
    scene.fog = savedFog;
    scene.background = savedBackground;
    renderer.setClearColor(this.savedClear, savedClearAlpha);
  }

  /**
   * Rectangular whole-region variant rendered into a WebGLRenderTarget —
   * the killstreak tablet's designation map composes this texture straight
   * onto its in-world screen mesh (no CPU readback). `halfWidth`/`halfHeight`
   * are world metres from the center to each view edge; the caller computes
   * them from world extents × display aspect (TabletLiveMap).
   */
  renderRegionToTarget(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    centerX: number,
    centerZ: number,
    halfWidth: number,
    halfHeight: number,
    target: THREE.WebGLRenderTarget,
  ): void {
    const cam = this.camera;
    cam.left = -halfWidth;
    cam.right = halfWidth;
    cam.top = halfHeight;
    cam.bottom = -halfHeight;
    cam.updateProjectionMatrix();
    cam.position.set(centerX, CAPTURE_HEIGHT, centerZ);
    this.up.set(0, 0, -1); // fixed-north, the tablet's convention
    cam.up.copy(this.up);
    cam.lookAt(centerX, 0, centerZ);

    const savedFog = scene.fog;
    const savedBackground = scene.background;
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedClear);
    scene.fog = null;
    scene.background = null;
    renderer.setClearColor(DISH_BACKDROP, 1);
    const savedRT = renderer.getRenderTarget();

    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    const releaseCamera = this.beginCapturePass();
    const releaseLight = this.beginLightPass(scene);
    renderer.render(scene, cam);
    releaseLight();
    releaseCamera();

    renderer.setRenderTarget(savedRT);
    scene.fog = savedFog;
    scene.background = savedBackground;
    renderer.setClearColor(this.savedClear, savedClearAlpha);
  }
}

export default LiveMinimapCapture;
