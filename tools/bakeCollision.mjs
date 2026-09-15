#!/usr/bin/env node
/**
 * bakeCollision.mjs — export server collision geometry from the level data.
 *
 * The server needs to answer "can a capsule stand here" and "what does this
 * ray hit" without a renderer. Two of our level kinds describe geometry
 * differently:
 *
 *   - box levels  : LevelDefinition.boxes, already plain numbers
 *   - shell levels: COL_* nodes inside a .glb, which only THREE can read
 *
 * Rather than teach the server to parse glTF (which would drag a renderer
 * dependency into a headless process), this bakes both kinds down to the same
 * flat AABB list at build time. The server then loads one JSON shape and never
 * learns that shell levels existed.
 *
 * Per the project asset policy this is a real tool producing real files:
 *   node tools/bakeCollision.mjs   ->  assets/collision/<levelId>.json
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'assets/collision');
const SRC = path.join(ROOT, 'src/environment/LevelDefinition.ts');

// --- read the level definitions without importing the TS module ------------
// LevelDefinition.ts has zero imports and is pure data, so esbuild can turn it
// into something Node executes directly.
const { build } = await import('esbuild');
const tmp = path.join(OUT_DIR, '.levels.mjs');
fs.mkdirSync(OUT_DIR, { recursive: true });
await build({
  entryPoints: [SRC],
  outfile: tmp,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { LEVELS } = await import(`file://${tmp}?t=${Date.now()}`);
fs.unlinkSync(tmp);

/** Read a .glb from disk into a THREE scene. */
function loadGLB(file) {
  return new Promise((resolve, reject) => {
    const buffer = fs.readFileSync(file);
    // Copy into a clean ArrayBuffer: Node pools Buffer memory, and handing the
    // pooled backing store to the parser yields garbage for small files.
    const array = new Uint8Array(buffer).buffer.slice(0);
    new GLTFLoader().parse(array, '', (gltf) => resolve(gltf.scene), reject);
  });
}

const round = (n) => Math.round(n * 1000) / 1000;
let totalBoxes = 0;
const summary = [];

for (const level of LEVELS) {
  const boxes = [];

  // --- ground plane --------------------------------------------------------
  // The client renders this as an infinite-feeling plane; the server needs a
  // real slab or players fall through the world.
  if (!level.shellFile) {
    const half = level.groundHalfSize;
    boxes.push({
      minX: -half, minY: -1, minZ: -half,
      maxX: half, maxY: 0, maxZ: half,
      surface: level.groundSurface,
    });
  }

  // --- authored boxes ------------------------------------------------------
  for (const box of level.boxes ?? []) {
    boxes.push({
      minX: round(box.min[0]), minY: round(box.min[1]), minZ: round(box.min[2]),
      maxX: round(box.max[0]), maxY: round(box.max[1]), maxZ: round(box.max[2]),
      surface: box.surface,
    });
  }

  // --- shell collision nodes ----------------------------------------------
  if (level.shellFile) {
    const file = path.join(ROOT, level.shellFile.replace(/^\//, ''));
    if (!fs.existsSync(file)) {
      console.log(`  SKIP ${level.id}: ${level.shellFile} not found`);
      continue;
    }
    const scene = await loadGLB(file);
    scene.updateMatrixWorld(true);
    const nodes = [];
    scene.traverse((node) => { if (/^COL_/.test(node.name)) nodes.push(node); });

    for (const node of nodes) {
      // World-space AABB, matching exactly what LevelLoader registers at
      // runtime -- the server and the client must agree on what is solid.
      const bounds = new THREE.Box3().setFromObject(node);
      if (!Number.isFinite(bounds.min.x) || bounds.isEmpty()) continue;
      boxes.push({
        minX: round(bounds.min.x), minY: round(bounds.min.y), minZ: round(bounds.min.z),
        maxX: round(bounds.max.x), maxY: round(bounds.max.y), maxZ: round(bounds.max.z),
        surface: /^COL_Ground/.test(node.name) ? level.groundSurface : 'concrete',
      });
    }
  }

  const payload = {
    levelId: level.id,
    spawn: level.spawn.map(round),
    spawnYaw: level.spawnYaw,
    killPlaneY: level.killPlaneY ?? -25,
    boxes,
  };
  const outFile = path.join(OUT_DIR, `${level.id}.json`);
  fs.writeFileSync(outFile, JSON.stringify(payload));
  totalBoxes += boxes.length;
  summary.push({ level: level.id, boxes: boxes.length, kb: Math.round(fs.statSync(outFile).size / 1024) });
}

console.table(summary);
console.log(`Baked ${summary.length} levels, ${totalBoxes} collision boxes -> assets/collision/`);
