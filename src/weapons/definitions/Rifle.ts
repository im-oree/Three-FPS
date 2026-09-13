/**
 * Rifle.ts — pure weapon data (Document A): the procedural AK-pattern rifle.
 * Baked reload-clip durations MUST equal the JSON clip durations in
 * /assets/animations (data-integrity pair).
 */
import { WEAPON_PROFILES } from '../WeaponProfile';
import type { WeaponDefinition } from '../WeaponBase';

export const Rifle: WeaponDefinition = {
  id: 'rifle',
  displayName: 'AK Rifle',
  modelPath: 'weapons/rifle.glb',
  muzzleSocketName: 'Socket_Muzzle',
  presentation: WEAPON_PROFILES.rifle,

  /** Baked joint-keyframe clips (Document A §7.3) under /assets/animations. */
  clips: {
    reloadTactical: 'rifle_reload_tactical',
    reloadEmpty: 'rifle_reload_empty',
    switchOut: 'switch_out',
    switchIn: 'switch_in',
    inspect: 'inspect',
  },

  damageNear: 35,
  damageFar: 20,
  damageFalloffStartDistance: 10,
  damageFalloffEndDistance: 40,

  fireRateRPM: 600,
  fireMode: 'auto',
  burstCount: null,
  burstDelaySeconds: null,

  magazineSize: 30,
  startingReserveAmmo: 90,
  maxReserveAmmo: 180,
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

  recoilPatternId: 'rifle',
  recoilJointScale: 1.0,

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
