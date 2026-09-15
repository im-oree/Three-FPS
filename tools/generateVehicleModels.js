#!/usr/bin/env node
/**
 * generateVehicleModels.js — Document H/I: exports the attack helicopter, the
 * reconnaissance UAV and the guided missile as real committed .glb files.
 *
 *   node tools/generateVehicleModels.js
 *
 * Same pipeline and asset policy as generateWeaponModels.js: the builders are
 * the source of truth, the .glb files are generated artefacts, and nothing is
 * constructed at runtime inside /src.
 */
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
import { buildHelicopterPattern } from './builders/HelicopterBuilder.js';
import { buildUAVPattern } from './builders/UAVBuilder.js';
import { buildMissilePattern } from './builders/MissileBuilder.js';
import { buildJetPattern } from './builders/JetBuilder.js';
import {
  buildSmokeGrenadePattern, buildStunGrenadePattern, buildFlashbangPattern,
  buildTabletPattern,
} from './builders/GrenadeBuilder.js';

const OUT_DIR = 'assets/models/vehicles';
const EQUIP_DIR = 'assets/models/equipment';
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(EQUIP_DIR, { recursive: true });

/** Nodes each vehicle MUST expose for the runtime to drive it. */
const CONTRACTS = {
  attack_helicopter: [
    'Root_Vehicle', 'Bone_MainRotorHub', 'Bone_TailRotorHub',
    'Socket_Pilot', 'Socket_Muzzle_R', 'Socket_Muzzle_L',
    'Socket_Hardpoint_R', 'Socket_Hardpoint_L',
  ],
  uav_drone: [
    'Root_Vehicle', 'Bone_PropHub', 'Socket_CameraGimbal', 'Socket_Exhaust',
  ],
  guided_missile: [
    'Root_Missile', 'Bone_SeekHead', 'Socket_Exhaust',
    'Socket_Detonation', 'Socket_NoseCam', 'Fin_0', 'Fin_1', 'Fin_2', 'Fin_3',
  ],
  fighter_jet: [
    'FighterJet', 'Fuselage', 'Canopy',
    'Socket_MissilePylon_L', 'Socket_MissilePylon_R',
    'Socket_Afterburner_L', 'Socket_Afterburner_R', 'Anchor_ChaseCam',
  ],
  killstreak_tablet: ['Root_Device', 'Screen', 'Socket_Grip'],
  smoke_grenade: ['Root_Throwable', 'Socket_Fuse'],
  stun_grenade: ['Root_Throwable', 'Socket_Fuse'],
  flashbang: ['Root_Throwable', 'Socket_Fuse'],
};

/** Which directory each id belongs in. */
const DIR_FOR = (id) => (
  ['smoke_grenade', 'stun_grenade', 'flashbang', 'killstreak_tablet'].includes(id)
    ? EQUIP_DIR : OUT_DIR
);

const vehicles = [
  ['attack_helicopter', () => buildHelicopterPattern().root],
  ['uav_drone', () => buildUAVPattern().root],
  ['guided_missile', () => buildMissilePattern().root],
  ['fighter_jet', () => buildJetPattern().root],
  ['killstreak_tablet', () => buildTabletPattern()],
  ['smoke_grenade', () => buildSmokeGrenadePattern()],
  ['stun_grenade', () => buildStunGrenadePattern()],
  ['flashbang', () => buildFlashbangPattern()],
];

let failed = false;

for (const [id, build] of vehicles) {
  const root = build();

  // Validate the node contract before export — a missing hub or socket is far
  // cheaper to catch here than as a silent no-op at runtime.
  const missing = CONTRACTS[id].filter((name) => !root.getObjectByName(name));
  if (missing.length) {
    console.error(`[generateVehicleModels] ${id} MISSING: ${missing.join(', ')}`);
    failed = true;
    continue;
  }

  let meshes = 0;
  root.traverse((o) => { if (o.isMesh) meshes += 1; });

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  const exporter = new GLTFExporter();
  exporter.parse(root, (gltf) => {
    const path = `${DIR_FOR(id)}/${id}.glb`;
    fs.writeFileSync(path, Buffer.from(gltf));
    console.log(
      `[generateVehicleModels] ${path} — ${meshes} parts, `
      + `${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} m, `
      + `${(gltf.byteLength ?? gltf.length) / 1024 | 0} KiB`,
    );
  }, (err) => { console.error(err); process.exit(1); }, { binary: true });
}

if (failed) process.exit(1);
