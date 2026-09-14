/**
 * PlayerHealth.ts — Document 5 §8.1.
 *
 * A deliberately small health concept, added only so the HUD has something
 * real to display. No prior document gave the player damageable state.
 *
 * Emits:
 *   player:healthChanged { current, max }  — any change
 *   player:damaged       { amount, sourceWorldPosition } — damage only,
 *                          carrying the source so DamageDirectionIndicator
 *                          can point at it
 *   player:died          {} — once, on reaching zero
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { HEALTH } from '../utils/Constants';

export class PlayerHealth {
  private current: number;
  private readonly max: number;
  private regenTimer = 0;
  private dead = false;

  constructor(max: number = HEALTH.MAX) {
    this.max = max;
    this.current = max;
  }

  get value(): number { return this.current; }
  get maximum(): number { return this.max; }
  get fraction(): number { return this.current / this.max; }
  get isDead(): boolean { return this.dead; }

  reset(): void {
    this.current = this.max;
    this.dead = false;
    this.regenTimer = 0;
    this.emitChanged();
  }

  takeDamage(amount: number, sourceWorldPosition?: THREE.Vector3): void {
    if (this.dead || amount <= 0) return;
    this.current = Math.max(0, this.current - amount);
    this.regenTimer = 0;
    eventBus.emit('player:damaged', {
      amount,
      sourceWorldPosition: sourceWorldPosition
        ? { x: sourceWorldPosition.x, y: sourceWorldPosition.y, z: sourceWorldPosition.z }
        : null,
    });
    this.emitChanged();
    if (this.current === 0) {
      this.dead = true;
      eventBus.emit('player:died', {});
    }
  }

  heal(amount: number): void {
    if (this.dead || amount <= 0) return;
    const before = this.current;
    this.current = Math.min(this.max, this.current + amount);
    if (this.current !== before) this.emitChanged();
  }

  /**
   * Out-of-combat regeneration, the standard modern-shooter behaviour: after
   * a quiet period health climbs back. Without it a single debug damage press
   * would leave the player permanently wounded with no way back.
   */
  update(dt: number): void {
    if (this.dead || this.current >= this.max) return;
    this.regenTimer += dt;
    if (this.regenTimer < HEALTH.REGEN_DELAY_SECONDS) return;
    this.heal(HEALTH.REGEN_PER_SECOND * dt);
  }

  private emitChanged(): void {
    eventBus.emit('player:healthChanged', {
      current: this.current,
      max: this.max,
    });
  }
}

export default PlayerHealth;
