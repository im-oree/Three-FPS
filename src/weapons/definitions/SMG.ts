/**
 * SMG.ts — pure weapon data (Document 3 §6.2).
 * Role: close-quarters hose — very high fire rate, low per-shot damage,
 * tight hip-fire (handled from the hip on the move) but a WIDER ADS cone than
 * the assault rifle (its sight picture is deliberately less precise), plus a
 * twitchy, horizontal-leaning recoil pattern.
 */
import type { WeaponDefinition } from '../WeaponBase';

export const SMG: WeaponDefinition = {
  id: 'smg',
  displayName: 'SMG',
  modelPath: 'weapons/smg.glb',
  muzzleSocketName: 'muzzle',

  damageNear: 24,
  damageFar: 12,
  damageFalloffStartDistance: 6,
  damageFalloffEndDistance: 22,

  fireRateRPM: 950,
  fireMode: 'auto',
  burstCount: null,
  burstDelaySeconds: null,

  magazineSize: 35,
  startingReserveAmmo: 105,
  maxReserveAmmo: 210,
  // Must match authored clip lengths in smg.glb (see generator tool).
  reloadTacticalDuration: 1.9,
  reloadEmptyDuration: 2.4,

  adsZoomFOV: 58,
  adsInDuration: 0.18,
  adsOutDuration: 0.15,
  adsMoveSpeedMultiplier: 0.62,

  hipfireSpreadBaseDeg: 2.2,
  hipfireSpreadMovingDeg: 3.0,
  hipfireSpreadJumpingDeg: 6.5,
  adsSpreadBaseDeg: 0.9,

  recoilPatternId: 'smg',

  soundKeys: {
    fire: 'weapon_smg_fire',
    reloadTactical: 'weapon_smg_reload_tactical',
    reloadEmpty: 'weapon_smg_reload_empty',
    adsIn: 'weapon_smg_ads_in',
    adsOut: 'weapon_smg_ads_out',
    switchOut: 'weapon_generic_switch_out',
    switchIn: 'weapon_generic_switch_in',
    emptyClick: 'weapon_generic_empty_click',
  },

  hasTracer: true,
};

export default SMG;
