/**
 * FireState.ts — brief one-shot on each confirmed shot: `fire` from the hip,
 * `ads_fire` while the additive ADS layer is engaged.
 */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';

export const FireState: AnimationStateStrategy = {
  getClipName(context: AnimationContext): string {
    return context.isADS ? 'ads_fire' : 'fire';
  },
  getBlendMode() {
    return 'oneshot';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_FAST_SECONDS;
  },
};

export default FireState;
