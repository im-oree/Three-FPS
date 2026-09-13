/**
 * ProceduralIKLayer.ts — Document C §5 layer 4 (ik).
 *
 * Samples the mixer against the composed pose (viewmodel update: mixer +
 * compositor + two-bone arm solve) and dispatches the resulting wrist
 * commands to the arm rig. IK overrides springs joint-by-joint — it runs
 * later in the order precisely so its contribution wins.
 */
import type { AnimLayer, LayerCategory } from '../AnimLayer';
import type { PoseComposer } from '../PoseComposer';

export class ProceduralIKLayer implements AnimLayer {
  readonly name = 'ProceduralIK';
  readonly category: LayerCategory = 'ik';

  constructor(
    private readonly updateViewmodel: (dt: number) => void,
    private readonly dispatch: () => void,
  ) {}

  update(dt: number): void {
    this.updateViewmodel(dt);
    this.dispatch();
  }

  contribute(_composer: PoseComposer): void {
    // The analytic solve dispatches through the arm command (HandsRig is the
    // single pivot writer); composer staging arrives with the rig refactor.
  }
}

export default ProceduralIKLayer;
