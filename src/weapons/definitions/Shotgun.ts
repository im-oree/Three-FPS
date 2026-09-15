/**
 * Shotgun.ts — pure weapon data (Document A): the procedural pump shotgun.
 * Bone_Pump cycles after every shot and at the reload's chamber beat.
 */
import { WEAPON_PROFILES } from '../WeaponProfile';
import type { WeaponDefinition } from '../WeaponBase';

export const Shotgun: WeaponDefinition = {
  id: 'shotgun',
  displayName: 'Pump Shotgun',
  modelPath: 'weapons/shotgun.glb',
  muzzleSocketName: 'Socket_Muzzle',
  presentation: WEAPON_PROFILES.shotgun,

  clips: {
    reloadTactical: 'shotgun_reload_tactical',
    reloadEmpty: 'shotgun_reload_empty',
    switchOut: 'switch_out',
    switchIn: 'switch_in',
    inspect: 'inspect',
  },

  /** Procedural part data (Document A §8.7): pump cycles after each shot. */
  parts: { pump: 'Bone_Pump', chargingHandle: 'Bone_ChargingHandle', magazine: 'Bone_Magazine' },
  pumpCycleSeconds: 0.55,

  // Document D §4.4: damage comes from PELLETS, not one slug. 8 x 14 = 112
  // at point blank, collapsing to 8 x 4 = 32 past 15 m — a brutal CQB curve.
  // damageNear/Far remain as the single-ray fallback for any code path that
  // has not been told about pellets.
  damageNear: 70,
  damageFar: 22,
  damageFalloffStartDistance: 3,
  damageFalloffEndDistance: 15,
  pelletCount: 8,
  pelletSpreadConeDeg: 6.5,
  damagePerPelletNear: 14,
  damagePerPelletFar: 4,

  fireRateRPM: 70,
  // Document D §4.7: pump-action. Firing is gated by CyclingActionSystem.
  fireMode: 'manualCycle',
  requiresManualCycle: true,
  cycleDurationSeconds: 0.55,
  reloadStyle: 'perShell',
  reloadShellInsertDuration: 0.55,
  burstCount: null,
  burstDelaySeconds: null,

  magazineSize: 6,
  startingReserveAmmo: 24,
  maxReserveAmmo: 48,
  reloadTacticalDuration: 2.8,
  reloadEmptyDuration: 3.3,

  adsZoomFOV: 58,
  adsInDuration: 0.2,
  adsOutDuration: 0.17,
  adsMoveSpeedMultiplier: 0.6,

  hipfireSpreadBaseDeg: 4.0,
  hipfireSpreadMovingDeg: 6.0,
  hipfireSpreadJumpingDeg: 8.0,
  adsSpreadBaseDeg: 2.2,

  recoilPatternId: 'shotgun',
  recoilJointScale: 2.1,

  soundKeys: {
    fire: 'weapon_sg_fire',
    reloadTactical: 'weapon_sg_reload_tactical',
    reloadEmpty: 'weapon_sg_reload_empty',
    adsIn: 'weapon_ar_ads_in',
    adsOut: 'weapon_ar_ads_out',
    switchOut: 'weapon_generic_switch_out',
    switchIn: 'weapon_generic_switch_in',
    emptyClick: 'weapon_generic_empty_click',
  },

  hasTracer: false,
};
