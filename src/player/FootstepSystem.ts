/**
 * FootstepSystem.js — cadence-only footstep event source (Document 2 §11).
 *
 * Accumulates travelled distance while grounded; once the gait-specific stride
 * threshold is crossed it emits 'player:footstep' and resets. Faster gait ->
 * longer stride but much higher speed, i.e. higher cadence, as specified.
 *
 * PLAYS NO AUDIO — Document 5 owns playback and binds to these events.
 *
 * SURFACE RESOLUTION (Document 4/5): the emitted surfaceType comes from a
 * provider injected by main, which asks the physics layer what the player is
 * actually standing on. It used to be the hardcoded literal "concrete".
 * Falls back to 'concrete' when nothing is known, so audio never goes silent.
 */
import eventBus from '../core/EventBus';
import { FOOTSTEP } from '../utils/Constants';
import type { BobGait } from './HeadBob';

export class FootstepSystem {
  private accumulator = 0;
  private surfaceProvider: (() => string) | null = null;

  /** Injected by main: what is under the player's feet right now. */
  setSurfaceProvider(provider: () => string): void {
    this.surfaceProvider = provider;
  }

  update(dt: number, horizontalSpeed: number, isGrounded: boolean, gait: BobGait): void {
    if (!isGrounded || horizontalSpeed < 0.5 || gait === 'NONE') return;
    this.accumulator += horizontalSpeed * dt;
    const stride =
      gait === 'SPRINT' ? FOOTSTEP.STRIDE_SPRINT_METERS : gait === 'CROUCH' ? FOOTSTEP.STRIDE_CROUCH_METERS : FOOTSTEP.STRIDE_WALK_METERS;
    if (this.accumulator >= stride) {
      this.accumulator = 0;
      eventBus.emit('player:footstep', {
        surfaceType: this.surfaceProvider?.() ?? 'concrete',
        gait,
      });
    }
  }
}

export default FootstepSystem;
