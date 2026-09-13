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
import { POSE_OFFSETS, SPRING_PROFILES } from '../utils/Constants';
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
    // --- layer 7a: state pose target (priority: tac > slide > sprint > crouch) ---
    let entry: OffsetEntry;
    if (input.isTacticalSprinting) {
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
      // §6.5: instant displacement (not via the spring), then the spring
      // pulls back to 0 — punchy kick, smooth settle.
      const k = Math.min(1, input.landingImpactVelocity * 0.02);
      this.landPos.displace(SETTLE_POS.clone().multiplyScalar(k));
      this.landRot.displace(SETTLE_ROT.clone().multiplyScalar(k));
    }
    this.landPos.update(dt, ZERO);
    this.landRot.update(dt, ZERO);

    // --- composition: simple additive sum (§6.1 layers 5-7 share one step) ---
    const p = this.statePos.value;
    const a = this.airPos.value;
    const l = this.landPos.value;
    this.offsets.posX = p.x + a.x + l.x;
    this.offsets.posY = p.y + a.y + l.y;
    this.offsets.posZ = p.z + a.z + l.z;
    const pr = this.stateRot.value;
    const ar = this.airRot.value;
    const lr = this.landRot.value;
    this.offsets.rotX = pr.x + ar.x + lr.x;
    this.offsets.rotY = pr.y + ar.y + lr.y;
    this.offsets.rotZ = pr.z + ar.z + lr.z;
    return this.offsets;
  }

  /** Weapon switch / test determinism. */
  reset(): void {
    this.statePos.reset();
    this.stateRot.reset();
    this.airPos.reset();
    this.airRot.reset();
    this.landPos.reset();
    this.landRot.reset();
  }
}

const ZERO = new THREE.Vector3(0, 0, 0);
/** §4.6 landing settle magnitudes (m / rad at a hard-threshold impact). */
const SETTLE_POS = new THREE.Vector3(0, -0.045, 0.02);
const SETTLE_ROT = new THREE.Vector3(0.09, 0, -0.05);

export default WeaponPoseOffsets;
