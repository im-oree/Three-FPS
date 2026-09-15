/**
 * WeaponPoseOffsets.ts — movement-state → weapon pose offsets (Document 2.5
 * §4.7), the Animation Layer Stack's layer 7 (§6.1).
 *
 * Every offset target lives in Constants.POSE_OFFSETS; every spring constant
 * lives in Constants.SPRING_PROFILES (§11: nothing hardcoded inline). The
 * independent springs (state pose, air float, landing settle) are summed —
 * §6.5's "all SpringDamper outputs are summed together" — so, e.g., a slide
 * angle and a fresh landing settle visibly coexist without knowing of each
 * other.
 */
import * as THREE from 'three';
import cameraShake from '../camera/CameraShakeController';
import { FOOTSTEP, HAND_BOB, POSE_OFFSETS, SPRING_PROFILES } from '../utils/Constants';
import { degToRad } from '../utils/MathUtils';
import { SpringDamper3 } from '../utils/SpringDamper';
import type { PlayerStateValue } from '../player/PlayerState';
import { PlayerState } from '../player/PlayerState';

export interface PoseOffsetsInput {
  movementState: PlayerStateValue;
  isTacticalSprinting: boolean;
  /** Sprint-to-ready snap window active (§4.2) — punchy upward overlay. */
  isSnappingToReady: boolean;
  /** Landing event this frame (consumed by the caller from PlayerMovement). */
  landingImpactVelocity: number;
  /** Killstreak tablet raised (Document I §2.3) — deep low-ready hold. */
  tabletRaised?: boolean;
  /**
   * Document E §2: live travel speed + grounding, needed for the stride-
   * synced hand bob and the airborne micro-drift. Optional so legacy callers
   * compile; main's provider always sends them.
   */
  horizontalSpeed?: number;
  isGrounded?: boolean;
}

export interface PoseOffsets {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

type OffsetEntry = { pos: readonly number[]; rotDeg: readonly number[] };

function entryToTargets(entry: OffsetEntry, pos: THREE.Vector3, rot: THREE.Vector3): void {
  pos.set(entry.pos[0], entry.pos[1], entry.pos[2]);
  rot.set(degToRad(entry.rotDeg[0]), degToRad(entry.rotDeg[1]), degToRad(entry.rotDeg[2]));
}

export class WeaponPoseOffsets {
  private readonly statePos = new SpringDamper3(SPRING_PROFILES.poseState);
  private readonly stateRot = new SpringDamper3(SPRING_PROFILES.sprintLower);
  private readonly airPos = new SpringDamper3(SPRING_PROFILES.jumpFloat);
  private readonly airRot = new SpringDamper3(SPRING_PROFILES.jumpFloat);
  private readonly landPos = new SpringDamper3(SPRING_PROFILES.landSettle);
  private readonly landRot = new SpringDamper3(SPRING_PROFILES.landSettle);

  private readonly targetPos = new THREE.Vector3();
  private readonly targetRot = new THREE.Vector3();
  readonly offsets: PoseOffsets = { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0 };

  update(dt: number, input: PoseOffsetsInput): PoseOffsets {
    // --- layer 7a: state pose target (priority: tablet > tac > slide > sprint) ---
    let entry: OffsetEntry;
    if (input.tabletRaised) {
      // The laptop owns centre-frame; the weapon parks at a deep low-ready.
      entry = POSE_OFFSETS.TABLET;
    } else if (input.isTacticalSprinting) {
      entry = POSE_OFFSETS.TAC_SPRINT;
    } else if (input.movementState === PlayerState.SLIDE) {
      entry = POSE_OFFSETS.SLIDE;
    } else if (input.movementState === PlayerState.SPRINT) {
      entry = POSE_OFFSETS.SPRINT;
    } else if (
      input.movementState === PlayerState.CROUCH_IDLE
      || input.movementState === PlayerState.CROUCH_WALK
    ) {
      entry = POSE_OFFSETS.CROUCH;
    } else {
      entry = { pos: [0, 0, 0], rotDeg: [0, 0, 0] };
    }
    entryToTargets(entry, this.targetPos, this.targetRot);
    this.statePos.update(dt, this.targetPos);
    this.stateRot.update(dt, this.targetRot);

    // --- layer 7b: airborne float (§4.6) ---
    const airborne = input.movementState === PlayerState.JUMP || input.movementState === PlayerState.AIR;
    if (airborne) {
      entryToTargets(POSE_OFFSETS.AIR, this.targetPos, this.targetRot);
      this.airPos.update(dt, this.targetPos);
      this.airRot.update(dt, this.targetRot);
    } else {
      this.airPos.update(dt, ZERO);
      this.airRot.update(dt, ZERO);
    }

    // --- layer 7c: landing settle — hybrid instant-kick + spring recovery ---
    if (input.landingImpactVelocity > 0) {
      // §6.5 hybrid: instant displacement (not via the spring), then the
      // spring pulls back to 0 — punchy kick, smooth settle. Fired from the
      // SAME player:landed event as the camera dip and the trauma pulse, so
      // all three are frame-synchronised (Document E §2.7).
      const k = Math.min(1, input.landingImpactVelocity * 0.02);
      this.landPos.displace(SETTLE_POS.clone().multiplyScalar(k));
      this.landRot.displace(SETTLE_ROT.clone().multiplyScalar(k));
    }
    this.landPos.update(dt, ZERO);
    this.landRot.update(dt, ZERO);

    // --- layer 7d (Document E §2): stride-synced hand bob -------------------
    // The hands ride the SAME distance-driven cadence as FootstepSystem: one
    // lateral cycle and two vertical bumps per stride, so the visual bob peak
    // lands exactly on each audible footfall. Amplitude is per-gait
    // (HAND_BOB table), with a light ±10% noise wobble so no two strides are
    // pixel-identical — dead-even machinery is what makes static bobs read
    // fake, not amplitude.
    const speed = input.horizontalSpeed ?? 0;
    const grounded = input.isGrounded ?? true;
    const sliding = input.movementState === PlayerState.SLIDE;
    const walking = input.movementState !== PlayerState.IDLE
      && input.movementState !== PlayerState.CROUCH_IDLE;
    let amp = 0;
    let strideMeters: number = FOOTSTEP.STRIDE_WALK_METERS;
    if (grounded && !sliding && walking) {
      if (input.isTacticalSprinting) {
        amp = HAND_BOB.TAC_SPRINT_AMPLITUDE;
        strideMeters = FOOTSTEP.STRIDE_SPRINT_METERS;
      } else if (input.movementState === PlayerState.SPRINT) {
        amp = HAND_BOB.SPRINT_AMPLITUDE;
        strideMeters = FOOTSTEP.STRIDE_SPRINT_METERS;
      } else if (input.movementState === PlayerState.CROUCH_WALK) {
        amp = HAND_BOB.CROUCH_AMPLITUDE;
        strideMeters = FOOTSTEP.STRIDE_CROUCH_METERS;
      } else {
        amp = HAND_BOB.WALK_AMPLITUDE;
        strideMeters = FOOTSTEP.STRIDE_WALK_METERS;
      }
    }
    // Distance-driven phase: identical to HeadBob/FootstepSystem math at the
    // same gait, so footstep sound and hand-bob can never visibly desync.
    this.stridePhase += (speed * dt / strideMeters) * Math.PI * 2;
    // Blend amplitude on gait changes — no pop when sprint catching.
    const ampRate = 10;
    this.strideAmp += (amp - this.strideAmp) * (1 - Math.exp(-ampRate * dt));
    const wobble = 1 + 0.12 * cameraShake.sampleNoise(7, this.clock);
    this.clock += dt;
    const a2 = this.strideAmp * wobble;
    const bobVert = -Math.abs(Math.sin(this.stridePhase)) * a2;  // two bumps/stride
    const bobLat = Math.sin(this.stridePhase * 0.5) * a2 * 0.6;  // one lateral cycle
    this.bobRotX = bobVert;
    this.bobRotZ = bobLat * 0.8;
    this.bobPosY = bobVert * 0.35;
    this.bobPosX = bobLat * 0.25;

    // --- layer 7e (Document E §2.7): airborne micro-drift --------------------
    // No ground contact means no stride cycle: stride bob correctly reads 0
    // there, but perfectly frozen mid-air arms look DEAD. Swap in a quiet,
    // noise-driven drift instead — slow, smooth, subtle.
    let driftX = 0;
    let driftZ = 0;
    if (!grounded) {
      const t = this.clock * HAND_BOB.AIR_DRIFT_FREQUENCY;
      driftX = cameraShake.sampleNoise(8, t) * HAND_BOB.AIR_DRIFT_AMPLITUDE;
      driftZ = cameraShake.sampleNoise(9, t) * HAND_BOB.AIR_DRIFT_AMPLITUDE * 0.7;
    }

    // --- composition: simple additive sum (§6.1 layers 5-7 share one step) ---
    const p = this.statePos.value;
    const a = this.airPos.value;
    const l = this.landPos.value;
    this.offsets.posX = p.x + a.x + l.x + this.bobPosX;
    this.offsets.posY = p.y + a.y + l.y + this.bobPosY;
    this.offsets.posZ = p.z + a.z + l.z;
    const pr = this.stateRot.value;
    const ar = this.airRot.value;
    const lr = this.landRot.value;
    this.offsets.rotX = pr.x + ar.x + lr.x + this.bobRotX + driftX;
    this.offsets.rotY = pr.y + ar.y + lr.y;
    this.offsets.rotZ = pr.z + ar.z + lr.z + this.bobRotZ + driftZ;
    return this.offsets;
  }

  private stridePhase = 0;
  private strideAmp = 0;
  private clock = 0;
  private bobRotX = 0;
  private bobRotZ = 0;
  private bobPosX = 0;
  private bobPosY = 0;

  /** Weapon switch / test determinism. */
  reset(): void {
    this.statePos.reset();
    this.stateRot.reset();
    this.airPos.reset();
    this.airRot.reset();
    this.landPos.reset();
    this.landRot.reset();
    this.stridePhase = 0;
    this.strideAmp = 0;
    this.bobRotX = 0;
    this.bobRotZ = 0;
    this.bobPosX = 0;
    this.bobPosY = 0;
  }
}

const ZERO = new THREE.Vector3(0, 0, 0);
/** §4.6 landing settle magnitudes (m / rad at a hard-threshold impact). */
const SETTLE_POS = new THREE.Vector3(0, -0.045, 0.02);
const SETTLE_ROT = new THREE.Vector3(0.09, 0, -0.05);

export default WeaponPoseOffsets;
