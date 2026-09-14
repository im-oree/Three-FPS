/**
 * VehicleAnimator.ts — Document I §5.2.
 *
 * Rotors and propellers need pure continuous rotation, not IK, springs or
 * blending. Routing them through OperatorAnimEngine would be misuse, so this
 * is a deliberately tiny standalone system shared by every vehicle.
 */
import type * as THREE from 'three';

export interface SpinConfig {
  /** Node name to spin, e.g. 'Bone_MainRotorHub'. */
  nodeName: string;
  axis: 'x' | 'y' | 'z';
  radiansPerSecond: number;
}

export class VehicleAnimator {
  private readonly spins: Array<{ node: THREE.Object3D; axis: 'x' | 'y' | 'z'; rate: number }> = [];
  /** 0..1 spool factor, so rotors wind up rather than snapping to full speed. */
  private spool = 0;
  private spoolRate = 0.6;

  constructor(model: THREE.Object3D, config: readonly SpinConfig[]) {
    for (const cfg of config) {
      const node = model.getObjectByName(cfg.nodeName);
      if (!node) {
        console.warn(`[VehicleAnimator] missing spin node "${cfg.nodeName}"`);
        continue;
      }
      this.spins.push({ node, axis: cfg.axis, rate: cfg.radiansPerSecond });
    }
  }

  /** Seconds to reach full rotor speed from cold. */
  setSpoolRate(perSecond: number): void {
    this.spoolRate = perSecond;
  }

  /** Jump straight to full speed (a vehicle that arrives already flying). */
  snapToFullSpeed(): void {
    this.spool = 1;
  }

  get spoolFactor(): number {
    return this.spool;
  }

  update(dt: number, spinningUp = true): void {
    this.spool = Math.max(0, Math.min(1,
      this.spool + (spinningUp ? this.spoolRate : -this.spoolRate) * dt));
    if (this.spool <= 0) return;
    for (const spin of this.spins) {
      spin.node.rotation[spin.axis] += spin.rate * this.spool * dt;
    }
  }
}

export default VehicleAnimator;
