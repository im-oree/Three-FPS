/**
 * Perception.ts — what a bot is allowed to know.
 *
 * FAIRNESS IS ENFORCED HERE OR NOWHERE
 * ------------------------------------
 * Every fact a bot acts on is produced by this file. Nothing else in ai/
 * reads the world directly, so "does the AI cheat" is a question with one
 * place to look. A bot sees an enemy only when the enemy is inside its view
 * cone, within its view range, and on the clear side of a `hasLineOfSight`
 * call — the same CollisionWorld raycast that decides whether a bullet
 * connects. A wall that stops a bullet stops sight, by construction.
 *
 * WHY MEMORY DECAYS INSTEAD OF VANISHING
 * --------------------------------------
 * Dropping a target the instant line of sight breaks produces the classic
 * goldfish bot: it chases you behind a crate, loses you, forgets, wanders
 * off. Humans keep hunting the spot for a few seconds. So a sighting becomes
 * a decaying memory with a last-known position, and the bot commits to it
 * until the memory expires. That single detail is most of the difference
 * between "dull AI" and something that feels like it is looking for you.
 *
 * Difficulty is tuned through the three honest levers — reaction time, view
 * cone, view range — never by granting knowledge. A hard bot notices you
 * sooner and from further away. It never knows where you are through a wall.
 */
import type { PlayerId, Vec3 } from '../../net/Protocol';
import type { CollisionWorld } from '../CollisionWorld';
import type { ServerPlayer, ServerWorld } from '../ServerWorld';
import type { DifficultyProfile } from './Difficulty';

/** Eye height above the player's feet, matching the combat hitbox model. */
export const EYE_HEIGHT = 1.68;

export interface Sighting {
  readonly id: PlayerId;
  /** Where it was last actually seen. */
  x: number; y: number; z: number;
  /** Server time of the last confirmed sighting. */
  lastSeen: number;
  /** True only while currently visible this tick. */
  visible: boolean;
  /** Distance at the last sighting. */
  distance: number;
}

/**
 * Everything one agent believes about the world.
 *
 * Plain mutable fields rather than a string-keyed bag: the planner needs
 * string facts, but perception itself benefits from types, and the two are
 * bridged in one place (`toFacts`) rather than scattered.
 */
export class Beliefs {
  readonly sightings = new Map<PlayerId, Sighting>();
  /** The target the agent has committed to, if any. */
  focusId: PlayerId | null = null;
  /** Time the current focus first became visible, for reaction delay. */
  focusAcquiredAt = 0;
  /** True once the reaction delay has elapsed and the bot may act on focus. */
  focusReady = false;
  /** Last position a threat was heard from, if any. */
  heardAt: Vec3 | null = null;
  heardTime = 0;
  /**
   * Leads already walked to and found empty.
   *
   * Without this a bot hunts a stale sighting, arrives, still remembers it,
   * and re-hunts the spot it is already standing on — it re-decides every
   * tick and never goes anywhere. Investigating a place is what uses the
   * lead up, exactly as it does for a player.
   */
  readonly clearedLeads = new Set<PlayerId>();
  heardCleared = false;

  /** Mark a remembered contact as investigated. */
  clearLead(id: PlayerId | null): void {
    if (id) this.clearedLeads.add(id);
    else this.heardCleared = true;
  }

  clear(): void {
    this.sightings.clear();
    this.focusId = null;
    this.focusReady = false;
    this.heardAt = null;
    this.clearedLeads.clear();
    this.heardCleared = false;
  }
}

/** How long a lost target is still worth hunting, in seconds. */
export const MEMORY_SECONDS = 6;

/**
 * Update one agent's beliefs.
 *
 * Returns the number of raycasts spent, so the scheduler can hold the whole
 * squad inside a global budget: 30 bots each casting at every other player
 * every tick is the easiest way to lose the frame, and it buys nothing,
 * because a bot that re-checks line of sight 60 times a second is not more
 * convincing than one that checks 10 times a second.
 */
export function perceive(
  self: ServerPlayer,
  world: ServerWorld,
  collision: CollisionWorld,
  beliefs: Beliefs,
  profile: DifficultyProfile,
  rayBudget: number,
): number {
  const now = world.time;
  let raysUsed = 0;

  const eye: Vec3 = [self.px, self.py + EYE_HEIGHT, self.pz];
  const cosHalfFov = Math.cos((profile.fovDegrees * 0.5 * Math.PI) / 180);

  // Everything starts unseen; only a successful check sets it back.
  for (const sighting of beliefs.sightings.values()) sighting.visible = false;

  for (const other of world.allPlayers) {
    if (other.id === self.id || !other.alive) continue;

    const dx = other.px - self.px;
    const dy = other.py - self.py;
    const dz = other.pz - self.pz;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > profile.viewRangeMeters) continue;

    // Facing test before the raycast: it is a dot product against a cheap
    // normalisation, and it rejects most candidates for free.
    if (distance > 1e-3) {
      const forwardX = -Math.sin(self.yaw);
      const forwardZ = -Math.cos(self.yaw);
      const dot = (dx / distance) * forwardX + (dz / distance) * forwardZ;
      if (dot < cosHalfFov) continue;
    }

    if (raysUsed >= rayBudget) break;
    raysUsed += 1;
    const target: Vec3 = [other.px, other.py + EYE_HEIGHT * 0.8, other.pz];
    if (!collision.hasLineOfSight(eye, target)) continue;

    // Seeing someone again makes them worth investigating once more.
    beliefs.clearedLeads.delete(other.id);
    const existing = beliefs.sightings.get(other.id);
    if (existing) {
      existing.x = other.px; existing.y = other.py; existing.z = other.pz;
      existing.lastSeen = now;
      existing.visible = true;
      existing.distance = distance;
    } else {
      beliefs.sightings.set(other.id, {
        id: other.id,
        x: other.px, y: other.py, z: other.pz,
        lastSeen: now, visible: true, distance,
      });
    }
  }

  // Expire stale memories.
  for (const [id, sighting] of beliefs.sightings) {
    if (now - sighting.lastSeen > MEMORY_SECONDS) beliefs.sightings.delete(id);
  }

  updateFocus(beliefs, now, profile);
  return raysUsed;
}

/**
 * Choose and hold a target.
 *
 * Nearest-visible wins, but an existing visible focus is kept unless a new
 * candidate is meaningfully closer. Without that hysteresis a bot flanked by
 * two enemies at similar range oscillates between them every tick and hits
 * neither — it reads as a malfunction, not as indecision.
 */
function updateFocus(beliefs: Beliefs, now: number, profile: DifficultyProfile): void {
  let best: Sighting | null = null;
  for (const sighting of beliefs.sightings.values()) {
    if (!sighting.visible) continue;
    if (!best || sighting.distance < best.distance) best = sighting;
  }

  if (best) {
    const current = beliefs.focusId ? beliefs.sightings.get(beliefs.focusId) : undefined;
    const keepCurrent = current?.visible
      && current.distance <= best.distance * 1.35;
    if (!keepCurrent && beliefs.focusId !== best.id) {
      beliefs.focusId = best.id;
      beliefs.focusAcquiredAt = now;
      beliefs.focusReady = false;
    }
  } else if (beliefs.focusId) {
    // Keep hunting a remembered target until the memory expires.
    const remembered = beliefs.sightings.get(beliefs.focusId);
    if (!remembered) {
      beliefs.focusId = null;
      beliefs.focusReady = false;
    }
  }

  // Reaction delay: a bot may not shoot the instant a target appears. This is
  // the single most important humanising knob — without it, even a bot with
  // a wide aim cone feels inhuman, because the timing is impossible.
  if (beliefs.focusId && !beliefs.focusReady) {
    if ((now - beliefs.focusAcquiredAt) * 1000 >= profile.reactionMs) {
      beliefs.focusReady = true;
    }
  }
}

/** Note a heard threat. Gunfire and explosions carry further than footsteps. */
export function hear(beliefs: Beliefs, at: Vec3, now: number): void {
  beliefs.heardAt = at;
  beliefs.heardTime = now;
}
