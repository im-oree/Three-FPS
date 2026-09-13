/**
 * SMG.ts — pure weapon data (Document D §5).
 *
 * Design identity: highest fire rate in the roster, the most horizontally
 * erratic recoil (rewarding short controlled bursts), the tightest hip-fire
 * cone of any two-handed weapon, and the snappiest ADS/tac-sprint transitions.
 *
 * Note what is NOT here: no new systems, and not even its own hold-pose or
 * reload event table — it deliberately reuses the rifle's, per §5.3. The only
 * thing that makes it feel different is data.
 */
import { WEAPON_PROFILES } from '../WeaponProfile';
import type { WeaponDefinition } from '../WeaponBase';

export const SMG: WeaponDefinition = {
  id: 'smg',
  displayName: 'Submachine Gun',
  modelPath: 'weapons/smg.glb',
  muzzleSocketName: 'Socket_Muzzle',
  presentation: WEAPON_PROFILES.smg,

  clips: {
    // Reuses the rifle's baked reload clips (§5.3) — same joint names, so
    // they retarget with zero changes.
    reloadTactical: 'rifle_reload_tactical',
    reloadEmpty: 'rifle_reload_empty',
    switchOut: 'switch_out',
    switchIn: 'switch_in',
    inspect: 'inspect',
  },

  parts: { chargingHandle: 'Bone_ChargingHandle', magazine: 'Bone_Magazine' },

  damageNear: 22,
  damageFar: 12,
  damageFalloffStartDistance: 5,
  damageFalloffEndDistance: 20,

  fireRateRPM: 950,
  fireMode: 'auto',
  burstCount: null,
  burstDelaySeconds: null,

  magazineSize: 35,
  startingReserveAmmo: 105,
  maxReserveAmmo: 210,
  reloadTacticalDuration: 1.7,
  reloadEmptyDuration: 2.0,
  reloadStyle: 'magazine',

  adsZoomFOV: 62,
  adsInDuration: 0.14,
  adsOutDuration: 0.12,
  adsMoveSpeedMultiplier: 0.75,

  hipfireSpreadBaseDeg: 2.0,
  hipfireSpreadMovingDeg: 3.2,
  hipfireSpreadJumpingDeg: 5.0,
  adsSpreadBaseDeg: 0.5,

  recoilPatternId: 'smg',
  recoilJointScale: 0.8,

  soundKeys: {
    fire: 'weapon_smg_fire',
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
