/**
 * ShakeTriggers.ts — Document E §1.4, the complete trauma trigger catalogue.
 *
 * Every source that shakes the camera is bound in ONE readable place rather
 * than scattered through the systems that emit the events. The emitters stay
 * ignorant of the camera entirely; they just keep emitting the events they
 * already emitted before this document existed.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import cameraShake from './CameraShakeController';
import { CAMERA_SHAKE } from '../utils/Constants';

export interface ShakeTriggerDeps {
  getListenerPosition: () => THREE.Vector3;
}

export function bindShakeTriggers(deps: ShakeTriggerDeps): void {
  // --- generic environment hook -------------------------------------------
  // Any level trigger / destructible / vehicle / future AI ability can shake
  // the camera by emitting an event, with no reference to camera or player.
  cameraShake.bindEnvironmentHook(deps.getListenerPosition);

  // --- hard landing --------------------------------------------------------
  // Fires from the SAME player:landed event as the camera dip and the hand
  // settle-kick, so all three are frame-synchronised by construction.
  eventBus.on('player:landed', (payload) => {
    const impact = Math.abs((payload as { impactVelocity?: number }).impactVelocity ?? 0);
    if (impact < 4) return; // a gentle step-down should not rattle anything
    const t = THREE.MathUtils.clamp((impact - 4) / 12, 0, 1);
    cameraShake.addTrauma(THREE.MathUtils.lerp(
      CAMERA_SHAKE.LANDING_TRAUMA_MIN, CAMERA_SHAKE.LANDING_TRAUMA_MAX, t,
    ));
  });

  // --- taking damage -------------------------------------------------------
  eventBus.on('player:damaged', (payload) => {
    const amount = (payload as { amount?: number }).amount ?? 0;
    cameraShake.addTrauma(Math.min(
      CAMERA_SHAKE.DAMAGE_TRAUMA_MAX,
      amount * CAMERA_SHAKE.DAMAGE_TRAUMA_PER_POINT,
    ));
  });

  // --- explosions ----------------------------------------------------------
  // The shake radius is deliberately MUCH larger than the damage radius: you
  // feel a blast you were never in danger from, which is what sells scale.
  eventBus.on('combat:explosion', (payload) => {
    const p = payload as {
      point?: { x: number; y: number; z: number };
      radius?: number;
      shakeScale?: number;
    };
    if (!p.point) return;
    const damageRadius = p.radius ?? 6;
    cameraShake.addTraumaAtDistance(
      CAMERA_SHAKE.EXPLOSION_BASE_TRAUMA * (p.shakeScale ?? 1),
      p.point,
      deps.getListenerPosition(),
      damageRadius * CAMERA_SHAKE.EXPLOSION_SHAKE_RADIUS_MULTIPLIER,
    );
  });
}

export default bindShakeTriggers;
