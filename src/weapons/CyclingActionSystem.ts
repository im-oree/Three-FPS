/**
 * CyclingActionSystem.ts — Document D §2.1.
 *
 * A CYCLING ACTION is a manually-operated mechanism (a pump-action shotgun's
 * forend, a bolt-action rifle's handle) that the shooter must physically rack
 * between shots to chamber the next round. It is distinct from a self-cycling
 * semi/auto action, and distinct from a magazine reload.
 *
 * This is ONE reusable system shared by every manually-cycled weapon — the
 * shotgun's pump and the sniper's bolt differ only in data (clip name, part
 * node, duration), never in code. That is the whole point of Document C's
 * engine-first ordering.
 *
 * STATE AUTHORITY: cycling is a real character state, so it goes through
 * CharacterStateSystem like everything else (see /CHARACTER_STATE.md). While
 * WeaponAction.CYCLING is held, firing and reloading are refused by the
 * authority's own transition table rather than by ad hoc booleans here.
 */
import characterState, { WeaponAction } from '../character/CharacterStateSystem';
import eventBus from '../core/EventBus';
import type { WeaponBase } from './WeaponBase';

export interface CycleAttemptResult {
  allowed: boolean;
  reason?: 'not_cycled' | 'already_cycling';
}

export class CyclingActionSystem {
  /** True when a round is chambered and the weapon may fire. */
  private chambered = true;
  private elapsed = 0;
  private duration = 0;
  private active = false;
  private weaponId = '';

  /** Weapons start chambered; re-arm when the player equips a fresh one. */
  onEquip(weapon: WeaponBase): void {
    this.weaponId = weapon.def.id;
    this.chambered = true;
    this.active = false;
    this.elapsed = 0;
  }

  get isCycling(): boolean {
    return this.active;
  }

  get isChambered(): boolean {
    return this.chambered;
  }

  /** 0..1 through the cycle, for the animation layer to drive the part node. */
  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 0;
  }

  /**
   * Gate a fire attempt. Called by FireModeSystem for `fireMode: 'manualCycle'`
   * BEFORE a round is consumed.
   */
  onFireAttempt(): CycleAttemptResult {
    if (this.active) return { allowed: false, reason: 'already_cycling' };
    if (!this.chambered) return { allowed: false, reason: 'not_cycled' };
    this.chambered = false;
    return { allowed: true };
  }

  /**
   * Begin racking. Called once the shot has actually gone out. Returns false
   * if the state authority refuses (e.g. a traversal is in progress).
   */
  begin(weapon: WeaponBase): boolean {
    if (this.active) return false;
    if (!characterState.request({
      channel: 'weaponAction',
      to: WeaponAction.CYCLING,
      source: 'CyclingActionSystem.begin',
    })) return false;

    this.weaponId = weapon.def.id;
    this.duration = weapon.def.cycleDurationSeconds ?? 0.55;
    this.elapsed = 0;
    this.active = true;
    eventBus.emit('weapon:cycleStart', {
      weaponId: this.weaponId,
      duration: this.duration,
    });
    return true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    if (this.elapsed < this.duration) return;
    this.complete();
  }

  /** Finish the cycle: a round is chambered again and the weapon may fire. */
  private complete(): void {
    this.active = false;
    this.chambered = true;
    characterState.request({
      channel: 'weaponAction',
      to: WeaponAction.NONE,
      source: 'CyclingActionSystem.complete',
      force: true,
    });
    eventBus.emit('weapon:cycleComplete', { weaponId: this.weaponId });
  }

  /**
   * Abort a cycle in flight (weapon switch, death). The round is treated as
   * chambered so the weapon is not left permanently unusable.
   */
  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.chambered = true;
    characterState.request({
      channel: 'weaponAction',
      to: WeaponAction.NONE,
      source: 'CyclingActionSystem.cancel',
      force: true,
    });
  }
}
