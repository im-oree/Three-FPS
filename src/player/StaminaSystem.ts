/**
 * StaminaSystem.ts — normalized 0..1 sprint/slide resource (Document 2 §9).
 *
 * Drains while sprinting or sliding; regenerates otherwise, but only after a
 * short delay once fully depleted (prevents instantly re-sprinting at 0).
 * Emits 'player:staminaChanged' with the normalized value, throttled by an
 * epsilon (documented choice: emit when the value has moved >= EMIT_EPSILON
 * since the last emit, rather than time-throttling) — this is the exact data
 * Document 5's stamina HUD binds to.
 */
import eventBus from '../core/EventBus';
import { STAMINA } from '../utils/Constants';
import { clamp } from '../utils/MathUtils';

export class StaminaSystem {
  private value = 1;
  private regenDelay = 0;
  private lastEmitted = 1;

  update(dt: number, draining: boolean): void {
    if (draining) {
      this.value = Math.max(0, this.value - STAMINA.DRAIN_PER_SECOND * dt);
      if (this.value === 0) this.regenDelay = STAMINA.REGEN_DELAY_SECONDS;
    } else if (this.regenDelay > 0) {
      this.regenDelay -= dt;
    } else {
      this.value = Math.min(1, this.value + STAMINA.REGEN_PER_SECOND * dt);
    }
    if (Math.abs(this.value - this.lastEmitted) >= STAMINA.EMIT_EPSILON) {
      this.lastEmitted = this.value;
      eventBus.emit('player:staminaChanged', this.value);
    }
  }

  /** May a sprint/slide be INITIATED right now? */
  hasStamina(): boolean {
    return this.value > 0;
  }

  getCurrentValue(): number {
    return this.value;
  }

  /** TEST-ONLY seam for the acceptance harness: set stamina deterministically. */
  debugSet(value: number): void {
    this.value = clamp(value, 0, 1);
    this.regenDelay = 0;
    this.lastEmitted = this.value;
  }
}

export default StaminaSystem;
