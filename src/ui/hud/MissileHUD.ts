/**
 * MissileHUD.ts — Document I §6.7, plus the cinematic letterbox bars (§6.4).
 *
 * Shown only while the input context is 'missileControl'. A bracket reticle,
 * a fuel bar that pulses red near empty, an artificial horizon (the player has
 * no peripheral reference at missile-cam FOV), and a CRT scanline wash so it
 * reads as a camera feed rather than the player's own eyes.
 */
import eventBus from '../../core/EventBus';
import { div } from '../dom';

export class MissileHUD {
  readonly element = div('hud__missile');
  private readonly bars = div('cinematic-bars');
  private readonly fuelFill = div('missile__fuel-fill');
  private readonly horizon = div('missile__horizon');
  private readonly status = div('missile__status', 'GUIDANCE ACTIVE');
  private readonly altValue = div('missile__tele-value', '0');
  private readonly hdgValue = div('missile__tele-value', '0');
  private readonly dveValue = div('missile__tele-value', '0');
  private readonly hint = div('missile__hint', 'MOUSE: STEER     HOLD FIRE: BOOST');
  private visible = false;

  constructor() {
    // Letterbox is a sibling of the missile HUD, not a child: it is shown for
    // ANY cinematic, not only the missile's.
    this.bars.append(div('cinematic-bars__top'), div('cinematic-bars__bottom'));

    const reticle = div('missile__reticle');
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      reticle.appendChild(div(`missile__bracket missile__bracket--${corner}`));
    }
    const fuel = div('missile__fuel');
    fuel.append(div('missile__fuel-label', 'FUEL'), this.fuelFill);

    // Telemetry readouts — a real missile feed shows altitude, heading and
    // dive angle. With no peripheral reference at this FOV the player has
    // nothing else to judge the approach by.
    const tele = div('missile__telemetry');
    for (const [label, value] of [
      ['ALT', this.altValue], ['HDG', this.hdgValue], ['DVE', this.dveValue],
    ] as const) {
      const cell = div('missile__tele');
      cell.append(div('missile__tele-label', label), value);
      tele.appendChild(cell);
    }

    this.element.append(
      div('missile__scanlines'), this.horizon, reticle, tele,
      fuel, this.status, this.hint,
    );

    eventBus.on('cinematic:started', () => this.bars.classList.add('cinematic-bars--in'));
    eventBus.on('cinematic:ended', () => this.bars.classList.remove('cinematic-bars--in'));
  }

  /** The letterbox element, registered separately by main. */
  get barsElement(): HTMLElement { return this.bars; }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.element.classList.toggle('hud--active', visible);
  }

  /** Full telemetry frame. */
  update(
    fuel: number, pitch: number,
    altitude = 0, heading = 0, boosting = false,
  ): void {
    if (!this.visible) return;
    this.fuelFill.style.transform = `scaleX(${Math.max(0, fuel).toFixed(3)})`;
    const low = fuel < 0.22;
    this.fuelFill.classList.toggle('missile__fuel-fill--low', low);

    this.status.textContent = boosting
      ? 'BOOST — STEERING REDUCED'
      : low ? 'FUEL CRITICAL' : 'GUIDANCE ACTIVE';
    this.status.classList.toggle('missile__status--warn', low || boosting);

    this.altValue.textContent = `${Math.max(0, Math.round(altitude))}m`;
    this.hdgValue.textContent = `${Math.round(heading).toString().padStart(3, '0')}`;
    this.dveValue.textContent = `${Math.round((pitch * 180) / Math.PI)}`;

    // Horizon line slides with pitch: below centre in a dive.
    this.horizon.style.transform = `translateY(${(-pitch * 150).toFixed(1)}px)`;
    this.element.classList.toggle('hud__missile--boost', boosting);
  }

  /** Test seams. */
  get isVisible(): boolean { return this.visible; }
  get fuelScale(): number {
    const m = /scaleX\(([\d.]+)\)/.exec(this.fuelFill.style.transform);
    return m ? Number(m[1]) : 1;
  }
}

export default MissileHUD;
