/**
 * SoundLibrary.ts — Document 5 §9.2.
 *
 * The single manifest mapping every sound key referenced anywhere in the
 * project to a real file under /assets/audio. Those files are produced by
 * `node tools/generateAudio.mjs` (standing asset policy: real static files
 * from a /tools script, never synthesized at runtime in /src).
 *
 * The whole manifest is handed to AssetLoader.preload() during LOADING, so
 * nothing pops in late on the first shot.
 */

/** Sound keys grouped by mixer bus, because the bus decides the gain path. */
export const SOUND_MANIFEST = {
  // --- SFX bus -------------------------------------------------------------
  weapon_ar_fire: 'weapons/weapon_ar_fire.wav',
  weapon_smg_fire: 'weapons/weapon_smg_fire.wav',
  weapon_pistol_fire: 'weapons/weapon_pistol_fire.wav',
  weapon_sg_fire: 'weapons/weapon_sg_fire.wav',
  weapon_sniper_fire: 'weapons/weapon_sniper_fire.wav',
  weapon_launcher_fire: 'weapons/weapon_launcher_fire.wav',

  weapon_ar_reload_tactical: 'weapons/weapon_ar_reload_tactical.wav',
  weapon_ar_reload_empty: 'weapons/weapon_ar_reload_empty.wav',
  weapon_pistol_reload_tactical: 'weapons/weapon_pistol_reload_tactical.wav',
  weapon_pistol_reload_empty: 'weapons/weapon_pistol_reload_empty.wav',
  weapon_sg_reload_tactical: 'weapons/weapon_sg_reload_tactical.wav',
  weapon_sg_reload_empty: 'weapons/weapon_sg_reload_empty.wav',

  weapon_generic_switch_out: 'weapons/weapon_generic_switch_out.wav',
  weapon_generic_switch_in: 'weapons/weapon_generic_switch_in.wav',
  weapon_generic_empty_click: 'weapons/weapon_generic_empty_click.wav',
  weapon_check: 'weapons/weapon_check.wav',
  weapon_pump_cycle: 'weapons/weapon_pump_cycle.wav',
  weapon_bolt_cycle: 'weapons/weapon_bolt_cycle.wav',

  // ADS in/out reuse the handling clacks — quiet, short, correct in feel.
  weapon_ar_ads_in: 'weapons/weapon_generic_switch_in.wav',
  weapon_ar_ads_out: 'weapons/weapon_generic_switch_out.wav',
  weapon_pistol_ads_in: 'weapons/weapon_generic_switch_in.wav',
  weapon_pistol_ads_out: 'weapons/weapon_generic_switch_out.wav',

  impact_concrete: 'impacts/impact_concrete.wav',
  impact_metal: 'impacts/impact_metal.wav',
  impact_wood: 'impacts/impact_wood.wav',
  impact_dirt: 'impacts/impact_dirt.wav',
  impact_gravel: 'impacts/impact_gravel.wav',
  impact_flesh: 'impacts/impact_flesh.wav',
  impact_dust: 'impacts/impact_dust.wav',
  impact_spark: 'impacts/impact_spark.wav',
  explosion: 'impacts/explosion.wav',

  // --- Throwables (Document F §8) ------------------------------------------
  grenade_pin_pull: 'equipment/grenade_pin_pull.wav',
  grenade_throw_whoosh: 'equipment/grenade_throw_whoosh.wav',
  grenade_bounce_metal: 'equipment/grenade_bounce_metal.wav',
  smoke_hiss_loop: 'equipment/smoke_hiss_loop.wav',
  stun_detonate: 'equipment/stun_detonate.wav',
  flash_detonate: 'equipment/flash_detonate.wav',
  concussion_ring: 'equipment/concussion_ring.wav',
  flashbang_ring: 'equipment/flashbang_ring.wav',

  // --- Killstreaks (Document H/I) ------------------------------------------
  killstreak_uav_activate: 'killstreaks/killstreak_uav_activate.wav',
  killstreak_uav_loop: 'killstreaks/killstreak_uav_loop.wav',
  killstreak_airstrike_activate: 'killstreaks/killstreak_airstrike_activate.wav',
  killstreak_heli_activate: 'killstreaks/killstreak_heli_activate.wav',
  killstreak_heli_loop: 'killstreaks/killstreak_heli_loop.wav',

  // --- UI bus --------------------------------------------------------------
  ui_hover: 'ui/ui_hover.wav',
  ui_click: 'ui/ui_click.wav',
  ui_confirm: 'ui/ui_confirm.wav',
  ui_back: 'ui/ui_back.wav',
  ui_hit_marker: 'ui/ui_hit_marker.wav',
  ui_kill_marker: 'ui/ui_kill_marker.wav',
  ui_damage: 'ui/ui_damage.wav',

  // --- Ambience (SFX bus, looped) ------------------------------------------
  ambient_warehouse: 'ambient/ambient_warehouse.wav',
  ambient_facility: 'ambient/ambient_facility.wav',
  ambient_range: 'ambient/ambient_range.wav',
} as const;

export type SoundKey = keyof typeof SOUND_MANIFEST | string;

/** Footstep + landing sets, keyed by the surface tags levels actually use. */
export const FOOTSTEP_SETS: Record<string, readonly string[]> = {
  concrete: [1, 2, 3, 4].map((i) => `footsteps/footstep_concrete_0${i}.wav`),
  metal: [1, 2, 3, 4].map((i) => `footsteps/footstep_metal_0${i}.wav`),
  wood: [1, 2, 3, 4].map((i) => `footsteps/footstep_wood_0${i}.wav`),
  dirt: [1, 2, 3, 4].map((i) => `footsteps/footstep_dirt_0${i}.wav`),
  gravel: [1, 2, 3, 4].map((i) => `footsteps/footstep_gravel_0${i}.wav`),
};

export const LANDING_SOUNDS: Record<string, string> = {
  concrete: 'footsteps/land_concrete.wav',
  metal: 'footsteps/land_metal.wav',
  wood: 'footsteps/land_wood.wav',
  dirt: 'footsteps/land_dirt.wav',
  gravel: 'footsteps/land_gravel.wav',
};

/** Which bus a key belongs to — decides its gain path in AudioManager. */
export function busFor(key: string): 'ui' | 'sfx' {
  return key.startsWith('ui_') ? 'ui' : 'sfx';
}

/** Impact sound for a surface tag, with a sane fallback. */
export function impactKeyFor(surfaceType: string): string {
  const key = `impact_${surfaceType}`;
  return key in SOUND_MANIFEST ? key : 'impact_concrete';
}

/** A random footstep variant for a surface, so steps never obviously repeat. */
export function footstepPathFor(surfaceType: string): string {
  const set = FOOTSTEP_SETS[surfaceType] ?? FOOTSTEP_SETS.concrete;
  return set[Math.floor(Math.random() * set.length)];
}

export function landingPathFor(surfaceType: string): string {
  return LANDING_SOUNDS[surfaceType] ?? LANDING_SOUNDS.concrete;
}

/** Every audio path the game can play — the LOADING-state preload list. */
export function allAudioPaths(): string[] {
  return [
    ...Object.values(SOUND_MANIFEST),
    ...Object.values(FOOTSTEP_SETS).flat(),
    ...Object.values(LANDING_SOUNDS),
  ];
}

export default SOUND_MANIFEST;
