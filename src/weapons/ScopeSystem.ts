/**
 * ScopeSystem.ts — Document C §8.4/§8.5 + Document D §6.5.
 *
 * Owns everything about a MAGNIFIED optic that is not just "narrow the FOV":
 *
 *   - live variable magnification on the scroll wheel, clamped to the
 *     weapon's min/max, recomputing adsFOV = baseFOV / magnification
 *   - the breath-hold meter: a second, independent instance of the stamina
 *     meter pattern, draining while held and regenerating when not
 *   - scope breath sway, whose amplitude scales with magnification (real
 *     scope sway looks more dramatic at higher zoom for the same physical
 *     hand movement) and spikes further when the shooter is moving
 *
 * It deliberately owns NO rendering. The circular tunnel is ScopeOverlay's
 * job; this class is the simulation half, so it stays testable headlessly.
 *
 * STATE AUTHORITY: scoping is not a new character state — it is the existing
 * Aim.ADS state on a weapon whose profile says `variableScope`. This system
 * only reads that state, never sets it (see /CHARACTER_STATE.md rule 2).
 */
import eventBus from '../core/EventBus';
import { SCOPE } from '../utils/Constants';
import { clamp } from '../utils/MathUtils';
import type { WeaponProfile } from './WeaponProfile';

export interface ScopeSwayOutput {
  /** Additive yaw/pitch offsets in radians, applied AFTER look rotation. */
  yaw: number;
  pitch: number;
}

export class ScopeSystem {
  private magnification = 4;
  private profile: WeaponProfile | null = null;
  private scoped = false;
  /** Seconds of breath remaining. */
  private breath: number = SCOPE.BREATH_HOLD_SECONDS;
  private holding = false;
  /** Post-hold penalty timer: sway is amplified briefly after you run out. */
  private penalty = 0;
  private phase = 0;
  private readonly sway: ScopeSwayOutput = { yaw: 0, pitch: 0 };

  /** True only for an optic that actually has a tube to look down. */
  get isVariableScope(): boolean {
    return this.profile?.opticType === 'variableScope';
  }

  get isScoped(): boolean {
    return this.scoped && this.isVariableScope;
  }

  get currentMagnification(): number {
    return this.magnification;
  }

  /**
   * The sway this system produced on the last update(). Read-only: harnesses
   * and HUD code must use THIS rather than calling update() again, which
   * would double-advance the meter and the phase.
   */
  get lastSway(): ScopeSwayOutput {
    return this.sway;
  }

  /** 0..1 for the HUD meter. */
  get breathFraction(): number {
    return clamp(this.breath / this.maxBreath, 0, 1);
  }

  get isHoldingBreath(): boolean {
    return this.holding && this.breath > 0;
  }

  private get maxBreath(): number {
    return this.profile?.breathHoldMaxDuration ?? SCOPE.BREATH_HOLD_SECONDS;
  }

  /** Called on equip so magnification resets to the weapon's base zoom. */
  setProfile(profile: WeaponProfile): void {
    this.profile = profile;
    this.magnification = profile.minMagnification ?? profile.magnification ?? 1;
    this.breath = this.maxBreath;
    this.penalty = 0;
  }

  setScoped(scoped: boolean): void {
    if (this.scoped === scoped) return;
    this.scoped = scoped;
    if (!scoped) {
      this.holding = false;
      this.sway.yaw = 0;
      this.sway.pitch = 0;
    }
    if (this.isVariableScope) {
      eventBus.emit('scope:changed', {
        scoped: this.isScoped,
        magnification: this.magnification,
      });
    }
  }

  setHoldingBreath(holding: boolean): void {
    this.holding = holding;
  }

  /**
   * Scroll-wheel zoom. `steps` is the wheel delta in notches (+1 = zoom in).
   * No-op unless actually scoped through a variable optic.
   */
  adjustZoom(steps: number): void {
    if (!this.isScoped || !this.profile) return;
    const min = this.profile.minMagnification ?? 1;
    const max = this.profile.maxMagnification ?? min;
    const next = clamp(
      this.magnification + steps * SCOPE.ZOOM_STEP, min, max,
    );
    if (next === this.magnification) return;
    this.magnification = next;
    eventBus.emit('scope:changed', {
      scoped: true, magnification: this.magnification,
    });
  }

  /**
   * Document C §8.3: the FOV this scope wants right now, or null if this
   * weapon is not a magnified optic (the caller keeps its normal ADS FOV).
   */
  adsFovFor(baseFov: number): number | null {
    if (!this.isVariableScope) return null;
    return baseFov / Math.max(1e-3, this.magnification);
  }

  /**
   * Advance the meter and the sway. `speed` is the player's horizontal speed
   * in m/s — moving while scoped visibly shakes the view far more.
   */
  update(dt: number, speed: number): ScopeSwayOutput {
    if (!this.isScoped || !this.profile?.hasScopeShake) {
      this.sway.yaw = 0;
      this.sway.pitch = 0;
      // Breath recovers whenever you are not actively holding it.
      this.breath = Math.min(
        this.maxBreath, this.breath + dt * SCOPE.BREATH_REGEN_RATE,
      );
      if (this.penalty > 0) this.penalty = Math.max(0, this.penalty - dt);
      return this.sway;
    }

    // --- breath meter -------------------------------------------------------
    if (this.holding) {
      // NOTE the condition is `holding`, not `holding && breath > 0`. Gating
      // on the remaining breath sent an exhausted-but-still-held meter into
      // the regen branch below, so the lungs refilled while the player was
      // still holding the key — an infinite hold with a slight stutter.
      // Keeping the key down pins the meter at empty until it is released.
      if (this.breath > 0) {
        this.breath = Math.max(0, this.breath - dt);
        if (this.breath === 0) {
          // "You cannot hold your breath forever": a brief sway spike.
          this.penalty = SCOPE.POST_HOLD_PENALTY_SECONDS;
          eventBus.emit('scope:breathExhausted', {});
        }
      }
    } else {
      this.breath = Math.min(
        this.maxBreath, this.breath + dt * SCOPE.BREATH_REGEN_RATE,
      );
    }
    if (this.penalty > 0) this.penalty = Math.max(0, this.penalty - dt);

    // --- sway ---------------------------------------------------------------
    this.phase += dt;
    const min = this.profile.minMagnification ?? 1;
    // §6.5: amplitude scales with zoom — the same hand tremor subtends a
    // bigger angle through a 10x tube than a 4x one.
    const zoomScale = this.magnification / Math.max(1e-3, min);
    // Moving while scoped is punished hard.
    const moveScale = 1 + Math.min(speed, SCOPE.MOVE_SWAY_SPEED_REF)
      / SCOPE.MOVE_SWAY_SPEED_REF * SCOPE.MOVE_SWAY_MULTIPLIER;
    const holdScale = this.isHoldingBreath
      ? SCOPE.BREATH_HOLD_SWAY_SCALE
      : (this.penalty > 0 ? SCOPE.POST_HOLD_SWAY_SCALE : 1);

    const amp = SCOPE.BASE_SWAY_RAD * zoomScale * moveScale * holdScale;
    // Two incommensurate sines per axis: a slow drift that never repeats
    // exactly, which reads as breathing rather than as a rotating machine.
    this.sway.yaw = amp * (
      Math.sin(this.phase * SCOPE.SWAY_FREQ_A)
      + 0.5 * Math.sin(this.phase * SCOPE.SWAY_FREQ_B + 1.7)
    );
    this.sway.pitch = amp * (
      Math.sin(this.phase * SCOPE.SWAY_FREQ_C + 0.6)
      + 0.5 * Math.sin(this.phase * SCOPE.SWAY_FREQ_D)
    );
    return this.sway;
  }
}

export const scopeSystem = new ScopeSystem();
export default scopeSystem;
