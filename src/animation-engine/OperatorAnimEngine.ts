/**
 * OperatorAnimEngine.ts — Document C §5: THE single animation owner.
 *
 * Every animation flow routes here:
 *   - registerLayer(layer) enforces the mandated order
 *     locomotion → additive → spring → ik → oneshot (registration rejects
 *     out-of-order categories);
 *   - update(dt, ctx) runs the layers in order — one update, one composed
 *     frame, one authoritative pass over the rig;
 *   - playBase/playOneshot/requestOneShot are the ONLY clip routes. The
 *     engine holds the only `action.play()` call in the codebase (the mixer
 *     facade); WeaponViewmodel delegates to it;
 *   - requestOneShot consults AnimationPriorityTable via the OneShotAction
 *     layer — a one-shot may only start if its tier >= the running tier;
 *   - AnimEventScheduler fires per-clip {atProgress, event} tables on the
 *     generic `anim:beat` bus event.
 */
import { LAYER_ORDER, type AnimLayer } from './AnimLayer';
import { PoseComposer } from './PoseComposer';
import AnimEventScheduler from './AnimEventScheduler';
import { OneShotActionLayer } from './layers/OneShotActionLayer';

/** Loop/clamp options for the mixer facade (mirrors PlayClipOptions). */
export interface ActionPlayOptions {
  loop: number; // THREE.LoopOnce | THREE.LoopRepeat
  clampWhenFinished: boolean;
  /** Re-requesting a running LOOPING action is a no-op; one-shots restart. */
  restartIfRunning: boolean;
}

export class OperatorAnimEngine {
  private readonly layers: AnimLayer[] = [];
  private readonly composer = new PoseComposer();
  readonly scheduler = new AnimEventScheduler();
  private readonly oneShotLayer = new OneShotActionLayer();

  /** The single action.play() site in the codebase (Doc C §5 gate). */
  playAction(
    action: { reset(): void; play(): void; stop(): void },
    options: ActionPlayOptions,
  ): void {
    if (options.restartIfRunning) action.reset();
    action.play();
  }

  /**
   * Register a layer. Throws on out-of-order categories — the sequence is a
   * hard invariant, not a convention.
   */
  registerLayer(layer: AnimLayer): void {
    const index = LAYER_ORDER.indexOf(layer.category);
    if (index === -1) throw new Error(`[OperatorAnimEngine] unknown layer category "${layer.category}"`);
    for (const existing of this.layers) {
      if (LAYER_ORDER.indexOf(existing.category) > index) {
        throw new Error(
          `[OperatorAnimEngine] registerLayer order violation: "${layer.name}" (${layer.category}) after "${existing.name}" (${existing.category})`,
        );
      }
    }
    this.layers.push(layer);
    if (layer.category === 'oneshot' && !(layer instanceof OneShotActionLayer)) {
      throw new Error('[OperatorAnimEngine] the oneshot layer is engine-owned');
    }
  }

  /**
   * One per-frame animation advance: locomotion → additive → springs →
   * ik → oneshot, in the registered order, then a single composer pass.
   */
  update(dt: number): void {
    // The oneshot layer is engine-owned and always LAST in the pipeline.
    if (!this.layers.includes(this.oneShotLayer)) this.layers.push(this.oneShotLayer);
    this.composer.clear();
    for (const layer of this.layers) layer.update(dt);
    this.composer.apply();
  }

  /**
   * Doc C §5: priority-arbitrated one-shot request. Returns the tier if
   * granted, null if an equal-or-higher one-shot is running. `boneMask`
   * names the joints the clip owns (the rest keep their spring/IK state) —
   * the rigid rig's clips are full-body hand clips, so the mask is carried
   * for the per-weapon content pass.
   */
  requestOneShot(
    clipName: string,
    playingClip: string | null,
    play: (clipName: string) => boolean,
    _boneMask?: readonly string[],
  ): number | null {
    // `playingClip` is the LIVE viewmodel state (authoritative); the layer
    // tracker is only a fallback mirror.
    const running = playingClip ?? this.currentOneShotName;
    if (!this.oneShotLayer.mayPlay(clipName, running)) return null;
    if (!play(clipName)) return null;
    this.oneShotLayer.sync(clipName);
    return this.oneShotLayer.tier;
  }

  /** Per-frame truth sync: the viewmodel's actual one-shot state. */
  syncOneShot(runningClip: string | null): void {
    this.oneShotLayer.sync(runningClip);
  }

  get currentOneShotName(): string | null {
    return this.oneShotLayer.current;
  }

  get currentOneShotTier(): number {
    return this.oneShotLayer.tier;
  }

  /** Debug/acceptance: the composer's pending joint count this frame. */
  get composedJointCount(): number {
    return this.composer.size();
  }
}

/** Process-wide engine (mirrors the eventBus singleton pattern). */
export const animationEngine = new OperatorAnimEngine();
export default animationEngine;
