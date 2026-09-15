/**
 * MinimapPreview.ts — animated live preview inside Settings, using the SAME
 * capture pass the HUD minimap uses.
 *
 * The settings menu owns a plain <canvas>; main's post-render hook asks this
 * module every frame — when a preview canvas is attached and visible, an
 * ortho capture of the world (spun by a slow demo yaw so the user sees the
 * rotate-with-player behaviour immediately) is rendered into the framebuffer
 * region under the canvas and composited in. Turning rotate on/off or
 * dragging the zoom slider therefore changes the preview LIVE, in the same
 * vocabulary the actual in-game dish will use: same camera, same scale,
 * same ring/tick/marker overlay — there is exactly one minimap system.
 *
 * The preview swaps the real player observer for an animated demo observer
 * (same position, spinning yaw) so the rotation behaviour is visible without
 * asking the user to be in a match.
 */
import * as THREE from 'three';
import type LiveMinimapCapture from './LiveMinimapCapture';
import { drawPlayerTriangle } from '../radarMapDraw';
import { getMinimapRotate, getMinimapZoomMeters } from './MinimapSettings';

export interface MinimapObserverSource {
  x: number;
  z: number;
}

/**
 * Renderer-independent "world has actual content" probe: MAIN_MENU with no
 * level loaded falls back to the built-in diorama, so the preview always has
 * something to show (a menu empty-world capture would be a void).
 */
export type HasWorldContent = () => boolean;

const PREVIEW_REFRESH_HZ = 12;
const DEMO_SPIN_RAD_PER_S = 0.5;

/**
 * A tiny deterministic block-town used ONLY when no real level is loaded
 * (first launch before any deployment). Rotation and zoom demonstrate
 * identically on it — every option maps through the same capture pass.
 */
function buildPreviewDiorama(): THREE.Scene {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x30343c, 1.6);
  scene.add(hemi);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshStandardMaterial({ color: 0x8a8580 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const palette = [0xb3352c, 0x2c5ea3, 0x3a6b3f, 0xd8a418];
  const boxes: Array<[number, number, number, number, number]> = [
    [0, 0, 16, 9, 0], [-14, -10, 10, 7, 0.4], [14, -8, 12, 8, -0.3],
    [-10, 14, 8, 10, 0.2], [10, 14, 9, 9, 0], [24, 2, 6, 6, 0.7],
  ];
  boxes.forEach(([x, z, w, d, ry], i) => {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, 3 + (i % 3), d),
      new THREE.MeshStandardMaterial({ color: palette[i % palette.length] }),
    );
    box.position.set(x, (3 + (i % 3)) / 2, z);
    box.rotation.y = ry;
    scene.add(box);
  });

  // Two reference walls so north-south antenna-line readability is obvious.
  for (const z of [-32, 32]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(70, 4, 2),
      new THREE.MeshStandardMaterial({ color: 0x67697c }),
    );
    wall.position.set(0, 2, z);
    scene.add(wall);
  }
  return scene;
}

class MinimapPreviewBus {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private accumulator = 0;
  private demoYaw = 0;
  private diorama: THREE.Scene | null = null;

  /** Settings menu attaches its canvas (null detaches). May be a detached node. */
  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    if (!canvas) { this.ctx = null; return; }
    canvas.width = 320;
    canvas.height = 320;
    this.ctx = canvas.getContext('2d');
    this.accumulator = 1; // force an immediate tick
  }

  /**
   * Driven from the post-render hook; renders only when it should (attached,
   * visible in layout) and only at PREVIEW_REFRESH_HZ.
   */
  renderIfActive(
    dt: number,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    capture: LiveMinimapCapture,
    observerSource: MinimapObserverSource,
    hasWorldContent: HasWorldContent = () => true,
  ): void {
    if (!this.canvas || !this.ctx) return;
    if (!this.canvas.isConnected || this.canvas.getClientRects().length === 0) return;
    this.accumulator += dt;
    if (this.accumulator < 1 / PREVIEW_REFRESH_HZ) return;
    this.accumulator = 0;
    this.demoYaw += (1 / PREVIEW_REFRESH_HZ) * DEMO_SPIN_RAD_PER_S;

    const cssRect = this.canvas.getBoundingClientRect();
    const scale = renderer.domElement.width / renderer.domElement.clientWidth;
    const rect = {
      x: Math.round(cssRect.left * scale),
      y: Math.round(renderer.domElement.height - cssRect.bottom * scale),
      size: Math.round(cssRect.width * scale),
    };
    if (rect.size < 4) return;

    // Prefer the real live world; before any level was ever loaded there is
    // nothing above the ground plane, so present the diorama instead.
    const worldLoaded = hasWorldContent();
    const source = worldLoaded ? scene : (this.diorama ??= buildPreviewDiorama());
    const ox = worldLoaded ? observerSource.x : 0;
    const oz = worldLoaded ? observerSource.z : 0;

    const rotate = getMinimapRotate();
    capture.render(
      renderer, source,
      { x: ox, z: oz, yaw: this.demoYaw },
      getMinimapZoomMeters(), rotate, rect,
    );

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    const sy = renderer.domElement.height - rect.y - rect.size;
    ctx.drawImage(renderer.domElement, rect.x, sy, rect.size, rect.size, 0, 0, w, h);

    // Dish rim + rings (same vocabulary as the HUD).
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    const half = w / 2;
    for (const frac of [0.33, 0.66, 1]) {
      ctx.beginPath();
      ctx.arc(half, half, (half - 6) * frac, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawPlayerTriangle(ctx, half, half, rotate ? 0 : this.demoYaw, 12);
    ctx.restore();

    // Frame.
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }
}

/** Module-level singleton — exactly one preview surface can ever exist. */
export const minimapPreview = new MinimapPreviewBus();
export default minimapPreview;
