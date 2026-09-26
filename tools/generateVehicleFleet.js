#!/usr/bin/env node
/**
 * generateVehicleFleet.js — exports the drivable vehicle fleet as .glb.
 *
 *   node tools/generateVehicleFleet.js
 *
 * Separate from generateVehicleModels.js, which builds the KILLSTREAK props
 * (attack helicopter, UAV, guided missile). Those are flown by scripted
 * controllers and are not enterable; these are the player-drivable vehicles.
 *
 * TWO GATES RUN ON EVERY BUILD, and a failure is a non-zero exit:
 *
 *   1. NODE CONTRACT — each vehicle must expose the exact nodes the runtime
 *      drives (wheels, seats, sockets). A renamed node is otherwise a silent
 *      runtime null.
 *   2. TRIANGLE BUDGET — a hard per-vehicle cap. The previous generation of
 *      builders reached 256 KB of .glb for one helicopter by stacking boxes;
 *      this gate makes that regression impossible rather than merely
 *      discouraged.
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
      this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
      if (this.onloadend) this.onloadend();
    });
  }
}
globalThis.FileReader = globalThis.FileReader ?? FileReaderShim;

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'node:fs';
import path from 'node:path';
import { buildMilitaryCarPattern } from './builders/MilitaryCarBuilder.js';
import { buildHelicopterPattern } from './builders/HelicopterBuilder.js';

const OUT_DIR = 'assets/models/vehicles';
fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * Nodes the runtime resolves by name. Keep in sync with VehicleDefinitions.ts.
 */
const CONTRACTS = {
  military_car: [
    'Root_Vehicle',
    'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR',
    'Bone_SteeringWheel',
    'Socket_Seat_Driver', 'Socket_Seat_Passenger',
    'Socket_Seat_RearLeft', 'Socket_Seat_RearRight',
    'Socket_Door_Driver', 'Socket_Door_Passenger',
    'Socket_Door_RearLeft', 'Socket_Door_RearRight',
    'Socket_Exhaust',
  ],
  military_car_gunner: [
    'Root_Vehicle',
    'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR',
    'Bone_SteeringWheel',
    'Socket_Seat_Driver', 'Socket_Seat_Passenger',
    'Socket_Seat_RearLeft', 'Socket_Seat_RearRight',
    'Socket_Seat_Gunner',
    'Turret_Yaw', 'Turret_Pitch', 'Socket_Muzzle_Turret',
    'Socket_Exhaust',
  ],
  utility_helicopter: [
    'Root_Vehicle',
    'Rotor_Main', 'Rotor_Tail',
    'Blur_Main', 'Blur_Tail',
    'Rotor_MainBlades', 'Rotor_TailBlades',
    'Socket_Seat_Pilot', 'Socket_Seat_Copilot',
    'Socket_Seat_CrewLeft', 'Socket_Seat_CrewRight',
    'Socket_Door_Pilot', 'Socket_Door_Copilot',
    'Socket_Door_CrewLeft', 'Socket_Door_CrewRight',
    'Socket_Muzzle_DoorL', 'Socket_Muzzle_DoorR',
    'Socket_Exhaust_L', 'Socket_Exhaust_R',
    'Socket_RotorWash',
  ],
};

/** Hard triangle ceilings. Exceeding one fails the build. */
const TRI_BUDGET = {
  military_car: 3600,
  military_car_gunner: 4400,
  // A helicopter is a bigger airframe than a car and carries eight rotor
  // blades, so it gets more room -- but nothing like the 256 KB the old
  // box-stacked builder produced.
  utility_helicopter: 5200,
};

const VEHICLES = [
  { id: 'military_car', build: () => buildMilitaryCarPattern({ turret: false }) },
  { id: 'military_car_gunner', build: () => buildMilitaryCarPattern({ turret: true }) },
  { id: 'utility_helicopter', build: () => buildHelicopterPattern({ doorGuns: true }) },
];

function countTriangles(root) {
  let tris = 0;
  let meshes = 0;
  let materials = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    if (o.material) materials.add(o.material.uuid);
    const idx = o.geometry.getIndex();
    tris += idx ? idx.count / 3 : o.geometry.getAttribute('position').count / 3;
  });
  return { tris, meshes, materials: materials.size };
}

function checkContract(id, names) {
  const required = CONTRACTS[id] ?? [];
  return required.filter((n) => !names.has(n));
}

async function exportGLB(root, file) {
  const exporter = new GLTFExporter();
  const buffer = await new Promise((resolve, reject) => {
    // onlyVisible defaults to TRUE, which silently drops every node whose
    // .visible is false. Rotor blur discs ship hidden and are switched on at
    // speed by the runtime, so the default quietly exported a helicopter with
    // no blur geometry at all -- and the contract check passed, because it
    // inspected the in-memory scene rather than the file.
    exporter.parse(root, resolve, reject, { binary: true, onlyVisible: false });
  });
  fs.writeFileSync(file, Buffer.from(buffer));
  return fs.statSync(file).size;
}

/**
 * Re-read the written .glb and list its node names.
 *
 * The contract MUST be verified against the exported file, not the scene
 * graph it came from: the whole class of bug this gate exists to catch is
 * "the runtime cannot find a node", and the runtime only ever sees the file.
 */
function nodeNamesInGLB(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return new Set((json.nodes ?? []).map((n) => n.name).filter(Boolean));
}

let failed = false;
console.log('Building drivable vehicle fleet\n');

for (const v of VEHICLES) {
  const { root, stats } = v.build();
  root.updateMatrixWorld(true);

  const counted = countTriangles(root);
  const budget = TRI_BUDGET[v.id] ?? Infinity;

  const file = path.join(OUT_DIR, `${v.id}.glb`);
  const bytes = await exportGLB(root, file);

  // Verify against what actually landed on disk.
  const missing = checkContract(v.id, nodeNamesInGLB(file));

  const overBudget = counted.tris > budget;
  if (missing.length) {
    console.log(`  FAIL ${v.id}: missing nodes -> ${missing.join(', ')}`);
    failed = true;
  }
  if (overBudget) {
    console.log(`  FAIL ${v.id}: ${counted.tris} tris exceeds budget ${budget}`);
    failed = true;
  }
  const status = missing.length || overBudget ? 'FAIL' : 'ok  ';
  console.log(
    `  ${status} ${v.id.padEnd(22)} ${String(counted.tris).padStart(5)} tris `
    + `(budget ${budget})  ${counted.meshes} meshes  ${counted.materials} materials  `
    + `${(bytes / 1024).toFixed(1)} KB`,
  );
}

if (failed) {
  console.log('\nFLEET BUILD FAILED');
  process.exit(1);
}
console.log('\nFleet exported to', OUT_DIR);
