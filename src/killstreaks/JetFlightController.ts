/**
 * JetFlightController.ts — Document M §3.3.
 *
 * Drives the fighter jet along its Catmull-Rom path. Banking is derived from
 * the RATE of lateral direction change (how sharply the curve is turning),
 * not a fixed authored value — the visual bank automatically matches however
 * aggressive the authored control points happen to be, for any target
 * position the player designates.
 */
import * as THREE from 'three';

const _tangent = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export interface JetFlightFrame {
  t: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  isComplete: boolean;
}

export class JetFlightController {
  private readonly model: THREE.Object3D;
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly duration: number;
  private elapsed = 0;
  private prevTangent: THREE.Vector3 | null = null;
  private bank = 0;

  constructor(
    model: THREE.Object3D,
    curve: THREE.CatmullRomCurve3,
    totalDuration: number,
  ) {
    this.model = model;
    this.curve = curve;
    this.duration = totalDuration;
  }

  update(dt: number): JetFlightFrame {
    this.elapsed += dt;
    const t = THREE.MathUtils.clamp(this.elapsed / this.duration, 0, 1);

    const position = this.curve.getPointAt(t);
    const tangent = this.curve.getTangentAt(t, _tangent);

    if (this.prevTangent) {
      // Lateral (sideways) component of the tangent's change = turn rate.
      const lateralChange = tangent.x - this.prevTangent.x
        + (tangent.z - this.prevTangent.z) * 0.5;
      const targetBank = THREE.MathUtils.clamp(-lateralChange * 40, -0.85, 0.85);
      // Critically-damped-ish smoothing so the bank swells, not snaps.
      this.bank = THREE.MathUtils.lerp(this.bank, targetBank, 1 - Math.pow(0.001, dt));
    }
    this.prevTangent = (this.prevTangent ?? new THREE.Vector3()).copy(tangent);

    // Nose along the tangent; the model's +Z IS its nose (builder contract —
    // the jet is oriented by lookAt, not by the -Z-forward convention).
    this.model.position.copy(position);
    this.model.up.set(0, 1, 0);
    this.model.lookAt(_lookTarget.copy(position).add(tangent));
    this.model.rotateZ(this.bank);

    return { t, position, tangent: tangent.clone(), isComplete: t >= 1 };
  }

  get t01(): number {
    return THREE.MathUtils.clamp(this.elapsed / this.duration, 0, 1);
  }

  get durationSeconds(): number { return this.duration; }

  getPositionAt(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1), out);
  }
}

export default JetFlightController;
