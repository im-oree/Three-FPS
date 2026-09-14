/**
 * TabletScreenRenderer.ts — Document I §2.4.
 *
 * Draws the tablet UI into a detached <canvas> and applies it as a
 * CanvasTexture on the screen mesh, so the UI is genuinely part of the 3D
 * world: viewable off-axis, occludable, lit as its own emissive surface.
 *
 * WHY Canvas2D rather than a render target: the tablet shows flat tiles, text
 * and rings, not a 3D scene. Canvas2D is far cheaper, matches the flat
 * aesthetic, and at a deliberate 12 Hz refresh costs essentially nothing even
 * though it is live.
 */
import * as THREE from 'three';
import { TABLET_UI } from '../utils/Constants';

export type TabletDrawFn = (
  ctx: CanvasRenderingContext2D, width: number, height: number,
) => void;

export class TabletScreenRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  readonly texture: THREE.CanvasTexture;
  private dirty = true;
  private accumulator = 0;

  constructor(screenMesh: THREE.Mesh, width = 256, height = 320) {
    this.canvas = document.createElement('canvas'); // never appended to the DOM
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Unlit: a screen is its own light source, so it must not be shaded by
    // the world or it goes black whenever the player stands in shadow.
    screenMesh.material = new THREE.MeshBasicMaterial({
      map: this.texture, toneMapped: false,
    });
  }

  markDirty(): void { this.dirty = true; }

  update(dt: number, draw: TabletDrawFn): void {
    this.accumulator += dt;
    if (this.accumulator < 1 / TABLET_UI.SCREEN_REFRESH_HZ && !this.dirty) return;
    this.accumulator = 0;
    this.dirty = false;
    if (!this.ctx) return;
    draw(this.ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

export default TabletScreenRenderer;
