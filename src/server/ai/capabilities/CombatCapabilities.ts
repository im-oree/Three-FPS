/**
 * CombatCapabilities.ts — fighting, expressed purely as button presses.
 *
 * Every capability here returns aim and buttons. None of them deal damage,
 * consume ammo or check hit registration: CombatSystem does all of that when
 * it sees `Button.Fire` in the agent's input, using the identical code path a
 * human's click takes. A bot therefore obeys fire rate, magazine size,
 * reload time and damage falloff automatically, and cannot be given a secret
 * advantage without that advantage also applying to players.
 */
import { Button } from '../../../net/Protocol';
import type { Vec3 } from '../../../net/Protocol';
import type { PlayerId } from '../../../net/Protocol';
import type { AgentContext } from '../AgentContext';
import type { Behaviour, Capability, InputIntent } from '../Capability';
import { aimError, approachAngle } from '../Difficulty';
import { EYE_HEIGHT } from '../Perception';
import { MoveTo } from '../behaviours/MoveTo';
import { navContext } from '../NavContext';

/** Aim at a point, with human turn-rate and cone error applied. */
function aimAt(ctx: AgentContext, target: Vec3, distance: number): {
  yaw: number; pitch: number; onTarget: boolean;
} {
  const { self, profile, rng } = ctx;
  const dx = target[0] - self.px;
  const dy = target[1] - (self.py + EYE_HEIGHT);
  const dz = target[2] - self.pz;

  // Same basis as MovementSystem; see MoveTo for the derivation.
  const desiredYaw = Math.atan2(-dx, dz) + aimError(profile, distance, rng);
  const flat = Math.hypot(dx, dz);
  const desiredPitch = Math.atan2(dy, flat) + aimError(profile, distance, rng) * 0.4;

  const yaw = approachAngle(self.yaw, desiredYaw, profile.maxTurnDegPerSecond, ctx.dt);
  const pitch = Math.max(-1.4, Math.min(1.4,
    self.pitch + (desiredPitch - self.pitch) * Math.min(1, profile.aimTracking * 6)));

  // Only pull the trigger when actually pointed at the target. Firing while
  // still swinging is what produces bots that spray at walls.
  let delta = desiredYaw - yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const onTarget = Math.abs(delta) < 0.12 && Math.abs(desiredPitch - pitch) < 0.16;

  return { yaw, pitch, onTarget };
}

/**
 * Engage the current target.
 *
 * Holds position and shoots while the target is visible; the moment it is
 * lost, this reports done and the utility layer picks something else —
 * usually Hunt, which goes to the last known position.
 */
export class EngageCapability implements Capability {
  readonly id = 'Engage';
  readonly tags = ['Combat'];

  isAvailable(ctx: AgentContext): boolean {
    return ctx.needs.hasEngageableTarget();
  }

  scoreUtility(ctx: AgentContext): number {
    if (!ctx.needs.hasEngageableTarget()) return 0;
    // Closer targets are more urgent; a badly hurt bot would rather not.
    const distance = ctx.needs.focusDistance();
    const proximity = Math.max(0, 1 - distance / ctx.profile.viewRangeMeters);
    return 0.72 + proximity * 0.2 - ctx.needs.hurt() * 0.25;
  }

  preconditions(): Record<string, boolean> { return { hasTarget: true }; }
  effects(): Record<string, boolean> { return { targetEngaged: true }; }
  cost(): number { return 1; }

  begin(): Behaviour {
    let strafe = 0;
    let strafeTimer = 0;

    return {
      tick(ctx: AgentContext): InputIntent {
        const { beliefs } = ctx;
        const sighting = beliefs.focusId ? beliefs.sightings.get(beliefs.focusId) : undefined;
        if (!sighting) return {};

        const target: Vec3 = [sighting.x, sighting.y + EYE_HEIGHT * 0.8, sighting.z];
        const { yaw, pitch, onTarget } = aimAt(ctx, target, sighting.distance);

        // Strafe while shooting. A stationary shooter is both trivially easy
        // to kill and instantly readable as a bot; humans never stand still
        // in a firefight.
        strafeTimer -= ctx.dt;
        if (strafeTimer <= 0) {
          strafe = ctx.rng.next() < 0.5 ? -1 : 1;
          strafeTimer = ctx.rng.range(0.4, 1.1);
        }

        // Close the distance if the target is far, back off if very close.
        const moveZ = sighting.distance > 22 ? 0.6 : sighting.distance < 4 ? -0.5 : 0;

        let buttons = 0;
        if (onTarget && sighting.visible) {
          buttons |= Button.Fire;
          noteFired(ctx.self, ctx.world.time);
        }
        // Aim down sights at range; hip-fire up close, like a player.
        if (sighting.distance > 14) buttons |= Button.ADS;

        return { moveX: strafe * 0.7, moveZ, yaw, pitch, buttons };
      },
      isDone(ctx: AgentContext): boolean {
        return !ctx.needs.hasEngageableTarget();
      },
    };
  }
}

/**
 * Go to where the target was last seen.
 *
 * This is the behaviour that makes a bot feel like it is looking for you
 * rather than having forgotten you. It runs on a decayed sighting or a heard
 * shot, and ends when something is actually seen (Engage outscores it) or the
 * memory expires.
 */
export class HuntCapability implements Capability {
  readonly id = 'Hunt';
  readonly tags = ['Combat', 'Movement'];

  isAvailable(ctx: AgentContext): boolean { return ctx.needs.hasLead(); }

  scoreUtility(ctx: AgentContext): number {
    if (!ctx.needs.hasLead()) return 0;
    // Below Engage, above Patrol: investigate only when nothing is visible.
    return 0.45 - ctx.needs.hurt() * 0.15;
  }

  preconditions(): Record<string, boolean> { return { hasLead: true }; }
  effects(): Record<string, boolean> { return { leadInvestigated: true }; }
  cost(): number { return 2; }

  begin(ctx: AgentContext): Behaviour {
    const lead = pickLead(ctx);
    const nav = navContext(ctx);
    const move = lead
      ? new MoveTo(nav.grid, nav.caps, lead.pos, ctx, { sprint: true, stopWithin: 2.5 })
      : null;
    let chasing = lead?.id ?? null;

    return {
      tick(c: AgentContext): InputIntent {
        if (!move) return {};
        // Keep chasing an updated last-known position.
        const current = pickLead(c);
        if (current) { move.retarget(current.pos, c); chasing = current.id; }
        return move.tick(c);
      },
      isDone(c: AgentContext): boolean {
        if (!move) return true;
        // Seeing something outranks investigating a rumour.
        if (c.needs.hasEngageableTarget()) return true;
        if (move.isDone(c)) {
          // Arrived and found nothing: use the lead up, or the bot would
          // immediately re-hunt the spot it is standing on.
          if (lead) c.beliefs.clearLead(chasing);
          return true;
        }
        return !c.needs.hasLead();
      },
    };
  }
}

/** The best lead available: freshest remembered sighting, else a heard shot. */
function pickLead(ctx: AgentContext): { id: PlayerId | null; pos: Vec3 } | null {
  let best: { at: number; id: PlayerId; pos: Vec3 } | null = null;
  for (const [id, sighting] of ctx.beliefs.sightings) {
    if (ctx.beliefs.clearedLeads.has(id)) continue;
    if (!best || sighting.lastSeen > best.at) {
      best = { at: sighting.lastSeen, id, pos: [sighting.x, sighting.y, sighting.z] };
    }
  }
  if (ctx.beliefs.heardAt && !ctx.beliefs.heardCleared
    && (!best || ctx.beliefs.heardTime > best.at)) {
    return { id: null, pos: ctx.beliefs.heardAt };
  }
  return best ? { id: best.id, pos: best.pos } : null;
}

/**
 * Reload when it is safe to.
 *
 * Only presses the button; ReloadSystem owns duration and whether it is even
 * legal. Scores high when the magazine is low and nothing is visible, which
 * is the same judgement a player makes between fights.
 */
export class ReloadCapability implements Capability {
  readonly id = 'Reload';
  readonly tags = ['Combat'];

  /**
   * Only available in the lull just after shooting.
   *
   * The first version was available whenever no enemy was visible, and scored
   * 0.2 against Patrol's 0.12 — so an idle bot reloaded forever and never
   * took a step. Topping up is only worth doing when something was actually
   * fired, and it must never be the reason a bot stands still.
   */
  isAvailable(ctx: AgentContext): boolean {
    if (ctx.needs.underThreat()) return false;
    const since = ctx.world.time - lastFiredAt(ctx);
    return since >= 0 && since < 6;
  }

  scoreUtility(ctx: AgentContext): number {
    return this.isAvailable(ctx) ? 0.18 : 0;
  }

  preconditions(): Record<string, boolean> { return { hasTarget: false }; }
  effects(): Record<string, boolean> { return { weaponLoaded: true }; }
  cost(): number { return 1; }

  begin(ctx: AgentContext): Behaviour {
    let held = 0;
    // Remember that we topped up, so this cannot immediately re-trigger.
    markReloaded(ctx);
    return {
      tick(c: AgentContext): InputIntent {
        held += c.dt;
        return { buttons: Button.Reload };
      },
      isDone(): boolean { return held > 0.3; },
    };
  }
}

/**
 * Per-agent record of when it last fired and last reloaded.
 *
 * Keyed off the player record rather than stored on the capability, because a
 * capability instance is shared conceptually but the state is per agent.
 */
const firedAt = new WeakMap<object, number>();
const reloadedAt = new WeakMap<object, number>();

export function noteFired(player: object, time: number): void {
  firedAt.set(player, time);
}

function lastFiredAt(ctx: AgentContext): number {
  const fired = firedAt.get(ctx.self);
  if (fired === undefined) return -Infinity;
  const reloaded = reloadedAt.get(ctx.self) ?? -Infinity;
  // Already topped up since the last shot: nothing to do.
  return reloaded > fired ? -Infinity : fired;
}

function markReloaded(ctx: AgentContext): void {
  reloadedAt.set(ctx.self, ctx.world.time);
}
