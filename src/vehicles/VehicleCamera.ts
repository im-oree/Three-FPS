/**
 * VehicleCamera.ts — the GTA-style chase camera.
 *
 * The user's requirement is absolute: while in a vehicle the view is ALWAYS
 * third-person exterior, never a cockpit. So this does not integrate with
 * PerspectiveController's FIRST/THIRD toggle at all — it takes over the
 * camera outright for the duration and hands it back on exit.
 *
 * WHY A SPRING BOOM AND NOT A PARENTED CAMERA
 * A camera parented to the vehicle is rigid: the world appears to rotate
 * about the player during every turn, which reads as the world spinning
 * rather than the car turning, and is a well-known nausea trigger. Instead
 * the boom has its own yaw that CHASES the vehicle's heading. During a turn
 * the car visibly rotates within the frame and the camera catches up a
 * moment later, which is what sells the turn.
 *
 * Collision: the boom is raycast against the world each frame and pulled in
 * on contact, so reversing into a wall pushes the camera forward rather than
 * putting it inside the wall.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Vehicle } from './Vehicle';
import type { VehicleCameraConfig } from './VehicleTypes';

const UP = new THREE.Vector3(0, 1, 0);

export class VehicleCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly physics: PhysicsWorld;

  /** Current boom yaw/pitch in world space. */
  private yaw = 0;
  private pitch = 0.12;
  /** Smoothed camera position, so the boom itself has inertia. */
  private readonly smoothed = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private config: VehicleCameraConfig | null = null;
  private active = false;
  private baseFov = 75;
  /** Set true on the first frame so the camera snaps instead of sweeping in. */
  private needsSnap = true;

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpOffset = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, physics: PhysicsWorld) {
    this.camera = camera;
    this.physics = physics;
  }

  get isActive(): boolean { return this.active; }

  /**
   * Take control of the camera.
   *
   * @param startYaw the vehicle's heading, so the camera begins behind it
   *                 rather than sweeping around from wherever the player
   *                 happened to be looking.
   */
  enter(config: VehicleCameraConfig, startYaw: number): void {
    this.config = config;
    this.active = true;
    this.needsSnap = true;
    this.yaw = startYaw;
    this.pitch = 0.12;
    this.baseFov = this.camera.fov;
  }

  /** Hand the camera back. The caller restores its own orientation. */
  exit(): void {
    this.active = false;
    this.config = null;
    if (this.camera.fov !== this.baseFov) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Swap boom parameters without a snap — used when changing seats. */
  setConfig(config: VehicleCameraConfig): void { this.config = config; }

  /**
   * @param lookDelta mouse delta in radians, applied when the seat allows free look.
   */
  update(dt: number, vehicle: Vehicle, lookDeltaYaw: number, lookDeltaPitch: number): void {
    const cfg = this.config;
    if (!this.active || !cfg) return;

    const vehYaw = vehicle.yaw;

    if (cfg.freeLook) {
      // Passenger/gunner: the player orbits freely and the boom does not
      // self-align, so they can watch the road behind while the car drives on.
      this.yaw -= lookDeltaYaw;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - lookDeltaPitch, cfg.pitchMin, cfg.pitchMax,
      );
    } else {
      // Driver: the boom chases the vehicle's heading along the SHORTEST
      // angular path. Lerping raw angles makes the camera take the long way
      // round whenever the heading crosses +/-PI.
      let delta = vehYaw - this.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));

      // Reversing inverts the intent: the player wants to see where they are
      // going, so the boom aligns to the BACK of the car below a small
      // negative speed threshold.
      if (vehicle.state.forwardSpeed < -1.2) {
        let rev = (vehYaw + Math.PI) - this.yaw;
        rev = Math.atan2(Math.sin(rev), Math.cos(rev));
        delta = rev;
      }

      const rate = 1 - Math.exp(-cfg.alignRate * dt);
      this.yaw += delta * rate;
      this.pitch = THREE.MathUtils.damp(this.pitch, 0.14, 4, dt);
    }

    // --- Desired boom position --------------------------------------------
    const speed = Math.abs(vehicle.state.forwardSpeed);
    const distance = cfg.distance + speed * cfg.distancePerSpeed;

    const anchor = vehicle.getPosition(this.tmpPos).clone();
    anchor.y += cfg.height;

    const cosP = Math.cos(this.pitch);
    this.tmpOffset.set(
      Math.sin(this.yaw) * cosP,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosP,
    ).multiplyScalar(distance);

    const desired = anchor.clone().add(this.tmpOffset);

    // --- Boom collision ----------------------------------------------------
    // Cast from the anchor outward; if something is in the way, sit just in
    // front of it. The 0.35 m margin keeps the near plane out of the surface.
    this.tmpDir.copy(desired).sub(anchor);
    const boomLen = this.tmpDir.length();
    if (boomLen > 1e-3) {
      this.tmpDir.divideScalar(boomLen);
      const hit = this.physics.castRayDistance(anchor, this.tmpDir, boomLen);
      if (hit !== null && hit < boomLen) {
        desired.copy(anchor).addScaledVector(this.tmpDir, Math.max(1.2, hit - 0.35));
      }
    }

    // --- Smoothing ---------------------------------------------------------
    if (this.needsSnap) {
      this.smoothed.copy(desired);
      this.needsSnap = false;
    } else {
      const k = 1 - Math.exp(-cfg.stiffness * dt);
      this.smoothed.lerp(desired, k);
    }

    this.camera.position.copy(this.smoothed);

    // Look slightly ahead of the vehicle rather than at its origin, so the
    // road ahead gets more of the frame than the bonnet does.
    const forward = vehicle.getForward(this.tmpDir);
    this.lookTarget.copy(vehicle.getPosition(this.tmpPos));
    this.lookTarget.y += cfg.lookHeight;
    this.lookTarget.addScaledVector(forward, Math.min(6, speed * 0.25));
    this.camera.up.copy(UP);
    this.camera.lookAt(this.lookTarget);

    // --- Speed FOV ---------------------------------------------------------
    // A widening FOV is the cheapest and strongest speed cue there is.
    const speedFrac = THREE.MathUtils.clamp(speed / 30, 0, 1);
    const targetFov = cfg.fov + cfg.fovBoost * speedFrac * speedFrac;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Where the camera currently sits — used to restore the player's view. */
  get currentYaw(): number { return this.yaw; }
  get currentPitch(): number { return this.pitch; }
}

export default VehicleCamera;
