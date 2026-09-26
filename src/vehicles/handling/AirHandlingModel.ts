/**
 * AirHandlingModel — arcade-sim flight for rotary and fixed-wing aircraft.
 *
 * Mirrors LandHandlingModel's contract exactly: own the position/quaternion/
 * velocity, integrate them in `step`, and let Vehicle copy the result onto the
 * scene node. Nothing here touches Rapier dynamics — the same reasoning that
 * ruled out joint-constrained wheels applies harder in the air, where a
 * physical rotor is both expensive and unstable.
 *
 * DESIGN
 * ------
 * Two wing types share one integrator:
 *
 *   'rotary'  Thrust points along the airframe's own UP axis. Tilting the
 *             disc is what moves you: pitch forward and the same collective
 *             that was holding you up now also pushes you forward. That one
 *             rule is what makes a helicopter feel like a helicopter, and it
 *             falls out of the maths for free rather than needing a special
 *             case.
 *
 *   'fixed'   Thrust points forward; lift is generated from AIRSPEED across
 *             the wing and collapses below the stall speed. A jet that slows
 *             down falls out of the sky.
 *
 * Control is rate-based with damping, not direct angle setting: the stick
 * commands an angular velocity, and `stability` bleeds the airframe back
 * toward level when the stick is centred. A helicopter has high stability
 * (it self-rights), a jet has almost none (it holds whatever attitude you
 * leave it in).
 *
 * GROUND HANDLING
 * ---------------
 * The model probes downward for the floor and refuses to sink through it,
 * which gives landing, resting on a helipad, and taxiing for free. This is
 * the same "probe from above the hull" trick the land model uses, and for the
 * same reason: a probe that starts inside the terrain finds nothing and the
 * aircraft falls forever.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { AirHandling, VehicleInput, VehicleState } from '../VehicleTypes';

const GRAVITY = -9.81;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/** How far above the hull origin the ground probe starts. */
const PROBE_HEIGHT = 3;
/** Total probe length, measured from PROBE_HEIGHT above the origin. */
const PROBE_DEPTH = 9;

/** Scratch, module-scope so `step` allocates nothing. */
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const spin = new THREE.Quaternion();
const target = new THREE.Vector3();

export class AirHandlingModel {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  /** Body-frame angular velocity: x = pitch, y = yaw, z = roll. */
  readonly angularVelocity = new THREE.Vector3();

  /**
   * 0..1 rotor/engine spool. Thrust scales with this, so a helicopter cannot
   * jump off the pad the instant someone presses a key — it has to spin up.
   * The visual rotor speed and the audio pitch both read from it.
   */
  rotorSpin = 0;
  /** Accumulated rotor angle in radians, for the blade mesh. */
  rotorAngle = 0;

  private readonly cfg: AirHandling;
  private readonly physics: PhysicsWorld;

  /** True while the gear is carrying weight. */
  private onGround = true;
  /** Ground height directly below, refreshed every step. */
  private groundY = 0;

  constructor(cfg: AirHandling, physics: PhysicsWorld) {
    this.cfg = cfg;
    this.physics = physics;
  }

  reset(position: THREE.Vector3, yaw: number): void {
    this.position.copy(position);
    this.quaternion.setFromAxisAngle(UP, yaw);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.rotorSpin = 0;
    this.rotorAngle = 0;
    this.onGround = true;
  }

  /** Airspeed along the nose, signed. */
  get forwardSpeed(): number {
    fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    return this.velocity.dot(fwd);
  }

  /**
   * Height above the ground directly below.
   *
   * groundY is -Infinity when the probe finds nothing (over a pit, or above
   * the probe's 9 m reach). Subtracting that yields Infinity, which smooths
   * to NaN in the HUD and prints "NaN" over the altimeter. Fall back to
   * height above the world origin plane, which is what a radar altimeter
   * with no return would show anyway.
   */
  get altitude(): number {
    if (!Number.isFinite(this.groundY)) return Math.max(0, this.position.y);
    return Math.max(0, this.position.y - this.groundY);
  }

  get grounded(): boolean { return this.onGround; }

  step(dt: number, input: VehicleInput, state: VehicleState): void {
    const cfg = this.cfg;
    const rotary = cfg.wing === 'rotary';

    // --- Orientation basis ---------------------------------------------------
    fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    right.set(1, 0, 0).applyQuaternion(this.quaternion);
    up.set(0, 1, 0).applyQuaternion(this.quaternion);

    // --- Ground probe --------------------------------------------------------
    // Cast from ABOVE the hull so an aircraft already intersecting the floor
    // still finds it. A probe starting at the origin of a half-sunk model
    // reports "no ground" and the thing falls through the world.
    tmp.copy(this.position).addScaledVector(UP, PROBE_HEIGHT);
    const hit = this.physics.castRayDistance(tmp, DOWN, PROBE_DEPTH);
    this.groundY = hit !== null
      ? this.position.y + PROBE_HEIGHT - hit
      : -Infinity;

    const restHeight = cfg.groundRestHeight ?? 0.4;
    const contactY = this.groundY + restHeight;

    // --- Engine spool --------------------------------------------------------
    // Collective (rotary) or throttle (fixed) demands power; the engine takes
    // time to deliver it. spoolRate is per second, so a 0.35 rate means ~3 s
    // from cold to full.
    const demand = rotary
      ? THREE.MathUtils.clamp(input.collective, 0, 1)
      : THREE.MathUtils.clamp(input.throttle, 0, 1);
    const spoolRate = cfg.spoolRate ?? 0.4;
    this.rotorSpin += THREE.MathUtils.clamp(
      demand - this.rotorSpin, -spoolRate * dt, spoolRate * dt,
    );
    this.rotorSpin = THREE.MathUtils.clamp(this.rotorSpin, 0, 1);
    this.rotorAngle += this.rotorSpin * (cfg.rotorRPM ?? 28) * dt;

    // --- Angular control -----------------------------------------------------
    // Rotary craft use ATTITUDE command, not rate command: stick deflection
    // asks for a bank/pitch ANGLE, and the model flies to it.
    //
    // This is the single most important choice in the whole model. A pure
    // rate command (stick = degrees per second) is what a real cyclic does,
    // but on a keyboard it means holding W loops the helicopter through the
    // vertical and it never settles at a useful attitude -- measured, the
    // aircraft tumbled continuously and made 7 m/s instead of 78. Attitude
    // command gives the player a stable, self-centring aircraft that holds
    // whatever bank they ask for and rolls level when they let go.
    //
    // Yaw stays a RATE, because that is genuinely how pedals behave.
    const airspeed = this.velocity.length();
    const authority = rotary
      ? this.rotorSpin
      : THREE.MathUtils.clamp(airspeed / Math.max(1, cfg.stallSpeed), 0, 1.4);

    if (rotary) {
      // Current attitude, read off the body basis.
      //   fwd.y   > 0  =>  nose up
      //   right.y > 0  =>  banked left (starboard wing high)
      const pitchAngle = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
      const bankAngle = Math.asin(THREE.MathUtils.clamp(right.y, -1, 1));

      // W (input.pitch = +1) tips the nose DOWN to accelerate forwards.
      const maxPitch = cfg.maxPitchAngle ?? 0.52;   // ~30 degrees
      const maxBank = cfg.maxBankAngle ?? 0.70;     // ~40 degrees
      const targetPitch = -input.pitch * maxPitch;
      const targetBank = input.roll * maxBank;

      // Proportional term, clamped to the configured rates so the aircraft
      // still takes a believable amount of time to roll.
      const kP = 2.4 * (cfg.stability > 0 ? cfg.stability : 1);
      const cmdPitch = THREE.MathUtils.clamp(
        (targetPitch - pitchAngle) * kP, -cfg.pitchRate, cfg.pitchRate,
      );
      const cmdBank = THREE.MathUtils.clamp(
        (targetBank - bankAngle) * kP, -cfg.rollRate, cfg.rollRate,
      );

      target.set(cmdPitch, input.yaw * cfg.yawRate, cmdBank)
        .multiplyScalar(authority);
    } else {
      // Fixed wing keeps rate command: aerobatic aircraft must be able to
      // roll continuously, and a pilot flying one expects exactly that.
      target.set(
        -input.pitch * cfg.pitchRate,
        input.yaw * cfg.yawRate,
        -input.roll * cfg.rollRate,
      ).multiplyScalar(authority);
    }

    // Approach the commanded rate rather than snapping to it; instant angular
    // velocity changes look like the airframe is being teleported. This also
    // supplies the derivative damping the attitude loop above needs.
    const responsiveness = 1 - Math.exp(-(cfg.controlResponse ?? 6) * dt);
    this.angularVelocity.lerp(target, responsiveness);

    // --- Self-levelling ------------------------------------------------------
    // Fixed wings are not attitude-commanded, so they still need an explicit
    // bleed back toward level when the stick is centred. Rotary craft get
    // this for free from the attitude loop.
    if (!rotary && cfg.stability > 0) {
      const rollErr = up.dot(right);
      const pitchErr = up.dot(fwd);
      const k = cfg.stability * dt;
      if (Math.abs(input.roll) < 0.05) this.angularVelocity.z -= rollErr * k;
      if (Math.abs(input.pitch) < 0.05) this.angularVelocity.x += pitchErr * k;
    }

    // Integrate orientation in the BODY frame, so pitch/yaw/roll compose the
    // way a pilot expects rather than around fixed world axes.
    if (this.angularVelocity.lengthSq() > 1e-9) {
      tmp.copy(this.angularVelocity).multiplyScalar(dt);
      const angle = tmp.length();
      spin.setFromAxisAngle(tmp.normalize(), angle);
      this.quaternion.multiply(spin).normalize();
      // Basis is stale after rotating.
      fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
      right.set(1, 0, 0).applyQuaternion(this.quaternion);
      up.set(0, 1, 0).applyQuaternion(this.quaternion);
    }

    // --- Accelerations -------------------------------------------------------
    // NOTE: this accumulator is in m/s^2, NOT newtons. maxThrust and
    // liftCoefficient are authored as accelerations so they can be compared
    // directly against gravity (a maxThrust of 16.5 is 1.68 g). Mixing a
    // force-based gravity term in here and dividing by mass at the end makes
    // lift `mass` times too small, which grounds the aircraft permanently.
    const accel = tmp.set(0, GRAVITY, 0);

    if (rotary) {
      // Thrust along the airframe's own up axis. Tilting the aircraft tilts
      // the thrust vector, which is exactly how a helicopter translates: no
      // separate "forward force" term is needed or wanted.
      // Thrust fades toward the service ceiling instead of stopping at an
      // invisible wall: thinner air, less rotor bite. At the ceiling the
      // aircraft can still hover but no longer climb.
      const ceiling = cfg.serviceCeiling ?? Infinity;
      const thin = THREE.MathUtils.clamp(
        1 - (this.position.y / ceiling) ** 2, 0, 1,
      );
      const hover = -GRAVITY;
      const lift = this.rotorSpin * (hover + (cfg.maxThrust - hover) * thin);
      accel.addScaledVector(up, lift);

      // Tail-rotor authority is part of yawRate above; cyclic drag is the
      // main thing left to model. Rotary craft bleed speed fast when the disc
      // is levelled, which is what makes them feel heavy.
      accel.addScaledVector(this.velocity, -cfg.dragCoefficient * airspeed);

      // Vertical drag is an order of magnitude stronger than horizontal, and
      // that is not a fudge: a helicopter climbing vertically is punching
      // through its own downwash, whereas in forward flight the disc keeps
      // meeting undisturbed air. Without this the aircraft climbs at the
      // sqrt of its excess thrust over the tiny forward-drag coefficient --
      // about 70 m/s, six times a real Black Hawk's rate.
      const vDrag = cfg.verticalDragCoefficient ?? 0.046;
      accel.y -= vDrag * this.velocity.y * Math.abs(this.velocity.y);
    } else {
      // Fixed wing: thrust forward, lift perpendicular to the wing, and lift
      // that COLLAPSES below stall speed.
      accel.addScaledVector(fwd, this.rotorSpin * cfg.maxThrust);

      const forwardAirspeed = Math.max(0, this.velocity.dot(fwd));
      const stallRatio = THREE.MathUtils.clamp(
        forwardAirspeed / Math.max(1, cfg.stallSpeed), 0, 1,
      );
      // Lift grows with the square of airspeed, scaled by how far above the
      // stall we are. Below the stall the wing simply stops working.
      const lift = cfg.liftCoefficient * forwardAirspeed * forwardAirspeed
        * stallRatio * stallRatio;
      accel.addScaledVector(up, lift);

      accel.addScaledVector(this.velocity, -cfg.dragCoefficient * airspeed);
    }

    this.velocity.addScaledVector(accel, dt);

    // --- Integrate -----------------------------------------------------------
    this.position.addScaledVector(this.velocity, dt);

    // --- Ground contact ------------------------------------------------------
    // Not a bounce: aircraft landing gear absorbs, it does not rebound. Clamp
    // to the rest height, kill downward velocity, and apply friction so a
    // landed aircraft does not slide off the pad.
    this.onGround = false;
    if (this.groundY > -Infinity && this.position.y <= contactY) {
      this.position.y = contactY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;

      // Ground friction, strong enough to stop a taxiing aircraft but not so
      // strong it locks a running takeoff.
      const friction = Math.exp(-(cfg.groundFriction ?? 2.4) * dt);
      this.velocity.x *= friction;
      this.velocity.z *= friction;

      // Settle toward level while sitting on the gear, so a helicopter parked
      // at an angle does not stay tilted forever.
      if (this.rotorSpin < 0.5) {
        tmpQ.setFromUnitVectors(up, UP);
        this.quaternion.premultiply(
          tmpQ.slerp(new THREE.Quaternion(), 1 - Math.min(1, dt * 3.0)),
        ).normalize();
        this.angularVelocity.multiplyScalar(Math.exp(-6 * dt));
      }
    }

    // --- Publish state -------------------------------------------------------
    state.velocity.copy(this.velocity);
    state.forwardSpeed = this.velocity.dot(fwd);
    state.throttleLoad = this.rotorSpin;
    state.grounded = this.onGround;
    state.altitude = this.altitude;
    state.medium = 'air';
    state.steerAngle = 0;
  }
}

export default AirHandlingModel;
