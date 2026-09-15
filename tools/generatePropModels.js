#!/usr/bin/env node
/**
 * generatePropModels.js — Document K §4.1: exports every environment prop
 * referenced by PropCatalog as a real committed .glb file.
 *
 *   node tools/generatePropModels.js
 *
 * Same pipeline and asset policy as generateWeaponModels.js /
 * generateVehicleModels.js: builders are the source of truth, .glb files are
 * generated artefacts, and nothing is constructed at runtime inside /src.
 * Dimensions are REAL (ISO 668 container, EUR-pallet, 55-gal drum) so maps
 * built from the catalog assemble at physically-correct human scale.
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
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve('assets/models/props');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- Shared palette (dockyard read, flat-shaded low-poly) ----------
const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, ...o });
const matContainer = (hex) => std({ color: hex, roughness: 0.72, metalness: 0.35 });
const matWood = std({ color: 0x8a6a45, roughness: 0.9, metalness: 0.0 });
const matWoodDark = std({ color: 0x6e5233, roughness: 0.92, metalness: 0.0 });
const matMetalDark = std({ color: 0x2e3134, roughness: 0.55, metalness: 0.6 });
const matBarrel = std({ color: 0x55605f, roughness: 0.55, metalness: 0.5 });
const matChainlink = std({
  color: 0x9aa2a6, roughness: 0.5, metalness: 0.4, transparent: true, opacity: 0.45,
  side: THREE.DoubleSide,
});
const matSandbag = std({ color: 0x9c8a5e, roughness: 0.95, metalness: 0.0 });
const matLamp = new THREE.MeshStandardMaterial({
  color: 0xfff4d6, emissive: 0xfff4d6, emissiveIntensity: 1.4, flatShading: true,
});

function exportGLB(object3D, filename) {
  return new Promise((resolve) => {
    new GLTFExporter().parse(
      object3D,
      (gltf) => {
        fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(gltf));
        console.log('wrote', filename);
        resolve();
      },
      (err) => { console.error(filename, err); process.exit(1); },
      { binary: true },
    );
  });
}

// =============================================================================
// SHIPPING CONTAINER 40ft — real ISO 668 dims 2.438w x 2.591h x 12.192l.
// Corrugated sides from baked rib strips + iconic corner castings. Long axis
// along Z, standard orientation, floor at y0 (mesh root at ground plane).
// =============================================================================
function buildContainer40ft() {
  const root = new THREE.Group();
  root.name = 'Container40ft';
  const W = 2.438, H = 2.59, L = 12.19;
  const paint = matContainer(0xb3352c); // retinted per-variant at map-build time

  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.92, L), paint);
  body.name = 'Paint';
  body.position.y = H / 2;

  // Roof corrugation (long stiffening channels).
  const roofGeo = new THREE.BoxGeometry(W * 0.96, 0.06, L * 0.97);
  const roof = new THREE.Mesh(roofGeo, paint);
  roof.position.y = H - 0.02;

  // Side corrugation ribs along the long faces.
  const ribGeo = new THREE.BoxGeometry(0.05, H * 0.86, 0.16);
  const ribs = [];
  const ribCount = 16, pitch = (L - 0.6) / ribCount;
  for (const side of [-1, 1]) {
    for (let i = 0; i < ribCount; i += 1) {
      const rib = new THREE.Mesh(ribGeo, paint);
      rib.position.set(side * (W / 2 + 0.015), H / 2, -L / 2 + 0.3 + pitch * (i + 0.5));
      ribs.push(rib);
    }
  }
  // End-face corrugation columns (rear end; door end gets framing instead).
  const colGeo = new THREE.BoxGeometry(0.16, H * 0.86, 0.05);
  for (const sx of [-1, 1]) {
    const col = new THREE.Mesh(colGeo, paint);
    col.position.set(sx * (W / 2 - 0.24), H / 2, -L / 2 - 0.015);
    ribs.push(col);
  }

  // Corner castings — the silhouette cue that reads "container" at any size.
  const castGeo = new THREE.BoxGeometry(0.17, 0.17, 0.17);
  for (const cx of [-1, 1]) for (const cy of [0, 1]) for (const cz of [-1, 1]) {
    const c = new THREE.Mesh(castGeo, matMetalDark);
    c.position.set(cx * (W / 2 - 0.02), cy === 1 ? H - 0.085 : 0.085, cz * (L / 2 - 0.02));
    ribs.push(c);
  }

  // Door end (+Z): frame + 2 locking-bar pairs. Painted same as body.
  const frameGeo = new THREE.BoxGeometry(W, H * 0.94, 0.06);
  const doorFrame = new THREE.Mesh(frameGeo, paint);
  doorFrame.position.set(0, H / 2, L / 2 + 0.005);
  const barGeo = new THREE.CylinderGeometry(0.025, 0.025, H * 0.88, 6);
  for (const bx of [-W * 0.3, -W * 0.12, W * 0.12, W * 0.3]) {
    const bar = new THREE.Mesh(barGeo, matMetalDark);
    bar.position.set(bx, H / 2, L / 2 + 0.05);
    ribs.push(bar);
  }
  const hingeGeo = new THREE.BoxGeometry(0.05, 0.12, 0.05);
  for (const hx of [-W / 2 + 0.05, W / 2 - 0.05]) {
    const hinge = new THREE.Mesh(hingeGeo, matMetalDark);
    hinge.position.set(hx, H * 0.5, L / 2 + 0.04);
    ribs.push(hinge);
  }

  root.add(body, roof, doorFrame, ...ribs);
  // EVERY mesh sharing the paint material is batch-classifiable by name —
  // marking by NAME (not material instance) keeps GLTF round-trip simple.
  root.traverse((n) => { if (n.isMesh && n.material === paint) n.name = 'Paint'; });
  root.userData.paintNode = 'Paint';
  return root;
}

// =============================================================================
// SHIPPING CONTAINER 20ft — 2.438 x 2.591 x 6.058. Built like the 40ft, not a
// non-uniform squash (ribs keep real pitch) — apart from length it is
// proportionally identical in every respect that reads at low-poly.
// =============================================================================
function buildContainer20ft() {
  const root = new THREE.Group();
  root.name = 'Container20ft';
  const W = 2.438, H = 2.59, L = 6.06;
  const paint = matContainer(0x2c8f96);

  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.92, L), paint);
  body.name = 'Paint';
  body.position.y = H / 2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.06, L * 0.97), paint);
  roof.position.y = H - 0.02;
  const ribs = [];
  const ribGeo = new THREE.BoxGeometry(0.05, H * 0.86, 0.16);
  const ribCount = 8, pitch = (L - 0.6) / ribCount;
  for (const side of [-1, 1]) {
    for (let i = 0; i < ribCount; i += 1) {
      const rib = new THREE.Mesh(ribGeo, paint);
      rib.position.set(side * (W / 2 + 0.015), H / 2, -L / 2 + 0.3 + pitch * (i + 0.5));
      ribs.push(rib);
    }
  }
  const castGeo = new THREE.BoxGeometry(0.17, 0.17, 0.17);
  for (const cx of [-1, 1]) for (const cy of [0, 1]) for (const cz of [-1, 1]) {
    const c = new THREE.Mesh(castGeo, matMetalDark);
    c.position.set(cx * (W / 2 - 0.02), cy === 1 ? H - 0.085 : 0.085, cz * (L / 2 - 0.02));
    ribs.push(c);
  }
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.94, 0.06), paint);
  doorFrame.position.set(0, H / 2, L / 2 + 0.005);
  const barGeo = new THREE.CylinderGeometry(0.025, 0.025, H * 0.88, 6);
  for (const bx of [-W * 0.3, -W * 0.12, W * 0.12, W * 0.3]) {
    const bar = new THREE.Mesh(barGeo, matMetalDark);
    bar.position.set(bx, H / 2, L / 2 + 0.05);
    ribs.push(bar);
  }
  root.add(body, roof, doorFrame, ...ribs);
  root.traverse((n) => { if (n.isMesh && n.material === paint) n.name = 'Paint'; });
  root.userData.paintNode = 'Paint';
  return root;
}

// =============================================================================
// OIL BARREL — standard 55-gal drum: 0.58 dia x 0.88 h, rolled chimes.
// =============================================================================
function buildOilBarrel() {
  const root = new THREE.Group();
  root.name = 'OilBarrel';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 12), matBarrel);
  body.name = 'Paint';
  body.position.y = 0.44;
  const chimeGeo = new THREE.TorusGeometry(0.29, 0.02, 6, 12);
  for (const cy of [0.07, 0.33, 0.55, 0.81]) {
    const chime = new THREE.Mesh(chimeGeo, matMetalDark);
    chime.rotation.x = Math.PI / 2;
    chime.position.y = cy;
    root.add(chime);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 12), matBarrel);
  lid.position.y = 0.875;
  lid.name = 'Paint';
  root.add(body, lid);
  root.userData.paintNode = 'Paint';
  return root;
}

// =============================================================================
// WOOD PALLET (EUR 1200x1200) + WOODEN CRATES + CABLE SPOOL
// =============================================================================
function buildWoodPallet() {
  const root = new THREE.Group();
  root.name = 'WoodPallet';
  const slatGeo = new THREE.BoxGeometry(1.2, 0.022, 0.145);
  for (let i = 0; i < 5; i += 1) {
    const slat = new THREE.Mesh(slatGeo, matWood);
    slat.position.set(0, 0.135, -0.5 + i * 0.25);
    root.add(slat);
  }
  const blockGeo = new THREE.BoxGeometry(0.145, 0.09, 0.145);
  for (const bx of [-0.5, 0, 0.5]) for (const bz of [-0.5, 0, 0.5]) {
    const block = new THREE.Mesh(blockGeo, matWoodDark);
    block.position.set(bx, 0.075, bz);
    root.add(block);
  }
  const underGeo = new THREE.BoxGeometry(0.145, 0.03, 1.2);
  for (const ux of [-0.5, 0, 0.5]) {
    const under = new THREE.Mesh(underGeo, matWoodDark);
    under.position.set(ux, 0.015, 0);
    root.add(under);
  }
  return root;
}

function buildCrateWoodSmall() {
  const root = new THREE.Group();
  root.name = 'CrateSmall';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), matWood);
  body.name = 'Paint';
  body.position.y = 0.45;
  root.add(body);
  // Edge battens — the cube-with-frame silhouette is what reads "crate".
  const batGeoH = new THREE.BoxGeometry(0.94, 0.07, 0.07);
  const batGeoV = new THREE.BoxGeometry(0.07, 0.94, 0.07);
  for (const s of [-1, 1]) {
    for (const sy of [0.035, 0.865]) {
      const b = new THREE.Mesh(batGeoH, matWoodDark);
      b.position.set(0, sy, s * 0.45);
      root.add(b);
      const b2 = new THREE.Mesh(batGeoH, matWoodDark);
      b2.position.set(s * 0.45, sy, 0);
      b2.rotation.y = Math.PI / 2;
      root.add(b2);
    }
    for (const sx of [-0.415, 0.415]) {
      const v = new THREE.Mesh(batGeoV, matWoodDark);
      v.position.set(sx, 0.45, s * 0.45);
      root.add(v);
      const v2 = new THREE.Mesh(batGeoV, matWoodDark);
      v2.position.set(s * 0.45, 0.45, sx);
      v2.rotation.y = Math.PI / 2;
      root.add(v2);
    }
  }
  root.userData.paintNode = 'Paint';
  return root;
}

function buildCrateWoodStacked() {
  const root = new THREE.Group();
  root.name = 'CrateStacked';
  const mk = (x, y, z, ry) => {
    const c = buildCrateWoodSmall();
    c.position.set(x, y, z);
    c.rotation.y = ry;
    return c;
  };
  root.add(mk(0, 0, 0, 0), mk(0.05, 0.9, 0, 0.35), mk(-0.08, 1.8, 0.05, -0.22));
  return root;
}

function buildCableSpool() {
  const root = new THREE.Group();
  root.name = 'CableSpool';
  const cheekGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.06, 14);
  for (const cx of [-0.4, 0.4]) {
    const cheek = new THREE.Mesh(cheekGeo, matWood);
    cheek.rotation.z = Math.PI / 2;
    cheek.position.set(cx, 0.75, 0);
    root.add(cheek);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.8, 10), matWoodDark);
  core.rotation.z = Math.PI / 2;
  core.position.y = 0.75;
  // Wound cable between the cheeks.
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.68, 14), matMetalDark,
  );
  cable.rotation.z = Math.PI / 2;
  cable.position.y = 0.75;
  root.add(core, cable);
  return root;
}

// =============================================================================
// FORKLIFT — small 1.6t counterbalance yard forklift (set dressing landmark).
// =============================================================================
function buildForklift() {
  const root = new THREE.Group();
  root.name = 'Forklift';
  const paint = std({ color: 0xd8a418, roughness: 0.6, metalness: 0.25 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 2.1), paint);
  body.name = 'Paint';
  body.position.y = 0.62;
  const counterweight = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.7, 0.5), paint);
  counterweight.position.set(0, 0.55, -1.05);

  // Overhead guard cage (4 posts + roof frame).
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.35, 6);
  for (const px of [-0.5, 0.5]) for (const pz of [-0.75, 0.05]) {
    const post = new THREE.Mesh(postGeo, matMetalDark);
    post.position.set(px, 1.55, pz);
    root.add(post);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 0.95), matMetalDark);
  roof.position.set(0, 2.24, -0.35);

  // Mast + carriage + forks (front, +Z).
  const mastGeo = new THREE.BoxGeometry(0.1, 1.8, 0.08);
  for (const mx of [-0.42, 0.42]) {
    const mast = new THREE.Mesh(mastGeo, matMetalDark);
    mast.position.set(mx, 1.1, 1.12);
    mast.name = mx < 0 ? 'Mast_L' : 'Mast_R';
    root.add(mast);
  }
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.06), matMetalDark);
  carriage.position.set(0, 0.45, 1.17);
  const forkGeo = new THREE.BoxGeometry(0.1, 0.05, 1.0);
  for (const fx of [-0.28, 0.28]) {
    const fork = new THREE.Mesh(forkGeo, matMetalDark);
    fork.position.set(fx, 0.32, 1.65);
    root.add(fork);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 10);
  for (const [wx, wz] of [[-0.52, 0.72], [0.52, 0.72], [-0.52, -0.72], [0.52, -0.72]]) {
    const wheel = new THREE.Mesh(wheelGeo, matMetalDark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.3, wz);
    root.add(wheel);
  }
  // Seat + steering wheel + backrest.
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.45), matMetalDark);
  seat.position.set(0, 1.05, -0.25);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 12), matMetalDark);
  wheel.position.set(0, 1.45, 0.15);
  wheel.rotation.x = -0.9;

  root.add(body, counterweight, roof, carriage, seat, wheel);
  root.userData.paintNode = 'Paint';
  return root;
}

// =============================================================================
// SHIP-TO-SHORE GANTRY CRANE (distant landmark; compound collider coarse).
// =============================================================================
function buildCargoCrane() {
  const root = new THREE.Group();
  root.name = 'CargoCrane';
  const paint = std({ color: 0x7a4a56, roughness: 0.8, metalness: 0.45 }); // weathered red
  const H = 16, HALF_W = 3.4, HALF_D = 2.6;

  // A-frame legs: 4 box columns with slight inward lean on the cross side.
  const legGeo = new THREE.BoxGeometry(0.55, H, 0.55);
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, paint);
    leg.position.set(lx * HALF_W, H / 2, lz * HALF_D);
    leg.rotation.z = lx * 0.035;
    root.add(leg);
  }
  // Horizontal side rails + X braces between leg pairs (the crane read).
  const railGeo = new THREE.BoxGeometry(0.22, 0.22, HALF_D * 2 + 0.55);
  const braceGeo = new THREE.BoxGeometry(0.14, 5.4, 0.14);
  for (const sx of [-1, 1]) {
    for (const ry of [H * 0.42, H * 0.78]) {
      const rail = new THREE.Mesh(railGeo, paint);
      rail.position.set(sx * HALF_W, ry, 0);
      root.add(rail);
    }
    for (const by of [H * 0.24, H * 0.62]) {
      const b1 = new THREE.Mesh(braceGeo, paint);
      b1.position.set(sx * HALF_W, by, 0);
      b1.rotation.x = 0.55;
      const b2 = new THREE.Mesh(braceGeo, paint);
      b2.position.set(sx * HALF_W, by, 0);
      b2.rotation.x = -0.55;
      root.add(b1, b2);
    }
  }
  // Top beam spanning the legs + the boom jutting seaward (+Z).
  const topBeam = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 1.4, 1.0, 1.6), paint);
  topBeam.position.y = H + 0.5;
  topBeam.name = 'Boom';
  const boom = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 12), paint);
  boom.position.set(0, H + 1.1, 6.2);
  root.add(topBeam, boom);
  // Operator house under the boom root + hanging spreader/cable (sway node).
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 1.6), matMetalDark);
  cab.position.set(0, H - 0.8, 1.4);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 7, 5), matMetalDark);
  cable.position.set(0, H - 3.6, 11.2);
  cable.name = 'HookCable';
  const spreader = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 1.0), paint);
  spreader.position.set(0, H - 7.2, 11.2);
  root.add(cab, cable, spreader);
  root.userData.swayNode = 'HookCable';
  return root;
}

// =============================================================================
// CHAINLINK FENCE SECTION (3.0m x 2.0m) + LIGHT TOWER + SANDBAG WALL
// =============================================================================
function buildChainlinkFence() {
  const root = new THREE.Group();
  root.name = 'ChainlinkFence';
  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.1, 6);
  for (const px of [-1.45, 1.45]) {
    const post = new THREE.Mesh(postGeo, matMetalDark);
    post.position.set(px, 1.05, 0);
    root.add(post);
  }
  // Woven wire read: two crossed diagonal plus vertical scores, one pane.
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.8), matChainlink);
  pane.position.y = 1.0;
  const scoreMat = matMetalDark;
  for (const ang of [0.62, -0.62]) {
    for (let i = 0; i < 5; i += 1) {
      const score = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.015), scoreMat);
      score.position.set(0, 0.35 + i * 0.35, ang > 0 ? 0.004 : -0.004);
      score.material = scoreMat;
      root.add(score);
      void ang;
    }
  }
  const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.9, 6), matMetalDark);
  topRail.rotation.z = Math.PI / 2;
  topRail.position.y = 1.93;
  root.add(pane, topRail);
  return root;
}

function buildLightTower() {
  const root = new THREE.Group();
  root.name = 'LightTower';
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 7, 6), matMetalDark);
  pole.position.y = 3.5;
  const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), matMetalDark);
  cross.position.y = 6.9;
  const lampGeo = new THREE.BoxGeometry(0.34, 0.3, 0.22);
  for (const lx of [-0.42, 0, 0.42]) {
    const lamp = new THREE.Mesh(lampGeo, matLamp);
    lamp.position.set(lx, 7.05, 0.12);
    lamp.rotation.x = -0.35;
    lamp.name = 'LampHead';
    root.add(lamp);
  }
  root.add(pole, cross);
  return root;
}

function buildSandbagWall() {
  const root = new THREE.Group();
  root.name = 'SandbagWall';
  const bagGeo = new THREE.SphereGeometry(0.26, 7, 5);
  bagGeo.scale(1.5, 0.62, 1.0);
  for (let row = 0; row < 3; row += 1) {
    const count = row === 2 ? 3 : 4;
    for (let i = 0; i < count; i += 1) {
      const bag = new THREE.Mesh(bagGeo, matSandbag);
      bag.position.set(
        (i - (count - 1) / 2) * 0.4,
        0.16 + row * 0.3,
        (row % 2 === 0 ? 0 : 0.07) + (i % 2) * 0.03,
      );
      bag.rotation.y = (i * 1.7 + row) * 0.35;
      root.add(bag);
    }
  }
  return root;
}

// ---------- EXPORT ALL ----------
await exportGLB(buildContainer40ft(), 'container_40ft.glb');
await exportGLB(buildContainer20ft(), 'container_20ft.glb');
await exportGLB(buildOilBarrel(), 'oil_barrel.glb');
await exportGLB(buildWoodPallet(), 'wood_pallet.glb');
await exportGLB(buildCrateWoodSmall(), 'crate_wood_small.glb');
await exportGLB(buildCrateWoodStacked(), 'crate_wood_stacked.glb');
await exportGLB(buildCableSpool(), 'cable_spool.glb');
await exportGLB(buildForklift(), 'forklift.glb');
await exportGLB(buildCargoCrane(), 'cargo_crane.glb');
await exportGLB(buildChainlinkFence(), 'chainlink_fence.glb');
await exportGLB(buildLightTower(), 'light_tower.glb');
await exportGLB(buildSandbagWall(), 'sandbag_wall.glb');
console.log('All prop models exported to', OUT_DIR);
