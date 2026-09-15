/**
 * HUDManager.ts — Document 5 §8.
 *
 * Owns every in-match HUD widget and is shown only during PLAYING. It is
 * hidden while paused (the standard convention, and the one §8 asks us to
 * pick and stay consistent with).
 *
 * Each widget is bound to events that already existed — this document
 * surfaces gameplay rather than changing it. The one exception is the
 * crosshair, which needs live spread and therefore reads it each frame from
 * the weapon rather than waiting for an event.
 */
import * as THREE from 'three';
import eventBus from '../../core/EventBus';
import gameStateManager, { GameState } from '../../state/GameStateManager';
import { HEALTH, HUD as HUD_CONST } from '../../utils/Constants';
import { div, el } from '../dom';
import type AudioManager from '../../audio/AudioManager';

export interface HUDDeps {
  audio: AudioManager;
  /** Current spread cone half-angle in degrees, for the crosshair. */
  getSpreadDegrees: () => number;
  /** Camera, to convert a damage source into a screen-edge direction. */
  getCameraYaw: () => number;
  getPlayerPosition: () => THREE.Vector3;
}

export class HUDManager {
  readonly element = div('hud');

  // health
  private readonly healthNum = div('hud__health-num', '100');
  private readonly healthFill = div('hud__health-fill');
  // ammo
  private readonly ammoMag = div('hud__ammo-mag', '30');
  private readonly ammoReserve = div('hud__ammo-reserve', '/ 120');
  private readonly ammoName = div('hud__ammo-name', 'RIFLE');
  private readonly ammoBlock = div('hud__ammo');
  // crosshair
  private readonly chSegs: HTMLElement[] = [];
  private crosshair: HTMLElement | null = null;
  // markers
  private readonly hitMarker = div('hud__hitmarker');
  private readonly damageDir = div('hud__damage-dir');
  private readonly damageWedge = div('hud__damage-dir-wedge');
  private readonly vignette = div('hud__vignette');
  private readonly hint = div('hud__hint', '');

  /**
   * Hide the parts of the HUD that only mean something when the player is
   * holding a weapon.
   *
   * Driving keeps the health bar, minimap and killstreaks — those still
   * apply — but the ammo counter, crosshair and equipment readout describe a
   * gun the player is not currently using, and the ammo block sits exactly
   * where the vehicle HUD draws its speed and gear.
   */
  setWeaponHudVisible(visible: boolean): void {
    this.ammoBlock.style.display = visible ? '' : 'none';
    if (this.crosshair) this.crosshair.style.display = visible ? '' : 'none';
  }

  private hitTimer = 0;
  private damageTimer = 0;
  private damageAngle = 0;
  private healthFraction = 1;

  constructor(private readonly deps: HUDDeps) {
    this.buildHealth();
    this.buildAmmo();
    this.buildCrosshair();
    this.buildMarkers();
    this.element.append(this.vignette, this.hint);
    this.bindEvents();
  }

  private buildHealth(): void {
    const block = div('hud__health');
    const bar = div('hud__health-bar');
    bar.appendChild(this.healthFill);
    block.append(div('hud__label', 'Vitals'), this.healthNum, bar);
    this.element.appendChild(block);
  }

  private buildAmmo(): void {
    const line = div();
    line.style.display = 'flex';
    line.style.alignItems = 'baseline';
    line.style.justifyContent = 'flex-end';
    line.style.gap = '8px';
    line.append(this.ammoMag, this.ammoReserve);
    this.ammoBlock.append(line, this.ammoName);
    this.element.appendChild(this.ammoBlock);
  }

  private buildCrosshair(): void {
    const ch = div('hud__crosshair');
    this.crosshair = ch;
    for (const cls of ['up', 'down', 'left', 'right']) {
      const seg = div(`hud__ch-seg hud__ch-seg--${cls === 'up' || cls === 'down' ? 'v' : 'h'}`);
      seg.dataset.dir = cls;
      this.chSegs.push(seg);
      ch.appendChild(seg);
    }
    ch.appendChild(div('hud__ch-dot'));
    this.element.appendChild(ch);
  }

  private buildMarkers(): void {
    this.hitMarker.innerHTML = `
      <svg viewBox="0 0 24 24">
        <g stroke="#ffffff" stroke-width="2.4" stroke-linecap="round">
          <line x1="5" y1="5" x2="10" y2="10" />
          <line x1="19" y1="5" x2="14" y2="10" />
          <line x1="5" y1="19" x2="10" y2="14" />
          <line x1="19" y1="19" x2="14" y2="14" />
        </g>
      </svg>`;
    this.damageDir.appendChild(this.damageWedge);
    this.element.append(this.hitMarker, this.damageDir);
  }

  private bindEvents(): void {
    eventBus.on('player:healthChanged', (p) => {
      const { current, max } = p as { current: number; max: number };
      this.setHealth(current, max);
    });

    eventBus.on('weapon:ammoChanged', (p) => {
      const { magazineAmmo, reserveAmmo } = p as
        { magazineAmmo: number; reserveAmmo: number };
      this.setAmmo(magazineAmmo, reserveAmmo);
    });
    eventBus.on('weapon:switchComplete', (p) => {
      const { toWeaponId } = p as { toWeaponId?: string };
      if (toWeaponId) this.ammoName.textContent = toWeaponId.replace(/_/g, ' ').toUpperCase();
    });
    eventBus.on('weapon:viewmodelEquipped', (p) => {
      const { weaponId } = p as { weaponId?: string };
      if (weaponId) this.ammoName.textContent = weaponId.replace(/_/g, ' ').toUpperCase();
    });

    eventBus.on('combat:hit', (p) => {
      const isKill = Boolean((p as { isKill?: boolean }).isKill);
      this.showHitMarker(isKill);
    });

    eventBus.on('player:damaged', (p) => {
      const src = (p as { sourceWorldPosition?: { x: number; y: number; z: number } | null })
        .sourceWorldPosition;
      this.showDamageFrom(src ?? null);
      this.deps.audio.playSound2D('ui/ui_damage.wav', { volume: 0.8, key: 'ui_damage' });
    });

    eventBus.on('game:stateChanged', (p) => {
      const { current } = p as { current: string };
      this.element.classList.toggle('hud--active', current === GameState.PLAYING);
    });
  }

  // --- widgets -------------------------------------------------------------

  setHealth(current: number, max: number): void {
    const fraction = Math.max(0, Math.min(1, current / max));
    this.healthFraction = fraction;
    this.healthNum.textContent = String(Math.ceil(current));
    this.healthFill.style.transform = `scaleX(${fraction.toFixed(3)})`;
    this.healthFill.style.background = fraction <= HEALTH.LOW_THRESHOLD
      ? 'var(--ui-danger)'
      : fraction < 0.6 ? 'var(--ui-accent)' : 'var(--ui-good)';

    // Low-health vignette. CSS, not a shader: Document 6 may later fold this
    // into a post-processing pass, in which case this is SUPERSEDED, not
    // duplicated.
    if (fraction <= HEALTH.LOW_THRESHOLD) {
      const t = 1 - fraction / HEALTH.LOW_THRESHOLD;
      this.vignette.style.opacity = (0.25 + t * 0.6).toFixed(2);
      this.vignette.classList.add('hud__vignette--pulse');
    } else {
      this.vignette.style.opacity = '0';
      this.vignette.classList.remove('hud__vignette--pulse');
    }
  }

  setAmmo(magazine: number, reserve: number): void {
    this.ammoMag.textContent = String(magazine);
    this.ammoReserve.textContent = `/ ${reserve}`;
    this.ammoBlock.classList.toggle('hud__ammo--empty', magazine === 0);
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  private showHitMarker(isKill: boolean): void {
    this.hitTimer = isKill ? HUD_CONST.KILL_MARKER_SECONDS : HUD_CONST.HIT_MARKER_SECONDS;
    this.hitMarker.classList.add('hud__hitmarker--show');
    this.hitMarker.classList.toggle('hud__hitmarker--kill', isKill);
    this.deps.audio.playSound2D(
      isKill ? 'ui/ui_kill_marker.wav' : 'ui/ui_hit_marker.wav',
      { volume: 0.6, key: isKill ? 'ui_kill_marker' : 'ui_hit_marker' },
    );
  }

  /**
   * Point the wedge at the damage source. The angle is the horizontal bearing
   * from where the camera is FACING to where the damage came from, so the
   * wedge stays glued to the attacker as the player turns.
   */
  private showDamageFrom(source: { x: number; y: number; z: number } | null): void {
    this.damageTimer = HUD_CONST.DAMAGE_INDICATOR_SECONDS;
    if (!source) {
      this.damageAngle = 0;
    } else {
      const p = this.deps.getPlayerPosition();
      const dx = source.x - p.x;
      const dz = source.z - p.z;
      // World bearing to the source, minus where we are looking.
      const bearing = Math.atan2(dx, -dz);
      this.damageAngle = bearing - this.deps.getCameraYaw();
    }
    this.damageDir.style.opacity = '1';
  }

  /**
   * Per-frame work: marker timers and the live crosshair.
   *
   * Runs even while paused (registered as an always-updatable) so a marker
   * cannot freeze mid-flash on the screen behind a pause menu.
   */
  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitMarker.classList.remove('hud__hitmarker--show');
    }
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      // Keep the wedge pointing at the source while the player turns.
      this.damageDir.style.transform = `rotate(${this.damageAngle}rad)`;
      this.damageDir.style.opacity =
        Math.min(1, this.damageTimer / HUD_CONST.DAMAGE_INDICATOR_SECONDS).toFixed(2);
      if (this.damageTimer <= 0) this.damageDir.style.opacity = '0';
    }

    if (!gameStateManager.is(GameState.PLAYING)) return;

    // Crosshair tracks the REAL spread cone, not a decorative approximation.
    const spread = this.deps.getSpreadDegrees();
    const gap = HUD_CONST.CROSSHAIR_BASE_GAP + spread * HUD_CONST.CROSSHAIR_PX_PER_DEGREE;
    for (const seg of this.chSegs) {
      // Pin BOTH axes on every arm. The vertical arms are 2px wide and the
      // horizontal ones 8px, so each needs its cross-axis explicitly centred
      // or the arm floats off to a corner instead of framing the reticle.
      switch (seg.dataset.dir) {
        case 'up':
          seg.style.left = '-1px';
          seg.style.top = `${-gap - 8}px`;
          break;
        case 'down':
          seg.style.left = '-1px';
          seg.style.top = `${gap}px`;
          break;
        case 'left':
          seg.style.top = '-1px';
          seg.style.left = `${-gap - 8}px`;
          break;
        default:
          seg.style.top = '-1px';
          seg.style.left = `${gap}px`;
          break;
      }
    }
  }

  /** Test seams. */
  get healthFractionForTest(): number { return this.healthFraction; }
  get isHitMarkerVisible(): boolean {
    return this.hitMarker.classList.contains('hud__hitmarker--show');
  }
  get isVignetteActive(): boolean {
    return parseFloat(this.vignette.style.opacity || '0') > 0.01;
  }
  get crosshairGap(): number {
    return parseFloat(this.chSegs[1]?.style.top || '0');
  }
  get damageIndicatorVisible(): boolean {
    return parseFloat(this.damageDir.style.opacity || '0') > 0.01;
  }
}

export default HUDManager;
void el;
