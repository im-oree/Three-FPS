/**
 * ProceduralSpringLayer.ts — Document C §5 layer 3 (springs).
 *
 * Integrates the per-joint springs (guard/locomotion/fidget/recoil recovery)
 * toward this frame's pose targets. Runs AFTER locomotion/additive and
 * BEFORE IK — the spec's ordering — so the IK solve sees settled spring
 * state.
 */
import type { AnimLayer, LayerCategory } from '../AnimLayer';
import type { PoseComposer } from '../PoseComposer';

export class ProceduralSpringLayer implements AnimLayer {
  readonly name = 'ProceduralSpring';
  readonly category: LayerCategory = 'spring';

  constructor(private readonly updateSprings: (dt: number) => void) {}

  update(dt: number): void {
    this.updateSprings(dt);
  }

  contribute(_composer: PoseComposer): void {
    // JointSpring quats are applied by HandsRig (single writer per pivot);
    // the full joint-map migration lands with the rig composer refactor.
  }
}

export default ProceduralSpringLayer;
