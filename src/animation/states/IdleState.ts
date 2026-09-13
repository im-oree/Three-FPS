/** IdleState.ts — grounded, no movement input → looping `idle` clip. */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';

export const IdleState: AnimationStateStrategy = {
  getClipName(_context: AnimationContext): string {
    return 'idle';
  },
  getBlendMode() {
    return 'base';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_DEFAULT_SECONDS;
  },
};

export default IdleState;
