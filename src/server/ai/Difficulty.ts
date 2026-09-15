/**
 * Difficulty.ts — the humanisation layer.
 *
 * Every knob that makes a bot easier or harder lives here, and every
 * capability that aims imports from here. Keeping it in one module is what
 * stops difficulty from drifting: if aiming noise were implemented separately
 * in the rifle code and the missile code, tuning "recruit" would fix one and
 * miss the other.
 *
 * WHAT IS NOT IN HERE
 * -------------------
 * There is no `omniscient` flag, no `seeThroughWalls`, no damage multiplier.
 * A harder bot reacts faster, sees further, holds a tighter cone and tracks
 * more smoothly. It never learns anything a player in the same position
 * could not have learned, and its bullets do exactly what a player's do.
 * Difficulty that cheats is the thing players notice and resent, and it is
 * also the thing that makes an AI impossible to debug.
 */

export interface DifficultyProfile {
  readonly name: string;
  /** Milliseconds between seeing a target and being allowed to act on it. */
  readonly reactionMs: number;
  /** Total horizontal view cone, degrees. */
  readonly fovDegrees: number;
  /** Maximum sighting distance, metres. */
  readonly viewRangeMeters: number;
  /** Base aim error half-angle, degrees, at close range. */
  readonly aimConeDegrees: number;
  /** 0..1 — how quickly aim converges on the target each tick. */
  readonly aimTracking: number;
  /** Maximum turn rate, degrees per second. A human cannot snap 180. */
  readonly maxTurnDegPerSecond: number;
  /** 0..1 random noise added to utility scores, to break uniformity. */
  readonly decisionJitter: number;
}

export const DIFFICULTIES: Readonly<Record<string, DifficultyProfile>> = {
  recruit: {
    name: 'recruit',
    reactionMs: 620,
    fovDegrees: 95,
    viewRangeMeters: 42,
    aimConeDegrees: 7.5,
    aimTracking: 0.09,
    maxTurnDegPerSecond: 190,
    decisionJitter: 0.18,
  },
  regular: {
    name: 'regular',
    reactionMs: 380,
    fovDegrees: 110,
    viewRangeMeters: 62,
    aimConeDegrees: 4.2,
    aimTracking: 0.16,
    maxTurnDegPerSecond: 280,
    decisionJitter: 0.12,
  },
  hardened: {
    name: 'hardened',
    reactionMs: 240,
    fovDegrees: 125,
    viewRangeMeters: 85,
    aimConeDegrees: 2.4,
    aimTracking: 0.24,
    maxTurnDegPerSecond: 380,
    decisionJitter: 0.08,
  },
  veteran: {
    name: 'veteran',
    reactionMs: 160,
    fovDegrees: 140,
    viewRangeMeters: 110,
    aimConeDegrees: 1.4,
    aimTracking: 0.33,
    maxTurnDegPerSecond: 460,
    decisionJitter: 0.05,
  },
};

export function getDifficulty(name: string): DifficultyProfile {
  return DIFFICULTIES[name] ?? DIFFICULTIES.regular;
}

/**
 * Deterministic RNG.
 *
 * Seeded per agent so a match can be replayed exactly. `Math.random()` here
 * would make every desync investigation and every failing test unreproducible
 * — the server is already bit-deterministic and the AI must not be the thing
 * that breaks that.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // Avoid the zero state, which would lock xorshift at zero forever.
    this.state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let x = this.state;
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    this.state = x;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  }

  /** Uniform in [-1, 1). */
  signed(): number { return this.next() * 2 - 1; }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/**
 * Turn toward a target angle without exceeding a human turn rate.
 *
 * Shared by every aiming capability — body, vehicle, drone, missile — so no
 * possessed entity can out-turn what a player could achieve with a mouse.
 * Fairness by construction rather than by a per-weapon nerf flag.
 */
export function approachAngle(
  current: number, desired: number, maxDegPerSecond: number, dt: number,
): number {
  let delta = desired - current;
  // Wrap into [-PI, PI] so turning left across the seam does not spin the
  // long way around.
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  const maxStep = (maxDegPerSecond * Math.PI) / 180 * dt;
  if (delta > maxStep) delta = maxStep;
  if (delta < -maxStep) delta = -maxStep;
  return current + delta;
}

/**
 * Aim error, widening with distance.
 *
 * A constant cone would make a bot lethal at range and harmless up close,
 * which is backwards. Scaling with distance reproduces the human pattern:
 * reliable in a corridor, spraying across a field.
 */
export function aimError(
  profile: DifficultyProfile, distance: number, rng: SeededRandom,
): number {
  const widen = 1 + Math.min(distance / 40, 2.5);
  const cone = (profile.aimConeDegrees * widen * Math.PI) / 180;
  return rng.signed() * cone;
}
