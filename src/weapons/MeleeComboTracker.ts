/**
 * MeleeComboTracker.ts — Document B §2: chained hits inside the combo window
 * advance the 3-variant punch cycle; the window resets on a hit, expires on
 * time. Pure state, no THREE.
 */
import { MELEE } from '../utils/Constants';
import eventBus from '../core/EventBus';

export class MeleeComboTracker {
  private index = 0;
  private windowLeft = 0;
  /** Bumped for the HandsRig/viewmodel to consume (play the next variant). */
  nextSwing = 0;

  constructor() {
    eventBus.on('combat:hit', () => {
      this.windowLeft = MELEE.COMBO_WINDOW_SECONDS;
      this.index = (this.index + 1) % 3;
    });
  }

  /** Called on each melee:swung — advances/kept index, stamps the clip. */
  onSwung(punchClips: readonly string[]): string {
    this.windowLeft = MELEE.COMBO_WINDOW_SECONDS;
    const clip = punchClips[this.index % punchClips.length];
    this.nextSwing += 1;
    return clip;
  }

  update(dt: number): void {
    if (this.windowLeft > 0) {
      this.windowLeft -= dt;
      if (this.windowLeft <= 0) this.index = 0; // combo expired
    }
  }
}
