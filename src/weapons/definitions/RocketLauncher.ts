/**
 * RocketLauncher.ts — pure weapon data (Document D §7).
 *
 * Design identity: single-round breach-loaded, shoulder-mounted, and the only
 * weapon in the roster that is NOT hitscan — it launches a real Rapier dynamic
 * rigid body that arcs under gravity and detonates on contact.
 *
 * §7.1: the blast damages ALL hittables in radius, the shooter included. That
 * is correct and intended, not a bug to be special-cased away.
 */
import { WEAPON_PROFILES } from '../WeaponProfile';
import type { WeaponDefinition } from '../WeaponBase';

export const RocketLauncher: WeaponDefinition = {
  id: 'rocket_launcher',
  displayName: 'Rocket Launcher',
  modelPath: 'weapons/rocket_launcher.glb',
  muzzleSocketName: 'Socket_Muzzle',
  presentation: WEAPON_PROFILES.rocket_launcher,

  clips: {
    // §7.7: tactical and empty collapse into one clip — there is never a
    // "partial magazine" state for a single-round weapon.
    reloadTactical: 'rifle_reload_tactical',
    reloadEmpty: 'rifle_reload_tactical',
    switchOut: 'switch_out',
    switchIn: 'switch_in',
    inspect: 'inspect',
  },

  parts: { magazine: 'Bone_Magazine' },

  // Direct-impact damage is irrelevant for a projectile; the blast does the
  // work. These remain for any generic code path that asks.
  damageNear: 40,
  damageFar: 40,
  damageFalloffStartDistance: 1,
  damageFalloffEndDistance: 1000,

  fireRateRPM: 30,
  fireMode: 'projectile',
  burstCount: null,
  burstDelaySeconds: null,

  // --- projectile ballistics (§2.2) ---------------------------------------
  projectileSpeed: 45,
  projectileGravityScale: 0.15,
  projectileDrag: 0.02,
  projectileMaxLifetime: 6,
  blastRadius: 6.0,
  blastDamage: 140,
  blastFalloffCurve: 'quadratic',

  magazineSize: 1,
  startingReserveAmmo: 3,
  maxReserveAmmo: 3,
  reloadTacticalDuration: 3.4,
  reloadEmptyDuration: 3.4,
  reloadStyle: 'singleRound',

  adsZoomFOV: 65,
  adsInDuration: 0.35,
  adsOutDuration: 0.28,
  adsMoveSpeedMultiplier: 0.45,

  // For a projectile these jitter the LAUNCH ANGLE, not a hitscan cone.
  hipfireSpreadBaseDeg: 3.0,
  hipfireSpreadMovingDeg: 4.2,
  hipfireSpreadJumpingDeg: 6.0,
  adsSpreadBaseDeg: 0.8,

  recoilPatternId: 'shotgun',
  recoilJointScale: 2.6,

  soundKeys: {
    fire: 'weapon_launcher_fire',
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
