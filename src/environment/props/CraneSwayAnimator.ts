/**
 * CraneSwayAnimator.ts — Document K §4.5: a crane's hook cable/spreader has
 * a little real-world wind sway. Purely cosmetic, deliberately cheap: one
 * sine evaluation per crane per frame, no allocation, no gameplay effect.
 */
import type { Object3D } from 'three';

export class CraneSwayAnimator {
  private readonly cable: Object3D | null;
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(craneModel: Object3D) {
    this.cable = craneModel.getObjectByName('HookCable') ?? null;
  }

  update(_dt: number, elapsed: number): void {
    if (!this.cable) return;
    const sway = Math.sin(elapsed * 0.4 + this.phase);
    this.cable.rotation.z = sway * 0.02;           // radians — deliberately tiny
    this.cable.rotation.x = Math.cos(elapsed * 0.31 + this.phase) * 0.014;
  }
}

export default CraneSwayAnimator;
