#!/usr/bin/env node
/**
 * generateFiringRangeProps.js — Document N §3/§4/§5: exports every Firing
 * Range building, prop and plant as a real committed .glb, plus the sidecar
 * collider JSON each building's PropCatalog entry lazy-loads.
 *
 *   node tools/generateFiringRangeProps.js
 *
 * Sibling to Document K's generatePropModels.js; identical pipeline and asset
 * policy (builders are the source of truth, .glb files are artefacts, nothing
 * is constructed at runtime inside /src). Shipment's props are untouched —
 * these are purely additive.
 *
 * Buildings are the one case where a tool's output includes catalog METADATA
 * as well as geometry: their compound colliders are derived from the assembled
 * panel hierarchy at build time (generateBuildingCompoundCollider) and written
 * to assets/environment-meta/collider_data/<key>.json, because PropCatalog is
 * a runtime module that needs static data, not a live Three.js traversal.
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
import { BuildingRecipes } from './lib/BuildingRecipes.js';
import { KitMaterials } from './lib/BuildingKit.js';
import {
  generateBuildingCompoundCollider, colliderBounds,
} from './lib/BuildingColliderGenerator.js';
import {
  buildPalmTree, buildJungleTree, buildJungleBush, buildGrassTuft,
} from './lib/VegetationBuilder.js';

const OUT_DIR = path.resolve('assets/models/props');
const COLLIDER_DIR = path.resolve('assets/environment-meta/collider_data');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(COLLIDER_DIR, { recursive: true });

const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, ...o });
const matOlive = std({ color: 0x3e4526, roughness: 0.8, metalness: 0.1 });
const matOliveDark = std({ color: 0x2f3520, roughness: 0.85, metalness: 0.1 });
const matRubber = std({ color: 0x1d1f20, roughness: 0.95, metalness: 0.0 });
const matGunmetal = std({ color: 0x2b2e30, roughness: 0.6, metalness: 0.6 });
const matGlass = std({ color: 0x38474d, roughness: 0.25, metalness: 0.4 });
const matTargetBoard = std({ color: 0x8c7c5e, roughness: 0.95, metalness: 0.0 });
const matTargetPaint = std({ color: 0x232323, roughness: 0.95, metalness: 0.0 });
const matCorrugated = KitMaterials.corrugatedTin;
const matCorrugatedRust = KitMaterials.corrugatedTinRust;
const matWood = KitMaterials.frameWood;
const matSandbag = KitMaterials.sandbag;
const matAmmoCrate = std({ color: 0x4a5130, roughness: 0.88, metalness: 0.05 });

function exportGLB(object3D, filename) {
  return new Promise((resolve) => {
    new GLTFExporter().parse(
      object3D,
      (gltf) => {
        fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(gltf));
        console.log('wrote', filename, `(${Math.round(gltf.byteLength / 1024)} KiB)`);
        resolve();
      },
      (err) => { console.error(filename, err); process.exit(1); },
      { binary: true },
    );
  });
}

/** Buildings: geometry .glb + sidecar collider JSON, derived from the recipe. */
async function exportBuilding(buildFn, glbName, catalogKey) {
  const model = buildFn();
  const shapes = generateBuildingCompoundCollider(model);
  const bounds = colliderBounds(shapes);
  fs.writeFileSync(
    path.join(COLLIDER_DIR, `${catalogKey}.json`),
    `${JSON.stringify(shapes)}\n`,
  );
  const size = bounds.getSize(new THREE.Vector3());
  console.log(
    `  ${catalogKey.padEnd(26)} ${String(shapes.length).padStart(3)} collider shapes`
    + `  ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)} m`,
  );
  await exportGLB(model, glbName);
}

// ===========================================================================
// PROPS — the Firing Range set-dressing vocabulary
// ===========================================================================

/** Military jeep — the vehicle parked in the sandbag nest at mid. */
function buildJeep() {
  const root = new THREE.Group();
  root.name = 'JeepMilitary';

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.62, 3.5), matOlive);
  body.position.y = 0.72;
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 1.75), matOliveDark);
  tub.position.set(0, 1.12, -0.75);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.34, 1.25), matOlive);
  hood.position.set(0, 1.12, 1.15);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.1), matGunmetal);
  grille.position.set(0, 1.0, 1.78);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.62, 0.07), matGlass);
  windshield.position.set(0, 1.62, 0.45);
  windshield.rotation.x = -0.28;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.72, 0.1), matOliveDark);
  frame.position.set(0, 1.6, 0.42);
  frame.rotation.x = -0.28;
  const seatL = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.55), matOliveDark);
  seatL.position.set(-0.4, 1.35, -0.3);
  const seatR = seatL.clone();
  seatR.position.x = 0.4;
  const rollBar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.09), matGunmetal);
  rollBar.position.set(0, 1.95, -1.2);
  for (const sx of [-1, 1]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), matGunmetal);
    upright.position.set(sx * 0.74, 1.55, -1.2);
    root.add(upright);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.32, 8);
  for (const [wx, wz] of [[-0.9, 1.15], [0.9, 1.15], [-0.9, -1.2], [0.9, -1.2]]) {
    const wheel = new THREE.Mesh(wheelGeo, matRubber);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.42, wz);
    const hub = new THREE.Mesh(hubGeo, matGunmetal);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx * 1.03, 0.42, wz);
    root.add(wheel, hub);
  }
  const spare = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.14, 6, 12), matRubber);
  spare.position.set(0, 1.0, -1.85);
  spare.rotation.y = Math.PI / 2;
  const jerry = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.46, 0.34), matOliveDark);
  jerry.position.set(-0.85, 1.25, -1.5);
  root.add(body, tub, hood, grille, windshield, frame, seatL, seatR, rollBar, spare, jerry);
  for (const child of root.children) { child.castShadow = true; child.receiveShadow = true; }
  return root;
}

/** Tire stack — the "Tyres" callout landmark. */
function buildTireStack() {
  const root = new THREE.Group();
  root.name = 'TireStack';
  const tireGeo = new THREE.TorusGeometry(0.44, 0.17, 7, 14);
  for (let i = 0; i < 5; i += 1) {
    const tire = new THREE.Mesh(tireGeo, matRubber);
    tire.rotation.x = Math.PI / 2;
    tire.rotation.z = i * 0.4;
    tire.position.set((i % 2) * 0.05, i * 0.3 + 0.17, (i % 3) * 0.04);
    tire.castShadow = true;
    tire.receiveShadow = true;
    root.add(tire);
  }
  return root;
}

/** Corrugated tunnel culvert — the hollow pipe players run through. */
function buildTunnelCulvert() {
  const root = new THREE.Group();
  root.name = 'TunnelCulvert';
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 7.2, 16, 1, true),
    matCorrugatedRust.clone(),
  );
  pipe.material.side = THREE.DoubleSide;
  pipe.rotation.x = Math.PI / 2;
  pipe.position.y = 1.5;
  pipe.castShadow = true;
  pipe.receiveShadow = true;
  root.add(pipe);
  // Corrugation rings.
  for (let i = 0; i <= 12; i += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.05, 4, 14), matCorrugatedRust);
    ring.position.set(0, 1.5, -3.6 + i * 0.6);
    root.add(ring);
  }
  // End collars.
  for (const z of [-3.6, 3.6]) {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.1, 5, 16), matCorrugated);
    collar.position.set(0, 1.5, z);
    collar.castShadow = true;
    root.add(collar);
  }
  return root;
}

/** Flatbed trailer — the "Trailer" callout. */
function buildTrailerFlatbed() {
  const root = new THREE.Group();
  root.name = 'TrailerFlatbed';
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.22, 6.4), matWood);
  deck.position.y = 1.0;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.24, 6.6), matGunmetal);
  frame.position.y = 0.8;
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 6.4), matGunmetal);
    rail.position.set(sx * 1.1, 1.3, 0);
    root.add(rail);
  }
  const axleGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.1, 8);
  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.3, 12);
  for (const z of [1.6, -1.6]) {
    const axle = new THREE.Mesh(axleGeo, matGunmetal);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.44, z);
    root.add(axle);
    for (const sx of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, matRubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 1.05, 0.44, z);
      wheel.castShadow = true;
      root.add(wheel);
    }
  }
  const hitch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.4), matGunmetal);
  hitch.position.set(0, 0.85, 3.7);
  const jack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), matGunmetal);
  jack.position.set(0, 0.4, 3.3);
  root.add(deck, frame, hitch, jack);
  for (const child of root.children) { child.castShadow = true; child.receiveShadow = true; }
  return root;
}

/**
 * Human-silhouette practice target on a stand — thematically the whole point
 * of a firing range. Built as extruded flat geometry so it reads as a
 * silhouette with no texture map (project low-poly / no-texture-budget policy).
 */
function buildTargetSilhouette() {
  const root = new THREE.Group();
  root.name = 'TargetSilhouette';
  const shape = new THREE.Shape();
  shape.moveTo(-0.22, 0);
  shape.lineTo(-0.2, 0.62);
  shape.lineTo(-0.34, 0.68);
  shape.lineTo(-0.36, 0.86);
  shape.lineTo(-0.16, 0.84);
  shape.lineTo(-0.13, 1.02);
  shape.absarc(0, 1.13, 0.155, Math.PI, 0, true);
  shape.lineTo(0.13, 1.02);
  shape.lineTo(0.16, 0.84);
  shape.lineTo(0.36, 0.86);
  shape.lineTo(0.34, 0.68);
  shape.lineTo(0.2, 0.62);
  shape.lineTo(0.22, 0);
  shape.closePath();
  const board = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false }), matTargetBoard,
  );
  board.position.y = 0.55;
  board.castShadow = true;
  board.receiveShadow = true;
  // Painted scoring rings on the chest.
  for (let i = 0; i < 3; i += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.06 + i * 0.05, 0.012, 4, 14), matTargetPaint,
    );
    ring.position.set(0, 1.15, 0.045);
    root.add(ring);
  }
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.62, 0.09), matWood);
  post.position.y = 0.3;
  const footA = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.1), matWood);
  footA.position.y = 0.05;
  const footB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.6), matWood);
  footB.position.y = 0.05;
  root.add(board, post, footA, footB);
  for (const child of root.children) child.castShadow = true;
  return root;
}

/** Ammo crate stack — olive-drab wooden boxes. */
function buildAmmoCrateStack() {
  const root = new THREE.Group();
  root.name = 'AmmoCrateStack';
  const layout = [
    [0, 0.22, 0, 0.05], [0.06, 0.66, 0.04, -0.12], [-0.05, 1.1, -0.06, 0.2],
  ];
  for (const [x, y, z, yaw] of layout) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.42, 0.6), matAmmoCrate);
    crate.position.set(x, y, z);
    crate.rotation.y = yaw;
    crate.castShadow = true;
    crate.receiveShadow = true;
    root.add(crate);
    for (const sx of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.62), matGunmetal);
      band.position.set(x + sx * 0.36, y, z);
      band.rotation.y = yaw;
      root.add(band);
    }
  }
  return root;
}

/** Fuel drum cluster — the blue/rust barrels seen against every wall. */
function buildFuelDrumCluster() {
  const root = new THREE.Group();
  root.name = 'FuelDrumCluster';
  const matDrumBlue = std({ color: 0x2f4f5e, roughness: 0.65, metalness: 0.4 });
  const matDrumRust = std({ color: 0x5e3a28, roughness: 0.8, metalness: 0.3 });
  const layout = [
    [0, 0, 0, matDrumBlue], [0.66, 0, 0.14, matDrumRust],
    [0.3, 0, 0.72, matDrumBlue], [0.32, 0.9, 0.3, matDrumRust],
  ];
  for (const [x, y, z, mat] of layout) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 12), mat);
    drum.position.set(x, y + 0.44, z);
    drum.castShadow = true;
    drum.receiveShadow = true;
    root.add(drum);
    for (const ry of [-0.22, 0.22]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.025, 4, 12), mat);
      rib.rotation.x = Math.PI / 2;
      rib.position.set(x, y + 0.44 + ry, z);
      root.add(rib);
    }
  }
  return root;
}

/** Sandbag nest — the free-standing sandbag cover at mid. */
function buildSandbagNest() {
  const root = new THREE.Group();
  root.name = 'SandbagNest';
  const bagGeo = new THREE.SphereGeometry(0.26, 6, 4);
  bagGeo.scale(1.4, 0.7, 1.0);
  for (let row = 0; row < 3; row += 1) {
    const count = 6 - row;
    for (let i = 0; i < count; i += 1) {
      const bag = new THREE.Mesh(bagGeo, matSandbag);
      bag.position.set(
        (i - (count - 1) / 2) * 0.46,
        0.16 + row * 0.28,
        (row % 2) * 0.08,
      );
      bag.rotation.y = (i * 1.9 + row) * 0.4;
      bag.castShadow = true;
      bag.receiveShadow = true;
      root.add(bag);
    }
  }
  return root;
}

/** Wooden beam bridge — the plank walk from Top Tin to the cliff ledge. */
function buildBeamWalk() {
  const root = new THREE.Group();
  root.name = 'BeamWalk';
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 6.0), matWood);
  beam.position.y = 0.09;
  beam.castShadow = true;
  beam.receiveShadow = true;
  const cleatGeo = new THREE.BoxGeometry(0.5, 0.05, 0.12);
  for (let i = 0; i < 9; i += 1) {
    const cleat = new THREE.Mesh(cleatGeo, KitMaterials.frameWoodDark);
    cleat.position.set(0, 0.2, -2.6 + i * 0.65);
    root.add(cleat);
  }
  root.add(beam);
  return root;
}

/** Range flag pole with a wind sock — the firing-range signature. */
function buildRangeFlag() {
  const root = new THREE.Group();
  root.name = 'RangeFlag';
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 8), matGunmetal);
  pole.position.y = 2.1;
  pole.castShadow = true;
  const matFlag = std({ color: 0x8c3a2a, roughness: 0.9, side: THREE.DoubleSide });
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 1.1, 8, 1, true), matFlag);
  sock.rotation.z = Math.PI / 2;
  sock.position.set(0.62, 3.8, 0);
  sock.castShadow = true;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), matGunmetal);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(0.2, 3.8, 0);
  root.add(pole, sock, arm);
  return root;
}

// ===========================================================================
// EXPORT ALL
// ===========================================================================

console.log('--- buildings (geometry + derived compound colliders) ---');
await exportBuilding(BuildingRecipes.buildWoodBuildingUnfinished, 'bldg_wood_unfinished.glb', 'bldg_wood_unfinished');
await exportBuilding(BuildingRecipes.buildTinBuilding, 'bldg_tin.glb', 'bldg_tin');
await exportBuilding(BuildingRecipes.buildWatchtower, 'bldg_watchtower.glb', 'bldg_watchtower');
await exportBuilding(BuildingRecipes.buildRangeShack, 'bldg_range_shack.glb', 'bldg_range_shack');
await exportBuilding(BuildingRecipes.buildWhiteWarehouse, 'bldg_white_warehouse.glb', 'bldg_white_warehouse');
await exportBuilding(BuildingRecipes.buildArmoryBunker, 'bldg_armory_bunker.glb', 'bldg_armory_bunker');
await exportBuilding(BuildingRecipes.buildRedLockerHut, 'bldg_red_locker_hut.glb', 'bldg_red_locker_hut');
await exportBuilding(BuildingRecipes.buildYellowShop, 'bldg_yellow_shop.glb', 'bldg_yellow_shop');
await exportBuilding(BuildingRecipes.buildToiletsBlock, 'bldg_toilets.glb', 'bldg_toilets');
await exportBuilding(BuildingRecipes.buildStorageShed, 'bldg_storage_shed.glb', 'bldg_storage_shed');
await exportBuilding(BuildingRecipes.buildGuardPost, 'bldg_guard_post.glb', 'bldg_guard_post');
await exportBuilding(BuildingRecipes.buildConcretePlatform, 'bldg_concrete_platform.glb', 'bldg_concrete_platform');
await exportBuilding(BuildingRecipes.buildPlywoodBarricade, 'bldg_plywood_barricade.glb', 'bldg_plywood_barricade');
await exportBuilding(BuildingRecipes.buildAwningShelter, 'bldg_awning_shelter.glb', 'bldg_awning_shelter');

console.log('--- props ---');
await exportGLB(buildJeep(), 'jeep_military.glb');
await exportGLB(buildTireStack(), 'tire_stack.glb');
await exportGLB(buildTunnelCulvert(), 'tunnel_culvert.glb');
await exportGLB(buildTrailerFlatbed(), 'trailer_flatbed.glb');
await exportGLB(buildTargetSilhouette(), 'target_silhouette.glb');
await exportGLB(buildAmmoCrateStack(), 'ammo_crate_stack.glb');
await exportGLB(buildFuelDrumCluster(), 'fuel_drum_cluster.glb');
await exportGLB(buildSandbagNest(), 'sandbag_nest.glb');
await exportGLB(buildBeamWalk(), 'beam_walk.glb');
await exportGLB(buildRangeFlag(), 'range_flag.glb');

console.log('--- vegetation ---');
// Three palm variants so a jungle band of 50 trees doesn't read as one tree
// stamped 50 times; the scatter picks between them by index.
await exportGLB(buildPalmTree({ seed: 11, height: 7.4, lean: 0.55, frondCount: 11 }), 'palm_tree_a.glb');
await exportGLB(buildPalmTree({ seed: 27, height: 6.2, lean: 0.95, frondCount: 10 }), 'palm_tree_b.glb');
await exportGLB(buildPalmTree({ seed: 43, height: 8.6, lean: 0.35, frondCount: 12 }), 'palm_tree_c.glb');
await exportGLB(buildJungleTree({ seed: 5, levels: 4 }), 'jungle_tree_a.glb');
await exportGLB(buildJungleTree({ seed: 19, levels: 4 }), 'jungle_tree_b.glb');
await exportGLB(buildJungleBush({ seed: 3 }), 'jungle_bush.glb');
await exportGLB(buildGrassTuft({ seed: 9 }), 'grass_tuft.glb');

console.log('\nAll Firing Range models exported to', OUT_DIR);
console.log('Collider sidecars written to', COLLIDER_DIR);
