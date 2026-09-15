/**
 * BuildingRecipes.js — Document N §3.2: Firing Range's structures, each one a
 * RECIPE composing BuildingKit panels. Adding a building is writing one
 * function here plus one PropCatalog entry — no changes to PropPool,
 * MapBuilder or ColliderShapeBuilder.
 *
 * Every recipe is authored from the CoD reference imagery:
 *   - the unfinished plywood two-storey with the blue stripe band and open
 *     stair well ("Wood Building" / Shoot House)
 *   - the tin-clad two-storey with the yellow ladder ("Tin Building" / Top Tin)
 *   - the central watchtower on stilts with the yellow ladder and railed loft
 *   - the long open-sided range shack with slatted roof
 *   - the whitewashed warehouse, the armoury bunker, the red locker hut,
 *     the yellow shop front, the toilets block, the small sheds
 *
 * CONVENTION: every recipe returns a Group whose origin is the building's
 * ground-centre (y = 0 is the floor), +Z is the "front" face. Terrain pads are
 * flattened under each footprint so this assumption always holds.
 */
import * as THREE from 'three';
import { BuildingKit, KitMaterials, MODULE_WIDTH, MODULE_HEIGHT } from './BuildingKit.js';

const {
  panelWallFinished, panelWallFrame, panelWallTin, panelSandbagBase,
  panelRoofSloped, panelRoofJoists, panelStairFlight, panelLadder,
  panelFloorPlatform, panelCamoNetAwning, panelCornerPost,
} = BuildingKit;

/** Place a panel at (x, z) with yaw, seating its centre at height y + h/2. */
function place(root, panel, x, y, z, yaw = 0, height = MODULE_HEIGHT) {
  panel.position.set(x, y + height / 2, z);
  panel.rotation.y = yaw;
  root.add(panel);
  return panel;
}

/** A closed or partly-open rectangular ring of wall panels. */
function wallRing(root, {
  halfX, halfZ, y = 0, height = MODULE_HEIGHT, factory,
  countX = 2, countZ = 2, skipFaces = [],
}) {
  const stepX = (halfX * 2) / countX;
  const stepZ = (halfZ * 2) / countZ;
  const faces = [
    { id: 'north', yaw: 0, count: countX, step: stepX, along: 'x', offset: -halfZ },
    { id: 'south', yaw: 0, count: countX, step: stepX, along: 'x', offset: halfZ },
    { id: 'west', yaw: Math.PI / 2, count: countZ, step: stepZ, along: 'z', offset: -halfX },
    { id: 'east', yaw: Math.PI / 2, count: countZ, step: stepZ, along: 'z', offset: halfX },
  ];
  for (const face of faces) {
    if (skipFaces.includes(face.id)) continue;
    for (let i = 0; i < face.count; i += 1) {
      const t = -((face.count - 1) / 2) * face.step + i * face.step;
      const panel = factory(face.id, i, face.count);
      if (!panel) continue;
      const x = face.along === 'x' ? t : face.offset;
      const z = face.along === 'x' ? face.offset : t;
      place(root, panel, x, y, z, face.yaw, height);
    }
  }
}

/** Corner posts at the four corners of a footprint. */
function cornerPosts(root, halfX, halfZ, height, y = 0) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = panelCornerPost({ height });
      post.position.set(sx * halfX, y, sz * halfZ);
      root.add(post);
    }
  }
}

// ===========================================================================
// 1. WOOD BUILDING — the two-storey unfinished plywood structure ("Shoot
//    House"). Ground floor enclosed with the painted blue stripe band; upper
//    floor is open studwork with a partial deck and an exposed stair well,
//    exactly as in the reference. The upper deck is REACHABLE and standable.
// ===========================================================================
export function buildWoodBuildingUnfinished() {
  const root = new THREE.Group();
  root.name = 'Bldg_WoodUnfinished';
  const HX = MODULE_WIDTH * 1.5;   // 3.6
  const HZ = MODULE_WIDTH * 1.25;  // 3.0

  // --- ground floor: sheeted plywood, stripe band, door front + windows ---
  wallRing(root, {
    halfX: HX, halfZ: HZ, countX: 3, countZ: 2,
    factory: (face, i) => {
      if (face === 'south' && i === 1) {
        return panelWallFinished({ variant: 'pale', hasDoor: true, stripe: true });
      }
      if (face === 'north' && i === 1) {
        return panelWallFinished({ variant: 'tan', hasDoor: true, stripe: true });
      }
      if (face === 'east' && i === 0) {
        return panelWallFinished({ variant: 'pale', hasWindow: true, stripe: true });
      }
      if (face === 'west' && i === 1) {
        return panelWallFinished({ variant: 'tan', hasWindow: true, stripe: true });
      }
      return panelWallFinished({ variant: i % 2 ? 'tan' : 'pale', stripe: true });
    },
  });
  cornerPosts(root, HX, HZ, MODULE_HEIGHT);

  // --- first floor deck: partial, with an open stair well on the west half ---
  const deckFull = panelFloorPlatform({
    width: HX * 2, depth: HZ, railed: false, thickness: 0.18,
  });
  deckFull.position.set(0, MODULE_HEIGHT, -HZ / 2);
  root.add(deckFull);
  const deckStrip = panelFloorPlatform({
    width: HX, depth: HZ, railed: false, thickness: 0.18,
  });
  deckStrip.position.set(HX / 2, MODULE_HEIGHT, HZ / 2);
  root.add(deckStrip);

  // --- the stair flight up through the open well (real stepped collision) ---
  const stairs = panelStairFlight({ rise: MODULE_HEIGHT + 0.09, run: 3.1, stepCount: 12, width: 1.2 });
  stairs.position.set(-HX * 0.55, 0, HZ * 0.1);
  stairs.rotation.y = Math.PI;
  root.add(stairs);

  // --- upper storey: open stud frame, one sheeted bay, reference silhouette --
  wallRing(root, {
    halfX: HX, halfZ: HZ, y: MODULE_HEIGHT + 0.09, countX: 3, countZ: 2,
    factory: (face, i) => {
      if (face === 'south') return i === 1 ? null : panelWallFrame();
      if (face === 'north') {
        return i === 1
          ? panelWallFinished({ variant: 'raw', hasWindow: true })
          : panelWallFinished({ variant: 'raw' });
      }
      if (face === 'west' && i === 1) return null; // open onto the stair well
      return panelWallFrame();
    },
  });

  // --- roof: joists over the open half, sheeted over the enclosed half ------
  const roof = panelRoofSloped({
    span: HX * 2 + 0.4, depth: HZ * 1.15, pitch: 0.22, rusted: false,
  });
  roof.position.set(0, MODULE_HEIGHT * 2 + 0.24, -HZ * 0.45);
  root.add(roof);
  const joists = panelRoofJoists({ span: HX * 2, depth: HZ, joists: 7 });
  joists.position.set(0, MODULE_HEIGHT * 2 + 0.18, HZ * 0.5);
  root.add(joists);

  // --- dressing: leaning plywood stack + sandbags at the base --------------
  const stack = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.5, 1.2), KitMaterials.plywoodRaw,
  );
  stack.userData.collision = 'solid';
  stack.position.set(-HX - 0.9, 0.25, HZ * 0.4);
  stack.rotation.y = 0.3;
  stack.castShadow = true;
  root.add(stack);

  const sandbags = panelSandbagBase({ rows: 2, width: 2.2 });
  sandbags.position.set(HX * 0.4, 0, HZ + 0.4);
  root.add(sandbags);

  root.userData.footprint = { halfExtents: [HX + 1.2, HZ + 1.0] };
  return root;
}

// ===========================================================================
// 2. TIN BUILDING — two-storey corrugated structure with the yellow ladder to
//    "Top Tin", a big front opening onto mid, and a railed upper floor.
// ===========================================================================
export function buildTinBuilding() {
  const root = new THREE.Group();
  root.name = 'Bldg_Tin';
  const HX = MODULE_WIDTH * 1.25;
  const HZ = MODULE_WIDTH * 1.1;

  wallRing(root, {
    halfX: HX, halfZ: HZ, countX: 2, countZ: 2,
    factory: (face, i) => {
      if (face === 'south' && i === 0) {
        return panelWallFinished({ variant: 'tin', hasDoor: true });
      }
      if (face === 'east' && i === 1) {
        return panelWallTin({ rusted: true });
      }
      return panelWallTin({ rusted: i % 2 === 0 });
    },
  });
  cornerPosts(root, HX, HZ, MODULE_HEIGHT);

  // Upper floor — "Top Tin". Open on the south face: the big mantle-in
  // opening toward mid that the reference is famous for.
  const deck = panelFloorPlatform({
    width: HX * 2, depth: HZ * 2, railed: false, thickness: 0.18,
  });
  deck.position.y = MODULE_HEIGHT;
  root.add(deck);

  wallRing(root, {
    halfX: HX, halfZ: HZ, y: MODULE_HEIGHT + 0.09, countX: 2, countZ: 2,
    factory: (face, i) => {
      if (face === 'south') return i === 0 ? null : panelWallTin({ rusted: false });
      if (face === 'north' && i === 1) return panelWallFinished({ variant: 'tin', hasWindow: true });
      return panelWallTin({ rusted: (i + (face === 'east' ? 1 : 0)) % 2 === 0 });
    },
  });

  // A low lip across the open south face — mantle-able, not a fall-through.
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(HX, 0.55, 0.14), KitMaterials.corrugatedTin,
  );
  lip.userData.collision = 'solid';
  lip.position.set(-HX / 2, MODULE_HEIGHT + 0.37, HZ);
  lip.castShadow = true;
  root.add(lip);

  // The yellow ladder up the east face — the only way to Top Tin.
  const ladder = panelLadder({ height: MODULE_HEIGHT + 0.35, lean: 0.1 });
  ladder.position.set(HX + 0.12, 0, HZ * 0.45);
  ladder.rotation.y = Math.PI / 2;
  root.add(ladder);

  const roof = panelRoofSloped({
    span: HX * 2 + 0.5, depth: HZ * 2 + 0.5, pitch: 0.18, rusted: true,
  });
  roof.position.y = MODULE_HEIGHT * 2 + 0.22;
  root.add(roof);

  const sandbags = panelSandbagBase({ rows: 2, width: 2.0 });
  sandbags.position.set(-HX * 0.3, 0, HZ + 0.45);
  root.add(sandbags);

  root.userData.footprint = { halfExtents: [HX + 1.0, HZ + 1.0] };
  return root;
}

// ===========================================================================
// 3. WATCHTOWER — the map's defining silhouette. Tin-clad box on stilts, the
//    yellow ladder up the front, railed loft on top, sandbagged base. This is
//    the "Tower"/"Loft" callout and it must be climbable end-to-end.
// ===========================================================================
export function buildWatchtower() {
  const root = new THREE.Group();
  root.name = 'Bldg_Watchtower';
  const LEG_HEIGHT = MODULE_HEIGHT * 1.75; // 4.55 — loft deck height
  const HALF = 1.15;

  // Stilts.
  const legGeo = new THREE.BoxGeometry(0.19, LEG_HEIGHT, 0.19);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, KitMaterials.frameWood);
      leg.userData.collision = 'solid';
      leg.position.set(sx * HALF, LEG_HEIGHT / 2, sz * HALF);
      leg.castShadow = true;
      root.add(leg);
    }
  }
  // Cross bracing (visual).
  for (const sx of [-1, 1]) {
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, HALF * 2.6, 0.1), KitMaterials.frameWood,
    );
    brace.userData.collision = 'skip';
    brace.position.set(sx * HALF, LEG_HEIGHT * 0.45, 0);
    brace.rotation.x = Math.PI / 3.4;
    brace.castShadow = true;
    root.add(brace);
  }

  // Loft deck — the standable platform.
  const loft = panelFloorPlatform({
    width: HALF * 2 + 0.5, depth: HALF * 2 + 0.5, railed: true, thickness: 0.18,
    openSides: ['south'],
  });
  loft.position.y = LEG_HEIGHT;
  loft.name = 'LoftPlatform'; // the "Loft" callout anchors here
  root.add(loft);

  // Cabin walls above the loft: tin, with a wide firing window on the south.
  const cabinY = LEG_HEIGHT + 0.09;
  const CH = MODULE_HEIGHT * 0.95;
  wallRing(root, {
    halfX: HALF + 0.25, halfZ: HALF + 0.25, y: cabinY, height: CH, countX: 1, countZ: 1,
    factory: (face) => {
      if (face === 'south') return null; // open firing face toward mid
      if (face === 'east') {
        return panelWallFinished({ variant: 'tin', hasWindow: true, width: (HALF + 0.25) * 2, height: CH });
      }
      return panelWallTin({ rusted: face === 'north', width: (HALF + 0.25) * 2, height: CH });
    },
  });
  // Waist-high sill across the open south face.
  const sill = new THREE.Mesh(
    new THREE.BoxGeometry((HALF + 0.25) * 2, 0.75, 0.12), KitMaterials.corrugatedTinRust,
  );
  sill.userData.collision = 'solid';
  sill.position.set(0, cabinY + 0.375, HALF + 0.25);
  sill.castShadow = true;
  root.add(sill);

  // The yellow ladder — full height, front face, the single access route.
  const ladder = panelLadder({ height: LEG_HEIGHT + 0.1, lean: 0.09 });
  ladder.position.set(0, 0, HALF + 0.42);
  root.add(ladder);

  const roof = panelRoofSloped({
    span: (HALF + 0.25) * 2 + 0.55, depth: (HALF + 0.25) * 2 + 0.55, pitch: 0.24, rusted: true,
  });
  roof.position.y = cabinY + CH + 0.2;
  root.add(roof);

  // Sandbag ring around the base.
  for (const cfg of [
    { x: 0, z: -HALF - 0.75, yaw: 0 },
    { x: -HALF - 0.75, z: 0, yaw: Math.PI / 2 },
    { x: HALF + 0.75, z: 0, yaw: Math.PI / 2 },
  ]) {
    const sb = panelSandbagBase({ rows: 3, width: 2.3 });
    sb.position.set(cfg.x, 0, cfg.z);
    sb.rotation.y = cfg.yaw;
    root.add(sb);
  }

  root.userData.boundingRadius = 3.6;
  root.userData.footprint = { halfExtents: [HALF + 1.4, HALF + 1.4] };
  return root;
}

// ===========================================================================
// 4. RANGE SHACK — the long open-fronted firing shed with the slatted roof
//    that the map is named for. Firing bays face out of the map boundary.
// ===========================================================================
export function buildRangeShack() {
  const root = new THREE.Group();
  root.name = 'Bldg_RangeShack';
  const HX = MODULE_WIDTH * 2.0;
  const HZ = MODULE_WIDTH * 0.95;
  const H = MODULE_HEIGHT;

  wallRing(root, {
    halfX: HX, halfZ: HZ, countX: 4, countZ: 2,
    factory: (face, i) => {
      if (face === 'south') return null;                     // fully open front
      if (face === 'north') return panelWallTin({ rusted: i % 2 === 1, width: MODULE_WIDTH });
      if (face === 'west' && i === 1) return panelWallFinished({ variant: 'raw', hasDoor: true });
      return panelWallFinished({ variant: i % 2 ? 'raw' : 'tan' });
    },
  });
  cornerPosts(root, HX, HZ, H);

  // Support posts along the open front.
  for (let i = 0; i < 4; i += 1) {
    const post = panelCornerPost({ height: H, thickness: 0.14 });
    post.position.set(-HX + (HX * 2 / 3) * i, 0, HZ);
    root.add(post);
  }
  // Firing bench along the back wall.
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(HX * 1.9, 0.12, 0.6), KitMaterials.frameWood,
  );
  bench.userData.collision = 'solid';
  bench.position.set(0, 1.0, -HZ + 0.45);
  bench.castShadow = true;
  root.add(bench);
  for (const sx of [-0.8, 0, 0.8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), KitMaterials.frameWood);
    leg.userData.collision = 'skip';
    leg.position.set(sx * HX * 0.85, 0.5, -HZ + 0.45);
    root.add(leg);
  }

  // Slatted roof — the exposed-joist top that scorestreaks can shoot through.
  const joists = panelRoofJoists({ span: HX * 2, depth: HZ * 2.2, joists: 9 });
  joists.position.y = H + 0.1;
  root.add(joists);
  const slats = panelRoofSloped({ span: HX * 2 + 0.3, depth: HZ * 1.1, pitch: 0.16, rusted: true });
  slats.position.set(0, H + 0.25, -HZ * 0.5);
  root.add(slats);

  root.userData.footprint = { halfExtents: [HX + 0.6, HZ + 0.8] };
  return root;
}

// ===========================================================================
// 5. WHITE WAREHOUSE — the long whitewashed structure on the west flank.
// ===========================================================================
export function buildWhiteWarehouse() {
  const root = new THREE.Group();
  root.name = 'Bldg_WhiteWarehouse';
  const HX = MODULE_WIDTH * 2.2;
  const HZ = MODULE_WIDTH * 1.4;
  const H = MODULE_HEIGHT * 1.45;

  wallRing(root, {
    halfX: HX, halfZ: HZ, height: H, countX: 4, countZ: 2,
    factory: (face, i) => {
      const w = face === 'north' || face === 'south' ? MODULE_WIDTH * 1.1 : MODULE_WIDTH * 1.4;
      if (face === 'south' && i === 1) {
        return panelWallFinished({ variant: 'whitewash', hasDoor: true, width: w, height: H });
      }
      if (face === 'south' && i === 3) {
        return panelWallFinished({ variant: 'whitewash', hasWindow: true, width: w, height: H });
      }
      if (face === 'north' && i === 2) {
        return panelWallFinished({ variant: 'whitewash', hasDoor: true, width: w, height: H });
      }
      if (face === 'east' && i === 0) {
        return panelWallFinished({ variant: 'whitewash', hasWindow: true, width: w, height: H });
      }
      return panelWallFinished({ variant: 'whitewash', width: w, height: H });
    },
  });
  cornerPosts(root, HX, HZ, H);

  const roof = panelRoofSloped({
    span: HX * 2 + 0.6, depth: HZ * 2 + 0.6, pitch: 0.2, variant: 'tinRust',
  });
  roof.position.y = H + 0.1;
  root.add(roof);

  // Awning over the south entrance.
  const awning = panelCamoNetAwning({ width: 3.4, depth: 2.2, posts: true });
  awning.position.set(-HX * 0.35, 2.4, HZ + 1.1);
  root.add(awning);

  root.userData.footprint = { halfExtents: [HX + 0.8, HZ + 0.8] };
  return root;
}

// ===========================================================================
// 6. ARMORY BUNKER — low, half-buried, sandbagged concrete.
// ===========================================================================
export function buildArmoryBunker() {
  const root = new THREE.Group();
  root.name = 'Bldg_ArmoryBunker';
  const HX = MODULE_WIDTH * 1.5;
  const HZ = MODULE_WIDTH * 1.1;
  const H = MODULE_HEIGHT * 0.92;

  wallRing(root, {
    halfX: HX, halfZ: HZ, height: H, countX: 2, countZ: 1,
    factory: (face, i) => {
      const w = face === 'north' || face === 'south' ? HX : HZ * 2;
      if (face === 'south' && i === 0) {
        return panelWallFinished({ variant: 'raw', hasDoor: true, width: w, height: H });
      }
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, 0.3), KitMaterials.concrete);
      wall.userData.collision = 'solid';
      wall.castShadow = true;
      wall.receiveShadow = true;
      const g = new THREE.Group();
      g.add(wall);
      return g;
    },
  });

  // Heavy concrete roof slab.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(HX * 2 + 0.7, 0.35, HZ * 2 + 0.7), KitMaterials.concrete,
  );
  slab.userData.collision = 'floor';
  slab.position.y = H + 0.175;
  slab.castShadow = true;
  slab.receiveShadow = true;
  root.add(slab);

  // Sandbag revetments on both flanks + across the front.
  for (const cfg of [
    { x: -HX - 0.45, z: 0, yaw: Math.PI / 2, rows: 3 },
    { x: HX + 0.45, z: 0, yaw: Math.PI / 2, rows: 3 },
    { x: HX * 0.55, z: HZ + 0.5, yaw: 0, rows: 2 },
  ]) {
    const sb = panelSandbagBase({ rows: cfg.rows, width: 2.4 });
    sb.position.set(cfg.x, 0, cfg.z);
    sb.rotation.y = cfg.yaw;
    root.add(sb);
  }

  const net = panelCamoNetAwning({ width: 4.0, depth: 2.6, posts: false });
  net.position.set(0, H + 0.75, 0);
  net.rotation.y = 0.2;
  root.add(net);

  root.userData.footprint = { halfExtents: [HX + 1.0, HZ + 1.0] };
  return root;
}

// ===========================================================================
// 7. RED LOCKER HUT — the small red shed by the entrance ("NEXT TIME BRING
//    BEER" in the original).
// ===========================================================================
export function buildRedLockerHut() {
  const root = new THREE.Group();
  root.name = 'Bldg_RedLockerHut';
  const HX = MODULE_WIDTH * 0.85;
  const HZ = MODULE_WIDTH * 0.7;

  wallRing(root, {
    halfX: HX, halfZ: HZ, countX: 1, countZ: 1,
    factory: (face) => {
      const w = face === 'north' || face === 'south' ? HX * 2 : HZ * 2;
      if (face === 'south') {
        return panelWallFinished({ variant: 'red', hasDoor: true, width: w });
      }
      if (face === 'east') {
        return panelWallFinished({ variant: 'red', hasWindow: true, width: w });
      }
      return panelWallTin({ variant: 'red', width: w });
    },
  });
  cornerPosts(root, HX, HZ, MODULE_HEIGHT);

  const roof = panelRoofSloped({
    span: HX * 2 + 0.4, depth: HZ * 2 + 0.4, pitch: 0.28, rusted: true,
  });
  roof.position.y = MODULE_HEIGHT + 0.1;
  root.add(roof);

  root.userData.footprint = { halfExtents: [HX + 0.5, HZ + 0.5] };
  return root;
}

// ===========================================================================
// 8. YELLOW SHOP — the yellow-fronted building with the big "2" and shuttered
//    bays (the tyre-shop/garage frontage in the reference).
// ===========================================================================
export function buildYellowShop() {
  const root = new THREE.Group();
  root.name = 'Bldg_YellowShop';
  const HX = MODULE_WIDTH * 1.6;
  const HZ = MODULE_WIDTH * 1.1;
  const H = MODULE_HEIGHT * 1.15;

  wallRing(root, {
    halfX: HX, halfZ: HZ, height: H, countX: 3, countZ: 2,
    factory: (face, i) => {
      const w = face === 'north' || face === 'south' ? (HX * 2) / 3 : HZ;
      if (face === 'south' && i === 1) {
        return panelWallFinished({ variant: 'yellow', hasDoor: true, width: w, height: H });
      }
      if (face === 'south') {
        return panelWallFinished({ variant: 'yellow', hasWindow: true, width: w, height: H });
      }
      if (face === 'west' && i === 0) {
        return panelWallFinished({ variant: 'yellow', hasWindow: true, width: w, height: H });
      }
      return panelWallTin({ variant: face === 'south' ? 'yellow' : 'tin', width: w, height: H });
    },
  });
  cornerPosts(root, HX, HZ, H);

  // Roller-shutter bay face.
  const shutter = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, H * 0.75, 0.1), KitMaterials.metalDark,
  );
  shutter.userData.collision = 'solid';
  shutter.position.set(HX * 0.45, H * 0.375, HZ + 0.02);
  shutter.castShadow = true;
  root.add(shutter);

  const roof = panelRoofSloped({
    span: HX * 2 + 0.5, depth: HZ * 2 + 0.5, pitch: 0.2, rusted: false,
  });
  roof.position.y = H + 0.1;
  root.add(roof);

  const awning = panelCamoNetAwning({ width: 3.0, depth: 1.8, posts: true });
  awning.position.set(-HX * 0.4, 2.5, HZ + 0.95);
  root.add(awning);

  root.userData.footprint = { halfExtents: [HX + 0.8, HZ + 0.9] };
  return root;
}

// ===========================================================================
// 9. TOILETS BLOCK — the small concrete utility block in the spawn corner.
// ===========================================================================
export function buildToiletsBlock() {
  const root = new THREE.Group();
  root.name = 'Bldg_Toilets';
  const HX = MODULE_WIDTH * 1.1;
  const HZ = MODULE_WIDTH * 0.6;

  wallRing(root, {
    halfX: HX, halfZ: HZ, countX: 2, countZ: 1,
    factory: (face, i) => {
      const w = face === 'north' || face === 'south' ? HX : HZ * 2;
      if (face === 'south') {
        return panelWallFinished({ variant: 'whitewash', hasDoor: true, width: w });
      }
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, MODULE_HEIGHT, 0.22), KitMaterials.concrete);
      wall.userData.collision = 'solid';
      wall.castShadow = true;
      wall.receiveShadow = true;
      const g = new THREE.Group();
      g.add(wall);
      void i;
      return g;
    },
  });

  const roof = panelRoofSloped({
    span: HX * 2 + 0.35, depth: HZ * 2 + 0.35, pitch: 0.15, variant: 'tinRust',
  });
  roof.position.y = MODULE_HEIGHT + 0.1;
  root.add(roof);

  root.userData.footprint = { halfExtents: [HX + 0.5, HZ + 0.5] };
  return root;
}

// ===========================================================================
// 10. STORAGE SHED — small tin lean-to used along the dirt road / jungle path.
// ===========================================================================
export function buildStorageShed() {
  const root = new THREE.Group();
  root.name = 'Bldg_StorageShed';
  const HX = MODULE_WIDTH * 0.75;
  const HZ = MODULE_WIDTH * 0.62;
  const H = MODULE_HEIGHT * 0.9;

  wallRing(root, {
    halfX: HX, halfZ: HZ, height: H, countX: 1, countZ: 1,
    factory: (face) => {
      const w = face === 'north' || face === 'south' ? HX * 2 : HZ * 2;
      if (face === 'south') return null; // open lean-to front
      return panelWallTin({ rusted: face === 'north', width: w, height: H });
    },
  });
  cornerPosts(root, HX, HZ, H);

  const roof = panelRoofSloped({
    span: HX * 2 + 0.45, depth: HZ * 2 + 0.6, pitch: 0.34, rusted: true,
  });
  roof.position.y = H + 0.12;
  root.add(roof);

  root.userData.footprint = { halfExtents: [HX + 0.4, HZ + 0.5] };
  return root;
}

// ===========================================================================
// 11. GUARD POST — tiny sandbagged sentry box on the perimeter road.
// ===========================================================================
export function buildGuardPost() {
  const root = new THREE.Group();
  root.name = 'Bldg_GuardPost';
  const HALF = 0.85;

  wallRing(root, {
    halfX: HALF, halfZ: HALF, countX: 1, countZ: 1,
    factory: (face) => {
      if (face === 'south') return null;
      if (face === 'east') {
        return panelWallFinished({ variant: 'raw', hasWindow: true, width: HALF * 2 });
      }
      return panelWallTin({ rusted: true, width: HALF * 2 });
    },
  });
  cornerPosts(root, HALF, HALF, MODULE_HEIGHT);

  const roof = panelRoofSloped({
    span: HALF * 2 + 0.5, depth: HALF * 2 + 0.5, pitch: 0.3, rusted: true,
  });
  roof.position.y = MODULE_HEIGHT + 0.1;
  root.add(roof);

  const sb = panelSandbagBase({ rows: 3, width: 2.0 });
  sb.position.set(0, 0, HALF + 0.55);
  root.add(sb);

  root.userData.footprint = { halfExtents: [HALF + 0.9, HALF + 0.9] };
  return root;
}

// ===========================================================================
// 12. CONCRETE PLATFORM — the raised sandbagged firing platform / cliff ledge
//     that overlooks mid (the beam-walk destination in the reference).
// ===========================================================================
export function buildConcretePlatform() {
  const root = new THREE.Group();
  root.name = 'Bldg_ConcretePlatform';
  const HX = MODULE_WIDTH * 1.3;
  const HZ = MODULE_WIDTH * 1.0;
  const H = 1.5;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(HX * 2, H, HZ * 2), KitMaterials.concrete,
  );
  body.userData.collision = 'floor';
  body.position.y = H / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  // Stairs up the west end.
  const stairs = panelStairFlight({ rise: H, run: 1.9, stepCount: 7, width: 1.2, rails: false });
  stairs.position.set(-HX - 0.95, 0, 0);
  stairs.rotation.y = Math.PI / 2;
  root.add(stairs);

  // Sandbag parapet along the exposed edge.
  const sb = panelSandbagBase({ rows: 2, width: HX * 1.9 });
  sb.position.set(0, H, HZ - 0.3);
  root.add(sb);

  root.userData.footprint = { halfExtents: [HX + 1.2, HZ + 0.6] };
  return root;
}

// ===========================================================================
// 13. PLYWOOD BARRICADE — freestanding shooting-lane wall, the partial walls
//     used as cover all over the compound.
// ===========================================================================
export function buildPlywoodBarricade() {
  const root = new THREE.Group();
  root.name = 'Bldg_PlywoodBarricade';
  const wall = panelWallFinished({ variant: 'raw', stripe: true, width: MODULE_WIDTH * 1.6 });
  wall.position.y = MODULE_HEIGHT / 2;
  root.add(wall);
  // Angled braces at the back.
  for (const sx of [-1, 1]) {
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 1.5), KitMaterials.frameWood,
    );
    brace.userData.collision = 'skip';
    brace.position.set(sx * MODULE_WIDTH * 0.6, 0.55, -0.6);
    brace.rotation.x = Math.PI / 4;
    brace.castShadow = true;
    root.add(brace);
  }
  root.userData.footprint = { halfExtents: [MODULE_WIDTH * 0.9, 0.9] };
  return root;
}

// ===========================================================================
// 14. OPEN AWNING SHELTER — freestanding camo-net shade over a sandbag nest.
// ===========================================================================
export function buildAwningShelter() {
  const root = new THREE.Group();
  root.name = 'Bldg_AwningShelter';
  const awning = panelCamoNetAwning({ width: 3.8, depth: 3.0, posts: true });
  awning.position.y = 2.35;
  root.add(awning);
  const sb = panelSandbagBase({ rows: 2, width: 2.6 });
  sb.position.set(0, 0, -1.1);
  root.add(sb);
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.7, 0.7), KitMaterials.frameWood,
  );
  crate.userData.collision = 'solid';
  crate.position.set(0.9, 0.35, 0.6);
  crate.rotation.y = 0.4;
  crate.castShadow = true;
  root.add(crate);
  root.userData.footprint = { halfExtents: [2.2, 1.9] };
  return root;
}

export const BuildingRecipes = {
  buildWoodBuildingUnfinished, buildTinBuilding, buildWatchtower, buildRangeShack,
  buildWhiteWarehouse, buildArmoryBunker, buildRedLockerHut, buildYellowShop,
  buildToiletsBlock, buildStorageShed, buildGuardPost, buildConcretePlatform,
  buildPlywoodBarricade, buildAwningShelter,
};

export default BuildingRecipes;
