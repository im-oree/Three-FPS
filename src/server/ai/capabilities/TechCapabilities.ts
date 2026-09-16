/**
 * TechCapabilities.ts — combat decisions a good player makes under fire.
 *
 * Travel tech (slide, hop) lives in MoveTo, because it applies to every
 * capability that moves and should not compete with them as a rival goal.
 * What is left here is tech that IS a decision: choosing to hit the deck
 * mid-gunfight instead of standing and trading. Gated on a SKILL number, so
 * only some bots ever do it.
 *
 * These are ordinary capability modules. Nothing in AgentController,
 * Planner, Perception, AISystem or Navigation knows they exist: they are
 * registered by id and scored against everything else, exactly as the
 * architecture requires. Adding "dolphin dive" later is another file like
 * this one and a line in registerCapabilities.ts.
 *
 * Every one of them emits BUTTONS. A bot slides by pressing sprint and then
 * crouch, the same two keys a human presses, and the movement system decides
 * what that means. None of them move the body directly.
 */
import { Button } from '../../../net/Protocol';
import type { AgentContext } from '../AgentContext';
import type { Behaviour, Capability, InputIntent } from '../Capability';

/**
 * Drop to a crouch as a gunfight opens.
 *
 * "Dropshotting": crouching or going prone the instant you start shooting
 * pulls your head out of the enemy's crosshair. Gated on `dropshotTendency`
 * so only some personalities do it at all.
 */
export class DropshotCapability implements Capability {
  readonly id = 'Dropshot';
  readonly tags = ['Combat', 'Tech'];

  isAvailable(ctx: AgentContext): boolean {
    if (ctx.skill.dropshotTendency < 0.2) return false;
    // Only in an actual fight, and only when already being shot at -- this
    // is a reaction, not an opening move.
    return ctx.needs.hasEngageableTarget() && ctx.needs.hurt() > 0.15;
  }

  scoreUtility(ctx: AgentContext): number {
    if (!this.isAvailable(ctx)) return 0;
    // Must beat Engage (about 1.0) to be worth anything, but only just, and
    // only for the fraction of bots with a high tendency.
    return 0.95 + 0.25 * ctx.skill.dropshotTendency;
  }

  preconditions(): Record<string, boolean> { return { hasTarget: true }; }
  effects(): Record<string, boolean> { return { engaged: true }; }
  cost(): number { return 1; }

  begin(ctx: AgentContext): Behaviour {
    let elapsed = 0;
    const duration = 0.8 + ctx.rng.next() * 0.6;
    return {
      tick(c: AgentContext): InputIntent {
        elapsed += c.dt;
        // Keep shooting on the way down. A dropshot that stops firing is
        // just lying down in the open.
        const aim = aimAtFocus(c);
        return {
          moveX: 0,
          moveZ: 0,
          yaw: aim?.yaw ?? c.self.yaw,
          pitch: aim?.pitch ?? c.self.pitch,
          buttons: Button.Crouch | Button.Fire | Button.ADS,
        };
      },
      isDone(c: AgentContext): boolean {
        return elapsed >= duration || !c.needs.hasEngageableTarget();
      },
    };
  }
}

/**
 * Where the bot currently wants to look, or null if it has no focus.
 *
 * Reads only the agent's own beliefs -- the same filtered, delayed picture
 * perception gave it. It never touches world state, so this cannot become a
 * back door to omniscience.
 */
function aimAtFocus(ctx: AgentContext): { yaw: number; pitch: number } | null {
  const focusId = ctx.beliefs.focusId;
  if (!focusId) return null;
  const sighting = ctx.beliefs.sightings.get(focusId);
  if (!sighting) return null;

  const dx = sighting.x - ctx.self.px;
  const dz = sighting.z - ctx.self.pz;
  const dy = (sighting.y + 1.4) - (ctx.self.py + ctx.self.height * 0.9);
  const flat = Math.hypot(dx, dz) || 1e-3;
  return {
    yaw: Math.atan2(-dx, dz),
    pitch: Math.atan2(dy, flat),
  };
}
