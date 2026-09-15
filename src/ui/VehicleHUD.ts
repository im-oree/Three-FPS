/**
 * VehicleHUD.ts — the in-vehicle instrument cluster.
 *
 * Per-domain layout, because the numbers that matter differ:
 *   land  — speed, gear, a tachometer-ish load bar, handbrake
 *   air   — speed, ALTITUDE (the number that keeps you alive), throttle,
 *           vertical speed, and an artificial horizon
 *   sea   — speed, heading
 *
 * Built from a single canvas rather than DOM nodes. The speed readout changes
 * every frame; doing that with DOM text means a layout pass per frame per
 * element, whereas a canvas the HUD owns costs one upload of a small texture
 * and keeps the whole cluster in one composite layer.
 */
import type { VehicleDefinition, VehicleState } from '../vehicles/VehicleTypes';

const W = 420;
const H = 150;

export class VehicleHUD {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private visible = false;
  /** Smoothed values so the needles do not jitter on a noisy frame. */
  private shownSpeed = 0;
  private shownLoad = 0;
  private shownAltitude = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.cssText = [
      'position:absolute',
      'right:24px',
      'bottom:24px',
      `width:${W}px`,
      `height:${H}px`,
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 160ms ease-out',
    ].join(';');

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('VehicleHUD: 2D context unavailable');
    ctx.scale(dpr, dpr);
    this.ctx = ctx;

    const root = document.getElementById('ui-root');
    if (root) root.appendChild(this.canvas);
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.canvas.style.opacity = '1';
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.canvas.style.opacity = '0';
  }

  update(dt: number, def: VehicleDefinition, state: VehicleState): void {
    if (!this.visible) return;

    // Exponential smoothing, frame-rate independent.
    const k = 1 - Math.exp(-9 * dt);
    const kmh = Math.abs(state.forwardSpeed) * 3.6;
    this.shownSpeed += (kmh - this.shownSpeed) * k;
    this.shownLoad += (state.throttleLoad - this.shownLoad) * k;
    this.shownAltitude += (state.altitude - this.shownAltitude) * k;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    // Panel
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    roundRect(ctx, 0, 0, W, H, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 4);
    ctx.stroke();

    // Vehicle name
    ctx.fillStyle = 'rgba(242,244,248,0.62)';
    ctx.font = '600 11px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.textAlign = 'left';
    ctx.fillText(def.displayName.toUpperCase(), 16, 22);

    if (def.domain === 'air') this.drawAir(state);
    else if (def.domain === 'sea') this.drawSea(state);
    else this.drawLand(def, state);

    // Damage bar, common to every domain.
    const healthFrac = state.health / def.maxHealth;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(16, H - 20, W - 32, 4);
    ctx.fillStyle = healthFrac > 0.5 ? '#6fcf7f'
      : healthFrac > 0.25 ? '#ffd76a' : '#ff6b5e';
    ctx.fillRect(16, H - 20, (W - 32) * healthFrac, 4);
  }

  private drawLand(def: VehicleDefinition, state: VehicleState): void {
    const ctx = this.ctx;

    // Big speed number.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f2f4f8';
    ctx.font = '700 46px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillText(String(Math.round(this.shownSpeed)).padStart(3, ' '), 150, 74);
    ctx.font = '600 12px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillStyle = 'rgba(242,244,248,0.55)';
    ctx.fillText('KM/H', 150, 92);

    // Gear: a synthetic readout derived from speed. The physics model has no
    // gearbox, but a driver expects to see a gear change as they accelerate,
    // and deriving it costs nothing versus simulating a transmission.
    const top = def.land?.topSpeed ?? 30;
    const frac = Math.abs(state.forwardSpeed) / Math.max(1, top);
    const gear = state.forwardSpeed < -0.6 ? 'R'
      : frac < 0.02 ? 'N'
        : String(Math.min(5, 1 + Math.floor(frac * 5)));
    ctx.textAlign = 'left';
    ctx.font = '700 30px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillStyle = gear === 'R' ? '#ffd76a' : '#f2f4f8';
    ctx.fillText(gear, 172, 70);
    ctx.font = '600 10px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillStyle = 'rgba(242,244,248,0.45)';
    ctx.fillText('GEAR', 172, 86);

    // Engine load bar.
    const barX = 224; const barW = W - barX - 16;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(barX, 52, barW, 10);
    const loadW = barW * Math.min(1, this.shownLoad);
    ctx.fillStyle = this.shownLoad > 0.85 ? '#ff6b5e' : '#6fa8ff';
    ctx.fillRect(barX, 52, loadW, 10);
    ctx.fillStyle = 'rgba(242,244,248,0.45)';
    ctx.font = '600 10px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillText('ENGINE', barX, 46);

    // Status flags.
    ctx.font = '600 11px ui-monospace,SFMono-Regular,Menlo,monospace';
    if (!state.grounded) {
      ctx.fillStyle = '#ffd76a';
      ctx.fillText('AIRBORNE', barX, 84);
    }
  }

  private drawAir(state: VehicleState): void {
    const ctx = this.ctx;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f2f4f8';
    ctx.font = '700 38px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillText(String(Math.round(this.shownSpeed)), 130, 66);
    ctx.font = '600 11px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillStyle = 'rgba(242,244,248,0.55)';
    ctx.fillText('KM/H', 130, 82);

    // Altitude is the number that keeps a pilot alive, so it gets equal weight.
    ctx.fillStyle = '#f2f4f8';
    ctx.font = '700 38px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillText(String(Math.round(this.shownAltitude)), 270, 66);
    ctx.font = '600 11px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillStyle = 'rgba(242,244,248,0.55)';
    ctx.fillText('ALT (M)', 270, 82);

    // Vertical speed, signed — the other number that keeps a pilot alive.
    const vs = state.velocity.y;
    ctx.fillStyle = vs < -6 ? '#ff6b5e' : 'rgba(242,244,248,0.85)';
    ctx.font = '700 20px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillText(`${vs >= 0 ? '+' : ''}${vs.toFixed(1)}`, 390, 62);
    ctx.font = '600 10px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillStyle = 'rgba(242,244,248,0.45)';
    ctx.fillText('V/S', 390, 78);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(16, 104, W - 32, 8);
    ctx.fillStyle = '#6fa8ff';
    ctx.fillRect(16, 104, (W - 32) * Math.min(1, this.shownLoad), 8);
  }

  private drawSea(state: VehicleState): void {
    const ctx = this.ctx;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f2f4f8';
    ctx.font = '700 44px ui-monospace,SFMono-Regular,Menlo,monospace';
    // Boats are quoted in knots; 1 m/s = 1.94384 kn.
    const knots = Math.abs(state.forwardSpeed) * 1.94384;
    ctx.fillText(knots.toFixed(1), 170, 74);
    ctx.font = '600 12px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillStyle = 'rgba(242,244,248,0.55)';
    ctx.fillText('KNOTS', 170, 92);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(224, 52, W - 240, 10);
    ctx.fillStyle = '#6fa8ff';
    ctx.fillRect(224, 52, (W - 240) * Math.min(1, this.shownLoad), 10);
  }

  dispose(): void { this.canvas.remove(); }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export default VehicleHUD;
