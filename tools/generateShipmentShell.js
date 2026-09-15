#!/usr/bin/env node
/**
 * generateShipmentShell.js — Document L §3: builds shipment_shell.glb
 * (ground + perimeter + out-of-bounds + distant dressing) using the shared
 * tools/lib/MapShellBuilder.js toolkit, and prints the killPlaneY metadata
 * value that ships inside the level definition.
 *
 *   node tools/generateShipmentShell.js
 *
 * Shipment is the classic fully-SEALED container yard (per the CoD4/MW2019
 * minimap references): the rectangular perimeter surrounds the playable
 * square with no lane openings — the shell builder's gaps stay unused here
 * (they exist for maps that want open entries).
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
import path from 'node:path';
import {
  buildGroundPlane, buildRectangularPerimeter, buildOutOfBoundsBoundary,
  buildDistantSkyline, computeKillPlaneY,
} from './lib/MapShellBuilder.js';

const OUT_DIR = path.resolve('assets/models/environment');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Classic Shipment playable square: ~55 m of fenced yard.
const MAP_WIDTH = 55, MAP_DEPTH = 55;
const WALL_HEIGHT = 1.35, FENCE_HEIGHT = 1.75, WALL_THICKNESS = 0.35;

function buildShipmentShell() {
  const root = new THREE.Group();
  root.name = 'ShipmentShell';
  const collisionRoot = new THREE.Group();
  collisionRoot.name = 'ShipmentCollision';

  const { group: ground, collisionMesh: groundCol } = buildGroundPlane({
    width: MAP_WIDTH, depth: MAP_DEPTH, segments: 30, jitterAmount: 0.02,
  });
  root.add(ground);
  collisionRoot.add(groundCol);

  const { group: perimeter, collisionMeshes: perimeterCols } = buildRectangularPerimeter({
    width: MAP_WIDTH, depth: MAP_DEPTH,
    wallHeight: WALL_HEIGHT, fenceHeight: FENCE_HEIGHT, thickness: WALL_THICKNESS,
    openings: [],
  });
  root.add(perimeter);
  for (const c of perimeterCols) collisionRoot.add(c);

  for (const c of buildOutOfBoundsBoundary({
    width: MAP_WIDTH, depth: MAP_DEPTH, margin: 3, height: 25,
  })) collisionRoot.add(c);

  const skyline = buildDistantSkyline({
    innerRadius: MAP_WIDTH / 2 + 14, count: 30, minHeight: 4, maxHeight: 13,
  });
  root.add(skyline); // visual root ONLY

  root.add(collisionRoot);
  return { root, killPlaneY: computeKillPlaneY(0, 25) };
}

const { root, killPlaneY } = buildShipmentShell();
await new Promise((resolve) => {
  new GLTFExporter().parse(
    root,
    (gltf) => {
      fs.writeFileSync(path.join(OUT_DIR, 'shipment_shell.glb'), Buffer.from(gltf));
      console.log('wrote', path.join(OUT_DIR, 'shipment_shell.glb'));
      console.log(`killPlaneY = ${killPlaneY}  (baked into the shipment level definition)`);
      resolve();
    },
    (err) => { console.error('shell export failed:', err); process.exit(1); },
    { binary: true },
  );
});
