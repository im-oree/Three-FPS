/**
 * Pistol.ts — pure weapon data (Document 3 §6.2).
 * Role: semi-auto sidearm — heavy per-shot damage, minimal kick, tight ADS,
 * small magazine. Meaningfully distinct from the AR, not a re-skin.
 */
import type { WeaponDefinition } from '../WeaponBase';

export const Pistol: WeaponDefinition = {
  id: 'pistol',
  displayName: 'Pistol',
  modelPath: 'weapons/pistol.glb',
  muzzleSocketName: 'muzzle',

  damageNear: 55,
  damageFar: 30,
  damageFalloffStartDistance: 8,
  damageFalloffEndDistance: 30,

  fireRateRPM: 300,
  fireMode: 'semi',
  burstCount: null,
  burstDelaySeconds: null,

  magazineSize: 12,
  startingReserveAmmo: 48,
  maxReserveAmmo: 96,
  // Must match authored clip lengths in pistol.glb (see generator tool).
  reloadTacticalDuration: 1.6,
  reloadEmptyDuration: 2.0,

  adsZoomFOV: 60,
  adsInDuration: 0.16,
  adsOutDuration: 0.14,
  adsMoveSpeedMultiplier: 0.7,

  hipfireSpreadBaseDeg: 2.0,
  hipfireSpreadMovingDeg: 3.4,
  hipfireSpreadJumpingDeg: 6.0,
  adsSpreadBaseDeg: 0.25,

  recoilPatternId: 'pistol',

  soundKeys: {
    fire: 'weapon_pistol_fire',
    reloadTactical: 'weapon_pistol_reload_tactical',
    reloadEmpty: 'weapon_pistol_reload_empty',
    adsIn: 'weapon_pistol_ads_in',
    adsOut: 'weapon_pistol_ads_out',
    switchOut: 'weapon_generic_switch_out',
    switchIn: 'weapon_generic_switch_in',
    emptyClick: 'weapon_generic_empty_click',
  },

  hasTracer: true,
};

export default Pistol;
