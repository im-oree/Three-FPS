/**
 * SpringDamper.ts — the single reusable spring utility (Document 2.5 §6.5).
 *
 *   velocity += ((target - current) * stiffness - velocity * damping) * dt
 *   current  += velocity * dt
 *
 * Every procedural viewmodel motion (sway lag, breathing settle, recoil
 * recovery, movement-state pose offsets, jump float / land settle) runs one
 * of these with a profile from Constants.SPRING_PROFILES — never inline
 * constants (§11 acceptance: all tunables live in Constants/WeaponProfile).
 *
 * Two integration styles are supported:
 *  - continuous: update(dt, target) chases a moving target;
 *  - hybrid "instant displacement, spring recovery" (§6.5 recoil/landing):
 *    displace()/impulse() move value/velocity OUT of band instantly, then the
 *    spring is simply updated toward its neutral target.
 */
import * as THREE from 'three';
import type { SpringProfile } from './Constants';

export class SpringDamper {
  value: number;
  velocity = 0;

  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
    initial = 0,
  ) {
    this.value = initial;
  }

  static fromProfile(profile: SpringProfile, initial = 0): SpringDamper {
    return new SpringDamper(profile.STIFFNESS, profile.DAMPING, initial);
  }

  /** Continuous integration toward `target`. Frame-rate independent clamp:
   *  dt is capped so a long stall can never explode the integrator. */
  update(dt: number, target: number): number {
    const step = Math.min(dt, 1 / 20);
    this.velocity += ((target - this.value) * this.stiffness - this.velocity * this.damping) * step;
    this.value += this.velocity * step;
    return this.value;
  }

  /** Hybrid pattern (§6.5): teleport the value (per-shot kick, landing kick). */
  displace(amount: number): void {
    this.value += amount;
  }

  /** Velocity-impulse variant (used when the target should stay put but the
   *  spring should overshoot — punchier feel than a pure displacement). */
  impulse(amount: number): void {
    this.velocity += amount;
  }

  /** Hard reset (weapon switch, teleport, acceptance determinism). */
  reset(value = 0): void {
    this.value = value;
    this.velocity = 0;
  }

  get settled(): boolean {
    return Math.abs(this.velocity) < 1e-5 && Math.abs(this.value) < 1e-5;
  }
}

/**
 * Vector3-flavoured convenience wrapper: three independent SpringDampers
 * driven from a shared profile. The §6.5 "summed together (position and
 * rotation separately)" composition step consumes these via `.value`s.
 */
export class SpringDamper3 {
  private readonly x: SpringDamper;
  private readonly y: SpringDamper;
  private readonly z: SpringDamper;
  readonly value = new THREE.Vector3();

  constructor(profile: SpringProfile) {
    this.x = SpringDamper.fromProfile(profile);
    this.y = SpringDamper.fromProfile(profile);
    this.z = SpringDamper.fromProfile(profile);
  }

  update(dt: number, target: THREE.Vector3): THREE.Vector3 {
    this.value.set(
      this.x.update(dt, target.x),
      this.y.update(dt, target.y),
      this.z.update(dt, target.z),
    );
    return this.value;
  }

  displace(v: THREE.Vector3): void {
    this.x.displace(v.x);
    this.y.displace(v.y);
    this.z.displace(v.z);
  }

  impulse(v: THREE.Vector3): void {
    this.x.impulse(v.x);
    this.y.impulse(v.y);
    this.z.impulse(v.z);
  }

  reset(v: THREE.Vector3 | null = null): void {
    this.x.reset(v?.x ?? 0);
    this.y.reset(v?.y ?? 0);
    this.z.reset(v?.z ?? 0);
  }
}

export default SpringDamper;
