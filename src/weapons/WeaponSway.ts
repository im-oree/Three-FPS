/**
 * WeaponSway.ts — procedural viewmodel feel (Document 3 §9 + the viewmodel
 * half of §10.2). Chosen home for BOTH additive viewmodel transforms:
 *   1. mouse-flick lag: spring-damped rotation chasing recent look deltas,
 *   2. idle breathing: slow low-amplitude sinusoidal drift when stationary,
 *   3. recoil viewmodel kick: exaggerated directional jolt per shot,
 *      spring-damped back to neutral (RECOIL.VIEWMODEL_KICK_*).
 * Everything is scaled by SWAY.ADS_SWAY_MULTIPLIER while ADS is active.
 * Pure offsets out; WeaponViewmodel applies them as the final rig tweak.
 */
import { RECOIL, SWAY } from '../utils/Constants';
import { clamp } from '../utils/MathUtils';

export interface SwayOffsets {
  rotX: number;
  rotY: number;
  rotZ: number;
  posX: number;
  posY: number;
  posZ: number;
}

export class WeaponSway {
  private lagX = 0;
  private lagY = 0;
  private lagVelX = 0;
  private lagVelY = 0;
  private kickPitch = 0;
  private kickYaw = 0;
  private kickVelPitch = 0;
  private kickVelYaw = 0;
  private breathPhase = 0;
  private strafeX = 0;
  private strafeZ = 0;
  private speedT = 0; // smoothed walk->sprint fraction driving the tuck
  readonly offsets: SwayOffsets = { rotX: 0, rotY: 0, rotZ: 0, posX: 0, posY: 0, posZ: 0 };

  /** RecoilSystem calls this per shot (degrees, viewmodel-exaggerated). */
  notifyKick(pitchDeg: number, yawDeg: number): void {
    const scale = RECOIL.VIEWMODEL_KICK_RECOVERY * RECOIL.VIEWMODEL_KICK_SCALE;
    this.kickVelPitch += ((pitchDeg * Math.PI) / 180) * scale;
    this.kickVelYaw += ((yawDeg * Math.PI) / 180) * scale;
  }

  update(
    dt: number,
    mouseDelta: { x: number; y: number },
    isADS: boolean,
    isStationary: boolean,
    localVelocity: { x: number; z: number } = { x: 0, z: 0 },
  ): SwayOffsets {
    const scale = isADS ? SWAY.ADS_SWAY_MULTIPLIER : 1;

    // 1) mouse lag: critically-damped-ish spring toward the look delta target.
    const targetX = clamp(-mouseDelta.x * SWAY.MOUSE_ROT_RAD_PER_PIXEL, -SWAY.CLAMP_RAD, SWAY.CLAMP_RAD);
    const targetY = clamp(-mouseDelta.y * SWAY.MOUSE_ROT_RAD_PER_PIXEL, -SWAY.CLAMP_RAD, SWAY.CLAMP_RAD);
    this.lagVelX += (targetX - this.lagX) * SWAY.SPRING * dt;
    this.lagVelY += (targetY - this.lagY) * SWAY.SPRING * dt;
    this.lagVelX *= Math.max(0, 1 - SWAY.DAMPING * dt);
    this.lagVelY *= Math.max(0, 1 - SWAY.DAMPING * dt);
    this.lagX += this.lagVelX * dt;
    this.lagY += this.lagVelY * dt;

    // 2) idle breathing drift.
    if (isStationary) this.breathPhase += dt * SWAY.BREATH_HZ * Math.PI * 2;
    const breath = isStationary ? Math.sin(this.breathPhase) * SWAY.BREATH_AMP_RAD : 0;

    // 3) recoil kick spring-back.
    this.kickVelPitch += -this.kickPitch * RECOIL.VIEWMODEL_KICK_RECOVERY * dt * SWAY.KICK_SPRING_MULTIPLIER;
    this.kickVelYaw += -this.kickYaw * RECOIL.VIEWMODEL_KICK_RECOVERY * dt * SWAY.KICK_SPRING_MULTIPLIER;
    this.kickVelPitch *= Math.max(0, 1 - RECOIL.VIEWMODEL_KICK_RECOVERY * dt * SWAY.KICK_DAMP_FACTOR);
    this.kickVelYaw *= Math.max(0, 1 - RECOIL.VIEWMODEL_KICK_RECOVERY * dt * SWAY.KICK_DAMP_FACTOR);
    this.kickPitch += this.kickVelPitch * dt;
    this.kickYaw += this.kickVelYaw * dt;

    this.offsets.rotX = (this.lagY + this.kickPitch) * scale;
    this.offsets.rotY = (this.lagX + this.kickYaw) * scale;
    this.offsets.rotZ = this.lagX * SWAY.ROTZ_FACTOR * scale;
    // 3) inertial strafe sway: the weapon hangs back opposite the body's
    //    camera-local velocity, exp-smoothed both in and out (weight).
    const strafeTargetX = clamp(
      -localVelocity.x * SWAY.STRAFE_POS_FACTOR, -SWAY.STRAFE_POS_MAX, SWAY.STRAFE_POS_MAX,
    );
    const strafeTargetZ = clamp(
      -localVelocity.z * SWAY.STRAFE_POS_FACTOR * SWAY.STRAFE_FWD_SHARE,
      -SWAY.STRAFE_POS_MAX, SWAY.STRAFE_POS_MAX,
    );
    const strafeLerp = 1 - Math.exp(-SWAY.STRAFE_SMOOTH * dt);
    this.strafeX += (strafeTargetX - this.strafeX) * strafeLerp;
    this.strafeZ += (strafeTargetZ - this.strafeZ) * strafeLerp;

    // 4) sprint tuck: speed-fraction blend (walk..sprint), exp-smoothed.
    const speed = Math.hypot(localVelocity.x, localVelocity.z);
    const tuckTarget = clamp(
      (speed - SWAY.TUCK_SPEED_START) / Math.max(0.001, SWAY.TUCK_SPEED_END - SWAY.TUCK_SPEED_START),
      0, 1,
    );
    this.speedT += (tuckTarget - this.speedT) * (1 - Math.exp(-SWAY.SPRINT_TUCK_SMOOTH * dt));

    this.offsets.posX = (this.lagX * SWAY.POS_FACTOR + this.strafeX + this.speedT * SWAY.SPRINT_TUCK.x) * scale;
    this.offsets.posY =
      (-this.lagY * SWAY.POS_FACTOR + breath * SWAY.BREATH_POS_FACTOR + this.speedT * SWAY.SPRINT_TUCK.y) * scale;
    // kick jolts the gun backward; strafe depth adds the forward/back hang
    this.offsets.posZ = (this.kickPitch * SWAY.POS_FACTOR * 3 + this.strafeZ) * scale;
    return this.offsets;
  }

  /** Drop all lag/kick state (weapon switch). */
  reset(): void {
    this.lagX = this.lagY = this.lagVelX = this.lagVelY = 0;
    this.kickPitch = this.kickYaw = this.kickVelPitch = this.kickVelYaw = 0;
  }
}

export default WeaponSway;
