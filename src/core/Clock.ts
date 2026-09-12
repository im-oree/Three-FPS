/**
 * Clock.ts — wraps THREE.Clock behind our own interface so the timing API can
 * evolve (e.g. interpolation timestamps, pause support) without ripple effects
 * through consumers. Nothing outside this file touches THREE.Clock.
 */
import * as THREE from 'three';
import { CLOCK } from '../utils/Constants';

export class Clock {
  private readonly threeClock = new THREE.Clock();
  private fixedStepAccumulator = 0;
  private fixedStepLastTime: number | null = null;

  /** Seconds since the previous getDelta() call, clamped to CLOCK.MAX_DELTA. */
  getDelta(): number {
    return Math.min(this.threeClock.getDelta(), CLOCK.MAX_DELTA);
  }

  /** Total seconds elapsed since the clock started. */
  getElapsed(): number {
    return this.threeClock.getElapsedTime();
  }

  /**
   * Fixed-timestep accumulator (deterministic simulation seam for Document 2).
   *
   * Tracks its OWN wall-clock time (performance.now), independent of getDelta(),
   * so callers may use both in the same frame without double-consuming time.
   * Invokes `callback(fixedDt)` zero or more times to catch up to real time;
   * any remainder stays accumulated for the next call.
   */
  stepFixed(fixedDt: number, callback: (fixedDt: number) => void): void {
    const now = performance.now() / 1000;
    if (this.fixedStepLastTime === null) this.fixedStepLastTime = now;
    this.fixedStepAccumulator += Math.min(now - this.fixedStepLastTime, CLOCK.MAX_DELTA);
    this.fixedStepLastTime = now;
    while (this.fixedStepAccumulator >= fixedDt) {
      callback(fixedDt);
      this.fixedStepAccumulator -= fixedDt;
    }
  }
}

export default Clock;
