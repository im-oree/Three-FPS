/** CrouchState.ts — CROUCH_IDLE → `crouch_idle`, CROUCH_WALK → `crouch_walk`. */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';
import { PlayerState } from '../../player/PlayerState';

export const CrouchState: AnimationStateStrategy = {
  getClipName(context: AnimationContext): string {
    return context.movementState === PlayerState.CROUCH_WALK ? 'crouch_walk' : 'crouch_idle';
  },
  getBlendMode() {
    return 'base';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_DEFAULT_SECONDS;
  },
};

export default CrouchState;
