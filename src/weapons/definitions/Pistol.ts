/**
 * Pistol.ts — pure weapon data (Document A): the procedural service pistol.
 */
import { WEAPON_PROFILES } from '../WeaponProfile';
import type { WeaponDefinition } from '../WeaponBase';

export const Pistol: WeaponDefinition = {
  id: 'pistol',
  displayName: 'Service Pistol',
  modelPath: 'weapons/pistol.glb',
  muzzleSocketName: 'Socket_Muzzle',
  presentation: WEAPON_PROFILES.pistol,

  clips: {
    reloadTactical: 'pistol_reload_tactical',
    reloadEmpty: 'pistol_reload_empty',
    switchOut: 'switch_out',
    switchIn: 'switch_in',
    inspect: 'inspect',
  },

  damageNear: 26,
  damageFar: 14,
  damageFalloffStartDistance: 8,
  damageFalloffEndDistance: 30,

  fireRateRPM: 300,
  fireMode: 'semi',
  burstCount: null,
  burstDelaySeconds: null,

  magazineSize: 12,
  startingReserveAmmo: 48,
  maxReserveAmmo: 96,
  reloadTacticalDuration: 1.9,
  reloadEmptyDuration: 2.4,

  adsZoomFOV: 60,
  adsInDuration: 0.16,
  adsOutDuration: 0.14,
  adsMoveSpeedMultiplier: 0.7,

  hipfireSpreadBaseDeg: 2.0,
  hipfireSpreadMovingDeg: 3.5,
  hipfireSpreadJumpingDeg: 6.0,
  adsSpreadBaseDeg: 0.5,

  recoilPatternId: 'pistol',
  recoilJointScale: 0.85,

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

  hasTracer: false,
};
