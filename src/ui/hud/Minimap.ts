/**
 * Minimap.ts — Document I §3.2. STANDING core UI, not killstreak-specific:
 * it exists from spawn, and the UAV is simply what most dramatically fills it.
 *
 * FIXED-NORTH convention (the modern-shooter standard): north is always up
 * and the player is a rotating triangle. Cheaper than rotating every blip
 * each frame, and easier to read than a spinning map.
 *
 * Canvas2D drawn at a throttled rate — a radar does not need 60 fps.
 */
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import { MINIMAP } from '../../utils/Constants';
import { div } from '../dom';
import type { RadarContactRegistry } from '../../world/RadarContactRegistry';

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
    this.element.appendChild(this.compass);

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
    this.draw();
    this.drawCompass();
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const size = MINIMAP.PIXEL_SIZE;
    const half = size / 2;
    const scale = half / MINIMAP.RADIUS_METERS;

    ctx.clearRect(0, 0, size, size);

    // Dish
    ctx.fillStyle = 'rgba(10, 13, 18, 0.66)';
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.fill();

    // Range rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    for (const frac of [0.33, 0.66, 1]) {
      ctx.beginPath();
      ctx.arc(half, half, (half - 2) * frac, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Cardinal ticks (fixed north)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '600 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', half, 8);
    ctx.fillText('S', half, size - 8);
    ctx.fillText('W', 8, half);
    ctx.fillText('E', size - 8, half);

    // Contacts. World +X is map right, world -Z is map UP (north), which
    // matches the project's -Z-forward convention.
    const px = this.deps.getPlayerX();
    const pz = this.deps.getPlayerZ();
    for (const c of this.registry.getActiveContacts()) {
      const dx = (c.x - px) * scale;
      const dz = (c.z - pz) * scale;
      if (Math.hypot(dx, dz) > half - 4) continue; // out of radar range
      const mx = half + dx;
      const my = half + dz;
      ctx.fillStyle = c.type === 'hostile' ? '#e2503f'
        : c.type === 'friendly' ? '#5aa9e6' : '#e0b53f';
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player arrow, rotating in place.
    const yaw = this.deps.getYaw();
    ctx.save();
    ctx.translate(half, half);
    // Screen-space rotation: yaw 0 faces -Z, which is up on this map.
    ctx.rotate(-yaw);
    ctx.fillStyle = '#f0f2f5';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
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

  /** Test seam. */
  get contactCount(): number { return this.registry.size; }
}

export default Minimap;
