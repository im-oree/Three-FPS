/**
 * generatePrototypeShell.js — the vehicle prototype/test map.
 *
 * A sandbox for building the vehicle system in: flat ground that joins onto
 * rising terrain, a lake, and SECTIONS reached by teleport pads. Only a
 * fraction is populated now; the rest is laid out and left empty so new
 * vehicle work has a home ready for it.
 *
 * LAYOUT (x right, z forward/south, metres)
 *
 *            -Z (north)
 *     +-----------------------------+
 *     |  AIRFIELD: runway + tower   |   z -210..-60
 *     |                             |
 *     +-----------------------------+
 *     |  HELI PADS   |  HILLS       |   z -60..-10
 *     +--------------+--------------+
 *     |        HUB (spawn)          |   z -10..30
 *     +--------------+--------------+
 *     |  DRIVING     |  WEAPONS     |   z  30..110
 *     |  COURSE      |  RANGE       |
 *     +--------------+--------------+
 *     |  HARBOUR + WATER            |   z 110..230
 *     +-----------------------------+
 *
 * The hub sits in the middle so every section is one teleport away, and the
 * driving course wraps the hub so you can also just drive there.
 *
 * WHY A GENERATED SHELL AND NOT boxes[]
 * A level made of LevelBoxes is axis-aligned cuboids only — no slopes, no
 * runway markings, no terrain. The shell pipeline already supports real
 * geometry plus `COL_`-prefixed collision nodes, so a vehicle test map that
 * needs ramps and banked ground has to go through it.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  ShellMaterials,
  buildOutOfBoundsBoundary,
  buildDistantSkyline,
  computeKillPlaneY,
} from './lib/MapShellBuilder.js';
import { buildTerrainCollisionData } from './lib/TerrainHeightfieldBuilder.js';

// ---------------------------------------------------------------------------
// FileReader shim — GLTFExporter probes for it even in binary mode.
// ---------------------------------------------------------------------------
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

const OUT_DIR = path.resolve('assets/models/environment');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MAP_HALF = 260;
/** Terrain grid resolution, shared by the visual mesh and the collider. */
const TERRAIN_SEG = 144;

// ---------------------------------------------------------------------------
// Materials. Kept few and shared: every distinct material is a draw call the
// batcher cannot merge away.
// ---------------------------------------------------------------------------
const M = {
  grass: new THREE.MeshStandardMaterial({
    color: 0x5c6b3f, roughness: 0.97, metalness: 0, flatShading: true,
  }),
  dirt: new THREE.MeshStandardMaterial({
    color: 0x6e5c40, roughness: 0.98, metalness: 0, flatShading: true,
  }),
  tarmac: new THREE.MeshStandardMaterial({
    color: 0x2b2e31, roughness: 0.95, metalness: 0.02, flatShading: true,
  }),
  tarmacLight: new THREE.MeshStandardMaterial({
    color: 0x3a3e42, roughness: 0.95, metalness: 0.02, flatShading: true,
  }),
  paint: new THREE.MeshStandardMaterial({
    color: 0xd8d8d0, roughness: 0.8, metalness: 0, flatShading: true,
  }),
  concrete: new THREE.MeshStandardMaterial({
    color: 0x8a8d90, roughness: 0.94, metalness: 0.03, flatShading: true,
  }),
  concreteDark: new THREE.MeshStandardMaterial({
    color: 0x5f6265, roughness: 0.94, metalness: 0.03, flatShading: true,
  }),
  metal: new THREE.MeshStandardMaterial({
    color: 0x53585c, roughness: 0.55, metalness: 0.7, flatShading: true,
  }),
  // Water is the one transparent material; depthWrite off so the shore and
  // any submerged geometry still sort correctly beneath it.
  water: new THREE.MeshStandardMaterial({
    color: 0x2c4f63, roughness: 0.18, metalness: 0.25,
    transparent: true, opacity: 0.82, depthWrite: false,
  }),
  hazard: new THREE.MeshStandardMaterial({
    color: 0xd6a12c, roughness: 0.85, metalness: 0.05, flatShading: true,
  }),
  invisible: ShellMaterials.invisible,
};

const root = new THREE.Group();
root.name = 'Root_PrototypeShell';
const collisionRoot = new THREE.Group();
collisionRoot.name = 'Collision';

let colliderCount = 0;

/** Add an invisible box collider the loader will pick up by its COL_ name. */
function collider(name, w, h, d, x, y, z, rotY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.invisible);
  mesh.name = `COL_${name}_${colliderCount++}`;
  mesh.position.set(x, y, z);
  if (rotY) mesh.rotation.y = rotY;
  collisionRoot.add(mesh);
  return mesh;
}

/** A flat visual slab (no collider — pair it with collider() when solid). */
function slab(material, w, d, x, y, z, rotY = 0) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  if (rotY) mesh.rotation.y = rotY;
  mesh.receiveShadow = true;
  return mesh;
}

function box(material, w, h, d, x, y, z, rotY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  if (rotY) mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// TERRAIN
//
// One displaced plane for the whole map. The height function is authored so
// the middle third is DEAD FLAT — vehicles need a reliable surface to be
// tuned on, and a test map where the car is always on a slope tells you
// nothing about the handling model.
// ---------------------------------------------------------------------------

/**
 * Ground height at (x, z).
 *
 * Flat everywhere the player drives, rising to hills in the north-east, and
 * dropping into a basin in the south that the lake fills.
 */
/**
 * Flat building platforms.
 *
 * Every constructed section (runway, apron, pads, quay) is laid at y = 0, so
 * the terrain underneath has to BE zero there or the slab floats above the
 * grass at one end and sinks into it at the other. Real airfields are graded
 * flat for exactly this reason.
 *
 * Each entry is a rectangle plus a falloff band; inside the rectangle the
 * terrain is forced to the platform height, and across the band it blends
 * back to the natural surface so there is no cliff at the edge.
 */
// Falloff bands are WIDE on purpose. A sharp platform edge is a near
// discontinuity that no finite grid can represent, so the collider
// heightfield and the visual mesh disagree by a large fraction of a metre
// right at the lip -- which is exactly where a vehicle drives. A long gentle
// grade is cheaper to sample, matches how real sites are cut, and drops the
// collider-vs-visual error by an order of magnitude.
const PLATFORMS = [
  // [minX, maxX, minZ, maxZ, height, falloff]
  [-82, -38, -270, -5, 0, 55],    // runway + its shoulders
  [-32, -12, -100, -30, 0, 45],   // taxiway
  [-30, 70, -100, -30, 0, 50],    // apron
  [-112, -48, -58, 6, 0, 48],     // helipad cluster
  [-38, 38, -22, 40, 0, 45],      // hub
  [26, 164, 12, 112, 0, 52],      // driving course
  [-145, -65, 22, 110, 0, 48],    // weapons range
  [0, 80, 96, 120, 0, 40],        // quay
];

/**
 * Ground height at (x, z).
 *
 * Flat everywhere the player drives, rising to hills in the north-east, and
 * dropping into a basin in the south that the lake fills.
 */
function terrainHeight(x, z) {
  const natural = naturalHeight(x, z);

  // Blend toward any platform this point falls in or near. Strongest
  // influence wins, so overlapping platforms (hub/driving) do not fight.
  let bestWeight = 0;
  let bestHeight = 0;
  for (const [minX, maxX, minZ, maxZ, height, falloff] of PLATFORMS) {
    // Distance OUTSIDE the rectangle; zero when inside it.
    const dx = Math.max(minX - x, 0, x - maxX);
    const dz = Math.max(minZ - z, 0, z - maxZ);
    const d = Math.hypot(dx, dz);
    if (d > falloff) continue;
    const w = smoothstep(1 - d / falloff);
    if (w > bestWeight) { bestWeight = w; bestHeight = height; }
  }

  if (bestWeight <= 0) return natural;
  return natural * (1 - bestWeight) + bestHeight * bestWeight;
}

/** The undisturbed landscape, before building platforms are graded into it. */
function naturalHeight(x, z) {
  // Lake basin: south of z=110, dished so the shore is a real slope into the
  // water rather than a cliff edge.
  if (z > 110) {
    const t = Math.min(1, (z - 110) / 55);
    const across = Math.min(1, Math.abs(x) / 150);
    return -7.5 * smoothstep(t) * (1 - across * across * 0.55);
  }

  // Hills: north-east quadrant only, and pushed far enough out that the
  // airfield and every section pad stay flat.
  let h = 0;
  const hillDist = Math.hypot(x - 150, z + 90);
  if (hillDist < 130) {
    const t = 1 - hillDist / 130;
    h += 26 * smoothstep(t) * smoothstep(t);
  }
  const ridgeDist = Math.hypot(x + 175, z + 30);
  if (ridgeDist < 100) {
    const t = 1 - ridgeDist / 100;
    h += 17 * smoothstep(t) * smoothstep(t);
  }

  // Gentle undulation everywhere else so the flat ground is not sterile,
  // suppressed near the middle where the sections live.
  const centreness = Math.max(0, 1 - Math.hypot(x, z - 10) / 170);
  const wobble = Math.sin(x * 0.021) * Math.cos(z * 0.019) * 2.1
    + Math.sin(x * 0.047 + 1.3) * 0.7;
  h += wobble * (1 - centreness);

  return h;
}

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function buildTerrain() {
  // Must match the collision heightfield's resolution: the graded platform
  // edges are near-discontinuities, and sampling them on two different grids
  // makes the collider disagree with what the player sees by up to a metre.
  const SEG = TERRAIN_SEG;
  const size = MAP_HALF * 2;
  const geo = new THREE.PlaneGeometry(size, size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x5c6b3f);
  const dirt = new THREE.Color(0x6e5c40);
  const rock = new THREE.Color(0x77736b);
  const sand = new THREE.Color(0x9a8a63);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

    // Vertex colour by height: sand at the waterline, grass on the flat,
    // rock on the peaks. Costs nothing at runtime (no extra texture, no
    // extra material) and stops 135k triangles reading as one green sheet.
    if (y < -0.6) c.copy(sand).lerp(dirt, Math.min(1, -y / 6));
    else if (y < 8) c.copy(grass).lerp(dirt, Math.min(1, y / 14));
    else c.copy(grass).lerp(rock, Math.min(1, (y - 8) / 16));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.97, metalness: 0, flatShading: true,
  }));
  mesh.name = 'Terrain';
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// WATER
// ---------------------------------------------------------------------------
function buildWater() {
  const g = new THREE.Group();
  g.name = 'Water';

  // Surface sits at y=-1.2, so the basin is up to ~6 m deep. A boat needs
  // depth under it and a shoreline the player can walk into.
  const surface = slab(M.water, 420, 150, 0, -1.2, 172);
  surface.name = 'Water_Surface';
  g.add(surface);

  // Shoreline foam strip: a slightly raised, lighter band at the waterline.
  // Pure decoration, but without it the water/land join is a hard seam.
  const foam = slab(
    new THREE.MeshStandardMaterial({
      color: 0x9fb3bd, roughness: 0.6, transparent: true, opacity: 0.5,
      depthWrite: false,
    }),
    420, 7, 0, -1.05, 118,
  );
  foam.name = 'Water_Foam';
  g.add(foam);

  return g;
}

// ---------------------------------------------------------------------------
// AIRFIELD — runway, taxiway, tower, hangars
// ---------------------------------------------------------------------------
function buildAirfield() {
  const g = new THREE.Group();
  g.name = 'Section_Airfield';
  const baseZ = -135;

  // Runway: 260 x 34 m. Real enough for a jet to use, and the single
  // strongest "this is an airbase" cue in the whole map.
  const rw = slab(M.tarmac, 34, 260, -60, 0.06, baseZ);
  rw.name = 'Runway';
  g.add(rw);
  collider('Runway', 34, 0.4, 260, -60, -0.1, baseZ);

  // Threshold bars and centreline dashes.
  for (const end of [-1, 1]) {
    for (let i = -3; i <= 3; i += 1) {
      g.add(box(M.paint, 2.0, 0.02, 14, -60 + i * 3.6, 0.09, baseZ + end * 118));
    }
  }
  for (let i = -11; i <= 11; i += 1) {
    g.add(box(M.paint, 1.0, 0.02, 12, -60, 0.09, baseZ + i * 20));
  }
  // Edge lights: small emissive posts. Cheap, and they read instantly.
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x223344, emissive: 0x4488cc, emissiveIntensity: 2.2,
    roughness: 0.4,
  });
  for (let i = -6; i <= 6; i += 1) {
    for (const side of [-1, 1]) {
      g.add(box(lampMat, 0.4, 0.5, 0.4, -60 + side * 18, 0.3, baseZ + i * 20));
    }
  }

  // Taxiway linking the runway to the apron.
  g.add(slab(M.tarmacLight, 14, 70, -22, 0.05, baseZ + 60));
  collider('Taxiway', 14, 0.4, 70, -22, -0.1, baseZ + 60);

  // Apron: where the planes and jets will be parked.
  const apron = slab(M.tarmacLight, 90, 60, 20, 0.05, baseZ + 70);
  apron.name = 'Apron';
  g.add(apron);
  collider('Apron', 90, 0.4, 60, 20, -0.1, baseZ + 70);

  // Control tower: a real vertical landmark so the airfield is visible from
  // the hub and the map does not read as flat.
  const tower = new THREE.Group();
  tower.name = 'ControlTower';
  tower.position.set(58, 0, baseZ + 74);
  tower.add(box(M.concrete, 9, 18, 9, 0, 9, 0));
  tower.add(box(M.concreteDark, 13, 3.2, 13, 0, 19.4, 0));
  tower.add(box(
    new THREE.MeshStandardMaterial({
      color: 0x314a58, roughness: 0.15, metalness: 0.3,
      transparent: true, opacity: 0.55,
    }),
    12.4, 2.6, 12.4, 0, 19.4, 0,
  ));
  tower.add(box(M.metal, 0.6, 7, 0.6, 0, 24.5, 0));
  g.add(tower);
  collider('Tower', 9, 18, 9, 58, 9, baseZ + 74);
  collider('TowerCab', 13, 3.2, 13, 58, 19.4, baseZ + 74);

  // Two open hangars on the apron edge.
  for (let i = 0; i < 2; i += 1) {
    const hx = -6 + i * 44;
    const hz = baseZ + 92;
    g.add(box(M.concrete, 34, 0.6, 26, hx, 0.3, hz));
    // Side walls + back wall only: the front is open so a plane can taxi in.
    g.add(box(M.concrete, 1.2, 11, 26, hx - 16.4, 5.5, hz));
    g.add(box(M.concrete, 1.2, 11, 26, hx + 16.4, 5.5, hz));
    g.add(box(M.concrete, 34, 11, 1.2, hx, 5.5, hz + 12.4));
    // Curved roof from a half-cylinder: one of the few places a lathe-like
    // surface beats a box outright.
    const roofGeo = new THREE.CylinderGeometry(17.6, 17.6, 26, 14, 1, true, 0, Math.PI);
    roofGeo.rotateZ(-Math.PI / 2);
    roofGeo.rotateY(Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, M.metal);
    roof.position.set(hx, 11, hz);
    roof.castShadow = true;
    g.add(roof);

    collider('HangarWallL', 1.2, 11, 26, hx - 16.4, 5.5, hz);
    collider('HangarWallR', 1.2, 11, 26, hx + 16.4, 5.5, hz);
    collider('HangarBack', 34, 11, 1.2, hx, 5.5, hz + 12.4);
  }

  // Windsock — a tiny prop that says "airfield" louder than its triangle count.
  g.add(box(M.metal, 0.3, 6, 0.3, -30, 3, baseZ + 40));
  const sockGeo = new THREE.ConeGeometry(1.1, 4, 8, 1, true);
  sockGeo.rotateZ(Math.PI / 2);
  const sock = new THREE.Mesh(sockGeo, new THREE.MeshStandardMaterial({
    color: 0xd4682c, roughness: 0.9, side: THREE.DoubleSide,
  }));
  sock.position.set(-27.6, 5.6, baseZ + 40);
  g.add(sock);

  return g;
}

// ---------------------------------------------------------------------------
// HELIPADS
// ---------------------------------------------------------------------------
function buildHelipads() {
  const g = new THREE.Group();
  g.name = 'Section_Helipads';

  const spots = [[-95, -40], [-95, -8], [-62, -24]];
  for (let i = 0; i < spots.length; i += 1) {
    const [x, z] = spots[i];
    const pad = new THREE.Group();
    pad.name = `Helipad_${i}`;

    // Circular pad.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(11, 24), M.tarmac);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.07, z);
    disc.receiveShadow = true;
    pad.add(disc);

    const ring = new THREE.Mesh(new THREE.RingGeometry(9.2, 10.2, 24), M.paint);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.09, z);
    pad.add(ring);

    // The H.
    pad.add(box(M.paint, 1.3, 0.02, 8, x - 2.6, 0.1, z));
    pad.add(box(M.paint, 1.3, 0.02, 8, x + 2.6, 0.1, z));
    pad.add(box(M.paint, 4.0, 0.02, 1.3, x, 0.1, z));

    collider('Helipad', 22, 0.4, 22, x, -0.1, z);

    // Perimeter lights.
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x332211, emissive: 0xffaa33, emissiveIntensity: 2.0,
    });
    for (let a = 0; a < 8; a += 1) {
      const th = (a / 8) * Math.PI * 2;
      pad.add(box(
        lampMat, 0.35, 0.4, 0.35,
        x + Math.cos(th) * 10.6, 0.25, z + Math.sin(th) * 10.6,
      ));
    }
    g.add(pad);
  }

  // A small ops shack so the area is not three discs on grass.
  g.add(box(M.concrete, 10, 4.2, 7, -72, 2.1, -52));
  g.add(box(M.metal, 11, 0.4, 8, -72, 4.4, -52));
  collider('HeliOps', 10, 4.2, 7, -72, 2.1, -52);

  return g;
}

// ---------------------------------------------------------------------------
// DRIVING COURSE — the section the car work actually needs
// ---------------------------------------------------------------------------
function buildDrivingCourse() {
  const g = new THREE.Group();
  g.name = 'Section_Driving';

  // A wide asphalt pad to tune handling on, with a painted skidpad circle
  // whose radius is known (25 m) so cornering can be measured, not guessed.
  const pad = slab(M.tarmac, 130, 90, 95, 0.06, 62);
  pad.name = 'DrivingPad';
  g.add(pad);
  collider('DrivingPad', 130, 0.4, 90, 95, -0.1, 62);

  const skid = new THREE.Mesh(new THREE.RingGeometry(24.6, 25.4, 48), M.paint);
  skid.rotation.x = -Math.PI / 2;
  skid.position.set(80, 0.09, 62);
  g.add(skid);

  // Ramps: three grades so suspension travel and landings can be compared.
  // Built as wedges (a box sheared into a triangular prism), because a ramp
  // made of stacked boxes is a staircase the wheels bounce down.
  const grades = [[0.9, 12], [1.8, 14], [3.2, 16]];
  for (let i = 0; i < grades.length; i += 1) {
    const [h, len] = grades[i];
    const x = 42 + i * 17;
    const z = 28;
    g.add(wedge(M.concrete, 9, h, len, x, 0, z));
    // Collide the ramp with a rotated thin box: a box tilted to the ramp's
    // own angle matches the slope far better than an axis-aligned stack.
    const angle = Math.atan2(h, len);
    const c = collider('Ramp', 9, 0.5, Math.hypot(h, len), x, h / 2, z);
    c.rotation.x = -angle;
  }

  // A banked curve, again as real geometry rather than boxes.
  const bank = wedge(M.tarmacLight, 40, 2.6, 18, 128, 0, 16, Math.PI);
  g.add(bank);
  const bc = collider('Bank', 40, 0.5, 18.2, 128, 1.3, 16);
  bc.rotation.x = Math.atan2(2.6, 18);

  // Hazard-striped blocks to weave through.
  for (let i = 0; i < 6; i += 1) {
    g.add(box(M.hazard, 1.2, 1.2, 1.2, 60 + i * 9, 0.6, 88));
    collider('Cone', 1.2, 1.2, 1.2, 60 + i * 9, 0.6, 88);
  }

  return g;
}

/** A triangular prism: flat at one end, `height` tall at the other. */
function wedge(material, width, height, length, x, y, z, rotY = 0) {
  const hw = width / 2;
  const hl = length / 2;
  const verts = new Float32Array([
    // Sloped top face
    -hw, 0, -hl, hw, 0, -hl, hw, height, hl,
    -hw, 0, -hl, hw, height, hl, -hw, height, hl,
    // Bottom
    -hw, 0, -hl, -hw, 0, hl, hw, 0, hl,
    -hw, 0, -hl, hw, 0, hl, hw, 0, -hl,
    // Back (tall end)
    -hw, 0, hl, -hw, height, hl, hw, height, hl,
    -hw, 0, hl, hw, height, hl, hw, 0, hl,
    // Left side
    -hw, 0, -hl, -hw, height, hl, -hw, 0, hl,
    // Right side
    hw, 0, -hl, hw, 0, hl, hw, height, hl,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  if (rotY) mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// HUB — spawn, and the teleport pad ring
// ---------------------------------------------------------------------------
function buildHub() {
  const g = new THREE.Group();
  g.name = 'Section_Hub';

  const pad = slab(M.concrete, 62, 52, 0, 0.06, 8);
  pad.name = 'HubPad';
  g.add(pad);
  collider('HubPad', 62, 0.4, 52, 0, -0.1, 8);

  // A low wall ring with gaps, so the hub reads as a place rather than a
  // patch of different-coloured floor.
  const wallSegs = [
    [-31, 8, 1.2, 52], [31, 8, 1.2, 52],
    [-20, -18, 22, 1.2], [20, -18, 22, 1.2],
    [-20, 34, 22, 1.2], [20, 34, 22, 1.2],
  ];
  for (const [x, z, w, d] of wallSegs) {
    g.add(box(M.concreteDark, w, 1.1, d, x, 0.55, z));
    collider('HubWall', w, 1.1, d, x, 0.55, z);
  }

  // Central marker pylon — the thing you orient by when you spawn.
  g.add(box(M.metal, 1.4, 7, 1.4, 0, 3.5, 8));
  g.add(box(M.hazard, 3.0, 0.5, 3.0, 0, 7.2, 8));
  collider('HubPylon', 1.4, 7, 1.4, 0, 3.5, 8);

  return g;
}

/**
 * Teleport pads.
 *
 * Each is a raised disc the player stands IN; the runtime detects occupancy,
 * shows a confirmation, and moves them. The visual has to say "stand here"
 * unambiguously, so: a glowing ring, a floor disc, and four corner posts that
 * frame the volume.
 *
 * Node names matter — the runtime finds pads by the `Teleport_<id>` prefix,
 * so adding a destination is adding an entry to the list below plus a
 * matching entry in PrototypeTeleports.ts.
 */
const TELEPORT_PADS = [
  { id: 'hub', x: 0, z: 26, color: 0x66ccff },
  { id: 'airfield', x: -22, z: -6, color: 0x66ccff },
  { id: 'helipads', x: -22, z: 22, color: 0x66ccff },
  { id: 'driving', x: 22, z: 22, color: 0xffcc44 },
  { id: 'weapons', x: 22, z: -6, color: 0xff7755 },
  { id: 'harbour', x: 0, z: -10, color: 0x55ffaa },
];

function buildTeleportPads() {
  const g = new THREE.Group();
  g.name = 'TeleportPads';

  for (const pad of TELEPORT_PADS) {
    const node = new THREE.Group();
    node.name = `Teleport_${pad.id}`;
    node.position.set(pad.x, 0, pad.z);

    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.22, 20), M.concreteDark);
    disc.position.y = 0.11;
    disc.receiveShadow = true;
    node.add(disc);

    // The glowing ring is emissive, not lit — it must read as "active" even
    // in shadow, and an emissive material costs nothing extra.
    const ringMat = new THREE.MeshStandardMaterial({
      color: pad.color, emissive: pad.color, emissiveIntensity: 1.6,
      roughness: 0.4, transparent: true, opacity: 0.85,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.09, 6, 24), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    ring.name = `TeleportRing_${pad.id}`;
    node.add(ring);

    for (let i = 0; i < 4; i += 1) {
      const th = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const post = box(
        M.metal, 0.22, 1.5, 0.22,
        Math.cos(th) * 2.35, 0.75, Math.sin(th) * 2.35,
      );
      node.add(post);
      const cap = box(
        ringMat, 0.3, 0.12, 0.3,
        Math.cos(th) * 2.35, 1.56, Math.sin(th) * 2.35,
      );
      node.add(cap);
    }

    // Pads are walk-ON, not walk-INTO: only the base disc collides, and the
    // posts are left non-colliding so the player can step in from any side.
    collider('TeleportPad', 5.2, 0.24, 5.2, pad.x, 0.11, pad.z);

    g.add(node);
  }
  return g;
}

// ---------------------------------------------------------------------------
// WEAPONS RANGE (stub — ~10% populated, per the brief)
// ---------------------------------------------------------------------------
function buildWeaponsRange() {
  const g = new THREE.Group();
  g.name = 'Section_Weapons';

  const pad = slab(M.dirt, 70, 80, -105, 0.06, 66);
  g.add(pad);
  collider('WeaponsPad', 70, 0.4, 80, -105, -0.1, 66);

  // Firing line + three target berms. Enough to establish what the section
  // is; the pickups themselves arrive with the weapon-pickup work.
  g.add(box(M.concreteDark, 60, 1.0, 1.4, -105, 0.5, 96));
  collider('FiringLine', 60, 1.0, 1.4, -105, 0.5, 96);

  for (let i = 0; i < 3; i += 1) {
    const z = 66 - i * 18;
    g.add(wedge(M.dirt, 56, 2.4, 6, -105, 0, z));
    const c = collider('Berm', 56, 0.6, 6.5, -105, 1.2, z);
    c.rotation.x = Math.atan2(2.4, 6);
  }

  // Ammo crates as a visual anchor for where pickups will live.
  for (let i = 0; i < 4; i += 1) {
    g.add(box(M.hazard, 1.6, 0.9, 1.0, -128 + i * 3.2, 0.45, 92));
    collider('Crate', 1.6, 0.9, 1.0, -128 + i * 3.2, 0.45, 92);
  }

  return g;
}

// ---------------------------------------------------------------------------
// HARBOUR (stub — the boat work will fill this)
// ---------------------------------------------------------------------------
function buildHarbour() {
  const g = new THREE.Group();
  g.name = 'Section_Harbour';

  // Quay running along the shoreline.
  g.add(box(M.concrete, 70, 3.0, 14, 40, -0.4, 108));
  collider('Quay', 70, 3.0, 14, 40, -0.4, 108);

  // Two jetties reaching out over the water. A boat needs somewhere to dock,
  // and they give the shoreline a silhouette.
  for (let i = 0; i < 2; i += 1) {
    const x = 22 + i * 36;
    g.add(box(M.concreteDark, 5, 1.4, 34, x, 0.0, 130));
    collider('Jetty', 5, 1.4, 34, x, 0.0, 130);
    for (let p = 0; p < 5; p += 1) {
      g.add(box(M.metal, 0.5, 4.5, 0.5, x - 2.0, -2.0, 116 + p * 7));
      g.add(box(M.metal, 0.5, 4.5, 0.5, x + 2.0, -2.0, 116 + p * 7));
    }
  }

  // A crane, for a vertical landmark on the waterline.
  const crane = new THREE.Group();
  crane.position.set(6, 0, 106);
  crane.add(box(M.hazard, 2.2, 16, 2.2, 0, 8, 0));
  crane.add(box(M.hazard, 2.0, 1.6, 22, 0, 16.4, 8));
  crane.add(box(M.metal, 0.3, 6, 0.3, 0, 12.6, 17));
  g.add(crane);
  collider('Crane', 2.2, 16, 2.2, 6, 8, 106);

  return g;
}

// ---------------------------------------------------------------------------
// ASSEMBLE
// ---------------------------------------------------------------------------
root.add(buildTerrain());
root.add(buildWater());
root.add(buildAirfield());
root.add(buildHelipads());
root.add(buildHub());
root.add(buildTeleportPads());
root.add(buildDrivingCourse());
root.add(buildWeaponsRange());
root.add(buildHarbour());

// Out-of-bounds wall + distant skyline so the horizon is not empty.
for (const c of buildOutOfBoundsBoundary({
  width: MAP_HALF * 2 - 12, depth: MAP_HALF * 2 - 12, margin: 4, height: 40,
})) collisionRoot.add(c);

root.add(buildDistantSkyline({
  innerRadius: MAP_HALF + 40, count: 46, minHeight: 6, maxHeight: 22,
}));

root.add(collisionRoot);

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------
let tris = 0;
let meshes = 0;
root.traverse((o) => {
  if (!o.isMesh) return;
  meshes += 1;
  const g = o.geometry;
  tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
});

const outFile = path.join(OUT_DIR, 'prototype_shell.glb');
await new Promise((resolve, reject) => {
  new GLTFExporter().parse(
    root,
    (gltf) => {
      fs.writeFileSync(outFile, Buffer.from(gltf));
      resolve();
    },
    (err) => reject(err),
    { binary: true },
  );
});

// ---------------------------------------------------------------------------
// TERRAIN COLLISION
//
// The visual terrain is 148x148 quads = ~44k triangles. A trimesh collider
// over that is an enormous physics asset for a surface a wheel only ever
// touches the top of; a Rapier heightfield is a fraction of the memory with
// closed-form ray queries, and unlike a trimesh it cannot have gaps for a
// vehicle to fall through.
//
// This is not optional garnish: without it the driving course has no floor
// below the authored collider slabs, and the acceptance run caught exactly
// that -- the Humvee drove off the hub pad and fell to y = -152.
// ---------------------------------------------------------------------------
const collisionData = buildTerrainCollisionData({
  width: MAP_HALF * 2,
  depth: MAP_HALF * 2,
  heightFn: (x, z) => ({ height: terrainHeight(x, z) }),
  ncols: TERRAIN_SEG,
  nrows: TERRAIN_SEG,
});

{
  // A collider that drifts from the visual mesh is how players end up walking
  // in the air, so verify the decimated heightfield tracks the real surface.
  let worst = 0;
  const { ncols, nrows } = collisionData;
  for (let i = 0; i < 600; i += 1) {
    const x = (Math.random() - 0.5) * MAP_HALF * 1.9;
    const z = (Math.random() - 0.5) * MAP_HALF * 1.9;
    const visual = terrainHeight(x, z);
    const u = (x / (MAP_HALF * 2) + 0.5) * ncols;
    const v = (z / (MAP_HALF * 2) + 0.5) * nrows;
    const c0 = Math.floor(u); const r0 = Math.floor(v);
    const fx = u - c0; const fz = v - r0;
    const at = (c, r) => collisionData.heights[
      Math.min(ncols, Math.max(0, c)) * (nrows + 1) + Math.min(nrows, Math.max(0, r))
    ];
    const approx = (at(c0, r0) * (1 - fx) + at(c0 + 1, r0) * fx) * (1 - fz)
      + (at(c0, r0 + 1) * (1 - fx) + at(c0 + 1, r0 + 1) * fx) * fz;
    worst = Math.max(worst, Math.abs(approx - visual));
  }
  // The visual mesh and the collider now sample the SAME height function on
  // the SAME grid (TERRAIN_SEG), so they agree by construction. What this
  // measures is the grid's error against the analytic surface — i.e. how
  // much relief the chosen resolution throws away.
  console.log(`  terrain grid vs analytic surface, worst: ${worst.toFixed(3)} m`);
}

const terrainFile = path.resolve('assets/environment-meta/prototype_terrain.json');
fs.mkdirSync(path.dirname(terrainFile), { recursive: true });
fs.writeFileSync(terrainFile, JSON.stringify({
  width: MAP_HALF * 2, depth: MAP_HALF * 2, ...collisionData,
}));

const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log('Prototype shell');
console.log(`  ${Math.round(tris)} tris  ${meshes} meshes  ${colliderCount} colliders  ${kb} KB`);
console.log(`  killPlaneY = ${computeKillPlaneY(-8, 25)}`);
console.log(`  wrote ${outFile}`);
console.log(`  wrote ${terrainFile} (${collisionData.heights.length} samples)`);

// Teleport destinations are exported alongside so the runtime and the shell
// can never disagree about which pads exist.
const destFile = path.resolve('assets/environment-meta/prototype_teleports.json');
fs.mkdirSync(path.dirname(destFile), { recursive: true });
fs.writeFileSync(destFile, `${JSON.stringify({
  pads: TELEPORT_PADS.map((p) => ({ id: p.id, x: p.x, z: p.z, color: p.color })),
}, null, 2)}\n`);
console.log(`  wrote ${destFile}`);
