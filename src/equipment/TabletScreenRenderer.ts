/**
 * TabletScreenRenderer.ts — Document I §2.4, extended for the live map.
 *
 * TWO-LAYER screen model:
 *   base layer  — the screen mesh itself. Carries the LIVE whole-map world
 *                 capture (a render-target texture) while the designation
 *                 map is open, or the default dark-glass tint otherwise.
 *   overlay     — a transparent quad cloned +1.5mm in front of the screen,
 *                 carrying the Canvas2D UI texture (titles, tiles, cursor,
 *                 contacts, confirm rings). The overlay draws for EVERY
 *                 screen, so UI code never branches between "with map" and
 *                 "without map" — the base simply changes what sits behind.
 *
 * This is the zero-readback composition path: the map stays a GPU texture
 * end-to-end, which is exactly why the live map costs one tiny scene pass
 * at 12 Hz and nothing else (fullscreen region grabs/CPU blits never happen).
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
  private readonly overlayMesh: THREE.Mesh;
  private readonly baseScreenMesh: THREE.Mesh;
  private readonly baseDarkMaterial: THREE.MeshBasicMaterial;
  private readonly baseMapMaterial: THREE.MeshBasicMaterial;
  private dirty = true;
  private accumulator = 0;

  constructor(screenMesh: THREE.Mesh, width = 256, height = 320) {
    this.baseScreenMesh = screenMesh;
    this.baseDarkMaterial = new THREE.MeshBasicMaterial({
      color: 0x0c1210, toneMapped: false,
    });
    this.baseMapMaterial = new THREE.MeshBasicMaterial({
      toneMapped: false,
    });
    screenMesh.material = this.baseDarkMaterial;

    // Transparent UI overlay, a hair in front of the base screen.
    this.canvas = document.createElement('canvas'); // never appended to the DOM
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const overlayMaterial = new THREE.MeshBasicMaterial({
      map: this.texture, toneMapped: false, transparent: true,
      depthWrite: false,
    });
    this.overlayMesh = screenMesh.clone();
    this.overlayMesh.material = overlayMaterial;
    this.overlayMesh.position.z += 0.0015;
    this.overlayMesh.renderOrder = screenMesh.renderOrder + 1;
    screenMesh.parent?.add(this.overlayMesh);
  }

  /** Wire the live tablet-map texture in (TabletLiveMap owns the content). */
  bindLiveMapTexture(texture: THREE.Texture): void {
    this.baseMapMaterial.map = texture;
    this.baseMapMaterial.needsUpdate = true;
  }

  /** Map mode on: base shows the live capture. Off: base shows dark glass. */
  setMapMode(active: boolean): void {
    this.baseScreenMesh.material = active ? this.baseMapMaterial : this.baseDarkMaterial;
  }

  /**
   * Counter-rotate the base capture so the map's north stays world-up on
   * screen while the device physically rolls (Document M era landscape map
   * mode). The overlay canvas gets its own -PI/2 correction for landscape;
   * the base image needs the SAME correction in the opposite sign convention
   * (texture UV rotation vs 2D context rotation) or glyphs and imagery
   * disagree by exactly 90 degrees — the "map is sideways" bug.
   *
   * `roll01` is the tablet's physical landscape roll blend, so the image
   * counter-rolls 1:1 with the wrist motion instead of snapping.
   */
  setMapRoll(roll01: number): void {
    const map = this.baseMapMaterial.map;
    if (!map) return;
    const target = roll01 * (Math.PI / 2);
    if (Math.abs(map.rotation - target) < 1e-4) return;
    map.center.set(0.5, 0.5);
    map.rotation = target;
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
