/**
 * AssaultRifle.ts — pure weapon data (Document 3 §6.2). All tuning lives here
 * or in Constants.js; behavior code must never inline these numbers.
 * Role: forgiving full-auto workhorse — steady climb recoil, mid spread.
 */
import type { WeaponDefinition } from '../WeaponBase';

export const AssaultRifle: WeaponDefinition = {
  id: 'assault_rifle',
  displayName: 'Assault Rifle',
  modelPath: 'weapons/assault_rifle.glb',
  muzzleSocketName: 'muzzle',

  damageNear: 35,
  damageFar: 20,
  damageFalloffStartDistance: 10,
  damageFalloffEndDistance: 40,

  fireRateRPM: 700,
  fireMode: 'auto',
  burstCount: null,
  burstDelaySeconds: null,

  magazineSize: 30,
  startingReserveAmmo: 90,
  maxReserveAmmo: 180,
  // DATA-INTEGRITY REQUIREMENT: these durations MUST equal the authored clip
  // lengths of `reload_tactical` / `reload_empty` inside the .glb (the
  // generator tool writes both from these same numbers).
  reloadTacticalDuration: 2.1,
  reloadEmptyDuration: 2.6,

  adsZoomFOV: 55,
  adsInDuration: 0.22,
  adsOutDuration: 0.18,
  adsMoveSpeedMultiplier: 0.55,

  hipfireSpreadBaseDeg: 2.5,
  hipfireSpreadMovingDeg: 4.5,
  hipfireSpreadJumpingDeg: 7.0,
  adsSpreadBaseDeg: 0.4,

  recoilPatternId: 'assault_rifle',

  soundKeys: {
    fire: 'weapon_ar_fire',
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

export default AssaultRifle;
