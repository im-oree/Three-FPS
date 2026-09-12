/**
 * ReloadState.ts — one-shot covering the reload duration: `reload_empty`
 * when the mag was fully drained, otherwise `reload_tactical` (the
 * WeaponManager tells ReloadSystem which variant is running; the ASM copies
 * that into context.reloadWasEmpty).
 */
import type { AnimationContext, AnimationStateStrategy } from '../AnimationBlender';

export const ReloadState: AnimationStateStrategy = {
  getClipName(context: AnimationContext): string {
    return context.reloadWasEmpty ? 'reload_empty' : 'reload_tactical';
  },
  getBlendMode() {
    return 'oneshot';
  },
  getCrossfadeDuration() {
    return 0.1;
  },
};

export default ReloadState;
