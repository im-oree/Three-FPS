/**
 * BodyRigBuilder.js — the procedural low-poly RIGID third-person body rig
 * (FPS/TPS Architectural Specification §1 "Invisible Master Skeleton").
 *
 * Same philosophy as HandRigBuilder: no skinning, no fingers, no DCC tool.
 * Box segments parented to pivot Groups; rotating a pivot swings everything
 * beneath it. Exported ONCE by tools/generateBodyModel.js — the running game
 * only ever loads the resulting .glb.
 *
 * The ARMS are built by HandRigBuilder.buildArmRig() with the IDENTICAL node
 * names the viewmodel rig uses (Shoulder_R / UpperArmPivot_R / ElbowPivot_R /
 * WristPivot_R / Socket_HandGrip_R). That is the whole point of the spec's
 * "one logical dataset, two visual rigs": the same JointIK solver, the same
 * spring system and the same resolved animation descriptors drive either rig
 * with zero special-casing.
 *
 * Origin convention: the rig's local origin is the FEET (y = 0 at the ground
 * plane) so the body can be positioned directly at PlayerMovement's capsule
 * position, which is also feet-anchored (COORDINATE_CONVENTIONS.md).
 * Local -Z is forward, matching the camera/weapon convention.
 */
import * as THREE from 'three';
import { buildArmRig, PALETTE as ARM_PALETTE } from './HandRigBuilder.js';

/** Segment dimensions [x, y, z] in metres. Total stature ≈ 1.8 m. */
export const BODY_DIMS = {
  pelvis: [0.30, 0.18, 0.20],
  spine: [0.32, 0.20, 0.21],
  chest: [0.38, 0.26, 0.23],
  neck: [0.11, 0.09, 0.11],
  head: [0.21, 0.23, 0.22],
  helmet: [0.24, 0.11, 0.25],
  thigh: [0.15, 0.42, 0.16],
  shin: [0.13, 0.40, 0.14],
  foot: [0.14, 0.09, 0.26],
};

/** Joint heights, measured from the feet (y = 0). */
export const BODY_JOINTS = {
  pelvisY: 0.94,
  hipOffsetX: 0.105,
  hipDropY: -0.04,
  spineY: 0.16,
  chestY: 0.17,
  neckY: 0.20,
  headY: 0.07,
  shoulderOffsetX: 0.20,
  shoulderY: 0.07,
  shoulderZ: 0.0,
};

export const BODY_PALETTE = {
  skin: ARM_PALETTE.skin,
  fatigues: 0x3a3f26,
  vest: 0x2c2f22,
  helmet: 0x24261c,
  boots: 0x16171a,
};

function makeSegment(size, color, name) {
  const geo = new THREE.BoxGeometry(...size);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.9, metalness: 0.0, flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A segment that hangs BELOW its pivot (limbs: thigh, shin). */
function makeHangingSegment(size, color, name) {
  const mesh = makeSegment(size, color, name);
  mesh.position.y = -size[1] / 2;
  return mesh;
}

/** A segment that rises ABOVE its pivot (spine stack). */
function makeRisingSegment(size, color, name) {
  const mesh = makeSegment(size, color, name);
  mesh.position.y = size[1] / 2;
  return mesh;
}

function buildLeg(side) {
  const sign = side === 'R' ? 1 : -1;

  const hip = new THREE.Group();
  hip.name = `HipPivot_${side}`;
  hip.position.set(sign * BODY_JOINTS.hipOffsetX, BODY_JOINTS.hipDropY, 0);
  hip.add(makeHangingSegment(BODY_DIMS.thigh, BODY_PALETTE.fatigues, `Thigh_${side}`));

  const knee = new THREE.Group();
  knee.name = `KneePivot_${side}`;
  knee.position.y = -BODY_DIMS.thigh[1];
  knee.add(makeHangingSegment(BODY_DIMS.shin, BODY_PALETTE.fatigues, `Shin_${side}`));
  hip.add(knee);

  const ankle = new THREE.Group();
  ankle.name = `AnklePivot_${side}`;
  ankle.position.y = -BODY_DIMS.shin[1];
  knee.add(ankle);

  // Foot sits forward of the ankle (toes point along -Z).
  const foot = makeSegment(BODY_DIMS.foot, BODY_PALETTE.boots, `Foot_${side}`);
  foot.position.set(0, -BODY_DIMS.foot[1] / 2, -0.05);
  ankle.add(foot);

  // Foot IK trace target: the sole contact point.
  const solePoint = new THREE.Object3D();
  solePoint.name = `Socket_Sole_${side}`;
  solePoint.position.set(0, -BODY_DIMS.foot[1], -0.05);
  ankle.add(solePoint);

  return { hip, knee, ankle, foot,
    lengths: { thigh: BODY_DIMS.thigh[1], shin: BODY_DIMS.shin[1] } };
}

/**
 * Build the full third-person body.
 *
 * Node contract consumed by src/character/ThirdPersonBody.ts:
 *   Root_Body, Bone_Pelvis, Bone_Spine, Bone_Chest, Bone_Neck, Bone_Head,
 *   Mesh_Head, Mesh_Helmet, Mesh_Neck            (the 1PS-masked set)
 *   Socket_Eyes                                   (1PS camera anchor)
 *   Socket_CameraPivot                            (3PS spring-arm origin)
 *   Shoulder_R/L ... WristPivot_R/L, Socket_HandGrip_R/L   (shared with the
 *                                                  viewmodel rig, by design)
 *   HipPivot_*, KneePivot_*, AnklePivot_*, Socket_Sole_*   (locomotion + foot IK)
 */
export function buildBodyRig({
  skinColor = BODY_PALETTE.skin,
  fatigueColor = BODY_PALETTE.fatigues,
  vestColor = BODY_PALETTE.vest,
  helmetColor = BODY_PALETTE.helmet,
} = {}) {
  const root = new THREE.Group();
  root.name = 'Root_Body';

  // --- spine stack ----------------------------------------------------------
  const pelvis = new THREE.Group();
  pelvis.name = 'Bone_Pelvis';
  pelvis.position.y = BODY_JOINTS.pelvisY;
  pelvis.add(makeRisingSegment(BODY_DIMS.pelvis, fatigueColor, 'Mesh_Pelvis'));
  root.add(pelvis);

  const spine = new THREE.Group();
  spine.name = 'Bone_Spine';
  spine.position.y = BODY_JOINTS.spineY;
  spine.add(makeRisingSegment(BODY_DIMS.spine, vestColor, 'Mesh_Spine'));
  pelvis.add(spine);

  const chest = new THREE.Group();
  chest.name = 'Bone_Chest';
  chest.position.y = BODY_JOINTS.chestY;
  chest.add(makeRisingSegment(BODY_DIMS.chest, vestColor, 'Mesh_Chest'));
  spine.add(chest);

  const neck = new THREE.Group();
  neck.name = 'Bone_Neck';
  neck.position.y = BODY_JOINTS.neckY;
  neck.add(makeRisingSegment(BODY_DIMS.neck, skinColor, 'Mesh_Neck'));
  chest.add(neck);

  const head = new THREE.Group();
  head.name = 'Bone_Head';
  head.position.y = BODY_JOINTS.headY;
  head.add(makeRisingSegment(BODY_DIMS.head, skinColor, 'Mesh_Head'));
  neck.add(head);

  const helmet = makeSegment(BODY_DIMS.helmet, helmetColor, 'Mesh_Helmet');
  helmet.position.y = BODY_DIMS.head[1] * 0.86;
  head.add(helmet);

  // 1PS camera anchor: inside the skull, at eye level, slightly forward.
  const eyes = new THREE.Object3D();
  eyes.name = 'Socket_Eyes';
  eyes.position.set(0, BODY_DIMS.head[1] * 0.62, -BODY_DIMS.head[2] * 0.18);
  head.add(eyes);

  // 3PS spring-arm origin: base of the neck, so the boom pivots around the
  // shoulders rather than the eyeballs (no nausea-inducing head-pivot orbit).
  const camPivot = new THREE.Object3D();
  camPivot.name = 'Socket_CameraPivot';
  camPivot.position.set(0, BODY_DIMS.chest[1] * 0.9, 0);
  chest.add(camPivot);

  // --- arms: the SAME builder + names as the first-person viewmodel rig ------
  const right = buildArmRig('R', { skinColor, sleeveColor: fatigueColor });
  const left = buildArmRig('L', { skinColor, sleeveColor: fatigueColor });
  for (const [arm, sign] of [[right, 1], [left, -1]]) {
    arm.shoulder.position.set(
      sign * BODY_JOINTS.shoulderOffsetX,
      BODY_JOINTS.shoulderY,
      BODY_JOINTS.shoulderZ,
    );
  }
  chest.add(right.shoulder, left.shoulder);

  // --- legs -----------------------------------------------------------------
  const legR = buildLeg('R');
  const legL = buildLeg('L');
  pelvis.add(legR.hip, legL.hip);

  return {
    root, pelvis, spine, chest, neck, head, helmet, eyes, camPivot,
    arms: { R: right, L: left },
    legs: { R: legR, L: legL },
  };
}
