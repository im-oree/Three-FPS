/**
 * WeaponBase.ts — shared runtime behavior for every weapon definition
 * (Document 3 §6.1). Definitions in /definitions are PURE DATA; this class
 * wraps one definition with live ammo/timing/spread/damage behavior.
 *
 * Pattern choice (spec §6.1): a base class consumed by composition —
 * WeaponManager owns one WeaponBase per equipped slot.
 */
import { SPREAD } from '../utils/Constants';
import { clamp, lerp } from '../utils/MathUtils';
import type { PlayerStateValue } from '../player/PlayerState';

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
  damageNear: number;
  damageFar: number;
  damageFalloffStartDistance: number;
  damageFalloffEndDistance: number;
  fireRateRPM: number;
  fireMode: 'auto' | 'semi' | 'burst';
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
}

export class WeaponBase {
  readonly def: WeaponDefinition;
  currentMagazineAmmo: number;
  currentReserveAmmo: number;
  /** Set by ReloadSystem / WeaponManager while those actions are in flight. */
  isReloading = false;
  isSwitching = false;
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
    this.currentMagazineAmmo = Math.max(0, this.currentMagazineAmmo - 1);
  }

  canFire(): boolean {
    return this.currentMagazineAmmo > 0 && !this.isReloading && !this.isSwitching;
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
