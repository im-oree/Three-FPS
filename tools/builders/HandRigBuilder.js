/**
 * HandRigBuilder.js — the procedural low-poly RIGID arm rig (Document A §3).
 * No skinning, no fingers: box segments on pivot Groups. Exported once by
 * tools/generateHandModel.js; the game only loads the exported .glb.
 */
import * as THREE from 'three';

export const DIMS = {
  shoulder: [0.16, 0.16, 0.16],
  upperArm: [0.12, 0.32, 0.12],
  forearm: [0.10, 0.28, 0.10],
  hand: [0.09, 0.11, 0.05],
  thumbNub: [0.03, 0.06, 0.03],
};

export const PALETTE = {
  skin: 0xd8a878,
  sleeve: 0x33361f,
  glove: 0x2a2a2e,
  gloveSleeve: 0x1c1e14,
};

function makeSegment(size, color) {
  const geo = new THREE.BoxGeometry(...size);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = -size[1] / 2; // hang below its pivot, like a real limb segment
  return mesh;
}

export function buildArmRig(side, { skinColor = PALETTE.skin, sleeveColor = PALETTE.sleeve } = {}) {
  const sign = side === 'R' ? 1 : -1;

  const shoulder = new THREE.Group();
  shoulder.name = `Shoulder_${side}`;
  shoulder.position.set(sign * 0.18, -0.04, -0.02);
  const shoulderMesh = makeSegment(DIMS.shoulder, sleeveColor);
  shoulderMesh.name = `ShoulderBlock_${side}`;
  shoulder.add(shoulderMesh);

  const upperArmPivot = new THREE.Group();
  upperArmPivot.name = `UpperArmPivot_${side}`;
  const upperArmMesh = makeSegment(DIMS.upperArm, sleeveColor);
  upperArmMesh.name = `UpperArmBlock_${side}`;
  upperArmPivot.add(upperArmMesh);
  shoulder.add(upperArmPivot);

  const elbowPivot = new THREE.Group();
  elbowPivot.name = `ElbowPivot_${side}`;
  elbowPivot.position.y = -DIMS.upperArm[1];
  const forearmMesh = makeSegment(DIMS.forearm, skinColor);
  forearmMesh.name = `ForearmBlock_${side}`;
  elbowPivot.add(forearmMesh);
  upperArmPivot.add(elbowPivot);

  const wristPivot = new THREE.Group();
  wristPivot.name = `WristPivot_${side}`;
  wristPivot.position.y = -DIMS.forearm[1];
  elbowPivot.add(wristPivot);

  const handMesh = makeSegment(DIMS.hand, skinColor);
  handMesh.name = `Hand_${side}`;
  wristPivot.add(handMesh);

  const thumbNub = makeSegment(DIMS.thumbNub, skinColor);
  thumbNub.name = `ThumbNub_${side}`;
  thumbNub.position.set(sign * -0.045, -0.02, 0.02);
  handMesh.add(thumbNub);

  const gripSocket = new THREE.Object3D();
  gripSocket.name = `Socket_HandGrip_${side}`;
  gripSocket.position.set(0, -DIMS.hand[1] * 0.65, 0.01);
  handMesh.add(gripSocket);

  return { shoulder, upperArmPivot, elbowPivot, wristPivot, handMesh, gripSocket,
    lengths: { upperArm: DIMS.upperArm[1], forearm: DIMS.forearm[1] } };
}

/** Full pair under a Torso_Reference empty (Document A §3.1). */
export function buildArmsRoot(variant = {}) {
  const root = new THREE.Group();
  root.name = 'ArmsRoot';
  const torso = new THREE.Group();
  torso.name = 'Torso_Reference';
  root.add(torso);
  const right = buildArmRig('R', variant);
  const left = buildArmRig('L', variant);
  torso.add(right.shoulder, left.shoulder);
  return { root, torso, right, left };
}
