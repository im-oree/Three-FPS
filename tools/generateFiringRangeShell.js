#!/usr/bin/env node
/**
 * generateFiringRangeShell.js — Document N §9: bakes Firing Range's shell.
 *
 *   node tools/generateFiringRangeShell.js
 *
 * Outputs (all real committed files, per the project's asset policy):
 *   assets/models/environment/firingrange_shell.glb       terrain + perimeter
 *   assets/environment-meta/firingrange_terrain.json      Rapier heightfield
 *   assets/environment-meta/firingrange_callouts.json     named zones
 *
 * Unlike Shipment's flat asphalt square, the ground here is a real heightfield
 * driven by an authored greyscale image, and the perimeter follows an
 * irregular polygon. Both come from shared toolkit functions
 * (TerrainHeightfieldBuilder, MapShellBuilder's polygon siblings) rather than
 * anything map-specific, and the plan itself comes from FiringRangeLayout.js
 * so nothing is authored twice.
 *
 * The terrain COLLIDER is NOT baked into the .glb: it ships as heightfield
 * data that LevelLoader hands to RAPIER.ColliderDesc.heightfield at load time,
 * matching how every other collider in this project is built (data -> desc).
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
import {
  buildIrregularPerimeter, buildOutOfBoundsBoundaryFromPolygon,
  buildDistantSkyline, computeKillPlaneY, ShellMaterials,
} from './lib/MapShellBuilder.js';
import {
  buildTerrainHeightfield, buildTerrainCollisionData,
} from './lib/TerrainHeightfieldBuilder.js';
import {
  MAP, BOUNDARY, PATHS, CALLOUTS, PERIMETER_OPENINGS, PERIMETER_WALL_KINDS,
  buildingFlatZones,
} from './lib/FiringRangeLayout.js';

const ENV_DIR = path.resolve('assets/models/environment');
const META_DIR = path.resolve('assets/environment-meta');
fs.mkdirSync(ENV_DIR, { recursive: true });
fs.mkdirSync(META_DIR, { recursive: true });

// Earth-bank material for the bermed boundary edges (jungle hillside).
const bermMaterial = new THREE.MeshStandardMaterial({
  color: 0x6b5a3c, roughness: 0.98, metalness: 0, flatShading: true,
});

console.log('[firingrange] building terrain heightfield...');
const terrain = buildTerrainHeightfield({
  width: MAP.terrainWidth,
  depth: MAP.terrainDepth,
  segments: 240,
  heightmapPath: path.resolve(MAP.heightmapPath),
  reference: MAP.heightmapReference,
  amplitude: MAP.heightmapAmplitude,
  boundaryPolygon: BOUNDARY,
  interiorFlatten: 0.1,
  interiorFalloff: 11,
  rimBerm: 3.1,
  rimFalloff: 18,
  pathSplines: PATHS,
  flatZones: buildingFlatZones(),
});

// ---- sanity: the playspace must actually be walkable ----------------------
{
  let maxAbs = 0;
  let maxSlope = 0;
  const step = 1.5;
  for (let x = -44; x <= 44; x += step) {
    for (let z = -36; z <= 44; z += step) {
      const y = terrain.heightAt(x, z);
      if (Math.abs(y) > maxAbs) maxAbs = Math.abs(y);
      const s = Math.max(
        Math.abs(terrain.heightAt(x + step, z) - y),
        Math.abs(terrain.heightAt(x, z + step) - y),
      ) / step;
      if (s > maxSlope) maxSlope = s;
    }
  }
  console.log(`[firingrange] playspace relief: max |y| = ${maxAbs.toFixed(2)} m, max slope = ${maxSlope.toFixed(2)}`);
}

const root = new THREE.Group();
root.name = 'FiringRangeShell';
const collisionRoot = new THREE.Group();
collisionRoot.name = 'FiringRangeCollision';

root.add(terrain.mesh);

// --- perimeter -------------------------------------------------------------
console.log('[firingrange] building irregular perimeter...');
const { group: perimeter, collisionMeshes: perimeterCols } = buildIrregularPerimeter({
  boundaryPoints: BOUNDARY,
  wallHeight: 1.4,
  fenceHeight: 1.85,
  thickness: 0.35,
  openings: PERIMETER_OPENINGS,
  wallKinds: PERIMETER_WALL_KINDS,
  bermMaterial,
});
// Seat every perimeter piece on the real terrain, not on y=0: the ground
// undulates outside the compound, and a wall floating over a dip is the most
// visible possible tell that terrain and architecture were built separately.
for (const child of perimeter.children) {
  child.position.y += terrain.heightAt(child.position.x, child.position.z) - 0.25;
}
root.add(perimeter);
for (const col of perimeterCols) {
  col.position.y += terrain.heightAt(col.position.x, col.position.z) - 0.25;
  collisionRoot.add(col);
}

// --- out of bounds ---------------------------------------------------------
for (const mesh of buildOutOfBoundsBoundaryFromPolygon({
  boundaryPoints: BOUNDARY, margin: 4.5, height: 40,
})) {
  collisionRoot.add(mesh);
}

// --- distant skyline -------------------------------------------------------
// Low, hazy silhouettes well beyond the boundary. Firing Range's reference
// shows a base perimeter and hills, not a dockyard, so this is deliberately
// sparse and short — the jungle treeline (props) does most of the sealing.
const skyline = buildDistantSkyline({
  innerRadius: 78, count: 22, minHeight: 2.5, maxHeight: 6, includeCranes: false, seed: 4242,
});
skyline.position.y = 1.5;
root.add(skyline);

root.add(collisionRoot);

// --- terrain collision data (consumed at load time by LevelLoader) ---------
console.log('[firingrange] baking terrain collision heightfield...');
const collisionData = buildTerrainCollisionData({
  width: MAP.terrainWidth,
  depth: MAP.terrainDepth,
  heightFn: terrain.heightFn,
  ncols: 128,
  nrows: 128,
});
{
  // Verify the decimated collider tracks the visual surface: a collider that
  // drifts from the mesh is how players end up walking in the air.
  let worst = 0;
  const { ncols, nrows } = collisionData;
  for (let i = 0; i < 400; i += 1) {
    const x = (Math.random() - 0.5) * 88;
    const z = (Math.random() - 0.5) * 80;
    const visual = terrain.heightAt(x, z);
    const u = (x / MAP.terrainWidth + 0.5) * ncols;
    const v = (z / MAP.terrainDepth + 0.5) * nrows;
    const c0 = Math.floor(u); const r0 = Math.floor(v);
    const fx = u - c0; const fz = v - r0;
    const at = (c, r) => collisionData.heights[
      Math.min(ncols, Math.max(0, c)) * (nrows + 1) + Math.min(nrows, Math.max(0, r))
    ];
    const approx = (at(c0, r0) * (1 - fx) + at(c0 + 1, r0) * fx) * (1 - fz)
      + (at(c0, r0 + 1) * (1 - fx) + at(c0 + 1, r0 + 1) * fx) * fz;
    worst = Math.max(worst, Math.abs(approx - visual));
  }
  console.log(`[firingrange] collider-vs-visual worst deviation: ${worst.toFixed(3)} m`);
}
fs.writeFileSync(
  path.join(META_DIR, 'firingrange_terrain.json'),
  JSON.stringify({
    width: MAP.terrainWidth,
    depth: MAP.terrainDepth,
    ...collisionData,
  }),
);
console.log('wrote assets/environment-meta/firingrange_terrain.json',
  `(${collisionData.heights.length} samples)`);

// --- callout zones ---------------------------------------------------------
fs.writeFileSync(
  path.join(META_DIR, 'firingrange_callouts.json'),
  `${JSON.stringify(CALLOUTS, null, 2)}\n`,
);
console.log(`wrote assets/environment-meta/firingrange_callouts.json (${CALLOUTS.length} zones)`);

// --- export ----------------------------------------------------------------
await new Promise((resolve) => {
  new GLTFExporter().parse(
    root,
    (gltf) => {
      const out = path.join(ENV_DIR, 'firingrange_shell.glb');
      fs.writeFileSync(out, Buffer.from(gltf));
      const kb = Math.round(gltf.byteLength / 1024);
      console.log(`wrote ${out} (${kb} KiB)`);
      console.log(`killPlaneY = ${computeKillPlaneY(-8, 25)} (baked into the level definition)`);
      resolve();
    },
    (err) => { console.error('shell export failed:', err); process.exit(1); },
    { binary: true },
  );
});

void ShellMaterials;
