/**
 * FireModeSystem.ts — pure trigger timing/gating (Document 3 §11.1).
 * WeaponManager delegates the "should a round leave the barrel THIS update"
 * decision entirely to this module; it owns no ammo and no raycasts.
 *
 *  auto  — level-triggered: fires while held, gated by secondsBetweenShots.
 *  semi  — edge-triggered: exactly one round per discrete press; must release.
 *  burst — one press queues burstCount rounds spaced burstDelaySeconds apart;
 *          the queue completes even if the button is released early, then a
 *          fresh press is required.
 */
import type { WeaponDefinition } from './WeaponBase';

export interface FireIntent {
  fireHeld: boolean;
  firePressed: boolean;
}

export class FireModeSystem {
  private burstRemaining = 0;
  private burstTimer = 0;

  /** Call on weapon switch / reload start to drop any queued burst. */
  reset(): void {
    this.burstRemaining = 0;
    this.burstTimer = 0;
  }

  get burstInProgress(): boolean {
    return this.burstRemaining > 0;
  }

  /**
   * Advances one simulation step. `tryConsumeShot` returns true when the shot
   * was actually accepted (ammo + rate gate passed), so burst queueing stays
   * in lockstep with real rounds leaving the magazine.
   */
  update(
    dt: number,
    def: WeaponDefinition,
    intent: FireIntent,
    tryConsumeShot: () => boolean,
  ): void {
    switch (def.fireMode) {
      case 'auto':
        if (intent.fireHeld) tryConsumeShot();
        return;
      case 'semi':
        if (intent.firePressed) tryConsumeShot();
        return;
      case 'projectile':
        // Launchers are single-shot-per-press, like semi.
        if (intent.firePressed) tryConsumeShot();
        return;
      case 'manualCycle':
        // Document D §2.1: one shot per press, and only while a round is
        // chambered. The chamber gate itself lives in CyclingActionSystem —
        // WeaponManager consults it before calling tryConsumeShot, so this
        // branch stays a pure input-shape rule like every other fire mode.
        if (intent.firePressed) tryConsumeShot();
        return;
      case 'burst':
        if (intent.firePressed && this.burstRemaining === 0) {
          this.burstRemaining = def.burstCount ?? 3;
          this.burstTimer = 0;
        }
        if (this.burstRemaining > 0) {
          this.burstTimer -= dt;
          if (this.burstTimer <= 0 && tryConsumeShot()) {
            this.burstRemaining -= 1;
            this.burstTimer = def.burstDelaySeconds ?? 0.08;
          }
        }
        return;
      default:
        break;
    }
  }
}

export default FireModeSystem;
