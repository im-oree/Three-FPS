/**
 * Minimap.ts — HUD minidish. Two presentation modes (Settings → Video):
 *
 *   'live'  — a REAL top-down render of the world follows the player
 *             (LiveMinimapCapture), composited into the dish circle every
 *             tick. Correct on every map forever — no baked images, nothing
 *             RAM-hungry to generate, and it shows live world state.
 *   'radar' — the classic abstract tactical dish (Document I §3.2): range
 *             rings + compass ticks + contact blips. Cheap fallback mode.
 *
 * Orientation is a player option in BOTH modes: fixed-north (north up, the
 * player triangle spins) or rotate-with-player (triangle locked pointing
 * up, the world spins beneath it). Zoom (world metres to dish edge) applies
 * to both modes' projection AND the live capture's ortho extents, so the
 * settings preview, the capture pass and every blip share ONE scale.
 *
 * The live composite has a strict frame-ordering contract: the ortho
 * capture must be rendered into the framebuffer BEFORE this canvas does its
 * 2D drawImage of it, inside the same synchronous frame, or the read is
 * undefined (preserveDrawingBuffer is off for performance). Minimap.update
 * therefore only THROTTLES; the actual capture+draw is driven from main's
 * post-render hook via renderLiveFrame().
 */
import * as THREE from 'three';
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import { MINIMAP } from '../../utils/Constants';
import { div } from '../dom';
import {
  drawPlayerTriangle, drawRadarContact, makeRadarProjection,
  type RadarContactLike,
} from '../radarMapDraw';
import type { RadarContactRegistry } from '../../world/RadarContactRegistry';
import calloutZoneRegistry from '../../world/CalloutZoneRegistry';
import type LiveMinimapCapture from './LiveMinimapCapture';
import {
  getMinimapMode, getMinimapRotate, getMinimapZoomMeters,
} from './MinimapSettings';

export interface MinimapDeps {
  getPlayerX: () => number;
  getPlayerZ: () => number;
  /** Camera yaw in radians. */
  getYaw: () => number;
}

const REFRESH_HZ = 15;

export class Minimap {
  readonly element = div('hud__minimap');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly compass = div('hud__compass');
  private readonly compassCanvas = document.createElement('canvas');
  private readonly compassCtx: CanvasRenderingContext2D | null;
  private accumulator = 0;
  private playing = false;
  private compositeDue = false;
  /**
   * Document N §7: callout names, rasterised ONCE per level into an
   * offscreen canvas and blitted each frame.
   *
   * Text layout is the expensive part of canvas 2D — measuring and shaping
   * ~24 labels at 15 Hz is real per-frame cost for content that never
   * changes. The labels live in WORLD space on this layer, so the composite
   * only has to translate (and, in rotate mode, rotate) it into place.
   */
  private calloutLayer: HTMLCanvasElement | null = null;
  private calloutLayerOrigin = { x: 0, z: 0 };
  private calloutLayerScale = 1;
  private calloutLayerZoneCount = -1;

  constructor(
    private readonly registry: RadarContactRegistry,
    private readonly deps: MinimapDeps,
  ) {
    const px = MINIMAP.PIXEL_SIZE;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = px * dpr;
    this.canvas.height = px * dpr;
    this.canvas.style.width = `${px}px`;
    this.canvas.style.height = `${px}px`;
    this.ctx = this.canvas.getContext('2d');
    this.ctx?.scale(dpr, dpr);

    this.compassCanvas.width = px * dpr;
    this.compassCanvas.height = 18 * dpr;
    this.compassCanvas.style.width = `${px}px`;
    this.compassCanvas.style.height = '18px';
    this.compassCtx = this.compassCanvas.getContext('2d');
    this.compassCtx?.scale(dpr, dpr);

    this.element.appendChild(this.canvas);
    this.compass.appendChild(this.compassCanvas);

    eventBus.on('game:stateChanged', (payload) => {
      this.playing = (payload as { current: string }).current === GameState.PLAYING;
      this.element.classList.toggle('hud--active', this.playing);
    });
  }

  update(dt: number): void {
    if (!this.playing) return;
    this.accumulator += dt;
    if (this.accumulator < 1 / REFRESH_HZ) return;
    this.accumulator = 0;
    if (getMinimapMode() === 'live') {
      // The capture pass must run inside the render frame; flag it and let
      // renderLiveFrame() finish this tick right after the world pass.
      this.compositeDue = true;
    } else {
      this.drawRadarDish();
    }
    this.drawCompass();
  }

  /**
   * Called from main's post-render hook, AFTER the world+viewmodel passes,
   * every frame. No-ops unless the throttled update marked a composite due.
   */
  renderLiveFrame(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    capture: LiveMinimapCapture,
  ): void {
    if (!this.compositeDue || !this.playing) return;
    this.compositeDue = false;
    const ctx = this.ctx;
    if (!ctx) return;

    const size = MINIMAP.PIXEL_SIZE;
    // The dish rect in CSS pixels, GL origin (bottom-left).
    //
    // NOT device pixels: renderer.setViewport/setScissor multiply whatever
    // they are given by the renderer's pixel ratio internally. Pre-scaling
    // here too squared the ratio, which was invisible while the ratio was
    // exactly 1 and became very visible once adaptive resolution started
    // driving it to ~0.5 — the capture landed in the wrong place and at the
    // wrong size, which is the minimap "not staying in its box".
    const el = renderer.domElement;
    const cssRect = this.canvas.getBoundingClientRect();
    if (cssRect.width < 2 || el.clientHeight < 2) return;
    const rect = {
      x: Math.round(cssRect.left),
      y: Math.round(el.clientHeight - cssRect.bottom),
      size: Math.round(cssRect.width),
    };
    const yaw = this.deps.getYaw();
    const rotate = getMinimapRotate();
    const zoomMeters = getMinimapZoomMeters();
    capture.render(
      renderer, scene,
      { x: this.deps.getPlayerX(), z: this.deps.getPlayerZ(), yaw },
      zoomMeters, rotate, rect,
    );

    const half = size / 2;
    ctx.clearRect(0, 0, size, size);
    // FULLY opaque corners: the scissored world square sits directly behind
    // this canvas — any translucency lets the square image ghost through the
    // corners around the circular dish.
    ctx.fillStyle = 'rgb(10, 13, 18)';
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.clip();
    // drawImage samples the BACKING STORE, so the CSS-pixel rect has to be
    // converted back into device pixels here — with the same ratio three.js
    // just used, read from the renderer rather than assumed.
    const dpr = renderer.getPixelRatio();
    const sx = Math.round(rect.x * dpr);
    const sSize = Math.max(1, Math.round(rect.size * dpr));
    // Y-flip: source canvas is top-left origin, the capture rect is bottom-left.
    const sy = Math.round(el.height - rect.y * dpr - sSize);
    ctx.drawImage(el, sx, sy, sSize, sSize, 0, 0, size, size);
    this.drawOverlays(ctx, yaw, rotate, zoomMeters);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Ring/tick/contact/marker overlay vocabulary shared by both modes. */
  private drawOverlays(
    ctx: CanvasRenderingContext2D, yaw: number, rotate: boolean, zoomMeters: number,
  ): void {
    const size = MINIMAP.PIXEL_SIZE;
    const half = size / 2;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    for (const frac of [0.33, 0.66, 1]) {
      ctx.beginPath();
      ctx.arc(half, half, (half - 2) * frac, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cardinal ticks — in rotate mode the tick ring itself spins so "N" stays
    // attached to real north (a real rotating-map compass read).
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '600 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cardinals: Array<[string, number]> = [
      ['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2],
    ];
    for (const [label, ang] of cardinals) {
      // Canvas angle of a world bearing under the image rotation derives from
      // the ortho camera's screen basis: image-x = R_y(-yaw)·dx etc. (derived
      // in rotateContact below). Bearing ang maps to canvas (ang + yaw) - PI/2.
      const screenAng = (rotate ? ang + yaw : ang) - Math.PI / 2;
      ctx.fillText(
        label,
        half + Math.cos(screenAng) * (half - 8),
        half + Math.sin(screenAng) * (half - 8),
      );
    }

    const px = this.deps.getPlayerX();
    const pz = this.deps.getPlayerZ();
    this.drawCalloutLabels(ctx, px, pz, yaw, rotate, zoomMeters);
    const projection = makeRadarProjection(half, half, half - 4, zoomMeters);
    for (const c of this.registry.getActiveContacts()) {
      drawRadarContact(ctx, projection, this.rotateContact(c, yaw, rotate), px, pz, 3);
    }
    drawPlayerTriangle(ctx, half, half, rotate ? 0 : yaw, 6);
  }

  /**
   * Build (once) and blit the callout-name layer.
   *
   * Rebuilt only when the zone set changes — i.e. on level load — which is
   * why the guard is a zone COUNT rather than a time or a dirty flag: it is
   * the cheapest thing that is actually correct across a level swap.
   */
  /** TEST-ONLY seam: the cached callout-name layer (null before first draw). */
  get debugCalloutLayer(): HTMLCanvasElement | null { return this.calloutLayer; }

  private drawCalloutLabels(
    ctx: CanvasRenderingContext2D,
    px: number, pz: number, yaw: number, rotate: boolean, zoomMeters: number,
  ): void {
    const zones = calloutZoneRegistry.zones;
    if (!zones.length) return;

    const size = MINIMAP.PIXEL_SIZE;
    const half = size / 2;
    // Pixels per world metre, matching makeRadarProjection's scale exactly.
    const scale = (half - 4) / zoomMeters;

    if (this.calloutLayerZoneCount !== zones.length || this.calloutLayerScale !== scale) {
      this.buildCalloutLayer(zones, scale);
    }
    const layer = this.calloutLayer;
    if (!layer) return;

    // Clip to the dish, then place the world-space layer under the player.
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.72;
    ctx.translate(half, half);
    if (rotate) ctx.rotate(yaw);
    ctx.drawImage(
      layer,
      (this.calloutLayerOrigin.x - px) * scale,
      (this.calloutLayerOrigin.z - pz) * scale,
    );
    ctx.restore();
  }

  private buildCalloutLayer(
    zones: readonly { name: string; centroid: readonly [number, number] }[],
    scale: number,
  ): void {
    let minX = Infinity; let maxX = -Infinity;
    let minZ = Infinity; let maxZ = -Infinity;
    for (const z of zones) {
      minX = Math.min(minX, z.centroid[0]); maxX = Math.max(maxX, z.centroid[0]);
      minZ = Math.min(minZ, z.centroid[1]); maxZ = Math.max(maxZ, z.centroid[1]);
    }
    const pad = 40;
    const w = Math.ceil((maxX - minX) * scale) + pad * 2;
    const h = Math.ceil((maxZ - minZ) * scale) + pad * 2;
    if (!(w > 0 && h > 0) || w > 4096 || h > 4096) return;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    if (!c) return;

    c.font = '600 7px ui-monospace, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    for (const z of zones) {
      const x = (z.centroid[0] - minX) * scale + pad;
      const y = (z.centroid[1] - minZ) * scale + pad;
      const label = z.name.toUpperCase();
      // Dark halo first: callouts sit over sunlit dirt in the live capture,
      // and plain white text is unreadable against it.
      c.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      c.lineWidth = 2.5;
      c.strokeText(label, x, y);
      c.fillStyle = 'rgba(255, 245, 220, 0.95)';
      c.fillText(label, x, y);
    }

    this.calloutLayer = canvas;
    this.calloutLayerOrigin = { x: minX - pad / scale, z: minZ - pad / scale };
    this.calloutLayerScale = scale;
    this.calloutLayerZoneCount = zones.length;
  }

  /**
   * Blip positions must match the rotated image exactly. The ortho camera's
   * screen basis for up = (-sin y, 0, -cos y) is xAxis = (cos y, 0, -sin y),
   * yAxis = (-sin y, 0, -cos y), so a world offset (dx, dz) lands at image
   * coords (dx cos y - dz sin y, -dx sin y - dz cos y) with canvas Y flipped:
   * contact = rotate by R_y(-yaw) around the player, then drawn with the
   * normal fixed-north projection.
   */
  private rotateContact(c: RadarContactLike, yaw: number, rotate: boolean): RadarContactLike {
    if (!rotate) return c;
    const dx = c.x - this.deps.getPlayerX();
    const dz = c.z - this.deps.getPlayerZ();
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return {
      x: this.deps.getPlayerX() + dx * cos - dz * sin,
      z: this.deps.getPlayerZ() + dx * sin + dz * cos,
      type: c.type,
    };
  }

  /** Abstract tactical dish — the classic radar fallback mode. */
  private drawRadarDish(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const size = MINIMAP.PIXEL_SIZE;
    const half = size / 2;

    ctx.clearRect(0, 0, size, size);

    // Dish
    ctx.fillStyle = 'rgba(10, 13, 18, 0.66)';
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.clip();
    this.drawOverlays(ctx, this.deps.getYaw(), getMinimapRotate(), getMinimapZoomMeters());
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Heading tape — fine facing feedback the top-down view cannot give. */
  private drawCompass(): void {
    const ctx = this.compassCtx;
    if (!ctx) return;
    const w = MINIMAP.PIXEL_SIZE;
    const h = 18;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 13, 18, 0.66)';
    ctx.fillRect(0, 0, w, h);

    const yawDeg = ((-this.deps.getYaw() * 180) / Math.PI + 360) % 360;
    const pxPerDeg = w / 180; // 180 degrees of tape visible
    ctx.font = '600 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let deg = 0; deg < 360; deg += 15) {
      let delta = deg - yawDeg;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      const x = w / 2 + delta * pxPerDeg;
      if (x < -10 || x > w + 10) continue;
      const cardinal = ['N', 'E', 'S', 'W'][deg / 90];
      if (cardinal) {
        ctx.fillStyle = 'rgba(240, 160, 75, 0.95)';
        ctx.fillText(cardinal, x, h / 2 + 1);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.fillRect(x, h / 2 - 2, 1, 4);
      }
    }
    // Centre index mark.
    ctx.fillStyle = 'rgba(240, 160, 75, 1)';
    ctx.fillRect(w / 2 - 0.5, 0, 1, 4);
  }
}

export default Minimap;
