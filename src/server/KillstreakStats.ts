/**
 * KillstreakStats.ts — the server's copy of the killstreak numbers.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The client's killstreak definitions live in src/killstreaks/definitions,
 * which is pure data and would be safe to import. Its CONTROLLERS are not:
 * they hold THREE.Object3D, cameras and audio. Importing the definitions
 * barrel drags the controller lookup in with it, so the server would fail the
 * purity check for the sake of four numbers per streak.
 *
 * This mirrors the same split WeaponStats.ts already makes for guns. The
 * values here are the authority; the client's copy is presentation metadata
 * (icon labels, sound keys, model names) and a test asserts the shared fields
 * agree, so the two cannot silently drift.
 */
import type { Vec3 } from '../net/Protocol';

/** How a streak is triggered, which decides what the server expects next. */
export type ServerActivation =
  /** Takes effect immediately on call (UAV). */
  | 'instant'
  /** Needs a designated ground point (airstrike, guided missile). */
  | 'directional'
  /** The caller pilots it; their body idles and stays vulnerable. */
  | 'controlled';

export interface ServerKillstreak {
  readonly id: string;
  readonly killsRequired: number;
  readonly activation: ServerActivation;
  /** How long it runs once active. 0 = fire-and-forget. */
  readonly durationSeconds: number;
  /** Seconds after it ENDS before the same slot may be called again. */
  readonly cooldownSeconds: number;
  /** Blast damage at the centre, if this streak explodes. */
  readonly blastDamage?: number;
  readonly blastRadius?: number;
}

export const SERVER_KILLSTREAKS: Readonly<Record<string, ServerKillstreak>> = {
  uav: {
    id: 'uav',
    killsRequired: 3,
    activation: 'instant',
    durationSeconds: 30,
    cooldownSeconds: 20,
  },
  airstrike: {
    id: 'airstrike',
    killsRequired: 5,
    activation: 'directional',
    durationSeconds: 0,
    cooldownSeconds: 30,
    blastDamage: 180,
    blastRadius: 10,
  },
  attack_helicopter: {
    id: 'attack_helicopter',
    killsRequired: 7,
    activation: 'controlled',
    durationSeconds: 45,
    cooldownSeconds: 40,
  },
  guided_missile: {
    id: 'guided_missile',
    killsRequired: 9,
    activation: 'directional',
    durationSeconds: 0,
    cooldownSeconds: 45,
    blastDamage: 220,
    blastRadius: 12,
  },
};

/** The three a loadout equips by default. */
export const DEFAULT_KILLSTREAK_IDS: readonly string[] = [
  'uav', 'airstrike', 'guided_missile',
];

/**
 * Earning rule, mirroring KILLSTREAK.EARN_MODE on the client.
 *
 * 'open' keeps every streak callable while the game has few enemies to kill;
 * cooldowns are still enforced, so pacing is real either way. Now that bots
 * exist this can flip to 'kills' without touching anything else.
 */
export type EarnMode = 'open' | 'kills';

/** Max streaks active at once across the match (a UAV and a heli can coexist). */
export const MAX_CONCURRENT_STREAKS = 2;

/**
 * Damage at a point from a blast centred elsewhere.
 *
 * Quadratic falloff, matching the client's `falloffCurve: 'quadratic'` so a
 * near-miss feels the same on both sides. Shared by every streak that
 * explodes, so airstrike and missile cannot disagree about lethality.
 */
export function blastDamageAt(
  centre: Vec3, target: Vec3, radius: number, maxDamage: number,
): number {
  const dx = target[0] - centre[0];
  const dy = target[1] - centre[1];
  const dz = target[2] - centre[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance >= radius) return 0;
  const falloff = 1 - distance / radius;
  return maxDamage * falloff * falloff;
}
