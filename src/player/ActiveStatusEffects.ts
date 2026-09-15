/**
 * ActiveStatusEffects.ts — Document F §6.2.
 *
 * A generic, timed modifier list. The stun grenade uses it for a movement
 * slow and looser aim; the flashbang uses it for a spread penalty. It is
 * deliberately NOT grenade-specific: a future EMP killstreak, a poison zone
 * or an AI debuff all reuse this with zero new movement code.
 *
 * Consumers ask for a resolved multiplier each frame rather than being
 * pushed at — the movement system stays ignorant of what caused a slow.
 */
import eventBus from '../core/EventBus';

export type StatusKind =
  | 'moveSlow'      // multiplies movement speed
  | 'swayLoosen'    // multiplies aim-spring stiffness DOWN
  | 'spreadPenalty' // ADDS degrees to weapon spread
  | 'flashed';      // 0..1 blind strength, read by the overlay

export interface StatusEffect {
  readonly id: string;
  readonly kind: StatusKind;
  /** Multiplier for scaling kinds, or magnitude for additive kinds. */
  readonly value: number;
  duration: number;
  readonly totalDuration: number;
}

export class ActiveStatusEffects {
  private readonly effects: StatusEffect[] = [];

  /**
   * Apply an effect. Re-applying the same id REFRESHES rather than stacking,
   * so standing in overlapping blasts cannot multiply a slow into a freeze.
   */
  apply(id: string, kind: StatusKind, value: number, duration: number): void {
    const existing = this.effects.find((e) => e.id === id);
    if (existing) {
      existing.duration = Math.max(existing.duration, duration);
      return;
    }
    this.effects.push({ id, kind, value, duration, totalDuration: duration });
    eventBus.emit('status:applied', { id, kind, value, duration });
  }

  clear(): void {
    this.effects.length = 0;
  }

  remove(id: string): void {
    const i = this.effects.findIndex((e) => e.id === id);
    if (i >= 0) this.effects.splice(i, 1);
  }

  has(kind: StatusKind): boolean {
    return this.effects.some((e) => e.kind === kind);
  }

  /** Product of every multiplier of this kind. 1 when none are active. */
  multiplier(kind: StatusKind): number {
    let m = 1;
    for (const e of this.effects) if (e.kind === kind) m *= e.value;
    return m;
  }

  /** Sum of every additive magnitude of this kind. 0 when none are active. */
  additive(kind: StatusKind): number {
    let total = 0;
    for (const e of this.effects) if (e.kind === kind) total += e.value;
    return total;
  }

  /**
   * Strongest remaining magnitude of a kind, scaled by how much of its
   * duration is left — what an overlay wants for a fade.
   */
  strength(kind: StatusKind): number {
    let best = 0;
    for (const e of this.effects) {
      if (e.kind !== kind) continue;
      const remaining = e.totalDuration > 0 ? e.duration / e.totalDuration : 0;
      best = Math.max(best, e.value * remaining);
    }
    return best;
  }

  /** Raw remaining seconds of the longest effect of a kind. */
  remaining(kind: StatusKind): number {
    let best = 0;
    for (const e of this.effects) {
      if (e.kind === kind) best = Math.max(best, e.duration);
    }
    return best;
  }

  get activeCount(): number {
    return this.effects.length;
  }

  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      this.effects[i].duration -= dt;
      if (this.effects[i].duration <= 0) {
        const [done] = this.effects.splice(i, 1);
        eventBus.emit('status:expired', { id: done.id, kind: done.kind });
      }
    }
  }
}

export const statusEffects = new ActiveStatusEffects();
export default statusEffects;
