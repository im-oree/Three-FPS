/**
 * JumpState.ts — the airborne trio: JUMP → `jump_start`, AIR → `jump_loop`,
 * LANDING → `jump_land` (short-lived; the movement machine auto-expires it
 * back to a grounded state, which crossfades to its own clip).
 */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';
import { PlayerState } from '../../player/PlayerState';

export const JumpState: AnimationStateStrategy = {
  getClipName(context: AnimationContext): string {
    if (context.movementState === PlayerState.JUMP) return 'jump_start';
    if (context.movementState === PlayerState.LANDING) return 'jump_land';
    return 'jump_loop';
  },
  getBlendMode() {
    return 'base';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_FAST_SECONDS;
  },
};

export default JumpState;
