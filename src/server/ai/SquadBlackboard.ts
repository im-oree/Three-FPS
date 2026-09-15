/**
 * SquadBlackboard.ts — shared intent, so a squad is not six copies of one bot.
 *
 * Without this, every bot on a team independently reaches the same conclusion
 * and they all do the same thing: six agents sprinting the same lane at the
 * same corner. The fix is not a scripted "squad tactic" state machine — those
 * are the things that rot. It is contention: a bot claims a role or a
 * position, and the claim makes that option unavailable to the others, so
 * they naturally pick their second choice and the squad spreads out.
 *
 * Sightings are shared here too, which is fair: a human squad has voice comms
 * and a minimap. The important restriction is that only Perception.ts writes
 * a sighting, and only after a real line-of-sight check by some member of the
 * team. Nobody gets information the team did not actually earn.
 */
import type { PlayerId, Vec3 } from '../../net/Protocol';

interface Claim {
  owner: PlayerId;
  /** Server time the claim was made, for expiry. */
  at: number;
}

/** Claims older than this are assumed abandoned (the claimant probably died). */
const CLAIM_TIMEOUT = 12;

export class SquadBlackboard {
  private readonly roles = new Map<string, Claim>();
  private readonly positions: { owner: PlayerId; pos: Vec3; at: number }[] = [];
  /** Sightings contributed by any member, keyed by target. */
  readonly shared = new Map<PlayerId, { pos: Vec3; at: number; by: PlayerId }>();

  /** Claim a named role. Returns false if someone else holds it. */
  claimRole(role: string, owner: PlayerId, now: number): boolean {
    const existing = this.roles.get(role);
    if (existing && existing.owner !== owner && now - existing.at < CLAIM_TIMEOUT) {
      return false;
    }
    this.roles.set(role, { owner, at: now });
    return true;
  }

  releaseRole(role: string, owner: PlayerId): void {
    if (this.roles.get(role)?.owner === owner) this.roles.delete(role);
  }

  holdsRole(role: string, owner: PlayerId): boolean {
    return this.roles.get(role)?.owner === owner;
  }

  /**
   * Claim a spot on the map, rejecting anything too close to an existing
   * claim. This is what stops two bots from stacking in the same doorway.
   */
  claimPosition(pos: Vec3, owner: PlayerId, now: number, minSeparation = 3): boolean {
    for (let i = this.positions.length - 1; i >= 0; i -= 1) {
      const entry = this.positions[i];
      if (now - entry.at > CLAIM_TIMEOUT) { this.positions.splice(i, 1); continue; }
      if (entry.owner === owner) { this.positions.splice(i, 1); continue; }
      const dx = entry.pos[0] - pos[0];
      const dz = entry.pos[2] - pos[2];
      if (Math.hypot(dx, dz) < minSeparation) return false;
    }
    this.positions.push({ owner, pos, at: now });
    return true;
  }

  reportSighting(target: PlayerId, pos: Vec3, by: PlayerId, now: number): void {
    this.shared.set(target, { pos, at: now, by });
  }

  /** Forget everything. Called on match start and end. */
  reset(): void {
    this.roles.clear();
    this.positions.length = 0;
    this.shared.clear();
  }

  /** Release everything one agent holds, e.g. when it dies. */
  releaseAll(owner: PlayerId): void {
    for (const [role, claim] of this.roles) {
      if (claim.owner === owner) this.roles.delete(role);
    }
    for (let i = this.positions.length - 1; i >= 0; i -= 1) {
      if (this.positions[i].owner === owner) this.positions.splice(i, 1);
    }
  }
}
