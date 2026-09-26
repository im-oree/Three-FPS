/**
 * MovementCapabilities.ts — getting around, and the vehicle contract.
 *
 * EnterVehicle is the clearest demonstration of the whole design: the bot
 * cannot teleport into a seat, because all it can do is walk to the door and
 * set `Button.Interact`. Whether it actually mounts is decided by the same
 * range and occupancy checks that judge a human pressing E. If mounting is
 * broken for players it is broken for bots, which is exactly the property
 * that stops AI-only bugs from existing.
 */
import { Button } from '../../../net/Protocol';
import type { Vec3 } from '../../../net/Protocol';
import type { AgentContext } from '../AgentContext';
import type { Behaviour, Capability, InputIntent } from '../Capability';
import { MoveTo } from '../behaviours/MoveTo';
import { navContext } from '../NavContext';
import { getNavGrid } from '../NavContext';
import { findPath } from '../Navigation';

/**
 * Move around the map when there is nothing better to do.
 *
 * Patrol is the floor of the utility stack — it must always be available, or
 * an agent with nothing to do freezes. It picks a distant reachable cell and
 * claims it on the squad blackboard, so six idle bots spread out instead of
 * walking the same loop in single file.
 */
export class PatrolCapability implements Capability {
  readonly id = 'Patrol';
  readonly tags = ['Movement'];

  isAvailable(): boolean { return true; }

  scoreUtility(ctx: AgentContext): number {
    // Lowest positive score: anything with a real reason outranks it.
    return ctx.needs.hasEngageableTarget() ? 0 : 0.12;
  }

  preconditions(): Record<string, boolean> { return { alive: true }; }
  effects(): Record<string, boolean> { return { repositioned: true }; }
  cost(): number { return 4; }

  begin(ctx: AgentContext): Behaviour {
    const nav = navContext(ctx);
    const goal = pickPatrolPoint(ctx);
    const move = goal
      ? new MoveTo(nav.grid, nav.caps, goal, ctx, { sprint: true, stopWithin: 2 })
      : null;

    return {
      tick(c: AgentContext): InputIntent {
        return move ? move.tick(c) : {};
      },
      isDone(c: AgentContext): boolean {
        if (!move) return true;
        // Abandon the stroll the moment there is something to fight.
        return move.isDone(c) || c.needs.hasEngageableTarget() || c.needs.hasLead();
      },
      interrupt(c: AgentContext): void {
        c.squad.releaseAll(c.id);
      },
    };
  }
}

/** Choose somewhere worth walking to, avoiding spots peers have claimed. */
function pickPatrolPoint(ctx: AgentContext): Vec3 | null {
  const grid = getNavGrid();
  if (!grid) return null;

  const walkable = grid.cells.filter((cell) => cell !== null);
  if (walkable.length === 0) return null;

  // Sample a handful rather than scanning every cell: with a 2 m grid a large
  // map has thousands, and this runs for every idle bot.
  //
  // The minimum distance relaxes as attempts fail. On a small map like
  // killhouse (24 m across) almost nothing is 12 m away AND reachable AND
  // unclaimed, so a fixed floor left four of eleven bots with no patrol
  // point at all -- they stood still in Patrol pressing nothing, which is
  // exactly the "dull AI" behaviour this is meant to prevent.
  const ATTEMPTS = 24;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const cell = walkable[Math.floor(ctx.rng.next() * walkable.length)]!;
    const distance = Math.hypot(cell.x - ctx.self.px, cell.z - ctx.self.pz);
    const minimum = attempt < 8 ? 12 : attempt < 16 ? 6 : 3;
    if (distance < minimum) continue;
    const pos: Vec3 = [cell.x, cell.y, cell.z];
    // Reachability has to be checked HERE. Nav islands are real -- killhouse
    // has 19, mostly crate tops -- so a random walkable cell is often on a
    // rooftop this bot cannot climb to. MoveTo would then build an empty
    // path, finish instantly, and Patrol would restart on a new impossible
    // cell every tick, which reads as a bot vibrating on the spot.
    const route = findPath(
      grid, [ctx.self.px, ctx.self.py, ctx.self.pz], pos, navContext(ctx).caps,
    );
    if (!route || route.length === 0) continue;
    if (!ctx.squad.claimPosition(pos, ctx.id, ctx.world.time, 6)) continue;
    return pos;
  }
  return null;
}

/**
 * Walk to a vehicle and press interact.
 *
 * Deliberately does nothing clever: it cannot mount, it can only ask. The
 * behaviour finishes when the server reports the agent is seated, or gives up
 * after a few seconds of asking, which is what a player does when a seat
 * turns out to be occupied.
 */
export class EnterVehicleCapability implements Capability {
  readonly id = 'EnterVehicle';
  readonly tags = ['Movement'];

  isAvailable(ctx: AgentContext): boolean {
    return ctx.self.vehicleId === null && nearestVehicle(ctx) !== null;
  }

  scoreUtility(ctx: AgentContext): number {
    if (ctx.self.vehicleId !== null) return 0;
    const vehicle = nearestVehicle(ctx);
    if (!vehicle) return 0;
    // Worth it only when there is distance to cover and nothing to shoot.
    if (ctx.needs.hasEngageableTarget()) return 0;
    const distance = Math.hypot(vehicle[0] - ctx.self.px, vehicle[2] - ctx.self.pz);
    return distance < 25 ? 0.3 : 0.05;
  }

  preconditions(): Record<string, boolean> { return { inVehicle: false }; }
  effects(): Record<string, boolean> { return { inVehicle: true }; }
  cost(): number { return 3; }

  begin(ctx: AgentContext): Behaviour {
    const nav = navContext(ctx);
    const target = nearestVehicle(ctx);
    const move = target
      ? new MoveTo(nav.grid, nav.caps, target, ctx, { sprint: true, stopWithin: 2.2 })
      : null;
    let asking = 0;

    return {
      tick(c: AgentContext): InputIntent {
        if (!move) return {};
        if (!move.isDone(c)) return move.tick(c);
        // In range: press interact, exactly as a human holds E at the door.
        asking += c.dt;
        return { buttons: Button.Interact };
      },
      isDone(c: AgentContext): boolean {
        if (!move) return true;
        return c.self.vehicleId !== null || asking > 2.5;
      },
    };
  }
}

/** Nearest vehicle entity the agent could plausibly reach. */
function nearestVehicle(ctx: AgentContext): Vec3 | null {
  let best: Vec3 | null = null;
  let bestDistance = Infinity;
  for (const entity of ctx.world.allEntities) {
    if (!entity.active || !entity.alive) continue;
    if (!entity.kind.includes('vehicle') && !entity.kind.includes('car')
      && !entity.kind.includes('heli')) continue;
    const distance = Math.hypot(entity.px - ctx.self.px, entity.pz - ctx.self.pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [entity.px, entity.py, entity.pz];
    }
  }
  return bestDistance <= 60 ? best : null;
}

/**
 * Break contact and recover.
 *
 * Runs when badly hurt: move away from the threat rather than trading shots
 * that cannot be won. Without this a bot fights to the death every time,
 * which is both easy to exploit and nothing like how a player behaves.
 */
export class RetreatCapability implements Capability {
  readonly id = 'Retreat';
  readonly tags = ['Movement'];

  isAvailable(ctx: AgentContext): boolean {
    return ctx.needs.hurt() > 0.55 && ctx.needs.underThreat();
  }

  scoreUtility(ctx: AgentContext): number {
    if (!this.isAvailable(ctx)) return 0;
    // Outranks Engage once badly hurt, which is the point.
    return 0.6 + ctx.needs.hurt() * 0.35;
  }

  preconditions(): Record<string, boolean> { return { healthy: false }; }
  effects(): Record<string, boolean> { return { disengaged: true }; }
  cost(): number { return 2; }

  begin(ctx: AgentContext): Behaviour {
    const nav = navContext(ctx);
    const away = awayFromThreat(ctx, 18);
    const move = away
      ? new MoveTo(nav.grid, nav.caps, away, ctx, { sprint: true, stopWithin: 3 })
      : null;
    let elapsed = 0;

    return {
      tick(c: AgentContext): InputIntent {
        elapsed += c.dt;
        if (!move) return { buttons: Button.Sprint, moveZ: 1 };
        return { ...move.tick(c), buttons: Button.Sprint };
      },
      isDone(c: AgentContext): boolean {
        if (elapsed > 6) return true;
        if (!move) return elapsed > 3;
        // Do not abandon the retreat the instant the threat lapses: threat
        // drops the moment line of sight breaks, which is the first thing
        // running away achieves. Ending there meant Retreat lived 0.02s and
        // the bot bounced back into the open. Commit to actually getting
        // out, then reassess.
        if (elapsed < 1.5) return false;
        return move.isDone(c) || !c.needs.underThreat();
      },
    };
  }
}

/** A point directly away from the nearest visible threat. */
function awayFromThreat(ctx: AgentContext, distance: number): Vec3 | null {
  let threat: { x: number; z: number } | null = null;
  let nearest = Infinity;
  for (const sighting of ctx.beliefs.sightings.values()) {
    if (!sighting.visible) continue;
    if (sighting.distance < nearest) {
      nearest = sighting.distance;
      threat = { x: sighting.x, z: sighting.z };
    }
  }
  if (!threat) return null;

  const dx = ctx.self.px - threat.x;
  const dz = ctx.self.pz - threat.z;
  const length = Math.hypot(dx, dz) || 1;
  return [
    ctx.self.px + (dx / length) * distance,
    ctx.self.py,
    ctx.self.pz + (dz / length) * distance,
  ];
}
