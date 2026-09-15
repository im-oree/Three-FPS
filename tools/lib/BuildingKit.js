/**
 * BuildingKit.js — Document N §3.1: the modular building kit.
 *
 * A small library of standardised architectural PANELS on a fixed connection
 * grid (every wall module is 2.4 m wide x 2.6 m tall). Whole buildings are
 * assembled by recipes placing panels edge-to-edge (BuildingRecipes.js) rather
 * than each of Firing Range's dozen-plus structures being a bespoke one-off
 * mesh script. This is how real level-design kits work, and it is the only
 * reason ~14 unique-looking buildings are producible here at all.
 *
 * COLLISION CONTRACT — the important part. Every panel tags its meshes with
 * userData.collision:
 *     'solid'  -> becomes a collider cuboid
 *     'skip'   -> decorative only (net sag, corrugation ribs, ladder rungs,
 *                 railings, roof lips), never collides
 *     'floor'  -> a walkable deck; collides, and is what makes lofts standable
 * BuildingColliderGenerator walks the assembled hierarchy and reads exactly
 * that. Door and window panels are built as separate pillar/lintel/sill
 * meshes, so an opening a player can walk and shoot through falls out of the
 * generic walk for free — no per-building hand-authored collider boxes.
 *
 * Palette note: colours are authored LOW. Firing Range ships under a hard,
 * bright sun HDRI plus IBL plus a sun light; mid-grey albedo tone-maps to
 * near-white under that stack (the "map going white" class of bug already hit
 * this project once on Shipment).
 */
import * as THREE from 'three';

export const MODULE_WIDTH = 2.4;
export const MODULE_HEIGHT = 2.6;
export const WALL_THICKNESS = 0.14;

const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, ...o });

export const KitMaterials = {
  plywoodRaw: std({ color: 0x9c7f52, roughness: 0.92, metalness: 0.0 }),
  plywoodTan: std({ color: 0x8d7449, roughness: 0.92, metalness: 0.0 }),
  plywoodPale: std({ color: 0x9f9075, roughness: 0.90, metalness: 0.0 }),
  blueStripe: std({ color: 0x3c5570, roughness: 0.85, metalness: 0.0 }),
  frameWood: std({ color: 0x6d5334, roughness: 0.93, metalness: 0.0 }),
  frameWoodDark: std({ color: 0x53402a, roughness: 0.94, metalness: 0.0 }),
  corrugatedTin: std({ color: 0x6f6a61, roughness: 0.62, metalness: 0.45 }),
  corrugatedTinRust: std({ color: 0x6a4a31, roughness: 0.78, metalness: 0.30 }),
  tinGreen: std({ color: 0x4d5a45, roughness: 0.70, metalness: 0.35 }),
  tinYellow: std({ color: 0x9a7f33, roughness: 0.72, metalness: 0.25 }),
  tinRed: std({ color: 0x7d3a2c, roughness: 0.80, metalness: 0.20 }),
  whitewash: std({ color: 0x9a968a, roughness: 0.90, metalness: 0.05 }),
  concrete: std({ color: 0x6d6a62, roughness: 0.95, metalness: 0.02 }),
  sandbag: std({ color: 0x7a6d4c, roughness: 0.96, metalness: 0.0 }),
  camoNet: std({ color: 0x3f4a33, roughness: 0.95, metalness: 0.0 }),
  metalDark: std({ color: 0x2b2e30, roughness: 0.60, metalness: 0.60 }),
  ladderYellow: std({ color: 0x9c8420, roughness: 0.70, metalness: 0.30 }),
};

/** Tag a mesh (and mark it for the collider generator). */
function tag(mesh, collision, name) {
  mesh.userData.collision = collision;
  if (name) mesh.name = name;
  if (collision !== 'skip') {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return mesh;
}

const solid = (mesh, name) => tag(mesh, 'solid', name);
const skip = (mesh, name) => tag(mesh, 'skip', name);
const floor = (mesh, name) => tag(mesh, 'floor', name);

function variantMaterial(variant) {
  switch (variant) {
    case 'raw': return KitMaterials.plywoodRaw;
    case 'pale': return KitMaterials.plywoodPale;
    case 'blueStripe': return KitMaterials.blueStripe;
    case 'whitewash': return KitMaterials.whitewash;
    case 'tin': return KitMaterials.corrugatedTin;
    case 'tinRust': return KitMaterials.corrugatedTinRust;
    case 'yellow': return KitMaterials.tinYellow;
    case 'red': return KitMaterials.tinRed;
    case 'green': return KitMaterials.tinGreen;
    default: return KitMaterials.plywoodTan;
  }
}

/**
 * WALL PANEL — finished plywood sheeting, optional door / window cutout and
 * the painted stripe band seen across the reference building faces.
 *
 * Doors and windows are REAL GAPS: the panel is built as side pillars plus a
 * lintel (and a sill for windows), so players walk and shoot through them.
 */
export function panelWallFinished({
  variant = 'tan', hasDoor = false, hasWindow = false, stripe = false,
  width = MODULE_WIDTH, height = MODULE_HEIGHT, thickness = WALL_THICKNESS,
} = {}) {
  const group = new THREE.Group();
  group.name = 'WallPanel_Finished';
  const mat = variantMaterial(variant);

  if (hasDoor) {
    const doorW = Math.min(1.05, width * 0.45);
    const doorH = Math.min(2.05, height - 0.35);
    const pillarW = (width - doorW) / 2;
    const left = solid(new THREE.Mesh(new THREE.BoxGeometry(pillarW, height, thickness), mat));
    left.position.x = -(doorW / 2 + pillarW / 2);
    const right = left.clone();
    right.position.x = doorW / 2 + pillarW / 2;
    const lintelH = height - doorH;
    const lintel = solid(new THREE.Mesh(
      new THREE.BoxGeometry(doorW, lintelH, thickness), mat,
    ));
    // Panels are centred on their own origin, so the lintel sits directly
    // above the door opening: doorH up from the panel's bottom edge.
    lintel.position.y = doorH + lintelH / 2 - height / 2;
    group.add(left, right, lintel);
    group.userData.hasOpening = true;
  } else if (hasWindow) {
    const winW = Math.min(1.15, width * 0.5);
    const winH = 0.95;
    const sillY = 1.05;
    const base = solid(new THREE.Mesh(new THREE.BoxGeometry(width, sillY, thickness), mat));
    base.position.y = sillY / 2 - height / 2;
    const topH = height - sillY - winH;
    const top = solid(new THREE.Mesh(new THREE.BoxGeometry(width, topH, thickness), mat));
    top.position.y = sillY + winH + topH / 2 - height / 2;
    const sideW = (width - winW) / 2;
    const sideL = solid(new THREE.Mesh(new THREE.BoxGeometry(sideW, winH, thickness), mat));
    sideL.position.set(-(winW / 2 + sideW / 2), sillY + winH / 2 - height / 2, 0);
    const sideR = sideL.clone();
    sideR.position.x = winW / 2 + sideW / 2;
    group.add(base, top, sideL, sideR);
    group.userData.hasOpening = true;
  } else {
    group.add(solid(new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), mat)));
    group.userData.hasOpening = false;
  }

  // Plank scoring — thin proud battens; visual only.
  const battenCount = Math.max(2, Math.round(width / 0.8));
  for (let i = 1; i < battenCount; i += 1) {
    const batten = skip(new THREE.Mesh(
      new THREE.BoxGeometry(0.035, height * 0.97, 0.02), KitMaterials.frameWoodDark,
    ));
    batten.position.set(-width / 2 + (width / battenCount) * i, 0, thickness / 2 + 0.01);
    group.add(batten);
  }

  if (stripe) {
    const band = skip(new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.99, 0.3, thickness + 0.03), KitMaterials.blueStripe,
    ));
    band.position.y = height * 0.06;
    group.add(band);
  }
  return group;
}

/**
 * WALL PANEL — unfinished timber stud frame, no sheathing. The
 * "under construction" look that defines the reference wood building:
 * deliberately see-through and shootable between the studs, but it still
 * BLOCKS movement, so the collider generator gets one thin full-height solid.
 */
export function panelWallFrame({
  width = MODULE_WIDTH, height = MODULE_HEIGHT, studCount = 5, brace = true,
} = {}) {
  const group = new THREE.Group();
  group.name = 'WallPanel_Frame';
  const studGeo = new THREE.BoxGeometry(0.09, height, 0.09);
  for (let i = 0; i < studCount; i += 1) {
    const stud = skip(new THREE.Mesh(studGeo, KitMaterials.frameWood));
    stud.position.x = -width / 2 + (i / (studCount - 1)) * width;
    stud.castShadow = true;
    group.add(stud);
  }
  const topPlate = skip(new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.1, 0.1), KitMaterials.frameWood,
  ));
  topPlate.position.y = height / 2 - 0.05;
  const botPlate = topPlate.clone();
  botPlate.position.y = -height / 2 + 0.05;
  group.add(topPlate, botPlate);
  if (brace) {
    const diag = skip(new THREE.Mesh(
      new THREE.BoxGeometry(0.07, Math.hypot(width, height) * 0.98, 0.07), KitMaterials.frameWood,
    ));
    diag.rotation.z = Math.atan2(width, height);
    group.add(diag);
  }
  // The one invisible collision proxy: porous to sight and bullets, solid to
  // bodies — exactly how the reference building plays.
  const blocker = solid(new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.1), KitMaterials.frameWood,
  ), 'FrameBlocker');
  blocker.visible = false;
  group.add(blocker);
  group.userData.hasOpening = true;
  return group;
}

/** WALL PANEL — corrugated tin sheeting (sheds, tower cladding, shop fronts). */
export function panelWallTin({
  rusted = false, variant = null, width = MODULE_WIDTH, height = MODULE_HEIGHT,
  ribs = true,
} = {}) {
  const mat = variant
    ? variantMaterial(variant)
    : (rusted ? KitMaterials.corrugatedTinRust : KitMaterials.corrugatedTin);
  const group = new THREE.Group();
  group.name = 'WallPanel_Tin';
  group.add(solid(new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.07), mat)));
  if (ribs) {
    const ribCount = Math.max(4, Math.round(width / 0.26));
    const ribGeo = new THREE.BoxGeometry(0.035, height * 0.985, 0.035);
    for (let i = 0; i <= ribCount; i += 1) {
      const rib = skip(new THREE.Mesh(ribGeo, mat));
      rib.position.set(-width / 2 + (i / ribCount) * width, 0, 0.05);
      group.add(rib);
    }
  }
  group.userData.hasOpening = false;
  return group;
}

/** Low defensive sandbag run — a fixed-width kit module. */
export function panelSandbagBase({ rows = 2, width = MODULE_WIDTH, perRow = 6 } = {}) {
  const group = new THREE.Group();
  group.name = 'SandbagBasePanel';
  const bagGeo = new THREE.SphereGeometry(0.25, 6, 4);
  bagGeo.scale(1.35, 0.72, 1.0);
  for (let row = 0; row < rows; row += 1) {
    const count = perRow - (row % 2);
    for (let i = 0; i < count; i += 1) {
      const bag = skip(new THREE.Mesh(bagGeo, KitMaterials.sandbag));
      bag.position.set(
        -width / 2 + ((i + (row % 2) * 0.5) / (perRow - 1)) * width,
        0.17 + row * 0.29,
        (row % 2) * 0.06,
      );
      bag.rotation.y = (i * 1.7 + row) * 0.4;
      bag.castShadow = true;
      bag.receiveShadow = true;
      group.add(bag);
    }
  }
  // One clean collision box for the whole run — 12 sphere colliders per
  // sandbag wall would be an absurd physics bill for waist-high cover.
  const h = rows * 0.29 + 0.06;
  const blocker = solid(new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.2, h, 0.62), KitMaterials.sandbag,
  ), 'SandbagBlocker');
  blocker.position.y = h / 2;
  blocker.visible = false;
  group.add(blocker);
  return group;
}

/** Sloped corrugated roof — the single-pitch roofline every reference building has. */
export function panelRoofSloped({
  span = MODULE_WIDTH * 2, depth = 3.0, pitch = 0.3, rusted = false, variant = null,
  lip = true,
} = {}) {
  const mat = variant
    ? variantMaterial(variant)
    : (rusted ? KitMaterials.corrugatedTinRust : KitMaterials.corrugatedTin);
  const group = new THREE.Group();
  group.name = 'RoofPanel_Sloped';

  const deck = floor(new THREE.Mesh(new THREE.BoxGeometry(span, 0.1, depth), mat), 'RoofDeck');
  deck.rotation.x = -pitch;
  group.add(deck);

  // Corrugation ridges running down the slope.
  const ridgeCount = Math.max(4, Math.round(span / 0.32));
  const ridgeGeo = new THREE.BoxGeometry(0.04, 0.04, depth * 0.99);
  for (let i = 0; i <= ridgeCount; i += 1) {
    const ridge = skip(new THREE.Mesh(ridgeGeo, mat));
    ridge.position.set(-span / 2 + (i / ridgeCount) * span, 0.07, 0);
    ridge.rotation.x = -pitch;
    group.add(ridge);
  }
  if (lip) {
    const lipMesh = skip(new THREE.Mesh(new THREE.BoxGeometry(span, 0.14, 0.07), mat));
    lipMesh.position.set(0, -Math.sin(pitch) * depth / 2 - 0.05, Math.cos(pitch) * depth / 2);
    group.add(lipMesh);
  }
  return group;
}

/** Flat roof / open-joist deck (the partially-roofed, exposed-rafter look). */
export function panelRoofJoists({ span = MODULE_WIDTH * 2, depth = 3.0, joists = 7 } = {}) {
  const group = new THREE.Group();
  group.name = 'RoofPanel_Joists';
  const beamGeo = new THREE.BoxGeometry(0.1, 0.18, depth);
  for (let i = 0; i < joists; i += 1) {
    const beam = skip(new THREE.Mesh(beamGeo, KitMaterials.frameWood));
    beam.position.x = -span / 2 + (i / (joists - 1)) * span;
    beam.castShadow = true;
    group.add(beam);
  }
  const ridge = skip(new THREE.Mesh(
    new THREE.BoxGeometry(span, 0.16, 0.16), KitMaterials.frameWood,
  ));
  ridge.position.y = 0.16;
  group.add(ridge);
  return group;
}

/**
 * STAIR FLIGHT — real stepped geometry, climbed by normal player movement.
 * Stepped rather than a smooth ramp on purpose: the capsule controller's
 * step-offset handling (Document 2) walks these like any solid stairs, so no
 * special traversal code exists or is needed.
 */
export function panelStairFlight({
  rise = MODULE_HEIGHT, run = 2.6, stepCount = 10, width = 1.15, rails = true,
} = {}) {
  const group = new THREE.Group();
  group.name = 'StairFlight';
  const stepH = rise / stepCount;
  const stepD = run / stepCount;
  for (let i = 0; i < stepCount; i += 1) {
    // Each tread is a full-height riser block: the solid under-mass means the
    // collider is a clean staircase of boxes with no gaps to fall through.
    const h = stepH * (i + 1);
    const step = solid(new THREE.Mesh(new THREE.BoxGeometry(width, h, stepD), KitMaterials.frameWood));
    step.position.set(0, h / 2, -run / 2 + stepD * (i + 0.5));
    group.add(step);
  }
  if (rails) {
    const railGeo = new THREE.BoxGeometry(0.06, 0.85, run * 1.02);
    for (const sx of [-1, 1]) {
      const rail = skip(new THREE.Mesh(railGeo, KitMaterials.frameWood));
      rail.position.set(sx * (width / 2 - 0.03), rise * 0.62, 0);
      rail.rotation.x = -Math.atan2(rise, run);
      rail.castShadow = true;
      group.add(rail);
    }
  }
  group.userData.climbVolume = { width, run, rise }; // reserved seam (Document N §1)
  return group;
}

/**
 * LADDER — the yellow watchtower ladder from the reference images.
 *
 * Climbable by normal movement: the rungs are pitched at 0.28 m, inside the
 * capsule's step tolerance, and the ladder leans back slightly so the capsule
 * stays in contact. Rungs are SOLID (they are what you stand on); rails are
 * skipped so you never snag on them.
 */
export function panelLadder({ height = MODULE_HEIGHT * 2, lean = 0.12 } = {}) {
  const group = new THREE.Group();
  group.name = 'Ladder';
  const railGeo = new THREE.BoxGeometry(0.055, height, 0.055);
  for (const sx of [-1, 1]) {
    const rail = skip(new THREE.Mesh(railGeo, KitMaterials.ladderYellow));
    rail.position.set(sx * 0.28, height / 2, 0);
    rail.castShadow = true;
    group.add(rail);
  }
  // Rung pitch is 0.28 m: comfortably under the character controller's step
  // offset, so climbing is ordinary walking-up-steps rather than a bespoke
  // climb mode. The collidable tread is DEEPER than the visible bar (0.24 vs
  // 0.11) — a capsule needs somewhere to actually stand, and a 0.11 m ledge
  // is thin enough that the controller slides off between rungs.
  const rungCount = Math.max(2, Math.floor(height / 0.28));
  const rungGeo = new THREE.BoxGeometry(0.62, 0.05, 0.11);
  for (let i = 1; i <= rungCount; i += 1) {
    const rung = skip(new THREE.Mesh(rungGeo, KitMaterials.ladderYellow));
    rung.position.y = i * (height / (rungCount + 1));
    rung.castShadow = true;
    group.add(rung);

    const tread = solid(new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.06, 0.24), KitMaterials.ladderYellow,
    ));
    tread.visible = false;          // collision proxy only
    tread.position.set(0, rung.position.y, -0.06);
    group.add(tread);
  }
  group.rotation.x = lean;
  group.userData.climbVolume = { height }; // reserved seam (Document N §1)
  return group;
}

/** Elevated walkable deck — tower tops, lofts, mezzanines. */
export function panelFloorPlatform({
  width = MODULE_WIDTH, depth = MODULE_WIDTH, railed = true, thickness = 0.16,
  openSides = [],
} = {}) {
  const group = new THREE.Group();
  group.name = 'FloorPlatform';
  group.add(floor(new THREE.Mesh(
    new THREE.BoxGeometry(width, thickness, depth), KitMaterials.frameWood,
  ), 'Deck'));

  if (railed) {
    const railH = 0.95;
    const sides = [
      { id: 'north', geo: [width, railH, 0.07], pos: [0, railH / 2 + thickness / 2, -depth / 2] },
      { id: 'south', geo: [width, railH, 0.07], pos: [0, railH / 2 + thickness / 2, depth / 2] },
      { id: 'west', geo: [0.07, railH, depth], pos: [-width / 2, railH / 2 + thickness / 2, 0] },
      { id: 'east', geo: [0.07, railH, depth], pos: [width / 2, railH / 2 + thickness / 2, 0] },
    ];
    for (const side of sides) {
      if (openSides.includes(side.id)) continue;
      const rail = solid(new THREE.Mesh(new THREE.BoxGeometry(...side.geo), KitMaterials.frameWood));
      rail.position.set(...side.pos);
      group.add(rail);
    }
  }
  return group;
}

/** Camo-net awning draped over a frame — the shade structures in every shot. */
export function panelCamoNetAwning({ width = 3.2, depth = 2.6, posts = true } = {}) {
  const group = new THREE.Group();
  group.name = 'CamoNetAwning';
  const geo = new THREE.PlaneGeometry(width, depth, 6, 5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    // Catenary-ish sag in both directions.
    const u = pos.getX(i) / width;
    const v = pos.getY(i) / depth;
    pos.setZ(i, -(0.28 * (0.25 - u * u) + 0.2 * (0.25 - v * v)));
  }
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const net = skip(new THREE.Mesh(geo, KitMaterials.camoNet), 'CamoNetSheet');
  net.material.side = THREE.DoubleSide;
  net.castShadow = true;
  group.add(net);
  if (posts) {
    const postGeo = new THREE.BoxGeometry(0.08, 2.3, 0.08);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = solid(new THREE.Mesh(postGeo, KitMaterials.frameWood));
        post.position.set(sx * (width / 2 - 0.1), -1.15, sz * (depth / 2 - 0.1));
        group.add(post);
      }
    }
  }
  return group;
}

/** Corner / edge post — ties panel runs together and reads as real framing. */
export function panelCornerPost({ height = MODULE_HEIGHT, thickness = 0.16 } = {}) {
  const post = solid(new THREE.Mesh(
    new THREE.BoxGeometry(thickness, height, thickness), KitMaterials.frameWood,
  ), 'CornerPost');
  post.position.y = height / 2;
  const group = new THREE.Group();
  group.name = 'CornerPost';
  group.add(post);
  return group;
}

/**
 * Lay a run of N panels edge-to-edge along local +X, centred on the origin —
 * the workhorse every recipe uses instead of hand-positioning each module.
 */
export function panelRun({ count, factory, width = MODULE_WIDTH, height = MODULE_HEIGHT }) {
  const group = new THREE.Group();
  group.name = 'PanelRun';
  const total = count * width;
  for (let i = 0; i < count; i += 1) {
    const panel = factory(i);
    if (!panel) continue;
    panel.position.x = -total / 2 + width * (i + 0.5);
    panel.position.y += height / 2;
    group.add(panel);
  }
  return group;
}

export const BuildingKit = {
  panelWallFinished, panelWallFrame, panelWallTin, panelSandbagBase,
  panelRoofSloped, panelRoofJoists, panelStairFlight, panelLadder,
  panelFloorPlatform, panelCamoNetAwning, panelCornerPost, panelRun,
  MODULE_WIDTH, MODULE_HEIGHT, WALL_THICKNESS, KitMaterials,
};

export default BuildingKit;
