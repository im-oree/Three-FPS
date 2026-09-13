/**
 * IdleFidgetController.ts — Document B §6: shoulder/wrist-scale procedural
 * fidget pulses. Randomized NON-REPEATING selection, 8-20s trigger window,
 * instantly interrupted by any real input (movement/fire/ADS/reload/switch).
 * Fidgets are spring-target pulses — no baked assets (per Document B §9).
 */
import { FIDGETS } from '../utils/Constants';
import type { JointSpring } from '../character/JointSpring';
import eventBus from '../core/EventBus';

interface FidgetVariant {
  name: string;
  duration: number;
  shoulder: readonly number[];
  wrist: readonly number[];
}

export class IdleFidgetController {
  private delay = this.nextDelay();
  private active: FidgetVariant | null = null;
  private elapsed = 0;
  private phase = 0;

  constructor(
    private readonly shoulderR: JointSpring,
    private readonly shoulderL: JointSpring,
    private readonly wristR: JointSpring,
    private readonly wristL: JointSpring,
  ) {
    for (const name of ['weapon:fired', 'weapon:reloadStart', 'weapon:switchStart', 'weapon:adsStart']) {
      eventBus.on(name, () => { this.interrupt(); });
    }
  }

  private nextDelay(): number {
    return FIDGETS.MIN_DELAY_SECONDS + Math.random() * (FIDGETS.MAX_DELAY_SECONDS - FIDGETS.MIN_DELAY_SECONDS);
  }

  /** Any real input instant-interrupts (Document B §6). */
  interrupt(): void {
    this.active = null;
    this.delay = this.nextDelay();
  }

  update(dt: number, activeWeaponId: string, isMoving: boolean, oneShotRunning: boolean): void {
    if (this.active) {
      this.elapsed += dt;
      this.phase = Math.sin(Math.min(1, this.elapsed / this.active.duration) * Math.PI);
      const v = this.active;
      this.shoulderR.addTarget(...this.scale(v.shoulder, this.phase));
      this.shoulderL.addTarget(...this.scale(v.shoulder, this.phase * 0.7));
      this.wristR.addTarget(...this.scale(v.wrist, this.phase));
      this.wristL.addTarget(...this.scale(v.wrist, this.phase * 0.5));
      if (this.elapsed >= v.duration) this.active = null;
      return;
    }
    if (isMoving || oneShotRunning || activeWeaponId === '') return;
    this.delay -= dt;
    if (this.delay <= 0) {
      // pick a non-repeating variant (Document B §6)
      const pool = FIDGETS.VARIANTS.filter((v) => v.name !== this.lastName);
      const v = pool[Math.floor(Math.random() * pool.length)] as FidgetVariant;
      this.lastName = v.name;
      this.active = { ...v } as FidgetVariant;
      this.elapsed = 0;
      this.delay = this.nextDelay();
    }
  }

  private lastName = '';

  private scale(v: readonly number[], k: number): [number, number, number] {
    return [v[0] * k, v[1] * k, v[2] * k];
  }
}
