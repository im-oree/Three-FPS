/**
 * WeaponBase.ts — shared runtime behavior for every weapon definition
 * (Document 3 §6.1). Definitions in /definitions are PURE DATA; this class
 * wraps one definition with live ammo/timing/spread/damage behavior.
 *
 * Pattern choice (spec §6.1): a base class consumed by composition —
 * WeaponManager owns one WeaponBase per equipped slot.
 */
import characterState, { WeaponAction } from '../character/CharacterStateSystem';
import { SPREAD } from '../utils/Constants';
import { clamp, lerp } from '../utils/MathUtils';
import type { PlayerStateValue } from '../player/PlayerState';
import type { WeaponProfile } from './WeaponProfile';

export interface WeaponSoundKeys {
  fire: string;
  reloadTactical: string;
  reloadEmpty: string;
  adsIn: string;
  adsOut: string;
  switchOut: string;
  switchIn: string;
  emptyClick: string;
}

/** The per-weapon data contract (Document 3 §6.2). */
export interface WeaponDefinition {
  id: string;
  displayName: string;
  modelPath: string;
  muzzleSocketName: string;
  /** Baked joint-keyframe clip names (Document A §7.3, /assets/animations). */
  clips: {
    reloadTactical: string;
    reloadEmpty: string;
    switchOut: string;
    switchIn: string;
    inspect: string;
  };
  /** Procedural part nodes (Document A §8.7). */
  parts?: {
    pump?: string;
    chargingHandle?: string;
    magazine?: string;
  };
  /** Seconds the pump action takes after each shot (shotgun). */
  pumpCycleSeconds?: number;
  /** Per-shot joint-recoil magnitude multiplier (Document A §8.3). */
  recoilJointScale?: number;
  /** Baked combo variants (Document B §2) — fists only. */
  punchClips?: readonly string[];
  /** Document 2.5 §2.3/§10: the purely-visual presentation profile (viewmodel,
   *  IK, ADS alignment, reload event tables). Gameplay code never reads it. */
  presentation: WeaponProfile;
  damageNear: number;
  damageFar: number;
  damageFalloffStartDistance: number;
  damageFalloffEndDistance: number;
  fireRateRPM: number;
  /**
   * Document D §2: 'manualCycle' (pump/bolt) and 'projectile' (launcher) join
   * the original three. Both are additive branches in FireModeSystem and
   * BallisticsSystem respectively — no existing mode changed behaviour.
   */
  fireMode: 'auto' | 'semi' | 'burst' | 'manualCycle' | 'projectile';
  burstCount: number | null;
  burstDelaySeconds: number | null;
  magazineSize: number;
  startingReserveAmmo: number;
  maxReserveAmmo: number;
  reloadTacticalDuration: number;
  reloadEmptyDuration: number;
  adsZoomFOV: number;
  adsInDuration: number;
  adsOutDuration: number;
  adsMoveSpeedMultiplier: number;
  hipfireSpreadBaseDeg: number;
  hipfireSpreadMovingDeg: number;
  hipfireSpreadJumpingDeg: number;
  adsSpreadBaseDeg: number;
  recoilPatternId: string;
  soundKeys: WeaponSoundKeys;
  hasTracer: boolean;
  /** Hands-first phase: no projectile, no ammo — a short-range hit ray. */
  melee?: boolean;
  meleeRangeMeters?: number;

  // --- Document D §2.1: manually-cycled actions (shotgun pump, sniper bolt) --
  /** Requires racking between shots; gated by CyclingActionSystem. */
  requiresManualCycle?: boolean;
  /** Seconds the cycle takes. */
  cycleDurationSeconds?: number;

  // --- Document D §4: multi-pellet hitscan (shotgun) ------------------------
  /** >1 spawns this many independently-jittered rays per trigger pull. */
  pelletCount?: number;
  /** Cone half-angle for pellet jitter, degrees. */
  pelletSpreadConeDeg?: number;
  damagePerPelletNear?: number;
  damagePerPelletFar?: number;

  // --- Document D §4.6: per-shell reload ------------------------------------
  reloadStyle?: 'magazine' | 'perShell' | 'singleRound';
  reloadShellInsertDuration?: number;

  // --- Document D §2.2 / §7: projectile ballistics (rocket launcher) --------
  projectileSpeed?: number;
  projectileGravityScale?: number;
  projectileDrag?: number;
  projectileMaxLifetime?: number;
  blastRadius?: number;
  blastDamage?: number;
  blastFalloffCurve?: 'linear' | 'quadratic';
}

export class WeaponBase {
  readonly def: WeaponDefinition;
  currentMagazineAmmo: number;
  currentReserveAmmo: number;
  /**
   * Reload/switch status is NOT stored here. The CharacterStateSystem is the
   * single authority for what the character is doing; a local copy would drift
   * (it has before). These are derived reads — see tools/verify/state-authority.mjs.
   */
  get busyWithAction(): boolean {
    const a = characterState.weaponAction;
    return a === WeaponAction.RELOADING || a === WeaponAction.SWITCHING;
  }
  private lastFiredAt = -Infinity;

  constructor(def: WeaponDefinition) {
    this.def = def;
    this.currentMagazineAmmo = def.magazineSize;
    this.currentReserveAmmo = def.startingReserveAmmo;
  }

  get secondsBetweenShots(): number {
    return 60 / this.def.fireRateRPM;
  }

  consumeRound(): void {
    if (this.def.melee) return; // fists never consume rounds
    this.currentMagazineAmmo = Math.max(0, this.currentMagazineAmmo - 1);
  }

  canFire(): boolean {
    if (this.def.melee) return !this.busyWithAction;
    return this.currentMagazineAmmo > 0 && !this.busyWithAction;
  }

  canFireNow(currentTime: number): boolean {
    return this.canFire() && currentTime - this.lastFiredAt >= this.secondsBetweenShots;
  }

  markFired(currentTime: number): void {
    this.lastFiredAt = currentTime;
  }

  /** Moves reserve ammo into the magazine; returns rounds actually added. */
  refillMagazine(): number {
    const need = this.def.magazineSize - this.currentMagazineAmmo;
    const taken = Math.min(need, this.currentReserveAmmo);
    this.currentMagazineAmmo += taken;
    this.currentReserveAmmo -= taken;
    return taken;
  }

  /**
   * Single source of truth for aim cone half-angle (degrees). BallisticsSystem
   * queries this per shot; movement state comes from Document 2's PlayerState.
   */
  getCurrentSpreadAngle(movementState: PlayerStateValue, isADS: boolean, isJumping: boolean): number {
    let degrees: number;
    if (isADS) {
      degrees = this.def.adsSpreadBaseDeg;
    } else if (isJumping) {
      degrees = this.def.hipfireSpreadJumpingDeg;
    } else {
      degrees = this.def.hipfireSpreadBaseDeg;
    }
    switch (movementState) {
      case 'SPRINT':
        degrees *= SPREAD.SPRINT_MULTIPLIER;
        break;
      case 'SLIDE':
        degrees *= SPREAD.SLIDE_MULTIPLIER;
        break;
      case 'JUMP':
      case 'AIR':
      case 'LANDING':
        degrees *= SPREAD.AIR_MULTIPLIER;
        break;
      case 'CROUCH_IDLE':
        degrees *= SPREAD.CROUCH_IDLE_MULTIPLIER;
        break;
      default:
        break;
    }
    if (isJumping && !isADS) degrees = Math.max(degrees, this.def.hipfireSpreadJumpingDeg);
    return degrees;
  }

  /** Linear falloff clamped at both ends (Document 3 §6.1). */
  getDamageAtDistance(distance: number): number {
    const { damageNear, damageFar, damageFalloffStartDistance, damageFalloffEndDistance } = this.def;
    if (distance <= damageFalloffStartDistance) return damageNear;
    if (distance >= damageFalloffEndDistance) return damageFar;
    const t = (distance - damageFalloffStartDistance) / (damageFalloffEndDistance - damageFalloffStartDistance);
    return lerp(damageNear, damageFar, t);
  }

  clampReserve(): void {
    this.currentReserveAmmo = clamp(this.currentReserveAmmo, 0, this.def.maxReserveAmmo);
  }
}

export default WeaponBase;
