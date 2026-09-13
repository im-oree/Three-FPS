/**
 * Fists.ts — the hands-first melee "weapon" (pre-Document-4 loadout).
 *
 * Guns are disabled at boot by user directive; the fists definition plugs
 * into the exact same WeaponBase/WeaponManager/Ballistics contracts as any
 * firearm (that compatibility IS the point), with `melee: true` switching
 * BallisticsSystem to a short camera-forward reach ray and WeaponBase to
 * ammo-less firing. Damage is flat inside MELEE.RANGE_METERS.
 */
import { MELEE } from '../../utils/Constants';
import { FISTS_PROFILE } from '../WeaponProfile';
import type { WeaponDefinition } from '../WeaponBase';

export const Fists: WeaponDefinition = {
  id: 'fists',
  displayName: 'Fists',
  // No gun mesh: the procedural HandsRig is the viewmodel for this slot.
  modelPath: '',
  muzzleSocketName: '',
  /** Baked punch combos (Document B §2); reload/inspect n/a for fists. */
  clips: {
    reloadTactical: '',
    reloadEmpty: '',
    switchOut: 'switch_out',
    switchIn: 'switch_in',
    inspect: '',
  },
  /** Combo punch variants cycled by MeleeComboTracker. */
  punchClips: ['melee_punch_01', 'melee_punch_02', 'melee_punch_03'],
  // Document 2.5 §2.3/§10: fists conform as a zero-socket oneHanded profile.
  presentation: FISTS_PROFILE,
  damageNear: MELEE.DAMAGE,
  damageFar: MELEE.DAMAGE,
  damageFalloffStartDistance: MELEE.RANGE_METERS,
  damageFalloffEndDistance: MELEE.RANGE_METERS + 0.01,
  fireRateRPM: 110,
  fireMode: 'semi',
  burstCount: null,
  burstDelaySeconds: null,
  magazineSize: 0,
  startingReserveAmmo: 0,
  maxReserveAmmo: 0,
  reloadTacticalDuration: 0,
  reloadEmptyDuration: 0,
  adsZoomFOV: 75, // no zoom: base FOV, ADS is just a tighter guard stance
  adsInDuration: 0.1,
  adsOutDuration: 0.1,
  adsMoveSpeedMultiplier: 1,
  hipfireSpreadBaseDeg: 0,
  hipfireSpreadMovingDeg: 0,
  hipfireSpreadJumpingDeg: 0,
  adsSpreadBaseDeg: 0,
  recoilPatternId: '',
  soundKeys: {
    fire: 'melee_swing',
    reloadTactical: 'melee_none',
    reloadEmpty: 'melee_none',
    adsIn: 'melee_none',
    adsOut: 'melee_none',
    switchOut: 'melee_none',
    switchIn: 'melee_none',
    emptyClick: 'melee_none',
  },
  hasTracer: false,
  melee: true,
  meleeRangeMeters: MELEE.RANGE_METERS,
};

export default Fists;
