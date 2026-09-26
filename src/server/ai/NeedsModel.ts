/**
 * NeedsModel.ts — why a bot wants anything.
 *
 * This is the layer that replaces "wander until you bump into someone".
 * Capabilities do not decide when to run; they report how well they serve the
 * agent's current needs, and the needs come from real state: how hurt it is,
 * how much ammo is left, whether anything is shooting at it.
 *
 * Every value is normalised 0..1 so utility scores are comparable across
 * capabilities written months apart by people who never spoke. A capability
 * that returns raw metres or raw ammo counts would silently dominate every
 * decision, and the bug would look like "the AI is obsessed with reloading".
 */
import type { AgentContext } from './AgentContext';

export class NeedsModel {
  /** Set by the controller each tick; avoids a circular constructor. */
  ctx: AgentContext | null = null;

  private get c(): AgentContext {
    if (!this.ctx) throw new Error('NeedsModel used before its context was set');
    return this.ctx;
  }

  /** 1 = untouched, 0 = dead. */
  health(): number {
    const { self } = this.c;
    return self.maxHealth > 0 ? Math.max(0, self.health / self.maxHealth) : 0;
  }

  /** 1 = in serious trouble. Non-linear: 50% health is not half a crisis. */
  hurt(): number {
    const h = this.health();
    return Math.min(1, (1 - h) * (1 - h) * 1.6);
  }

  /** Is anything visible right now? */
  underThreat(): boolean {
    for (const sighting of this.c.beliefs.sightings.values()) {
      if (sighting.visible) return true;
    }
    return false;
  }

  /** Is there a target the reaction delay has cleared us to engage? */
  hasEngageableTarget(): boolean {
    const { beliefs } = this.c;
    if (!beliefs.focusId || !beliefs.focusReady) return false;
    return beliefs.sightings.get(beliefs.focusId)?.visible === true;
  }

  /** Distance to the current focus, or Infinity. */
  focusDistance(): number {
    const { beliefs } = this.c;
    if (!beliefs.focusId) return Infinity;
    return beliefs.sightings.get(beliefs.focusId)?.distance ?? Infinity;
  }

  /** Somewhere worth investigating — a decayed sighting or a heard shot. */
  hasLead(): boolean {
    const { beliefs, world } = this.c;
    if (beliefs.heardAt && !beliefs.heardCleared
      && world.time - beliefs.heardTime < 8) return true;
    for (const [id, sighting] of beliefs.sightings) {
      // A lead already walked to and found empty is not a lead any more.
      if (!sighting.visible && !beliefs.clearedLeads.has(id)) return true;
    }
    return false;
  }
}
