/**
 * ExplosionDamageResolver.ts — Document D §2.2.
 *
 * Consumes `combat:explosion` and applies radius-based falloff damage to every
 * registered hittable inside the blast.
 *
 * It deliberately queries the SAME registerHittable() registry that hitscan
 * bullets use (Document 3), with zero changes to that contract — which is the
 * evidence that Document C's engine-first ordering paid off: splash damage
 * needed no new damage plumbing at all.
 *
 * Per Document D §7.1 the shooter is NOT excluded. A rocket fired at your own
 * feet should hurt you; that is correct, intended behaviour, not a bug.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import ballistics from './BallisticsSystem';

export interface ExplosionPayload {
  point: { x: number; y: number; z: number };
  radius: number;
  maxDamage: number;
  falloffCurve: 'linear' | 'quadratic';
  weaponId: string;
}

const _point = new THREE.Vector3();
const _target = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Damage multiplier at `distance` from the centre of a blast of `radius`.
 * 1 at the epicentre, 0 at the rim.
 */
export function blastFalloff(
  distance: number, radius: number, curve: 'linear' | 'quadratic',
): number {
  if (radius <= 0) return 0;
  const t = Math.max(0, Math.min(1, 1 - distance / radius));
  return curve === 'quadratic' ? t * t : t;
}

export class ExplosionDamageResolver {
  private playerProbe: (() => THREE.Vector3 | null) | null = null;
  private playerDamage: ((amount: number) => void) | null = null;

  /** Let the blast reach the shooter too (Document D §7.1). */
  setPlayerTarget(
    probe: () => THREE.Vector3 | null,
    damage: (amount: number) => void,
  ): void {
    this.playerProbe = probe;
    this.playerDamage = damage;
  }

  start(): void {
    eventBus.on('combat:explosion', (raw) => {
      this.resolve(raw as unknown as ExplosionPayload);
    });
  }

  private resolve(payload: ExplosionPayload): void {
    _point.set(payload.point.x, payload.point.y, payload.point.z);

    for (const entry of ballistics.hittables) {
      if (!entry.metadata.takeDamage) continue;
      // Measure to the nearest point of the object's bounds, not its origin:
      // a large object clipped by the blast edge should still take damage.
      _box.setFromObject(entry.object);
      if (_box.isEmpty()) {
        entry.object.getWorldPosition(_target);
      } else {
        _box.clampPoint(_point, _target);
      }
      const distance = _point.distanceTo(_target);
      if (distance > payload.radius) continue;
      const amount = payload.maxDamage
        * blastFalloff(distance, payload.radius, payload.falloffCurve);
      if (amount <= 0) continue;
      entry.metadata.takeDamage(amount, _target.clone());
    }

    // The shooter is a legitimate target.
    if (this.playerProbe && this.playerDamage) {
      const self = this.playerProbe();
      if (self) {
        const distance = _point.distanceTo(self);
        if (distance <= payload.radius) {
          const amount = payload.maxDamage
            * blastFalloff(distance, payload.radius, payload.falloffCurve);
          if (amount > 0) this.playerDamage(amount);
        }
      }
    }
  }
}

export const explosionDamage = new ExplosionDamageResolver();
export default explosionDamage;
