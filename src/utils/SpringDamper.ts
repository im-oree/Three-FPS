/**
 * SpringDamper.ts — the reusable spring utility from the FP-Controller &
 * Viewmodel spec §6.5. Every procedural viewmodel motion (mouse-look sway
 * lag, spring-filtered breathing, recoil recovery, movement-state pose
 * offsets, jump float / landing settle) is one of these with different
 * stiffness/damping drawn from ANIMATION.SPRING_PROFILES.
 *
 * Formula (spec-exact):
 *   velocity += ((target - current) * stiffness - velocity * damping) * dt
 *   current  += velocity * dt
 *
 * The hybrid "instant displacement, spring recovery" pattern (recoil kick,
 * landing settle) is `displace()`: shove `current` immediately, then let the
 * spring pull it back to target on subsequent updates.
 */
export class SpringDamper {
  private current: number;
  private velocity = 0;

  constructor(
    public stiffness: number,
    public damping: number,
    initial = 0,
  ) {
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  /** Instant displacement (kick/settle), bypassing the spring input. */
  displace(amount: number): void {
    this.current += amount;
  }

  /** Hard reset (level load, weapon switch). */
  set(value: number): void {
    this.current = value;
    this.velocity = 0;
  }

  /** Advance toward `target`; returns the new value. */
  update(target: number, dt: number): number {
    this.velocity += ((target - this.current) * this.stiffness - this.velocity * this.damping) * dt;
    this.current += this.velocity * dt;
    return this.current;
  }
}

/** Three-axis sibling for rigid-root position/rotation offsets. */
export class SpringDamper3 {
  readonly x: SpringDamper;
  readonly y: SpringDamper;
  readonly z: SpringDamper;

  constructor(stiffness: number, damping: number, initial: readonly [number, number, number] = [0, 0, 0]) {
    this.x = new SpringDamper(stiffness, damping, initial[0]);
    this.y = new SpringDamper(stiffness, damping, initial[1]);
    this.z = new SpringDamper(stiffness, damping, initial[2]);
  }

  set stiffness(v: number) {
    this.x.stiffness = v; this.y.stiffness = v; this.z.stiffness = v;
  }

  set damping(v: number) {
    this.x.damping = v; this.y.damping = v; this.z.damping = v;
  }

  displace(dx: number, dy: number, dz: number): void {
    this.x.displace(dx); this.y.displace(dy); this.z.displace(dz);
  }

  set(x: number, y: number, z: number): void {
    this.x.set(x); this.y.set(y); this.z.set(z);
  }

  update(tx: number, ty: number, tz: number, dt: number): { x: number; y: number; z: number } {
    return {
      x: this.x.update(tx, dt),
      y: this.y.update(ty, dt),
      z: this.z.update(tz, dt),
    };
  }
}

export default SpringDamper;
