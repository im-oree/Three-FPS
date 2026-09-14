/**
 * ThrowableEffects.ts — Document F §6. Turns a detonation into its effects.
 *
 * THE FLASHBANG RULE (§6.3), which is what makes it feel fair rather than an
 * inescapable screen-wipe:
 *   strength = distanceFalloff x viewingAngle x lineOfSight
 * Looking away helps. Taking cover helps more — a blocked line of sight
 * collapses the effect to a token minimum ("heard it, barely felt it").
 * You can deny a flashbang by positioning, which is the whole point.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import statusEffects from '../player/ActiveStatusEffects';
import { DISORIENT } from '../utils/Constants';
import { getThrowable } from './definitions';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

const _point = new THREE.Vector3();
const _toBlast = new THREE.Vector3();

export interface ThrowableEffectDeps {
  physics: PhysicsWorld;
  getEyePosition: () => THREE.Vector3;
  getForward: () => THREE.Vector3;
}

export class ThrowableEffects {
  private deps: ThrowableEffectDeps | null = null;

  attach(deps: ThrowableEffectDeps): void {
    this.deps = deps;
  }

  start(): void {
    eventBus.on('equipment:detonated', (payload) => {
      const p = payload as {
        id: string;
        point: { x: number; y: number; z: number };
        radius: number;
      };
      this.resolve(p.id, p.point, p.radius);
    });
  }

  /**
   * Compute how hard the local player is hit. Exposed so tests can assert the
   * angle/occlusion rules directly rather than inferring them from overlays.
   */
  computeStrength(
    point: { x: number; y: number; z: number },
    radius: number,
    useAngle: boolean,
  ): { strength: number; distance: number; exposure: number; occluded: boolean } {
    if (!this.deps) return { strength: 0, distance: Infinity, exposure: 0, occluded: true };
    const eye = this.deps.getEyePosition();
    _point.set(point.x, point.y, point.z);
    const distance = _point.distanceTo(eye);
    if (distance >= radius) {
      return { strength: 0, distance, exposure: 0, occluded: false };
    }

    const falloff = 1 - distance / radius;

    // Viewing angle: 1 staring straight at it, 0 facing away.
    let exposure = 1;
    if (useAngle) {
      _toBlast.copy(_point).sub(eye).normalize();
      const forward = this.deps.getForward().clone().normalize();
      exposure = Math.max(0, forward.dot(_toBlast));
    }

    // Line of sight, via the same Rapier query bullets use.
    _toBlast.copy(_point).sub(eye);
    const rayLength = _toBlast.length();
    _toBlast.normalize();
    const hit = this.deps.physics.castRayStatic(eye, _toBlast, rayLength - 0.35);
    const occluded = Boolean(hit);

    let strength = falloff * exposure;
    if (occluded) strength = Math.min(strength, DISORIENT.OCCLUDED_STRENGTH);
    return { strength, distance, exposure, occluded };
  }

  private resolve(
    id: string, point: { x: number; y: number; z: number }, radius: number,
  ): void {
    const profile = getThrowable(id);
    if (!profile) return;

    // Every detonation gets the shared explosion visuals at tactical scale,
    // with ZERO blast damage — the clean split Document G was built around.
    if (profile.id !== 'smoke_grenade') {
      eventBus.emit('combat:explosion', {
        point, radius, maxDamage: 0, falloffCurve: profile.effectFalloff,
        weaponId: profile.id, presetId: 'tacticalDetonation',
        shakeScale: profile.id === 'flashbang' ? 0.5 : 0.35,
      });
    }

    if (profile.id === 'smoke_grenade') {
      eventBus.emit('smoke:deployed', {
        point, radius, linger: profile.smokeLingerSeconds ?? 15,
      });
      return;
    }

    // Only the FLASHBANG cares which way you are looking. A concussion blast
    // is pressure — turning your back does not save you from it.
    const useAngle = profile.id === 'flashbang';
    const { strength, occluded } = this.computeStrength(point, radius, useAngle);
    if (strength < DISORIENT.MIN_STRENGTH) return;

    if (profile.id === 'flashbang') {
      const blindSeconds = THREE.MathUtils.lerp(
        DISORIENT.FLASH_MIN_SECONDS, DISORIENT.FLASH_MAX_SECONDS, strength,
      );
      statusEffects.apply('flashed', 'flashed', strength, blindSeconds);
      statusEffects.apply(
        'flash_spread', 'spreadPenalty',
        DISORIENT.FLASH_SPREAD_PENALTY_DEG * strength, blindSeconds,
      );
      eventBus.emit('effect:flashed', {
        strength, seconds: blindSeconds, occluded,
      });
    } else {
      // Stun: movement slow + looser aim + blur, but never a whiteout.
      const seconds = (profile.slowDuration ?? 3.5) * strength;
      statusEffects.apply(
        'stun_slow', 'moveSlow',
        THREE.MathUtils.lerp(1, profile.slowMoveMultiplier ?? 0.4, strength),
        seconds,
      );
      statusEffects.apply('stun_sway', 'swayLoosen',
        THREE.MathUtils.lerp(1, 0.45, strength), seconds);
      eventBus.emit('effect:concussed', { strength, seconds, occluded });
    }

    eventBus.emit('effect:audioMuffle', {
      seconds: (profile.audioMuffleDuration ?? 3) * strength,
      strength,
      ringTone: profile.soundKeys.ringTone ?? null,
    });
  }
}

export const throwableEffects = new ThrowableEffects();
export default throwableEffects;
