/**
 * JointSpring.ts — the shared per-joint spring-damper (Document A §8.1).
 * Every continuous contribution (sway, breathing, recoil recovery, look-layer,
 * pose blends) feeds `target` / `kick()`; one `update(dt)` integrates them —
 * layers sum with zero special-case code.
 */
import * as THREE from 'three';
import type { SpringProfile } from '../utils/Constants';

export class JointSpring {
  readonly value = new THREE.Euler();
  private readonly velocity = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly disp = new THREE.Vector3();
  private readonly force = new THREE.Vector3();

  constructor(private readonly profile: SpringProfile) {}

  /** Add to the target orientation (radians, XYZ euler components). */
  addTarget(x: number, y: number, z: number): void {
    this.target.x += x; this.target.y += y; this.target.z += z;
  }

  /** Impulse: instantaneous velocity change (recoil kicks land here). */
  kick(x: number, y: number, z: number): void {
    this.velocity.x += x; this.velocity.y += y; this.velocity.z += z;
  }

  /** Instantaneous displacement jump (Document A §8.3 — not a target change). */
  jump(x: number, y: number, z: number): void {
    this.value.x += x; this.value.y += y; this.value.z += z;
  }

  reset(): void {
    this.value.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.target.set(0, 0, 0);
  }

  update(dt: number): void {
    this.force.copy(this.target).sub(this.disp).multiplyScalar(this.profile.STIFFNESS)
      .addScaledVector(this.velocity, -this.profile.DAMPING);
    this.velocity.addScaledVector(this.force, dt);
    this.disp.addScaledVector(this.velocity, dt);
    this.value.set(this.disp.x, this.disp.y, this.disp.z);
    // targets are per-frame contributions — consume them
    this.target.set(0, 0, 0);
  }
}
