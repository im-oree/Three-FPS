/**
 * AdditivePoseLayer.ts — Document C §5 layer 2 (additive).
 *
 * Advances weight-driven additive pose state (the AnimationBlender's ADS
 * mirror in the rigid rig — additive ACTIONS are retired per Document A
 * §7.2, but the weight state must stay honest for the compositor).
 */
import type { AnimLayer, LayerCategory } from '../AnimLayer';
import type { PoseComposer } from '../PoseComposer';

export class AdditivePoseLayer implements AnimLayer {
  readonly name = 'AdditivePose';
  readonly category: LayerCategory = 'additive';

  constructor(private readonly updateAdditive: (dt: number) => void) {}

  update(dt: number): void {
    this.updateAdditive(dt);
  }

  contribute(_composer: PoseComposer): void {
    // Additive weights flow into the compositor, not the joint map.
  }
}

export default AdditivePoseLayer;
