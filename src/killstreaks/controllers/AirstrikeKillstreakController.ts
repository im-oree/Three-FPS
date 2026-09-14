/**
 * AirstrikeKillstreakController.ts — Document H §2.2.
 *
 * Pure ORCHESTRATION of systems that already exist: ground targeting, a
 * delay, then a line of explosions each driving the shared ExplosionEffect,
 * ExplosionDamageResolver and CameraShakeController. There is no new damage
 * code and no new VFX code in this file — that is the point.
 *
 * `durationSeconds: 0` in its definition marks it fire-and-forget, so this
 * controller calls reportEnded() itself once the last bomb has landed.
 */
import * as THREE from 'three';
import eventBus from '../../core/EventBus';
import { AIRSTRIKE } from '../../utils/Constants';
import {
  KillstreakControllerInterface, type KillstreakContext,
} from '../KillstreakControllerInterface';

export class AirstrikeKillstreakController extends KillstreakControllerInterface {
  private timer = 0;
  private dropped = 0;
  private readonly target = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private finished = false;

  /**
   * The manager hands over a context; the target point is supplied separately
   * by whoever ran the targeting mode, because targeting is a UI-level flow
   * that happens BEFORE activation.
   */
  static pendingTarget: THREE.Vector3 | null = null;
  static pendingAxis: THREE.Vector3 | null = null;

  activate(context: KillstreakContext): void {
    this.context = context;
    this.timer = 0;
    this.dropped = 0;
    this.finished = false;

    this.target.copy(
      AirstrikeKillstreakController.pendingTarget ?? context.getPlayerPosition(),
    );
    // Bombs walk along the player's view axis through the target, flattened —
    // a vertical component would march the line into the sky.
    const forward = AirstrikeKillstreakController.pendingAxis
      ?? context.getCameraForward();
    this.axis.set(forward.x, 0, forward.z);
    if (this.axis.lengthSq() < 1e-6) this.axis.set(0, 0, -1);
    this.axis.normalize();

    AirstrikeKillstreakController.pendingTarget = null;
    AirstrikeKillstreakController.pendingAxis = null;

    eventBus.emit('killstreak:airstrike:inbound', {
      x: this.target.x, z: this.target.z, delay: AIRSTRIKE.INBOUND_DELAY,
    });
  }

  override update(dt: number): void {
    if (this.finished) return;
    this.timer += dt;

    const dropAt = AIRSTRIKE.INBOUND_DELAY + this.dropped * AIRSTRIKE.BOMB_INTERVAL;
    if (this.timer < dropAt) return;
    if (this.dropped >= AIRSTRIKE.BOMB_COUNT) {
      this.finished = true;
      this.context?.reportEnded();
      return;
    }

    // Space the bombs along the axis, centred on the designated point.
    const offset = (this.dropped - (AIRSTRIKE.BOMB_COUNT - 1) / 2)
      * AIRSTRIKE.BOMB_SPACING;
    const point = this.target.clone().addScaledVector(this.axis, offset);

    // ONE event drives visuals, damage and camera shake. No new code here.
    eventBus.emit('combat:explosion', {
      point: { x: point.x, y: point.y + 0.4, z: point.z },
      radius: AIRSTRIKE.BLAST_RADIUS,
      maxDamage: AIRSTRIKE.BLAST_DAMAGE,
      falloffCurve: 'quadratic',
      weaponId: 'airstrike',
      presetId: 'airstrikeBomb',
      shakeScale: 1.4,
    });

    this.dropped += 1;
  }

  override get remainingSeconds(): number {
    const total = AIRSTRIKE.INBOUND_DELAY
      + AIRSTRIKE.BOMB_COUNT * AIRSTRIKE.BOMB_INTERVAL;
    return Math.max(0, total - this.timer);
  }

  deactivate(): void {
    this.finished = true;
    this.context = null;
  }
}

export default AirstrikeKillstreakController;
