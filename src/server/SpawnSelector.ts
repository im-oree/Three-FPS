/**
 * SpawnSelector.ts — where a player comes back to life.
 *
 * This is the Call of Duty spawn model, not a round-robin over a list. Real
 * COD scores every candidate point each time someone needs one, because the
 * safe part of the map moves continuously as players push. The published
 * behaviour (Treyarch's own patch notes, and the long-standing MW2 rules)
 * weighs:
 *
 *   - enemy proximity        — close enemies poison a spawn;
 *   - enemy line of sight    — a point someone is LOOKING at is far worse
 *                              than one merely near them;
 *   - recent deaths there    — dying at a point should not send you back to it;
 *   - teammate presence      — spawning near friends is good in team modes
 *                              ("buddy spawn"), and irrelevant in FFA;
 *   - reuse decay            — avoid handing out the same point repeatedly.
 *
 * The selector is deliberately deterministic given the same world state and
 * the same RNG draw, so a test can assert "this is the spawn that gets used"
 * rather than probing statistically.
 *
 * Round-robin is kept as the FALLBACK, not the strategy: when every point is
 * contested (a tiny map like Shipment with eight players fighting in a box)
 * scoring alone would keep picking one least-bad point, so the selector
 * rotates through the best few instead of always taking the maximum.
 */
import type { Vec3 } from '../net/Protocol';
import type { CollisionWorld } from './CollisionWorld';
import type { ServerPlayer, SpawnPoint } from './ServerWorld';

/** Eye height used for the "is anyone looking at this point" test. */
const EYE_HEIGHT = 1.68;
/** A spawn this close to an enemy is effectively a spawn kill. */
const DANGER_RADIUS = 12;
/** Beyond this an enemy no longer influences a point at all. */
const INFLUENCE_RADIUS = 34;
/** How long a death keeps poisoning the point it happened at. */
const DEATH_MEMORY_SECONDS = 7;
/** How long a point stays "recently used". */
const REUSE_MEMORY_SECONDS = 5;
/** Ranked candidates to rotate between when everything is contested. */
const ROTATION_POOL = 3;

/**
 * A spawn point with a living player inside this radius is unusable.
 *
 * Larger than a player capsule on purpose: not clipping into someone is the
 * minimum bar, but spawning two metres from a stranger in a free-for-all is
 * still a bad spawn.
 */
const OCCUPIED_RADIUS = 4.5;

export type SpawnSetName = 'ffa' | 'teamA' | 'teamB';

export interface SpawnSets {
  readonly ffa: readonly SpawnPoint[];
  readonly teamA: readonly SpawnPoint[];
  readonly teamB: readonly SpawnPoint[];
}

interface RecentEvent { x: number; z: number; at: number }

export interface SpawnScoreDetail {
  readonly point: SpawnPoint;
  readonly score: number;
  readonly nearestEnemy: number;
  readonly visibleToEnemy: boolean;
}

export class SpawnSelector {
  private sets: SpawnSets = { ffa: [], teamA: [], teamB: [] };

  /** Deaths, so we do not respawn someone where they just died. */
  private readonly recentDeaths: RecentEvent[] = [];
  /** Recently handed-out points, so eight players do not stack on one. */
  private readonly recentlyUsed: RecentEvent[] = [];
  /** Rotation cursor, used only to break ties between equally good points. */
  private cursor = 0;

  loadSets(sets: Partial<SpawnSets>): void {
    this.sets = {
      ffa: sets.ffa ?? [],
      teamA: sets.teamA ?? [],
      teamB: sets.teamB ?? [],
    };
  }

  get loaded(): boolean {
    return this.sets.ffa.length > 0 || this.sets.teamA.length > 0;
  }

  countFor(set: SpawnSetName): number { return this.sets[set].length; }

  reset(): void {
    this.recentDeaths.length = 0;
    this.recentlyUsed.length = 0;
    this.cursor = 0;
  }

  /** Called by whoever owns death, so the point is avoided for a few seconds. */
  noteDeath(x: number, z: number, now: number): void {
    this.recentDeaths.push({ x, z, at: now });
  }

  /**
   * Pick a spawn.
   *
   * `enemies` and `friends` are passed in rather than read from the world so
   * that the mode layer decides who counts as an enemy: in FFA everyone else
   * is an enemy and there are no friends, in TDM it is the other team.
   */
  select(
    set: SpawnSetName,
    enemies: readonly ServerPlayer[],
    friends: readonly ServerPlayer[],
    collision: CollisionWorld,
    now: number,
  ): SpawnPoint | null {
    const points = this.sets[set].length ? this.sets[set] : this.sets.ffa;
    if (!points.length) return null;

    this.expire(now);

    const ranked = points
      .map((point) => this.scorePoint(point, enemies, friends, collision, now))
      .sort((a, b) => b.score - a.score);

    // HARD rule, applied before any scoring is allowed to matter: a point
    // with a living body on it is not a spawn point. Scoring alone cannot
    // express this -- a penalty is a preference, and eight players placed in
    // the same instant will happily all accept the same "slightly penalised"
    // best point and end up standing inside each other. Which is exactly
    // what happened: eight players, closest pair 0.4 m apart.
    const free = ranked.filter((entry) => !this.isOccupied(entry.point, enemies, friends));
    // If every point is occupied (tiny map, full lobby) fall back to the
    // ranking rather than refusing to spawn: being crowded beats being
    // nowhere.
    const usable = free.length ? free : ranked;

    // Rotate among the top few rather than always taking the single best.
    // Always taking the maximum makes spawns predictable, which is exactly
    // how spawn camping starts.
    const poolSize = Math.min(ROTATION_POOL, usable.length);
    const chosen = usable[this.cursor % poolSize];
    this.cursor += 1;

    this.recentlyUsed.push({ x: chosen.point.pos[0], z: chosen.point.pos[2], at: now });
    return chosen.point;
  }

  /** Exposed for tests and the debug overlay: the full ranking, unmutated. */
  rank(
    set: SpawnSetName,
    enemies: readonly ServerPlayer[],
    friends: readonly ServerPlayer[],
    collision: CollisionWorld,
    now: number,
  ): SpawnScoreDetail[] {
    const points = this.sets[set].length ? this.sets[set] : this.sets.ffa;
    return points
      .map((p) => this.scorePoint(p, enemies, friends, collision, now))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Is somebody already standing here?
   *
   * Uses a generous radius: two players 2 m apart are not intersecting, but
   * spawning that close to a stranger is still a bad spawn — in FFA it is an
   * instant free kill for whoever turns around first.
   */
  private isOccupied(
    point: SpawnPoint,
    enemies: readonly ServerPlayer[],
    friends: readonly ServerPlayer[],
  ): boolean {
    const [px, , pz] = point.pos;
    for (const other of enemies) {
      if (!other.alive) continue;
      if (Math.hypot(other.px - px, other.pz - pz) < OCCUPIED_RADIUS) return true;
    }
    for (const other of friends) {
      if (!other.alive) continue;
      if (Math.hypot(other.px - px, other.pz - pz) < OCCUPIED_RADIUS) return true;
    }
    return false;
  }

  private scorePoint(
    point: SpawnPoint,
    enemies: readonly ServerPlayer[],
    friends: readonly ServerPlayer[],
    collision: CollisionWorld,
    now: number,
  ): SpawnScoreDetail {
    const [px, py, pz] = point.pos;
    let score = 1000;
    let nearestEnemy = Infinity;
    let visibleToEnemy = false;

    const spawnEye: Vec3 = [px, py + EYE_HEIGHT, pz];

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const distance = Math.hypot(enemy.px - px, enemy.pz - pz);
      if (distance < nearestEnemy) nearestEnemy = distance;
      if (distance > INFLUENCE_RADIUS) continue;

      // Proximity: quadratic so the last few metres hurt far more than the
      // first few. A linear penalty treats 30 m as meaningfully dangerous,
      // which it is not.
      const closeness = 1 - distance / INFLUENCE_RADIUS;
      score -= 260 * closeness * closeness;
      if (distance < DANGER_RADIUS) score -= 220;

      // Line of sight is the dominant term, per the MW2-onward rule: it is
      // not being near an enemy that kills you, it is being in front of one.
      const enemyEye: Vec3 = [enemy.px, enemy.py + EYE_HEIGHT, enemy.pz];
      if (collision.hasLineOfSight(enemyEye, spawnEye)) {
        visibleToEnemy = true;
        score -= 400;
        // Worse still if they are actually facing it.
        const dx = px - enemy.px;
        const dz = pz - enemy.pz;
        const len = Math.hypot(dx, dz) || 1;
        const forwardX = -Math.sin(enemy.yaw);
        const forwardZ = Math.cos(enemy.yaw);
        const facing = (dx / len) * forwardX + (dz / len) * forwardZ;
        if (facing > 0.5) score -= 300;
      }
    }

    // Buddy spawn: in team modes, appearing near a teammate is good, because
    // the side of the map your team holds is the safe side.
    for (const friend of friends) {
      if (!friend.alive) continue;
      const distance = Math.hypot(friend.px - px, friend.pz - pz);
      if (distance < INFLUENCE_RADIUS) {
        score += 120 * (1 - distance / INFLUENCE_RADIUS);
      }
    }

    for (const death of this.recentDeaths) {
      const distance = Math.hypot(death.x - px, death.z - pz);
      if (distance < DANGER_RADIUS) {
        const age = (now - death.at) / DEATH_MEMORY_SECONDS;
        score -= 320 * (1 - age);
      }
    }

    for (const used of this.recentlyUsed) {
      const distance = Math.hypot(used.x - px, used.z - pz);
      if (distance < DANGER_RADIUS * 0.6) {
        const age = (now - used.at) / REUSE_MEMORY_SECONDS;
        score -= 200 * (1 - age);
      }
    }

    return { point, score, nearestEnemy, visibleToEnemy };
  }

  private expire(now: number): void {
    prune(this.recentDeaths, now, DEATH_MEMORY_SECONDS);
    prune(this.recentlyUsed, now, REUSE_MEMORY_SECONDS);
  }
}

function prune(list: RecentEvent[], now: number, ttl: number): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (now - list[i].at > ttl) list.splice(i, 1);
  }
}
