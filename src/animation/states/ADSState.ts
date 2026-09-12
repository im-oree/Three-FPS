/**
 * ADSState.ts — deliberately maps to NO standalone clip: it tells the
 * AnimationStateMachine to engage AnimationBlender's additive ADS layer on
 * top of whatever base locomotion clip is currently resolved (spec §14.2).
 */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';

export const ADSState: AnimationStateStrategy = {
  getClipName(_context: AnimationContext): string | null {
    return null; // additive-only: base clip untouched
  },
  getBlendMode() {
    return 'additive';
  },
  getCrossfadeDuration() {
    return 0;
  },
};

export default ADSState;
