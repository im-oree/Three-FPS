/**
 * BaseLocomotionLayer.ts — Document C §5 layer 1 (locomotion).
 *
 * Feeds the arm rig's pose targets (locomotion spring profile + guard
 * stance) BEFORE the springs integrate. Base-clip PLAYBACK requests route
 * through the engine's mixer facade; this layer owns the per-frame pose
 * target refresh that must precede spring integration.
 */
import type { AnimLayer, LayerCategory } from '../AnimLayer';
import type { PoseComposer } from '../PoseComposer';

export class BaseLocomotionLayer implements AnimLayer {
  readonly name = 'BaseLocomotion';
  readonly category: LayerCategory = 'locomotion';

  constructor(private readonly refresh: () => void) {}

  update(_dt: number): void {
    this.refresh();
  }

  contribute(_composer: PoseComposer): void {
    // Pose targets are spring INPUTS, not joint writes — nothing to compose.
  }
}

export default BaseLocomotionLayer;
