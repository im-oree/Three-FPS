/**
 * GameModes.ts — the rules of a match, as data.
 *
 * Numbers are the real Call of Duty ones, not invented:
 *
 *   Free-For-All  8 players, 30 kills, 10 minutes, top 3 "win".
 *   Team Deathmatch  6v6, 75 kills, 10 minutes.
 *
 * (FFA: "the first player to reach the score limit ends the game, the top
 * three players win" — callofduty.com mode description; 30 kills / 10 min is
 * consistent across MW2, BO1, MW3, Ghosts, WWII and MWII. MW2019-era TDM uses
 * 75; MWII lists 100 on a 12-minute clock. Both are exposed as settings, so a
 * custom match can be dialled to either.)
 *
 * A mode is a DESCRIPTION, never behaviour. Everything here is a plain value
 * that `MatchSystem` reads, which is what makes custom matches possible: the
 * host edits the numbers and the same code runs. A mode that needed its own
 * branch in the match loop would not be tunable that way.
 */

export type TeamId = 'A' | 'B' | 'FFA';

export interface GameModeDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** FFA scores per player; team modes pool kills into a team score. */
  readonly teamBased: boolean;
  /** Kills (or points) that end the match early. */
  readonly scoreLimit: number;
  /** Seconds on the match clock. */
  readonly timeLimitSeconds: number;
  /** Total players the mode is balanced for. */
  readonly maxPlayers: number;
  /** Seconds between dying and being allowed back in. */
  readonly respawnDelaySeconds: number;
  /** Pre-match countdown, as COD does before the first spawn. */
  readonly startCountdownSeconds: number;
  /** How many placings are treated as a win (FFA's "top three"). */
  readonly winningPlaces: number;
  /** Points awarded per kill. COD FFA shows 50/kill against a 1500 target; we
   *  count kills directly (as BO2 onward does) so the HUD reads "12/30". */
  readonly pointsPerKill: number;
}

export const FREE_FOR_ALL: GameModeDefinition = {
  id: 'ffa',
  displayName: 'Free-For-All',
  description: 'Everyone for themselves. First to the score limit ends it.',
  teamBased: false,
  scoreLimit: 30,
  timeLimitSeconds: 600,
  maxPlayers: 8,
  respawnDelaySeconds: 3,
  startCountdownSeconds: 5,
  winningPlaces: 3,
  pointsPerKill: 1,
};

export const TEAM_DEATHMATCH: GameModeDefinition = {
  id: 'tdm',
  displayName: 'Team Deathmatch',
  description: 'Two teams. First to the score limit wins.',
  teamBased: true,
  scoreLimit: 75,
  timeLimitSeconds: 600,
  maxPlayers: 12,
  respawnDelaySeconds: 5,
  startCountdownSeconds: 5,
  winningPlaces: 1,
  pointsPerKill: 1,
};

export const GAME_MODES: readonly GameModeDefinition[] = [
  FREE_FOR_ALL,
  TEAM_DEATHMATCH,
];

export function getGameMode(id: string): GameModeDefinition {
  return GAME_MODES.find((m) => m.id === id) ?? FREE_FOR_ALL;
}

/**
 * A custom match is the same definition with fields overridden.
 *
 * This is the whole "host a custom match" feature: there is no separate custom
 * mode, only a base mode plus overrides, so anything the host can change is by
 * definition something the normal mode already understood.
 */
export type GameModeOverrides = Partial<Omit<GameModeDefinition, 'id' | 'teamBased'>>;

export function customise(
  base: GameModeDefinition,
  overrides: GameModeOverrides,
): GameModeDefinition {
  return { ...base, ...overrides };
}

/** Hard bounds on what a custom match may ask for. */
export const RULE_LIMITS = {
  scoreLimit: { min: 1, max: 500 },
  timeLimitSeconds: { min: 60, max: 3600 },
  maxPlayers: { min: 2, max: 32 },
  respawnDelaySeconds: { min: 0, max: 30 },
} as const;

/**
 * Sanitise a client-proposed rule patch.
 *
 * A custom match is hosted by a CLIENT, so its numbers arrive over the wire
 * and are therefore untrusted input. Everything is clamped to a sane range
 * and anything non-finite is dropped -- a score limit of NaN would make
 * `reachedScoreLimit()` always false and the match unendable, and a maxPlayers of
 * 10000 would have the lobby filler spawn bots until the tab died.
 */
export function sanitiseOverrides(
  patch: Partial<Record<keyof typeof RULE_LIMITS, unknown>>,
): GameModeOverrides {
  const out: Record<string, number> = {};
  for (const key of Object.keys(RULE_LIMITS) as Array<keyof typeof RULE_LIMITS>) {
    const raw = patch[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const { min, max } = RULE_LIMITS[key];
    out[key] = Math.min(max, Math.max(min, raw));
  }
  return out as GameModeOverrides;
}
