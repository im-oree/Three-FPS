/** SlideState.ts — `slide` clip with a fast crossfade (spec §14.2 example). */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';

export const SlideState: AnimationStateStrategy = {
  getClipName(_context: AnimationContext): string {
    return 'slide';
  },
  getBlendMode() {
    return 'base';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_FAST_SECONDS;
  },
};

export default SlideState;
