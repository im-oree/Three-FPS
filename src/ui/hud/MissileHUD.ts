/**
 * MissileHUD.ts — the guided-missile camera feed, rebuilt to the reference
 * "military cam" layout (dark green night-vision wash with monochrome
 * telemetry chrome):
 *
 *   · top heading tape with cardinal ticks
 *   · corner blocks: AREA / DOC / LCTR / DIR + S/W coordinates (top-left),
 *     RNG / ELV / BRG (top-right)
 *   · centre ARM brackets that blink LOCKED warning states
 *   · pitch ladder scrolling against the horizon
 *   · fuel budget bar + control hint along the bottom
 *
 * The 3D scene itself is untouched — the whole "camera feed" illusion is
 * this overlay: a CSS green wash + scanlines, then a full-viewport canvas
 * repainted every frame with the chrome. (DOM-div chrome could not do the
 * scrolling tape/ladder; canvas also costs one composited layer.)
 */
import eventBus from '../../core/EventBus';
import { div } from '../dom';

const LINE = 'rgba(150,255,190,0.92)';
const DIM = 'rgba(150,255,190,0.55)';
const FAINT = 'rgba(150,255,190,0.28)';
const DANGER = 'rgba(255,90,77,0.95)';
const FONT = 'ui-monospace, "Cascadia Mono", monospace';

const CARDINALS: Array<[number, string]> = [
  [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
  [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'],
];

export class MissileHUD {
  readonly element = div('hud__missile');
  private readonly bars = div('cinematic-bars');

  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d');

  private visible = false;
  private dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  private cw = 0; // css-pixel size of the viewport
  private ch = 0;
  private lastFuel = 1;

  constructor() {
    this.canvas.className = 'missile__canvas';

    // Layer order: green wash over the scene -> scanlines -> drawn chrome.
    this.element.append(
      div('missile__wash'), div('missile__scanlines'), this.canvas,
    );

    // Letterbox is a sibling of the missile HUD, not a child: it is shown for
    // ANY cinematic, not only the missile's.
    this.bars.append(div('cinematic-bars__top'), div('cinematic-bars__bottom'));

    eventBus.on('cinematic:started', () => this.bars.classList.add('cinematic-bars--in'));
    eventBus.on('cinematic:ended', () => this.bars.classList.remove('cinematic-bars--in'));
    window.addEventListener('resize', () => this.resize());
  }

  /** The letterbox element, registered separately by main. */
  get barsElement(): HTMLElement { return this.bars; }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.element.classList.toggle('hud--active', visible);
    if (visible) this.resize(); // fresh size the instant the feed opens
  }

  /** Full telemetry frame. `x/z` are the missile's world metres (feed coords). */
  update(
    fuel: number, pitch: number,
    altitude = 0, heading = 0, boosting = false, x = 0, z = 0,
  ): void {
    if (!this.visible || !this.ctx) return;
    this.lastFuel = Math.max(0, fuel);
    if (this.cw === 0) this.resize();
    this.render(
      Math.max(0, fuel), pitch, Math.max(0, altitude),
      ((heading % 360) + 360) % 360, boosting, x, z,
    );
  }

  // ---------------------------------------------------------------- layout

  private resize(): void {
    const w = this.element.clientWidth;
    const h = this.element.clientHeight;
    if (w === 0 || h === 0) return;
    this.cw = w;
    this.ch = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  private render(
    fuel: number, pitch: number, altitude: number,
    heading: number, boosting: boolean, x: number, z: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = this.cw;
    const h = this.ch;
    ctx.clearRect(0, 0, w, h);

    // The letterbox bars own 11vh top and bottom; all chrome lives inside.
    const top = h * 0.115;
    const bot = h * 0.885;
    const cy = (top + bot) / 2;
    const cx = w / 2;

    // Boosting shakes the feed a touch — the missile is straining.
    const jitter = boosting ? (Math.random() - 0.5) * 2.2 : 0;
    ctx.save();
    ctx.translate(jitter, 0);

    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';

    this.drawHeadingTape(ctx, cx, top + 22, heading);
    this.drawCornerBlocks(ctx, w, top, altitude, heading, x, z);
    this.drawLadder(ctx, cx, cy, pitch, altitude);
    this.drawReticle(ctx, cx, cy, fuel, boosting);
    this.drawFuel(ctx, cx, bot, fuel);
    this.drawBottomChrome(ctx, w, bot, boosting);

    // CRT refresh: one slow bright line drifting down the feed.
    const sweepY = top + ((performance.now() / 4200) % 1.2) * (bot - top);
    if (sweepY < bot) {
      ctx.fillStyle = 'rgba(150,255,190,0.06)';
      ctx.fillRect(0, sweepY, w, 2.5);
    }
    // Sensor noise — sparse green specks, new every frame.
    ctx.fillStyle = 'rgba(150,255,190,0.10)';
    for (let i = 0; i < 70; i += 1) {
      ctx.fillRect(
        Math.random() * w, top + Math.random() * (bot - top), 1.4, 1.4,
      );
    }
    ctx.restore();
  }

  /** Scrolling compass strip across the top of the feed. */
  private drawHeadingTape(
    ctx: CanvasRenderingContext2D, cx: number, y: number, heading: number,
  ): void {
    const pxPerDeg = 5;
    const halfSpan = 220; // px of tape visible each side of centre

    ctx.strokeStyle = FAINT;
    ctx.beginPath();
    ctx.moveTo(cx - halfSpan - 30, y);
    ctx.lineTo(cx + halfSpan + 30, y);
    ctx.stroke();

    ctx.textAlign = 'center';
    const first = Math.floor((heading - halfSpan / pxPerDeg) / 5) * 5;
    for (let a = first; a <= heading + halfSpan / pxPerDeg; a += 5) {
      const deg = ((a % 360) + 360) % 360;
      const x = cx + (a - heading) * pxPerDeg;
      if (Math.abs(x - cx) > halfSpan + 26) continue;
      const major = deg % 45 === 0;
      ctx.strokeStyle = major ? LINE : DIM;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - (major ? 10 : 5));
      ctx.stroke();
      if (deg % 10 === 0) {
        const cardinal = CARDINALS.find(([d]) => d === deg);
        ctx.fillStyle = major ? LINE : DIM;
        ctx.font = `${cardinal ? 'bold ' : ''}10px ${FONT}`;
        ctx.fillText(cardinal ? cardinal[1] : `${deg / 10}`, x, y - 17);
      }
    }

    // Centre caret + boxed numeric heading.
    ctx.fillStyle = LINE;
    ctx.beginPath();
    ctx.moveTo(cx, y + 3);
    ctx.lineTo(cx - 5, y + 11);
    ctx.lineTo(cx + 5, y + 11);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.strokeRect(cx - 17, y + 14, 34, 15);
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillText(
      `${Math.round(heading).toString().padStart(3, '0')}°`, cx, y + 22,
    );
  }

  /** AREA/DOC/LCTR/DIR + S/W coords (left), RNG/ELV/BRG (right). */
  private drawCornerBlocks(
    ctx: CanvasRenderingContext2D,
    w: number, top: number,
    altitude: number, heading: number, x: number, z: number,
  ): void {
    const y0 = top + 64; // clear of the heading tape
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'left';

    const rows: string[] = [
      'AREA   SECTOR 117',
      `DOC    TU-${(140 + Math.round((x + z) % 7 + 7) % 7)}R ONLINE`,
      'LCTR   AGM-114R',
      `DIR    ${Math.round(heading).toString().padStart(3, '0')} DEG`,
      '',
      `S ${Math.abs(Math.round(z * 10)).toString().padStart(6, '0')}`,
      `W ${Math.abs(Math.round(x * 10)).toString().padStart(6, '0')}`,
    ];
    rows.forEach((row, i) => {
      if (row === '') return;
      ctx.fillStyle = i < 4 ? LINE : DIM;
      ctx.fillText(row, 26, y0 + i * 15);
    });

    // Right block.
    const rng = Math.round(altitude * 1.35); // slant-ish estimate
    ctx.textAlign = 'right';
    const right = [
      `RNG  ${rng.toString().padStart(4, ' ')} M`,
      `ELV  ${Math.round(altitude).toString().padStart(4, ' ')} M`,
      `BRG  ${Math.round(heading).toString().padStart(3, '0')} DEG`,
    ];
    right.forEach((row, i) => {
      ctx.fillStyle = LINE;
      ctx.fillText(row, w - 26, y0 + i * 15);
    });
    // Recording indicator.
    if (Math.floor(performance.now() / 700) % 2 === 0) {
      ctx.fillStyle = DANGER;
      ctx.beginPath();
      ctx.arc(w - 34, y0 - 22, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = LINE;
      ctx.fillText('REC', w - 44, y0 - 22);
    }
  }

  /** Pitch ladder: 10-degree rungs scrolling against the horizon. */
  private drawLadder(
    ctx: CanvasRenderingContext2D, cx: number, cy: number,
    pitch: number, altitude: number,
  ): void {
    const pxPerDeg = 4.2;
    const rungHalf = 78;
    const gap = 34; // centre gap for the reticle
    const pitchDeg = (pitch * 180) / Math.PI;

    ctx.font = `9px ${FONT}`;
    ctx.setLineDash([]);
    for (let a = -40; a <= 40; a += 10) {
      if (a === 0) continue; // the horizon itself is drawn separately
      const y = cy + (pitchDeg - a) * pxPerDeg;
      if (Math.abs(y - cy) > this.ch * 0.34) continue;
      ctx.strokeStyle = a < 0 ? FAINT : DIM;
      if (a < 0) ctx.setLineDash([5, 4]);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * gap, y);
        ctx.lineTo(cx + side * (gap + rungHalf), y);
        ctx.lineTo(cx + side * (gap + rungHalf), y + (a < 0 ? 6 : -6));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = DIM;
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.abs(a)}`, cx + gap + rungHalf + 6, y);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.abs(a)}`, cx - gap - rungHalf - 6, y);
    }

    // Horizon line + centre cross ticks.
    const hy = cy + pitchDeg * pxPerDeg;
    if (Math.abs(hy - cy) < this.ch * 0.4) {
      ctx.strokeStyle = LINE;
      ctx.beginPath();
      ctx.moveTo(cx - 200, hy);
      ctx.lineTo(cx - gap, hy);
      ctx.moveTo(cx + gap, hy);
      ctx.lineTo(cx + 200, hy);
      ctx.stroke();
    }

    // Altitude ribbon on the right edge of the ladder zone.
    ctx.textAlign = 'right';
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = LINE;
    ctx.fillText(
      `${Math.round(altitude).toString().padStart(4, ' ')} M`, cx + 215, cy,
    );
  }

  /** Centre target brackets with the ARM/state readout. */
  private drawReticle(
    ctx: CanvasRenderingContext2D, cx: number, cy: number,
    fuel: number, boosting: boolean,
  ): void {
    const low = fuel < 0.22;
    const bracket = 46;
    const len = 14;
    const warn = low || boosting;

    ctx.strokeStyle = low ? DANGER : LINE;
    if (low && Math.floor(performance.now() / 260) % 2 === 0) {
      ctx.strokeStyle = FAINT; // blink while critical
    }
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * bracket, cy + sy * bracket - sy * len);
      ctx.lineTo(cx + sx * bracket, cy + sy * bracket);
      ctx.lineTo(cx + sx * bracket - sx * len, cy + sy * bracket);
      ctx.stroke();
    }
    // Boresight dot.
    ctx.fillStyle = warn ? DANGER : LINE;
    ctx.fillRect(cx - 1, cy - 1, 2, 2);

    ctx.textAlign = 'center';
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = warn ? DANGER : LINE;
    const label = boosting ? 'BOOST — AUTHORITY CUT'
      : low ? 'FUEL CRITICAL' : 'ARM';
    ctx.fillText(label, cx, cy + bracket + 22);
  }

  /** Fuel budget bar just above the control hint. */
  private drawFuel(
    ctx: CanvasRenderingContext2D, cx: number, bot: number, fuel: number,
  ): void {
    const bw = 220;
    const y = bot - 46;
    const low = fuel < 0.22;
    ctx.textAlign = 'right';
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = DIM;
    ctx.fillText('FUEL', cx - bw / 2 - 8, y + 3);
    ctx.strokeStyle = DIM;
    ctx.strokeRect(cx - bw / 2, y, bw, 7);
    ctx.fillStyle = low ? DANGER : LINE;
    if (low && Math.floor(performance.now() / 200) % 2 === 0) return; // blink
    ctx.fillRect(cx - bw / 2 + 1, y + 1, (bw - 2) * Math.min(1, fuel), 5);
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(fuel * 100)}%`, cx + bw / 2 + 8, y + 3);
  }

  private drawBottomChrome(
    ctx: CanvasRenderingContext2D, w: number, bot: number,
    boosting: boolean,
  ): void {
    ctx.textAlign = 'center';
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = DIM;
    ctx.fillText(
      boosting ? 'BOOSTING — STEERING LIMITED' : 'MOUSE  STEER      FIRE  BOOST',
      w / 2, bot - 20,
    );
  }

  /** Test seams. */
  get isVisible(): boolean { return this.visible; }
  get fuelScale(): number { return this.lastFuel; }
}

export default MissileHUD;
