/**
 * index.ts — the three initial killstreak definitions (Document H §2).
 *
 * Pure data. Adding a fourth means appending a definition here and adding its
 * controller to the lookup map in KillstreakManager — no other file changes.
 */
import type { KillstreakDefinition } from './types';

export const UAV_DEFINITION: KillstreakDefinition = {
  id: 'uav',
  displayName: 'UAV',
  killsRequired: 3,
  activationType: 'instant',
  iconLabel: 'UAV',
  soundKeys: { activate: 'killstreak_uav_activate', ambient: 'killstreak_uav_loop' },
  durationSeconds: 30,
  cooldownSeconds: 20,
  controllerClass: 'UAVKillstreakController',
};

export const AIRSTRIKE_DEFINITION: KillstreakDefinition = {
  id: 'airstrike',
  displayName: 'Airstrike',
  killsRequired: 5,
  activationType: 'directional',
  iconLabel: 'AIR',
  soundKeys: { activate: 'killstreak_airstrike_activate' },
  // Fire-and-forget: the bombing run plays out and ends itself.
  durationSeconds: 0,
  cooldownSeconds: 30,
  controllerClass: 'AirstrikeKillstreakController',
};

export const HELICOPTER_DEFINITION: KillstreakDefinition = {
  id: 'attack_helicopter',
  displayName: 'Attack Heli',
  killsRequired: 7,
  activationType: 'controlled',
  iconLabel: 'HELI',
  soundKeys: {
    activate: 'killstreak_heli_activate',
    ambient: 'killstreak_heli_loop',
  },
  durationSeconds: 45,
  cooldownSeconds: 40,
  controllerClass: 'AttackHelicopterKillstreakController',
};

export const MISSILE_DEFINITION: KillstreakDefinition = {
  id: 'guided_missile',
  displayName: 'Guided Missile',
  killsRequired: 9,
  // Directional: the player designates a ground point on the tablet map
  // before the cinematic launch begins.
  activationType: 'directional',
  iconLabel: 'MSL',
  soundKeys: { activate: 'killstreak_airstrike_activate' },
  // Fire-and-forget from the manager's perspective: the controller runs its
  // own five-phase sequence and reports when it is done.
  durationSeconds: 0,
  cooldownSeconds: 45,
  controllerClass: 'MissileKillstreakController',
};

/**
 * Four streaks exist; a loadout equips three. The manager renders whatever it
 * is given, so changing this list needs no HUD or manager changes.
 */
export const ALL_KILLSTREAKS: readonly KillstreakDefinition[] = [
  UAV_DEFINITION, AIRSTRIKE_DEFINITION, HELICOPTER_DEFINITION, MISSILE_DEFINITION,
];

/** The three equipped by default. */
export const DEFAULT_KILLSTREAK_LOADOUT = ['uav', 'airstrike', 'guided_missile'];

export function getKillstreak(id: string): KillstreakDefinition | null {
  return ALL_KILLSTREAKS.find((k) => k.id === id) ?? null;
}
