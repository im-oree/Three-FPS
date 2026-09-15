/**
 * TabletLiveMap.ts — the killstreak tablet's designation map is the SAME
 * live top-down world capture the HUD minimap uses (LiveMinimapCapture),
 * rendered into a render target and composed straight onto the tablet's
 * in-world screen mesh. No baked minimap images, no per-map authoring: the
 * actual world, live, always correct on every level the project already
 * loads — future prop-built maps included.
 *
 * View fit: the view shows the WHOLE world extents (vel: level bounds) with
 * correct proportions for the tablet screen's physical aspect (portrait —
 * or landscape when the device rolls into map mode), letterboxing with a
 * small margin in whichever dimension needs it, so the map is NEVER
 * squished and NEVER crops the world. The math is pure and shared between
 * the capture camera and the overlay projection, so the cursor, player
 * marker, contact blips and the image CANNOT disagree.
 */
import * as THREE from 'three';
import LiveMinimapCapture from '../ui/hud/LiveMinimapCapture';
import type { FrustumCullingManager } from '../core/FrustumCullingManager';

/** The level's playable surface bounds in world coordinates. */
export interface WorldExtents {
  centerX: number;
  centerZ: number;
  halfWidth: number;
  halfHeight: number;
}

/** The actual world region the screen shows (extents + aspect letterbox). */
export interface TabletMapView {
  centerX: number;
  centerZ: number;
  halfWidth: number;
  halfHeight: number;
}

/** Breathing room around the world bounds so edge geometry isn't clipped. */
const MARGIN = 1.05;

/**
 * Fit world extents into a display aspect (view width / view height),
 * growing whichever half-dimension needs it so the whole world stays inside.
 * Pure function — the capture camera and the overlay projection both use it.
 */
export function computeTabletView(
  extents: WorldExtents, displayAspect: number,
): TabletMapView {
  const needH = extents.halfWidth / displayAspect;
  const halfHeight = Math.max(extents.halfHeight, needH) * MARGIN;
  const halfWidth = halfHeight * displayAspect;
  return {
    centerX: extents.centerX, centerZ: extents.centerZ, halfWidth, halfHeight,
  };
}

/** Physical aspect (width/height) of the in-world screen plane, per the GLB builder. */
export const TABLET_SCREEN_ASPECT = 0.196 / 0.256;       // portrait
export const TABLET_SCREEN_ASPECT_LANDSCAPE = 0.256 / 0.196;

export class TabletLiveMap {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly capture: LiveMinimapCapture;
  private extents: WorldExtents = {
    centerX: 0, centerZ: 0, halfWidth: 60, halfHeight: 60,
  };

  constructor(culling: FrustumCullingManager | null = null) {
    this.capture = new LiveMinimapCapture(culling);
    this.target = new THREE.WebGLRenderTarget(384, 384);
    // sRGB end-to-end: the capture writes display-encoded values into the
    // RT (NoColorSpace stored LINEAR, which the tablet screen material then
    // displayed as-is → the whole map washed out to a white sheet).
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** Applied when a level loads; defaults serve levels without explicit bounds. */
  setWorldExtents(extents: WorldExtents): void {
    this.extents = extents;
  }

  get texture(): THREE.Texture { return this.target.texture; }

  /** Render the live whole-map view for the given screen aspect. */
  render(
    renderer: THREE.WebGLRenderer, scene: THREE.Scene, displayAspect: number,
  ): void {
    const view = computeTabletView(this.extents, displayAspect);
    this.capture.renderRegionToTarget(
      renderer, scene,
      view.centerX, view.centerZ, view.halfWidth, view.halfHeight,
      this.target,
    );
  }

  /**
   * World point -> 0..1 screen-plane UV (u right, v down) using the SAME
   * view math as the capture, so overlay glyphs land exactly over the image.
   */
  worldToUV(
    worldX: number, worldZ: number, displayAspect: number,
  ): { u: number; v: number } {
    const view = computeTabletView(this.extents, displayAspect);
    return {
      u: 0.5 + (worldX - view.centerX) / (view.halfWidth * 2),
      v: 0.5 + (worldZ - view.centerZ) / (view.halfHeight * 2),
    };
  }

  getView(displayAspect: number): TabletMapView {
    return computeTabletView(this.extents, displayAspect);
  }
}

export default TabletLiveMap;
