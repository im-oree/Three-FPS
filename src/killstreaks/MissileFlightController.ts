/**
 * MissileFlightController.ts — Document I §6.6.
 *
 * KINEMATIC body with fully custom flight math: Rapier is used purely for
 * accurate collision DETECTION against real level geometry, never to simulate
 * the missile's motion. That is the correct body type for a player-steered
 * object whose handling must feel authored rather than physical.
 *
 * Two deliberate design choices:
 *  - Turning SLERPS toward the target orientation rather than snapping, so
 *    the missile feels weighted.
 *  - A constant downward drift the player must actively counter, which stops
 *    the degenerate "fly flat forever" strategy and creates real urgency.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { MISSILE } from '../utils/Constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export interface MissileStepResult {
  outOfFuel: boolean;
  /** World-space impact point, or null while still flying. */
  impact: THREE.Vector3 | null;
}

const _forward = new THREE.Vector3();
const _step = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();

export class MissileFlightController {
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private pitch = 0;
  private yaw = 0;
  private fuel = MISSILE.FLIGHT_TIME_BUDGET;
  private readonly prev = new THREE.Vector3();
  private readonly fins: THREE.Object3D[] = [];
  private dead = false;

  constructor(
    readonly model: THREE.Object3D,
    private readonly physics: PhysicsWorld,
    startPosition: THREE.Vector3,
    startYaw: number,
    startPitch: number,
  ) {
    this.yaw = startYaw;
    this.pitch = startPitch;
    model.position.copy(startPosition);
    this.prev.copy(startPosition);
    this.applyOrientation(1);

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(startPosition.x, startPosition.y, startPosition.z),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.15), this.body,
    );

    for (let i = 0; i < 4; i += 1) {
      const fin = model.getObjectByName(`Fin_${i}`);
      if (fin) this.fins.push(fin);
    }
  }

  get fuelSeconds(): number { return this.fuel; }
  get fuelFraction(): number {
    return Math.max(0, this.fuel / MISSILE.FLIGHT_TIME_BUDGET);
  }
  get pitchRadians(): number { return this.pitch; }
  get position(): THREE.Vector3 { return this.model.position; }

  /** `look` is a mouse delta in pixels for this frame. */
  update(dt: number, look: { x: number; y: number }, boosting: boolean): MissileStepResult {
    if (this.dead) return { outOfFuel: true, impact: null };
    this.fuel -= dt;

    // BOOST TRADE-OFF (the real streak's defining mechanic): boosting nearly
    // doubles descent speed but cuts steering authority to roughly a third.
    // Boosting early gets you down fast but you cannot correct; coasting
    // gives control but burns your short flight time.
    const steer = MISSILE.STEER_SENSITIVITY
      * (boosting ? MISSILE.BOOST_STEER_SCALE : 1);
    this.yaw -= look.x * steer;
    this.pitch -= look.y * steer;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch, MISSILE.MAX_PITCH_DOWN, MISSILE.MAX_PITCH_UP,
    );
    const responsiveness = MISSILE.TURN_RESPONSIVENESS
      * (boosting ? MISSILE.BOOST_STEER_SCALE : 1);
    this.applyOrientation(responsiveness * dt);

    _forward.set(0, 0, -1).applyQuaternion(this.model.quaternion);
    const speed = boosting ? MISSILE.BOOST_SPEED : MISSILE.FORWARD_SPEED;
    this.prev.copy(this.model.position);
    this.model.position.addScaledVector(_forward, speed * dt);

    this.body.setNextKinematicTranslation(this.model.position);
    this.deflectFins(look);

    return { outOfFuel: this.fuel <= 0, impact: this.sweepForImpact() };
  }

  /** Altitude above whatever is directly below — real missile HUD telemetry. */
  altitudeAboveGround(): number {
    const down = new THREE.Vector3(0, -1, 0);
    const hit = this.physics.castRayStatic(this.model.position, down, 400);
    return hit ? this.model.position.distanceTo(hit.point) : this.model.position.y;
  }

  get headingDegrees(): number {
    return ((-this.yaw * 180) / Math.PI + 360) % 360;
  }

  get divePitchDegrees(): number {
    return (this.pitch * 180) / Math.PI;
  }

  get speedMetresPerSecond(): number {
    return MISSILE.FORWARD_SPEED;
  }

  private applyOrientation(blend: number): void {
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    _quat.setFromEuler(_euler);
    if (blend >= 1) this.model.quaternion.copy(_quat);
    else this.model.quaternion.slerp(_quat, Math.min(1, blend));
  }

  /**
   * Swept collision. At 55 m/s the missile covers ~0.9 m per frame against a
   * 0.15 m collider, so an overlap test would tunnel straight through walls.
   * Cast the segment actually travelled instead.
   */
  private sweepForImpact(): THREE.Vector3 | null {
    _step.copy(this.model.position).sub(this.prev);
    const travelled = _step.length();
    if (travelled < 1e-4) return null;
    _step.divideScalar(travelled);
    const hit = this.physics.castRayStatic(this.prev, _step, travelled);
    if (!hit) return null;
    return hit.point.clone();
  }

  /** Visible fin deflection — small, but it is what sells the steering. */
  private deflectFins(look: { x: number; y: number }): void {
    const yawAmount = THREE.MathUtils.clamp(-look.x * 0.02, -0.5, 0.5);
    const pitchAmount = THREE.MathUtils.clamp(-look.y * 0.02, -0.5, 0.5);
    for (let i = 0; i < this.fins.length; i += 1) {
      // Fins 0/2 sit on the vertical axis and answer to pitch; 1/3 to yaw.
      const target = i % 2 === 0 ? pitchAmount : yawAmount;
      const sign = i < 2 ? 1 : -1;
      this.fins[i].rotation.x += (target * sign - this.fins[i].rotation.x) * 0.35;
    }
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.physics.world.removeCollider(this.collider, false);
    this.physics.world.removeRigidBody(this.body);
  }
}

export default MissileFlightController;
