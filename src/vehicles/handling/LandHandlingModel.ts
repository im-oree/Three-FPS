/**
 * LandHandlingModel.ts — raycast arcade-sim vehicle physics.
 *
 * WHY RAYCAST AND NOT RAPIER JOINTS
 * Constraining four wheel colliders to a chassis with joints is the
 * physically honest approach and it is what most engines demo. It is also
 * jittery at 60 Hz (the contact solver fights the joint solver), expensive
 * (5 bodies + 4 joints per vehicle), and nearly impossible to tune for
 * arcade feel because every change fights the solver. Every shipped driving
 * game from Gran Turismo to GTA uses the model below instead:
 *
 *   ONE rigid body for the chassis. Four rays cast down from the wheel
 *   anchors. Each ray that hits applies three forces at its contact point:
 *     - SUSPENSION, a damped spring along the contact normal
 *     - DRIVE/BRAKE, along the wheel's forward direction
 *     - LATERAL GRIP, opposing sideways slip at that wheel
 *
 * That yields weight transfer, body roll under cornering, dive under
 * braking and squat under acceleration as emergent consequences of where
 * the forces are applied — none of it is scripted.
 *
 * The chassis here is integrated by hand rather than handed to Rapier as a
 * dynamic body. The vehicle needs to respond instantly to input and never
 * tunnel or jitter; a hand-integrated body with raycast contacts gives
 * frame-exact control, and the level is static geometry, so Rapier's
 * contact solver has nothing to add.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { LandHandling, VehicleInput, VehicleState } from '../VehicleTypes';

const GRAVITY = -9.81;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** How far above the chassis the safety probe starts. */
const PROBE_HEIGHT = 4;
/** How far below it looks. */
const PROBE_DEPTH = 8;

/** Per-wheel output, consumed by the visual layer to place the wheel meshes. */
export interface WheelState {
  /** Contact found this frame. */
  grounded: boolean;
  /** Distance from the anchor down to the contact, clamped to travel. */
  compression: number;
  /** Suspension length this frame (rest - compression). */
  length: number;
  /** Steering angle applied to this wheel, radians. */
  steer: number;
  /** Accumulated spin for the rolling animation, radians. */
  spin: number;
  /** How much this wheel is sliding sideways, 0..1, for skid FX. */
  slip: number;
  /** World-space contact point, for dust/skid decals. */
  contactPoint: THREE.Vector3;
  contactNormal: THREE.Vector3;
}

const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpProbe = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

export class LandHandlingModel {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  readonly angularVelocity = new THREE.Vector3();
  readonly wheels: WheelState[] = [];

  private readonly cfg: LandHandling;
  private readonly physics: PhysicsWorld;
  private readonly invMass: number;
  /** Diagonal inertia tensor; a box approximation is plenty here. */
  private readonly invInertia = new THREE.Vector3();
  private steerAngle = 0;
  /** Set while the vehicle is upside down, to drive the auto-flip prompt. */
  private flippedFor = 0;

  constructor(cfg: LandHandling, physics: PhysicsWorld) {
    this.cfg = cfg;
    this.physics = physics;
    this.invMass = 1 / cfg.mass;

    // Box inertia from the wheel layout: half-track and half-wheelbase give
    // a good enough extent, and the height is taken as the suspension rest.
    let hx = 0.5; let hz = 1.0;
    for (const a of cfg.wheelAnchors) {
      hx = Math.max(hx, Math.abs(a[0]));
      hz = Math.max(hz, Math.abs(a[2]));
    }
    const hy = cfg.suspensionRest + cfg.wheelRadius;
    const m = cfg.mass;
    const ix = (m / 3) * (hy * hy + hz * hz);
    const iy = (m / 3) * (hx * hx + hz * hz);
    const iz = (m / 3) * (hx * hx + hy * hy);
    this.invInertia.set(1 / ix, 1 / iy, 1 / iz);

    for (let i = 0; i < cfg.wheelAnchors.length; i += 1) {
      this.wheels.push({
        grounded: false,
        compression: 0,
        length: cfg.suspensionRest,
        steer: 0,
        spin: 0,
        slip: 0,
        contactPoint: new THREE.Vector3(),
        contactNormal: new THREE.Vector3(0, 1, 0),
      });
    }
  }

  /** Place the vehicle without any physics response (spawn, teleport). */
  reset(position: THREE.Vector3, yaw: number): void {
    this.position.copy(position);
    this.quaternion.setFromAxisAngle(UP, yaw);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.steerAngle = 0;
    for (const w of this.wheels) {
      w.grounded = false;
      w.compression = 0;
      w.length = this.cfg.suspensionRest;
      w.slip = 0;
    }
  }

  /** True when the chassis has been inverted long enough to offer a reset. */
  get isFlipped(): boolean { return this.flippedFor > 1.5; }

  step(dt: number, input: VehicleInput, state: VehicleState): void {
    const cfg = this.cfg;

    // --- Orientation basis -------------------------------------------------
    tmpM.makeRotationFromQuaternion(this.quaternion);
    const up = tmpB.setFromMatrixColumn(tmpM, 1).clone();
    const forward = tmpC.setFromMatrixColumn(tmpM, 2).clone().negate(); // -Z

    const forwardSpeed = this.velocity.dot(forward);
    const speedAbs = Math.abs(forwardSpeed);

    // --- Steering ----------------------------------------------------------
    // Maximum lock falls off with speed. Without this the vehicle spins
    // instantly at 100 km/h because full lock at speed is not survivable.
    const speedFrac = Math.min(1, speedAbs / Math.max(1, cfg.topSpeed));
    const maxSteer = THREE.MathUtils.lerp(
      cfg.steerAngleLow, cfg.steerAngleHigh, speedFrac,
    );
    const targetSteer = input.steer * maxSteer;
    this.steerAngle = THREE.MathUtils.damp(
      this.steerAngle, targetSteer, cfg.steerRate, dt,
    );

    // --- Accumulate forces -------------------------------------------------
    const force = new THREE.Vector3(0, GRAVITY * cfg.mass, 0);
    const torque = new THREE.Vector3();
    let groundedCount = 0;
    let totalSlip = 0;

    for (let i = 0; i < cfg.wheelAnchors.length; i += 1) {
      const w = this.wheels[i];
      const anchorLocal = cfg.wheelAnchors[i];
      const steered = cfg.steeredWheels.includes(i);
      w.steer = steered ? this.steerAngle : 0;

      // Anchor in world space.
      const anchor = new THREE.Vector3(anchorLocal[0], anchorLocal[1], anchorLocal[2])
        .applyQuaternion(this.quaternion)
        .add(this.position);

      // Cast from the anchor down the chassis' own up axis, not world down,
      // so suspension still works on a banked surface or mid-roll.
      const rayDir = up.clone().negate();
      const maxDist = cfg.suspensionRest + cfg.suspensionTravel + cfg.wheelRadius;
      const hit = this.physics.castRayStatic(anchor, rayDir, maxDist);

      if (!hit) {
        w.grounded = false;
        w.slip = 0;
        // Extend the suspension smoothly so the wheel drops rather than snaps.
        w.length = THREE.MathUtils.damp(
          w.length, cfg.suspensionRest + cfg.suspensionTravel, 8, dt,
        );
        w.compression = 0;
        // A free wheel keeps spinning, slowly decaying.
        w.spin += (forwardSpeed / cfg.wheelRadius) * dt;
        continue;
      }

      groundedCount += 1;
      w.grounded = true;
      w.contactNormal.copy(hit.normal);
      w.contactPoint.copy(hit.point);

      // Suspension length is the ray distance minus the wheel radius.
      const rawLength = hit.toi - cfg.wheelRadius;
      const length = THREE.MathUtils.clamp(
        rawLength, cfg.suspensionRest - cfg.suspensionTravel, cfg.suspensionRest,
      );
      const compression = cfg.suspensionRest - length;
      // Damper uses the RATE of compression, which is the velocity of the
      // contact point along the spring axis.
      const armToContact = w.contactPoint.clone().sub(this.position);
      const pointVel = this.velocity.clone()
        .add(new THREE.Vector3().crossVectors(this.angularVelocity, armToContact));
      const springVel = -pointVel.dot(up);

      const springForce = compression * cfg.suspensionStiffness
        + springVel * cfg.suspensionDamping;
      // A suspension can push but never pull the car down.
      const normalForce = Math.max(0, springForce);

      w.length = length;
      w.compression = compression;

      // Apply along the CONTACT NORMAL, not the chassis up: driving across a
      // slope should push the car off the slope, which is what makes hills
      // and banked turns feel physical.
      const suspension = w.contactNormal.clone().multiplyScalar(normalForce);
      force.add(suspension);
      torque.add(new THREE.Vector3().crossVectors(armToContact, suspension));

      // --- Wheel-local basis, projected onto the contact plane -------------
      const wheelYaw = new THREE.Quaternion().setFromAxisAngle(UP, w.steer);
      const wheelFwd = forward.clone().applyQuaternion(wheelYaw);
      // Remove any component into the ground so traction stays on the surface.
      wheelFwd.addScaledVector(w.contactNormal, -wheelFwd.dot(w.contactNormal))
        .normalize();
      const wheelSide = new THREE.Vector3()
        .crossVectors(w.contactNormal, wheelFwd).normalize();

      const vFwd = pointVel.dot(wheelFwd);
      const vSide = pointVel.dot(wheelSide);

      // --- Longitudinal: drive and brake -----------------------------------
      let driveForce = 0;
      if (cfg.drivenWheels.includes(i)) {
        const share = 1 / cfg.drivenWheels.length;
        // Torque curve: full force from rest, tapering to zero at top speed,
        // so the vehicle has a natural terminal velocity without a hard clamp.
        const limit = input.throttle >= 0 ? cfg.topSpeed : cfg.reverseTopSpeed;
        const headroom = 1 - THREE.MathUtils.clamp(
          Math.abs(vFwd) / Math.max(1, limit), 0, 1,
        );
        driveForce = input.throttle * cfg.enginePower * share * headroom;
      }

      // Braking opposes motion and must never reverse it within one step.
      const brakeInput = Math.max(
        input.brake, input.handbrake && i >= 2 ? 1 : 0,
      );
      if (brakeInput > 0) {
        const share = 1 / cfg.wheelAnchors.length;
        const maxStop = Math.abs(vFwd) * cfg.mass * share / Math.max(dt, 1e-4);
        const brakeForce = Math.min(brakeInput * cfg.brakePower * share, maxStop);
        driveForce -= Math.sign(vFwd) * brakeForce;
      }

      // Rolling resistance, always opposing.
      driveForce -= Math.sign(vFwd) * Math.min(
        cfg.rollingResistance * normalForce * 0.001,
        Math.abs(vFwd) * cfg.mass * 0.25 / Math.max(dt, 1e-4),
      );

      const longitudinal = wheelFwd.clone().multiplyScalar(driveForce);
      force.add(longitudinal);
      torque.add(new THREE.Vector3().crossVectors(armToContact, longitudinal));

      // --- Lateral: grip ----------------------------------------------------
      // The impulse that would cancel sideways velocity outright, limited by
      // available grip. Friction cannot exceed the normal force times mu, so
      // an airborne-ish wheel (low normalForce) grips less — that is what
      // makes the inside wheel lose traction in a hard turn.
      const gripScale = input.handbrake && i >= 2 ? cfg.handbrakeGripScale : 1;
      const desired = -vSide * cfg.mass / Math.max(dt, 1e-4)
        / cfg.wheelAnchors.length;
      const maxGrip = normalForce * cfg.lateralGrip * gripScale;
      const lateralMag = THREE.MathUtils.clamp(desired, -maxGrip, maxGrip);
      const lateral = wheelSide.clone().multiplyScalar(lateralMag);
      force.add(lateral);
      torque.add(new THREE.Vector3().crossVectors(armToContact, lateral));

      // Slip for FX: how much sideways velocity the grip failed to cancel.
      w.slip = THREE.MathUtils.clamp(
        (Math.abs(desired) - Math.abs(lateralMag)) / Math.max(maxGrip, 1), 0, 1,
      );
      totalSlip += w.slip;

      w.spin += (vFwd / cfg.wheelRadius) * dt;
    }

    // --- Aerodynamics ------------------------------------------------------
    const speed = this.velocity.length();
    if (speed > 0.01) {
      force.addScaledVector(
        this.velocity, -cfg.drag * speed / Math.max(speed, 1e-4) * speed,
      );
    }
    if (groundedCount > 0) {
      force.addScaledVector(up, -cfg.downforce * speed * speed);
    }

    // --- Integrate ---------------------------------------------------------
    this.velocity.addScaledVector(force, this.invMass * dt);

    // Torque is in world space; rotate into body space to apply the inertia
    // tensor, then back out again.
    const invRot = this.quaternion.clone().invert();
    const localTorque = torque.clone().applyQuaternion(invRot);
    const localAngAccel = new THREE.Vector3(
      localTorque.x * this.invInertia.x,
      localTorque.y * this.invInertia.y,
      localTorque.z * this.invInertia.z,
    );
    this.angularVelocity.addScaledVector(
      localAngAccel.applyQuaternion(this.quaternion), dt,
    );

    // Angular damping. Yaw is damped far less than pitch/roll: a car should
    // rotate freely about its vertical axis but must not wobble on the other
    // two, and this is much cheaper and steadier than modelling anti-roll bars.
    const localAng = this.angularVelocity.clone().applyQuaternion(invRot);
    localAng.x *= Math.exp(-6.0 * dt);
    localAng.y *= Math.exp(-0.9 * dt);
    localAng.z *= Math.exp(-6.0 * dt);
    this.angularVelocity.copy(localAng.applyQuaternion(this.quaternion));

    this.position.addScaledVector(this.velocity, dt);

    const angSpeed = this.angularVelocity.length();
    if (angSpeed > 1e-5) {
      tmpQ.setFromAxisAngle(
        this.angularVelocity.clone().divideScalar(angSpeed), angSpeed * dt,
      );
      this.quaternion.premultiply(tmpQ).normalize();
    }

    // --- Anti-sink safety net ---------------------------------------------
    //
    // THE BUG THIS FIXES: the suspension ray starts at the wheel ANCHOR and
    // reaches down `rest + travel + radius`. Once the chassis has dipped far
    // enough that the anchor is itself below the ground surface, the ray
    // starts underground, hits nothing, the model concludes "airborne",
    // applies gravity, and the vehicle accelerates downward forever. An
    // acceptance run caught exactly this: the Humvee reached y = -993 at
    // -126 m/s with all four wheels reporting no contact.
    //
    // The first attempt at this net only ran when ALL FOUR wheels were
    // grounded, which is precisely the case that never happens while sinking,
    // and compared a wheel radius against a chassis-to-contact distance,
    // which is not a penetration depth of anything. Both were wrong.
    //
    // The fix casts DOWNWARD FROM ABOVE the chassis instead. A ray that
    // starts in open air cannot miss the ground the way one starting
    // underground can, so this is a reliable floor probe no matter how deep
    // the vehicle has got.
    const probeTop = tmpProbe.copy(this.position);
    probeTop.y += PROBE_HEIGHT;
    const toGround = this.physics.castRayDistance(
      probeTop, DOWN, PROBE_HEIGHT + PROBE_DEPTH,
    );
    if (toGround !== null) {
      const groundY = probeTop.y - toGround;
      // Lowest the chassis origin may sit: ground + wheel radius + the
      // fully-compressed suspension, with a small tolerance so the normal
      // spring range is untouched.
      const floorY = groundY + cfg.wheelRadius
        + (cfg.suspensionRest - cfg.suspensionTravel) - 0.10;
      if (this.position.y < floorY) {
        this.position.y = floorY;
        // Kill only the downward component: preserve horizontal momentum so
        // clipping a kerb does not stop the vehicle dead.
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    }

    // --- Publish state -----------------------------------------------------
    const newForward = tmpC.set(0, 0, -1).applyQuaternion(this.quaternion);
    state.forwardSpeed = this.velocity.dot(newForward);
    state.velocity.copy(this.velocity);
    state.steerAngle = this.steerAngle;
    state.grounded = groundedCount > 0;
    state.medium = 'ground';
    state.throttleLoad = THREE.MathUtils.clamp(
      Math.abs(state.forwardSpeed) / Math.max(1, cfg.topSpeed), 0, 1,
    );

    const groundDist = this.physics.castRayDistance(
      this.position, new THREE.Vector3(0, -1, 0), 200,
    );
    state.altitude = groundDist ?? 0;

    // Track how long we have been inverted, for the flip-recovery prompt.
    const upness = up.dot(UP);
    this.flippedFor = upness < -0.1 ? this.flippedFor + dt : 0;
  }

  /** Average sideways slip across all wheels, 0..1 — drives skid audio/FX. */
  get slipAmount(): number {
    let t = 0;
    for (const w of this.wheels) t += w.slip;
    return t / Math.max(1, this.wheels.length);
  }
}

export default LandHandlingModel;
