/**
 * generateBodyModel.js — builds the rigid low-poly THIRD-PERSON body rig ONCE
 * and saves it as a real .glb. The game only loads the file.
 *
 *   node tools/generateBodyModel.js
 *     -> assets/models/characters/body_standard.glb
 *
 * Validates the node contract src/character/ThirdPersonBody.ts depends on
 * before writing, so a broken export can never reach the game silently.
 */
// Node polyfill: GLTFExporter reads Blobs through FileReader.
class FileReaderShim {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      if (this.onloadend) this.onloadend();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(buf).toString('base64');
      if (this.onloadend) this.onloadend();
    });
  }
}
globalThis.FileReader = globalThis.FileReader ?? FileReaderShim;

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'node:fs';
import { buildBodyRig, BODY_PALETTE } from './builders/BodyRigBuilder.js';

/** Every node src/character/ThirdPersonBody.ts resolves by name. */
const REQUIRED_NODES = [
  'Root_Body',
  'Bone_Pelvis', 'Bone_Spine', 'Bone_Chest', 'Bone_Neck', 'Bone_Head',
  'Mesh_Head', 'Mesh_Helmet', 'Mesh_Neck',
  'Socket_Eyes', 'Socket_CameraPivot',
  'Shoulder_R', 'UpperArmPivot_R', 'ElbowPivot_R', 'WristPivot_R', 'Socket_HandGrip_R',
  'Shoulder_L', 'UpperArmPivot_L', 'ElbowPivot_L', 'WristPivot_L', 'Socket_HandGrip_L',
  'HipPivot_R', 'KneePivot_R', 'AnklePivot_R', 'Socket_Sole_R', 'Foot_R',
  'HipPivot_L', 'KneePivot_L', 'AnklePivot_L', 'Socket_Sole_L', 'Foot_L',
];

function validate(root) {
  const missing = REQUIRED_NODES.filter((name) => !root.getObjectByName(name));
  if (missing.length > 0) {
    console.error(`[generateBodyModel] MISSING required nodes: ${missing.join(', ')}`);
    process.exit(1);
  }
  // Sanity: the sole of each foot must sit on the ground plane (y ≈ 0) in the
  // rest pose, since the rig origin is feet-anchored to the capsule position.
  root.updateMatrixWorld(true);
  for (const side of ['R', 'L']) {
    const sole = root.getObjectByName(`Socket_Sole_${side}`);
    const y = sole.getWorldPosition(new THREE.Vector3()).y;
    if (Math.abs(y) > 0.02) {
      console.error(`[generateBodyModel] Socket_Sole_${side} rest height ${y.toFixed(3)} m — expected ~0 (feet-anchored origin)`);
      process.exit(1);
    }
  }
  const eyes = root.getObjectByName('Socket_Eyes').getWorldPosition(new THREE.Vector3());
  console.log(`[generateBodyModel] rest eye height ${eyes.y.toFixed(3)} m`);
}

function save(root, path) {
  const exporter = new GLTFExporter();
  exporter.parse(
    root,
    (gltf) => {
      fs.writeFileSync(path, Buffer.from(gltf));
      console.log(`[generateBodyModel] ${path} (${gltf.byteLength ?? gltf.length} bytes)`);
    },
    (err) => { console.error(err); process.exit(1); },
    { binary: true },
  );
}

const body = buildBodyRig();
validate(body.root);
save(body.root, 'assets/models/characters/body_standard.glb');
