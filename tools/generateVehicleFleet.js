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
};

/** Hard triangle ceilings. Exceeding one fails the build. */
const TRI_BUDGET = {
  military_car: 3600,
  military_car_gunner: 4400,
};

const VEHICLES = [
  { id: 'military_car', build: () => buildMilitaryCarPattern({ turret: false }) },
  { id: 'military_car_gunner', build: () => buildMilitaryCarPattern({ turret: true }) },
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

function checkContract(id, root) {
  const required = CONTRACTS[id] ?? [];
  const missing = required.filter((n) => !root.getObjectByName(n));
  return missing;
}

async function exportGLB(root, file) {
  const exporter = new GLTFExporter();
  const buffer = await new Promise((resolve, reject) => {
    exporter.parse(root, resolve, reject, { binary: true });
  });
  fs.writeFileSync(file, Buffer.from(buffer));
  return fs.statSync(file).size;
}

let failed = false;
console.log('Building drivable vehicle fleet\n');

for (const v of VEHICLES) {
  const { root, stats } = v.build();
  root.updateMatrixWorld(true);

  const counted = countTriangles(root);
  const missing = checkContract(v.id, root);
  const budget = TRI_BUDGET[v.id] ?? Infinity;

  const file = path.join(OUT_DIR, `${v.id}.glb`);
  const bytes = await exportGLB(root, file);

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
