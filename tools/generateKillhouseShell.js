#!/usr/bin/env node
/**
 * generateKillhouseShell.js — builds killhouse_shell.glb.
 *
 * Killhouse is INDOORS, which makes it different from every shell we have so
 * far: the envelope is a warehouse (walls + roof), not a fenced yard. The
 * shared MapShellBuilder toolkit still supplies the ground and the
 * out-of-bounds volume; the warehouse envelope and the roof system are built
 * here from the same primitives rather than by inventing a parallel toolkit.
 *
 * THE ROOF IS THE INTERESTING PART
 * --------------------------------
 * Activision's own Killhouse guide: the warehouse is "partially exposed to
 * the outside thanks to its unique roof… multiple giant windows allow natural
 * light and air to flow freely", and aerial scorestreaks have to be flown
 * THROUGH those openings or they are blocked. So the roof here is a real
 * collider with real holes in it:
 *
 *   - solid panels are COL_ nodes, so a missile hits them
 *   - the bays in KillhouseLayout.ROOF_BAYS are left OPEN, so a missile flown
 *     through one reaches the floor
 *
 * That gives the covered-map behaviour the design needs without special-casing
 * killstreaks anywhere: the collision world already answers "what does this
 * ray hit", and the roof is simply part of the world now.
 *
 *   node tools/generateKillhouseShell.js
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
  buildGroundPlane, buildOutOfBoundsBoundary, computeKillPlaneY, ShellMaterials,
} from './lib/MapShellBuilder.js';
import {
  KILLHOUSE, ROOF_BAYS, COVER, TOWER, PLATFORMS, BOUNDS,
} from './lib/KillhouseLayout.js';

const OUT_DIR = path.resolve('assets/models/environment');
fs.mkdirSync(OUT_DIR, { recursive: true });

const { WIDTH, DEPTH, WALL_HEIGHT, ROOF_Y, WALL_THICKNESS } = KILLHOUSE;
const { HALF_W, HALF_D } = BOUNDS;

const M = {
  concrete: new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.95, flatShading: true }),
  concreteDark: new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 0.96, flatShading: true }),
  brick: new THREE.MeshStandardMaterial({ color: 0x8d7b6b, roughness: 0.95, flatShading: true }),
  plywood: new THREE.MeshStandardMaterial({ color: 0xa87f4e, roughness: 0.9, flatShading: true }),
  plywoodDark: new THREE.MeshStandardMaterial({ color: 0x7d5d36, roughness: 0.92, flatShading: true }),
  steel: new THREE.MeshStandardMaterial({ color: 0x5d636b, roughness: 0.6, metalness: 0.5, flatShading: true }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x3f454c, roughness: 0.65, metalness: 0.45, flatShading: true }),
  container: new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.85, flatShading: true }),
  containerB: new THREE.MeshStandardMaterial({ color: 0x3f5f52, roughness: 0.85, flatShading: true }),
  sandbag: new THREE.MeshStandardMaterial({ color: 0x8e8259, roughness: 0.98, flatShading: true }),
  car: new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.85, flatShading: true }),
  glassPanel: new THREE.MeshStandardMaterial({
    color: 0xdfe6ea, roughness: 0.35, metalness: 0.0,
    transparent: true, opacity: 0.22, side: THREE.DoubleSide,
  }),
};

let colIndex = 0;
/** A visible box plus, optionally, a matching collider. */
function box(parent, colParent, { min, max, material, name, collide = true, surface = '' }) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);

  if (collide && colParent) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ShellMaterials.invisible);
    col.position.copy(mesh.position);
    col.name = `COL_${surface || 'Solid'}_${name}_${colIndex++}`;
    colParent.add(col);
  }
  return mesh;
}

function buildKillhouseShell() {
  const root = new THREE.Group();
  root.name = 'KillhouseShell';
  const col = new THREE.Group();
  col.name = 'KillhouseCollision';

  // --- floor ---------------------------------------------------------------
  const { group: ground, collisionMesh: groundCol } = buildGroundPlane({
    width: WIDTH + 2, depth: DEPTH + 2, segments: 26,
    surfaceMaterial: M.concrete, jitterAmount: 0.015,
  });
  root.add(ground);
  col.add(groundCol);

  // --- warehouse envelope --------------------------------------------------
  // Four walls, full height, sealed. These are the map boundary: there is no
  // way out of a Killhouse except through the roof, which is the point.
  const walls = new THREE.Group(); walls.name = 'Walls';
  const outer = HALF_W + WALL_THICKNESS;
  const outerD = HALF_D + WALL_THICKNESS;
  box(walls, col, {
    min: [-outer, 0, -outerD], max: [-HALF_W, WALL_HEIGHT, outerD],
    material: M.concrete, name: 'wall_west',
  });
  box(walls, col, {
    min: [HALF_W, 0, -outerD], max: [outer, WALL_HEIGHT, outerD],
    material: M.concrete, name: 'wall_east',
  });
  box(walls, col, {
    min: [-HALF_W, 0, -outerD], max: [HALF_W, WALL_HEIGHT, -HALF_D],
    material: M.concrete, name: 'wall_north',
  });
  box(walls, col, {
    min: [-HALF_W, 0, HALF_D], max: [HALF_W, WALL_HEIGHT, outerD],
    material: M.concrete, name: 'wall_south',
  });

  // Pilasters down the long walls: the structural rhythm every warehouse
  // reference shows, and a bit of shallow cover along the edge lanes.
  for (let z = -HALF_D + 6; z <= HALF_D - 6; z += 8) {
    for (const sx of [-1, 1]) {
      box(walls, col, {
        min: [sx > 0 ? HALF_W - 0.6 : -HALF_W, 0, z - 0.45],
        max: [sx > 0 ? HALF_W : -HALF_W + 0.6, WALL_HEIGHT - 1.2, z + 0.45],
        material: M.concreteDark, name: `pilaster_${sx > 0 ? 'e' : 'w'}_${Math.round(z)}`,
      });
    }
  }
  root.add(walls);

  // --- roof ----------------------------------------------------------------
  // Built as a grid of panels with the bays subtracted, so the holes are real
  // geometry rather than a texture. Every solid panel gets a collider.
  const roof = new THREE.Group(); roof.name = 'Roof';
  const THICK = 0.35;
  const STEP = 2.0;

  const inBay = (x0, x1, z0, z1) => ROOF_BAYS.some((b) => (
    x0 < b.maxX && x1 > b.minX && z0 < b.maxZ && z1 > b.minZ
  ));

  // Visual panels are fine-grained (they carry the corrugated rhythm), but
  // the COLLIDERS are merged into long runs. The server answers every
  // raycast with a linear scan over its box list, so 470 individual roof
  // colliders would make the roof alone cost more than the rest of the map
  // put together -- and a missile raycast happens every tick it is in flight.
  let panels = 0;
  const solidRow = [];   // merged collider spans, one per roof strip
  for (let x = -HALF_W; x < HALF_W - 0.01; x += STEP) {
    const x1 = Math.min(x + STEP, HALF_W);
    let runStart = null;
    for (let z = -HALF_D; z < HALF_D - 0.01; z += STEP) {
      const z1 = Math.min(z + STEP, HALF_D);
      const open = inBay(x, x1, z, z1);
      if (!open) {
        box(roof, null, {
          min: [x, ROOF_Y, z], max: [x1, ROOF_Y + THICK, z1],
          material: (panels % 7 === 0) ? M.steelDark : M.steel,
          name: `roof_panel_${panels}`, collide: false,
        });
        panels += 1;
        if (runStart === null) runStart = z;
      }
      if ((open || z1 >= HALF_D - 0.01) && runStart !== null) {
        solidRow.push([x, x1, runStart, open ? z : z1]);
        runStart = null;
      }
    }
  }
  for (const [x0, x1, z0, z1] of solidRow) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, THICK, z1 - z0), ShellMaterials.invisible);
    mesh.position.set((x0 + x1) / 2, ROOF_Y + THICK / 2, (z0 + z1) / 2);
    mesh.name = `COL_Roof_${colIndex++}`;
    col.add(mesh);
  }

  // Trusses across the short axis, under the roof. Visual only: colliding
  // with them would make the roof line unpredictable for a diving missile.
  for (let z = -HALF_D + 4; z <= HALF_D - 4; z += 6) {
    const truss = new THREE.Mesh(
      new THREE.BoxGeometry(WIDTH, 0.5, 0.28), M.steelDark,
    );
    truss.position.set(0, ROOF_Y - 0.45, z);
    truss.name = `truss_${Math.round(z)}`;
    roof.add(truss);
  }

  // Glazing bars in the clean bays, so an open bay still reads as a window
  // rather than a missing panel. Thin, non-colliding, and set well inside
  // the opening so they never narrow the flight path.
  for (const bay of ROOF_BAYS) {
    if (bay.damaged) continue;
    const w = bay.maxX - bay.minX;
    const bars = 3;
    for (let i = 1; i < bars; i += 1) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.1, bay.maxZ - bay.minZ), M.steelDark,
      );
      bar.position.set(bay.minX + (w / bars) * i, ROOF_Y + 0.05, (bay.minZ + bay.maxZ) / 2);
      roof.add(bar);
    }
  }

  // Torn edges on the collapsed bays: a few hanging panels so the hole looks
  // like failure rather than a clean rectangle cut out of the roof.
  for (const bay of ROOF_BAYS.filter((b) => b.damaged)) {
    for (let i = 0; i < 5; i += 1) {
      const w = 0.7 + (i % 3) * 0.5;
      const flap = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.9), M.steel);
      const alongX = i % 2 === 0;
      flap.position.set(
        alongX ? bay.minX + (bay.maxX - bay.minX) * (i / 5) : (i < 3 ? bay.minX : bay.maxX),
        ROOF_Y + 0.1,
        alongX ? (i < 3 ? bay.minZ : bay.maxZ) : bay.minZ + (bay.maxZ - bay.minZ) * (i / 5),
      );
      flap.rotation.set((i % 2 ? 0.5 : -0.4), i * 0.7, (i % 3 ? 0.35 : -0.25));
      flap.name = `roof_debris_${bay.name}_${i}`;
      roof.add(flap);
    }
  }
  root.add(roof);

  // --- watchtower ----------------------------------------------------------
  const tower = new THREE.Group(); tower.name = 'Watchtower';
  const { legInset, legThickness: LT, deckY, deckHalf, railHeight, roofY } = TOWER;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    box(tower, col, {
      min: [sx * legInset - LT / 2, 0, sz * legInset - LT / 2],
      max: [sx * legInset + LT / 2, deckY, sz * legInset + LT / 2],
      material: M.plywoodDark, name: `tower_leg_${sx}_${sz}`,
    });
  }
  // Deck: a real floor you can stand on.
  box(tower, col, {
    min: [-deckHalf, deckY, -deckHalf], max: [deckHalf, deckY + 0.24, deckHalf],
    material: M.plywood, name: 'tower_deck',
  });
  // Rails on three sides; the south side is the ladder entry and stays open.
  const railT = 0.12;
  box(tower, col, {
    min: [-deckHalf, deckY + 0.24, -deckHalf],
    max: [deckHalf, deckY + 0.24 + railHeight, -deckHalf + railT],
    material: M.plywoodDark, name: 'tower_rail_n',
  });
  box(tower, col, {
    min: [-deckHalf, deckY + 0.24, -deckHalf],
    max: [-deckHalf + railT, deckY + 0.24 + railHeight, deckHalf],
    material: M.plywoodDark, name: 'tower_rail_w',
  });
  box(tower, col, {
    min: [deckHalf - railT, deckY + 0.24, -deckHalf],
    max: [deckHalf, deckY + 0.24 + railHeight, deckHalf],
    material: M.plywoodDark, name: 'tower_rail_e',
  });
  // Canopy overhead, on four short posts.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    box(tower, null, {
      min: [sx * (deckHalf - 0.2) - 0.08, deckY + 0.24, sz * (deckHalf - 0.2) - 0.08],
      max: [sx * (deckHalf - 0.2) + 0.08, roofY, sz * (deckHalf - 0.2) + 0.08],
      material: M.plywoodDark, name: `tower_post_${sx}_${sz}`, collide: false,
    });
  }
  box(tower, col, {
    min: [-deckHalf - 0.3, roofY, -deckHalf - 0.3],
    max: [deckHalf + 0.3, roofY + 0.18, deckHalf + 0.3],
    material: M.plywood, name: 'tower_canopy',
  });
  // Ladder on the south face: rails plus rungs, climbable.
  const ladderX = 0.0, ladderZ = deckHalf + 0.05;
  for (const sx of [-0.34, 0.34]) {
    box(tower, null, {
      min: [ladderX + sx - 0.05, 0, ladderZ], max: [ladderX + sx + 0.05, deckY + 0.5, ladderZ + 0.1],
      material: M.plywoodDark, name: `tower_ladder_rail_${sx}`, collide: false,
    });
  }
  for (let y = 0.3; y < deckY + 0.4; y += 0.32) {
    box(tower, null, {
      min: [ladderX - 0.34, y, ladderZ - 0.02], max: [ladderX + 0.34, y + 0.06, ladderZ + 0.12],
      material: M.plywood, name: `tower_rung_${y.toFixed(2)}`, collide: false,
    });
  }
  // A climb volume so the ladder is actually usable: a thin ramp of collision
  // steps rather than a sheer face.
  for (let y = 0; y < deckY; y += 0.3) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.5), ShellMaterials.invisible);
    step.position.set(ladderX, y, ladderZ + 0.3);
    step.name = `COL_Ladder_step_${colIndex++}`;
    col.add(step);
  }
  root.add(tower);

  // --- spawn platforms -----------------------------------------------------
  const platforms = new THREE.Group(); platforms.name = 'Platforms';
  for (const p of PLATFORMS) {
    box(platforms, col, {
      min: p.deck.min, max: p.deck.max, material: M.steel, name: `platform_${p.name}`,
    });
    // Support legs.
    for (const lx of [p.deck.min[0] + 0.5, p.deck.max[0] - 0.9]) {
      box(platforms, null, {
        min: [lx, 0, p.deck.min[2] + 0.4], max: [lx + 0.4, p.deck.min[1], p.deck.min[2] + 0.8],
        material: M.steelDark, name: `platform_leg_${p.name}_${lx.toFixed(0)}`, collide: false,
      });
    }
    // Rail along the inward edge, with a gap in the middle to shoot through.
    const railZ = p.name === 'south' ? p.deck.min[2] : p.deck.max[2] - 0.12;
    for (const seg of [[-8, -2.2], [2.2, 8]]) {
      box(platforms, col, {
        min: [seg[0], p.deck.max[1], railZ],
        max: [seg[1], p.deck.max[1] + 1.0, railZ + 0.12],
        material: M.steelDark, name: `platform_rail_${p.name}_${seg[0]}`,
      });
    }
    // Stairs up.
    const { steps, rise, run } = p.stair;
    for (let i = 0; i < steps; i += 1) {
      const y = rise * i;
      const sx = p.stair.dir === 'west' ? p.stair.x - run * (i + 1) : p.stair.x + run * i;
      box(platforms, col, {
        min: [sx, y, p.deck.min[2] + 0.6], max: [sx + run, y + rise, p.deck.min[2] + 3.2],
        material: M.steelDark, name: `stair_${p.name}_${i}`,
      });
    }
  }
  root.add(platforms);

  // --- interior cover ------------------------------------------------------
  const cover = new THREE.Group(); cover.name = 'Cover';
  for (const c of COVER) {
    const material = {
      brick: M.brick, wood: M.plywood, container: M.container,
      sandbag: M.sandbag, crate: M.plywoodDark, car: M.car,
    }[c.kind] ?? M.concrete;
    box(cover, col, { min: c.min, max: c.max, material, name: c.name });

    // Containers get a contrasting end wall so the yard reads as mixed stock.
    if (c.kind === 'container') {
      const end = new THREE.Mesh(
        new THREE.BoxGeometry(c.max[0] - c.min[0], c.max[1] - c.min[1], 0.12), M.containerB,
      );
      end.position.set((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, c.max[2]);
      end.name = `${c.name}_end`;
      cover.add(end);
    }
  }
  root.add(cover);

  // --- out of bounds -------------------------------------------------------
  for (const c of buildOutOfBoundsBoundary({
    width: WIDTH + 4, depth: DEPTH + 4, margin: 2, height: 30,
  })) col.add(c);

  root.add(col);
  return { root, killPlaneY: computeKillPlaneY(0, 25), panels };
}

const { root, killPlaneY, panels } = buildKillhouseShell();
let colliders = 0;
root.traverse((n) => { if (/^COL_/.test(n.name)) colliders += 1; });

await new Promise((resolve) => {
  new GLTFExporter().parse(
    root,
    (gltf) => {
      const out = path.join(OUT_DIR, 'killhouse_shell.glb');
      fs.writeFileSync(out, Buffer.from(gltf));
      console.log('wrote', out, `(${Math.round(gltf.byteLength / 1024)} KB)`);
      console.log(`roof: ${panels} solid panels, ${ROOF_BAYS.length} open bays`);
      console.log(`colliders: ${colliders}`);
      console.log(`killPlaneY = ${killPlaneY}`);
      resolve();
    },
    (err) => { console.error('shell export failed:', err); process.exit(1); },
    { binary: true },
  );
});
