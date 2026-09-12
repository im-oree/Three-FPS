/**
 * SwitchWeaponState.ts — two-phase one-shots: `switch_out` for the old
 * weapon (until SWITCH_OUT_SECONDS elapses), then the NEW weapon plays
 * `switch_in`. Both come from the equipped viewmodel — the out-clip of the
 * incoming weapon reads as the holstering motion of the swap, which is the
 * standard single-viewmodel simplification.
 */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';
import { ANIMATION } from '../../utils/Constants';

export const SwitchWeaponState: AnimationStateStrategy = {
  getClipName(context: AnimationContext): string {
    return context.switchPhase === 'out' ? 'switch_out' : 'switch_in';
  },
  getBlendMode() {
    return 'oneshot';
  },
  getCrossfadeDuration() {
    return ANIMATION.CROSSFADE_FAST_SECONDS;
  },
};

export default SwitchWeaponState;
