/**
 * WalkState.ts — grounded walking. Directional clip selection from
 * camera-local velocity: mostly-forward → `walk`, mostly-back → `walk_back`,
 * lateral → `strafe_left` / `strafe_right` (Document 3 §5 clip list).
 */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';

export const WalkState: AnimationStateStrategy = {
  getClipName(context: AnimationContext): string {
    const { x, z } = context.localVelocity;
    if (Math.abs(x) > Math.abs(z)) return x > 0 ? 'strafe_right' : 'strafe_left';
    if (z < 0) return 'walk_back'; // camera-local z positive = forward
    return 'walk';
  },
  getBlendMode() {
    return 'base';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_DEFAULT_SECONDS;
  },
};

export default WalkState;
