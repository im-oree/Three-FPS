/**
 * OneShotActionLayer.ts — Document C §5 layer 5 (oneshot).
 *
 * Owns one-shot lifecycle state: which clip is running, at what priority
 * tier, and whether incoming requests may interrupt (AnimationPriorityTable:
 * incoming tier >= current tier). Playback itself executes through the
 * engine's mixer facade on request — this layer is the ARBITER and tracker.
 */
import type { AnimLayer, LayerCategory } from '../AnimLayer';
import type { PoseComposer } from '../PoseComposer';
import { canInterrupt, tierOf } from '../../animation/AnimationPriorityTable';

export class OneShotActionLayer implements AnimLayer {
  readonly name = 'OneShotAction';
  readonly category: LayerCategory = 'oneshot';

  private currentClip: string | null = null;

  /** Is `clip` allowed to start, given what is running? (priority table) */
  mayPlay(clip: string, runningClip: string | null): boolean {
    return canInterrupt(runningClip, clip);
  }

  /** Tracker sync — called by the engine after any successful one-shot start/stop. */
  sync(runningClip: string | null): void {
    this.currentClip = runningClip;
  }

  get current(): string | null {
    return this.currentClip;
  }

  get tier(): number {
    return this.currentClip ? tierOf(this.currentClip) : 0;
  }

  update(_dt: number): void {
    // Lifecycle tracking mirrors the viewmodel's one-shot state via sync().
  }

  contribute(_composer: PoseComposer): void {
    // One-shots are baked mixer clips — the mixer IS their applier.
  }
}

export default OneShotActionLayer;
