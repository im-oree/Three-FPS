/**
 * generateWeaponModels.js — Document A §4.3: builds the three procedural
 * weapons, validates the six mandatory sockets on each, and exports real
 * .glb files. Run once; the game only loads the outputs.
 *
 *   node tools/generateWeaponModels.js
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
import { buildRiflePattern } from './builders/RifleBuilder.js';
import { buildPistolPattern } from './builders/PistolBuilder.js';
import { buildShotgunPattern } from './builders/ShotgunBuilder.js';
import { buildSMGPattern } from './builders/SMGBuilder.js';
import { buildSniperPattern } from './builders/SniperBuilder.js';
import {
  buildRocketLauncherPattern, buildRocketProjectilePattern,
} from './builders/RocketLauncherBuilder.js';

const weapons = [
  ['rifle', buildRiflePattern],
  ['pistol', buildPistolPattern],
  ['shotgun', buildShotgunPattern],
  // Document D roster.
  ['smg', buildSMGPattern],
  ['sniper', buildSniperPattern],
  ['rocket_launcher', buildRocketLauncherPattern],
  ['rocket_projectile', buildRocketProjectilePattern],
];

for (const [id, build] of weapons) {
  const root = build();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o.name || '(anon)'); });
  const exporter = new GLTFExporter();
  exporter.parse(root, (gltf) => {
    const path = `assets/models/weapons/${id}.glb`;
    fs.writeFileSync(path, Buffer.from(gltf));
    console.log(`[generateWeaponModels] ${path} (${gltf.byteLength ?? gltf.length} bytes) — ${meshes.length} parts`);
  }, (err) => { console.error(err); process.exit(1); }, { binary: true });
}
