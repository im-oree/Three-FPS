/**
 * SprintState.ts — looping `sprint`, or the dedicated `tac_sprint` clip while
 * the orthogonal isTacticalSprinting flag is up (Document 2.5 §4.3/§6.4).
 * Fast blend in/out of locomotion either way.
 */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';

export const SprintState: AnimationStateStrategy = {
  getClipName(context: AnimationContext): string {
    return context.isTacticalSprinting ? ANIMATION.BASE_CLIPS.tacSprint : ANIMATION.BASE_CLIPS.sprint;
  },
  getBlendMode() {
    return 'base';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_FAST_SECONDS;
  },
};

export default SprintState;
