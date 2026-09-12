/**
 * FootstepSystem.js — cadence-only footstep event source (Document 2 §11).
 *
 * Accumulates travelled distance while grounded; once the gait-specific stride
 * threshold is crossed it emits 'player:footstep' and resets. Faster gait ->
 * longer stride but much higher speed, i.e. higher cadence, as specified.
 *
 * PLAYS NO AUDIO — Document 5 owns playback and binds to these events.
 *
 * TEMPORARY: surfaceType is the hardcoded literal "concrete" because the
 * placeholder Test Arena has one surface. Document 4 replaces this with a real
 * lookup against whatever the ground raycast actually hit.
 */
import eventBus from '../core/EventBus';
import { FOOTSTEP } from '../utils/Constants';
import type { BobGait } from './HeadBob';

export class FootstepSystem {
  private accumulator = 0;

  update(dt: number, horizontalSpeed: number, isGrounded: boolean, gait: BobGait): void {
    if (!isGrounded || horizontalSpeed < 0.5 || gait === 'NONE') return;
    this.accumulator += horizontalSpeed * dt;
    const stride =
      gait === 'SPRINT' ? FOOTSTEP.STRIDE_SPRINT_METERS : gait === 'CROUCH' ? FOOTSTEP.STRIDE_CROUCH_METERS : FOOTSTEP.STRIDE_WALK_METERS;
    if (this.accumulator >= stride) {
      this.accumulator = 0;
      eventBus.emit('player:footstep', { surfaceType: 'concrete' }); // TEMPORARY stand-in (see file header)
    }
  }
}

export default FootstepSystem;
