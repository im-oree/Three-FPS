/**
 * MeleeHitDetection.ts — Document B §2: short hit-SWEEP (sphere cast along the
 * camera forward across the strike window), reusing the ballistics hittable
 * registry. Fires combat:hit once per victim per swing; damage from data.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { MELEE } from '../utils/Constants';
import type { BallisticsSystem } from './BallisticsSystem';

export class MeleeHitDetection {
  /** Swing state: active during the punch clip's strike window. */
  private swingActive = false;
  private swingElapsed = 0;
  private readonly hitThisSwing = new Set<THREE.Object3D>();
  private readonly origin = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private camera: THREE.PerspectiveCamera | null = null;
  /** Consumed by the player controller (collision-clamped). */
  lungeDelta = new THREE.Vector3();

  constructor(
    private readonly ballistics: BallisticsSystem,
  ) {
    eventBus.on('melee:swung', () => this.beginSwing());
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  private beginSwing(): void {
    this.swingActive = true;
    this.swingElapsed = 0;
    this.hitThisSwing.clear();
  }

  update(dt: number): void {
    if (this.swingActive) {
      this.swingElapsed += dt;
      if (this.swingElapsed >= MELEE.STRIKE_WINDOW.START && this.swingElapsed <= MELEE.STRIKE_WINDOW.END) {
        this.sweep();
        // forward lunge (Document B §2): collision-clamped by the consumer
        this.camera!.getWorldDirection(this.forward);
        this.lungeDelta.copy(this.forward).multiplyScalar(MELEE.LUNGE_DISTANCE * dt / (MELEE.STRIKE_WINDOW.END - MELEE.STRIKE_WINDOW.START));
      } else {
        this.lungeDelta.set(0, 0, 0);
      }
      if (this.swingElapsed > MELEE.STRIKE_WINDOW.END) {
        this.swingActive = false;
        this.lungeDelta.set(0, 0, 0);
      }
    }
  }

  private sweep(): void {
    if (!this.camera) return;
    this.camera.getWorldPosition(this.origin);
    this.camera.getWorldDirection(this.forward);
    // capsule-approximating sweep: sample spheres along the reach ray; ONE
    // victim per swing (a punch cannot double-hit stacked hitboxes).
    const steps = 4;
    const sphere = new THREE.Sphere();
    outer:
    for (let i = 1; i <= steps; i += 1) {
      const t = (i / steps) * MELEE.RANGE_METERS;
      sphere.center.copy(this.origin).addScaledVector(this.forward, t);
      sphere.radius = 0.45;
      for (const entry of this.ballistics.hittables) {
        if (this.hitThisSwing.has(entry.object)) continue;
        const box = new THREE.Box3().setFromObject(entry.object);
        if (box.intersectsSphere(sphere)) {
          this.hitThisSwing.add(entry.object);
          const point = sphere.center.clone();
          const distance = this.origin.distanceTo(point);
          // Payload stays JSON-cloneable (harness/EventBus contract): no
          // Object3D references — victims take damage via the registry.
          eventBus.emit('combat:hit', {
            point, normal: this.forward.clone().negate(), distance,
            damage: MELEE.DAMAGE, surfaceType: entry.metadata.surfaceType ?? 'generic',
            isKill: false,
          });
          entry.metadata.takeDamage?.(MELEE.DAMAGE, point);
          eventBus.emit('combat:shotFired', { weaponId: 'fists', hit: true });
          break outer;
        }
      }
    }
  }
}
