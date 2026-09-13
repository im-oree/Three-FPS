/**
 * Sniper.ts — pure weapon data (Document D §6).
 *
 * Design identity: bolt-action (shares CyclingActionSystem with the shotgun's
 * pump), the highest single-shot damage in the roster, a true variable-zoom
 * scope with tunnel rendering and breath-hold, and the heaviest movement and
 * ADS-time penalties. High commitment per shot, by design.
 */
import { WEAPON_PROFILES } from '../WeaponProfile';
import type { WeaponDefinition } from '../WeaponBase';

export const Sniper: WeaponDefinition = {
  id: 'sniper',
  displayName: 'Bolt-Action Sniper',
  modelPath: 'weapons/sniper.glb',
  muzzleSocketName: 'Socket_Muzzle',
  presentation: WEAPON_PROFILES.sniper,

  clips: {
    reloadTactical: 'rifle_reload_tactical',
    reloadEmpty: 'rifle_reload_empty',
    switchOut: 'switch_out',
    switchIn: 'switch_in',
    inspect: 'inspect',
  },

  /** The bolt handle is the cycled part (§6.6). */
  parts: { chargingHandle: 'Bone_ChargingHandle', magazine: 'Bone_Magazine' },

  damageNear: 95,
  damageFar: 65,
  damageFalloffStartDistance: 40,
  damageFalloffEndDistance: 120,

  fireRateRPM: 45,
  fireMode: 'manualCycle',
  requiresManualCycle: true,
  cycleDurationSeconds: 0.95,
  burstCount: null,
  burstDelaySeconds: null,

  magazineSize: 5,
  startingReserveAmmo: 15,
  maxReserveAmmo: 30,
  reloadTacticalDuration: 3.0,
  reloadEmptyDuration: 3.6,
  reloadStyle: 'magazine',

  // adsZoomFOV is superseded for a variableScope: Document C §8.3 derives it
  // live as baseFOV / currentMagnification.
  adsZoomFOV: 22,
  adsInDuration: 0.42,
  adsOutDuration: 0.30,
  adsMoveSpeedMultiplier: 0.35,

  hipfireSpreadBaseDeg: 5.5,
  hipfireSpreadMovingDeg: 8.0,
  hipfireSpreadJumpingDeg: 11.0,
  adsSpreadBaseDeg: 0.05,

  recoilPatternId: 'sniper',
  recoilJointScale: 2.4,

  soundKeys: {
    fire: 'weapon_sniper_fire',
    reloadTactical: 'weapon_ar_reload_tactical',
    reloadEmpty: 'weapon_ar_reload_empty',
    adsIn: 'weapon_ar_ads_in',
    adsOut: 'weapon_ar_ads_out',
    switchOut: 'weapon_generic_switch_out',
    switchIn: 'weapon_generic_switch_in',
    emptyClick: 'weapon_generic_empty_click',
  },

  hasTracer: true,
};
