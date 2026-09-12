/** SprintState.ts — looping `sprint`; fast blend in/out of locomotion. */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';

export const SprintState: AnimationStateStrategy = {
  getClipName(_context: AnimationContext): string {
    return 'sprint';
  },
  getBlendMode() {
    return 'base';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_FAST_SECONDS;
  },
};

export default SprintState;
