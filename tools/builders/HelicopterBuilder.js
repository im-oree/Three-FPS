/**
 * HelicopterBuilder.js — 4-seat military utility helicopter (UH-60 class).
 *
 * MODELLING APPROACH
 * ------------------
 * Built with tools/lib/MeshKit.js: one lofted fuselage whose cross-section
 * changes along its length, not a stack of boxes. The previous builder of
 * this name used ~60 box meshes for 256 KB of .glb; this one is five meshes
 * and a fraction of the size.
 *
 * The silhouette comes from reference photography (see image-search/, Sikorsky
 * UH-60 side profile). Five lines make it read as a Black Hawk at 50 m:
 *
 *   1. A deep, slab-sided cabin that is WIDEST at the doors and tapers both
 *      forward to the nose and aft into the tailboom.
 *   2. A downward-sloping nose with a chin, not a flat face.
 *   3. A long thin tailboom that carries a CANTED tail rotor pylon — the
 *      single most recognisable Black Hawk feature.
 *   4. A stabilator low on the boom, well aft.
 *   5. Wheeled main gear on stub sponsons, not skids.
 *
 * Panel lines and rivets contribute nothing at gameplay range and are absent.
 *
 * WHAT IS GROUPED (and why)
 * -------------------------
 * Parts the runtime moves must not be merged into the hull:
 *   Rotor_Main       spins on local Y. Holds the blade geometry so the blades
 *                    and hub turn as one.
 *   Rotor_Tail       spins on local X, canted with its pylon.
 *   Blur_Main/Tail   flat discs, hidden at rest and faded in with rotor RPM.
 *                    A spinning 4-blade mesh strobes horribly at 60 Hz; every
 *                    flight sim cross-fades to a disc instead.
 * Everything else is static and merged per material.
 *
 * FRAME: Y=0 at the ground (bottom of the wheels), -Z forward, +X right.
 * Origin sits under the rotor mast so the physics body's centre of mass and
 * the lift point coincide — offsetting them makes a helicopter that pitches
 * when it climbs.
 */
import * as THREE from 'three';
import {
  loft, lathe, bevelBox, plate, tube, at, rot, mirrorX, merge, triCount,
} from '../lib/MeshKit.js';

// ---------------------------------------------------------------------------
// Palette — olive drab, matching the reference.
// ---------------------------------------------------------------------------
export const HELI_COLORS = {
  hull: 0x4a5340,
  trim: 0x2b2f26,
  glass: 0x2a3640,
  metal: 0x53585a,
  rotor: 0x23261f,
};

/**
 * Real UH-60 dimensions, metres. Scaled down ~12% so it fits the 22 m helipads
 * with visible clearance; a full 16.4 m rotor disc overhangs them completely
 * and reads as "too big for the map" rather than "accurate".
 */
export const HELI_DIMS = {
  length: 13.6,          // nose to tail rotor
  cabinWidth: 2.4,
  cabinHeight: 1.85,
  rotorRadius: 7.2,
  rotorHeight: 3.95,     // hub centre above ground
  /** Underside of the fuselage above the ground, standing on the gear. */
  bellyHeight: 0.62,
  tailRotorRadius: 1.5,
  boomLength: 5.4,
  gearRadius: 0.30,
};

const D = HELI_DIMS;

// ---------------------------------------------------------------------------
// Fuselage
// ---------------------------------------------------------------------------

/**
 * The cabin cross-section: a rounded-off rectangle, flat-bottomed.
 *
 * Wound counter-clockwise in XY. MeshKit.loft normalises winding, but keeping
 * it consistent here makes the shape easier to reason about.
 */
function cabinProfile() {
  const hw = D.cabinWidth / 2;
  // The belly sits BELLY_Y above the ground so the aircraft stands on its
  // wheels rather than resting on the dirt. Everything else in the builder is
  // authored against this baseline.
  const y0 = D.bellyHeight;
  const h = D.cabinHeight;
  const c = 0.34;              // corner cut
  return [
    [-hw + c, y0],
    [hw - c, y0],
    [hw, y0 + c],
    [hw, y0 + h - c],
    [hw - c * 1.3, y0 + h],
    [-hw + c * 1.3, y0 + h],
    [-hw, y0 + h - c],
    [-hw, y0 + c],
  ];
}

/**
 * Fuselage from nose to the end of the tailboom, as ONE loft.
 *
 * Stations run nose (-Z) to tail (+Z). The scale pair squeezes the profile
 * independently in X and Y, which is what turns a constant cabin box into a
 * tapering airframe: the boom is the same profile at 22% width and 45% height.
 * Offsets drop the nose and lift the boom so the belly line curves.
 */
function buildFuselage() {
  const p = cabinProfile();
  const stations = [
    // Nose: small, dropped, and pushed down for the chin.
    { z: -6.30, scale: [0.30, 0.34], offset: [0, 0.30] },
    { z: -5.85, scale: [0.52, 0.55], offset: [0, 0.20] },
    { z: -5.20, scale: [0.74, 0.76], offset: [0, 0.10] },
    // Cockpit and cabin: full section.
    { z: -4.20, scale: [0.93, 0.95], offset: [0, 0.02] },
    { z: -2.60, scale: [1.00, 1.00] },
    { z: -0.60, scale: [1.00, 1.00] },
    { z: 0.90, scale: [0.98, 0.99] },
    // Aft cabin closes down toward the boom.
    { z: 1.90, scale: [0.86, 0.90], offset: [0, 0.06] },
    { z: 2.70, scale: [0.60, 0.72], offset: [0, 0.22] },
    { z: 3.30, scale: [0.38, 0.55], offset: [0, 0.40] },
    // Tailboom: long, thin, slightly rising.
    { z: 4.60, scale: [0.24, 0.42], offset: [0, 0.52] },
    { z: 6.10, scale: [0.21, 0.38], offset: [0, 0.60] },
    { z: 7.30, scale: [0.20, 0.36], offset: [0, 0.66] },
  ];
  return loft(p, stations, { capStart: true, capEnd: true });
}

/**
 * Canted tail pylon — the Black Hawk's signature.
 *
 * The fin leans ~20 degrees so the tail rotor contributes lift as well as
 * anti-torque. Built as a small loft and then rotated about Z.
 */
function buildTailPylon() {
  const p = [
    [-0.16, 0], [0.16, 0], [0.19, 0.55], [0.12, 1.30], [-0.12, 1.30], [-0.19, 0.55],
  ];
  const fin = loft(p, [
    { z: 6.85, scale: [1.0, 1.0] },
    { z: 7.35, scale: [1.0, 1.06] },
    { z: 7.80, scale: [0.85, 0.92] },
  ], { capStart: true, capEnd: true });
  at(fin, 0, 1.28, 0);
  // Lean the whole fin to starboard.
  rot(fin, 0, 0, -0.34);
  return fin;
}

/**
 * Stabilator: the wide low tailplane, well aft on the boom.
 *
 * plate(w, h, thickness) is bevelBox(w, thickness, h) -- already flat in XZ
 * with the thickness along Y. It needs NO rotation to lie flat; rotating it
 * stands it on edge.
 */
function buildStabilator() {
  const half = plate(1.55, 0.62, 0.09, 0.03);
  at(half, 1.05, 1.36, 6.70);
  return merge([half, mirrorX(half.clone())]);
}

/**
 * Engine nacelles either side of the rotor mast.
 *
 * Two fat cylinders lying fore-aft. On the real aircraft these are the T700
 * turboshafts and they dominate the upper fuselage silhouette.
 */
function buildEngines() {
  const prof = [
    [0, -0.95], [0.32, -0.95], [0.40, -0.55], [0.40, 0.75], [0.30, 1.05], [0, 1.05],
  ];
  const nac = lathe(prof, 8);
  rot(nac, Math.PI / 2, 0, 0);
  at(nac, 0.72, 2.90, -0.30);

  // Exhaust stub, angled outboard and aft.
  const ex = lathe([[0, 0], [0.19, 0], [0.19, 0.42], [0.14, 0.50], [0, 0.50]], 7);
  rot(ex, Math.PI / 2, 0, 0.34);
  at(ex, 1.02, 2.96, 0.82);

  const side = merge([nac, ex]);
  return merge([side, mirrorX(side.clone())]);
}

/**
 * Rotor mast and hub fairing.
 *
 * Sits above the engines; the spinning Rotor_Main group is parented at its
 * top so blades pivot about the right point.
 */
function buildMast() {
  const mast = lathe([
    [0.30, 0], [0.34, 0.18], [0.26, 0.46], [0.30, 0.62], [0, 0.72],
  ], 8);
  at(mast, 0, 3.24, -0.30);
  return mast;
}

/** Stub sponsons that carry the main gear and fuel. */
function buildSponsons() {
  const s = bevelBox(0.58, 0.52, 1.85, 0.08);
  at(s, 1.30, 0.92, 0.35);
  return merge([s, mirrorX(s.clone())]);
}

/**
 * Cabin floor plate, so the open doors do not show through to the sky.
 *
 * No rotation: plate() is already a flat slab in XZ.
 */
function buildFloor() {
  const f = plate(D.cabinWidth * 0.96, 3.9, 0.08, 0.02);
  at(f, 0, 1.54, -1.0);
  return f;
}

// ---------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------

/**
 * Windscreen, chin bubble and door windows.
 *
 * Glass is inset ~2 cm rather than flush: coplanar faces z-fight, and on the
 * car build that showed up as flickering panels at distance.
 */
function buildGlass() {
  const parts = [];

  // plate() lies flat in XZ. A window is vertical, so each pane starts flat
  // and is tipped up by 90 degrees about X, THEN raked. Doing the rake first
  // (as the first version did) rotates about the wrong axis and skews the
  // pane through the fuselage.

  // Windscreen: two panes meeting at the centreline, raked back ~35 degrees.
  const wsL = plate(0.92, 1.12, 0.05, 0.02);
  rot(wsL, Math.PI / 2, 0, 0);       // stand upright, facing -Z
  rot(wsL, 0.60, 0, 0);              // rake the top backwards
  rot(wsL, 0, 0.17, 0);              // splay outboard
  at(wsL, -0.52, 2.28, -4.88);
  parts.push(wsL, mirrorX(wsL.clone()));

  // Chin bubble: the downward-view panel under the pilots' feet. Nearly flat,
  // so only a small tip from horizontal.
  const chin = plate(1.06, 0.66, 0.05, 0.02);
  rot(chin, 0.42, 0, 0);
  at(chin, 0, 1.44, -5.26);
  parts.push(chin);

  // Cabin door windows: upright, on the slab flank, facing +X.
  const door = plate(1.30, 0.62, 0.05, 0.02);
  rot(door, Math.PI / 2, 0, 0);
  rot(door, 0, Math.PI / 2, 0);
  at(door, D.cabinWidth / 2 - 0.03, 2.24, -1.55);
  parts.push(door, mirrorX(door.clone()));

  // Cockpit side glass, forward of the doors.
  const sideL = plate(0.85, 0.58, 0.05, 0.02);
  rot(sideL, Math.PI / 2, 0, 0);
  rot(sideL, 0, Math.PI / 2, 0);
  at(sideL, D.cabinWidth / 2 - 0.12, 2.24, -3.60);
  parts.push(sideL, mirrorX(sideL.clone()));

  return merge(parts);
}

// ---------------------------------------------------------------------------
// Rotors
// ---------------------------------------------------------------------------

/**
 * One rotor blade: a long thin aerofoil, tapered and slightly twisted.
 *
 * Built as a loft so the tip is narrower than the root — a constant-chord
 * rectangle reads as a plank.
 */
function buildBlade(radius, chord) {
  const p = [
    [-chord * 0.5, 0], [chord * 0.42, 0], [chord * 0.5, 0.05],
    [chord * 0.30, 0.085], [-chord * 0.42, 0.06],
  ];
  const blade = loft(p, [
    { z: 0, scale: [1.0, 1.0] },
    { z: -radius * 0.55, scale: [0.94, 0.92] },
    { z: -radius * 0.88, scale: [0.82, 0.80] },
    { z: -radius, scale: [0.55, 0.62] },
  ], { capStart: true, capEnd: true });
  return blade;
}

/**
 * Main rotor: hub plus four blades, as a Group the runtime spins on Y.
 *
 * Also carries Blur_Main, a disc that is hidden at rest and cross-faded in as
 * RPM rises. Spinning discrete blades at 60 Hz aliases into a strobing mess;
 * this is the standard fix.
 */
function buildMainRotor(matRotor, matMetal) {
  const g = new THREE.Group();
  g.name = 'Rotor_Main';
  g.position.set(0, D.rotorHeight, -0.30);

  const hubGeo = merge([
    lathe([[0.36, 0], [0.42, 0.10], [0.38, 0.26], [0, 0.32]], 8),
    // Blade grips: four stubs radiating from the hub.
    ...[0, 1, 2, 3].map((i) => {
      const grip = bevelBox(0.20, 0.16, 0.62, 0.03);
      at(grip, 0, 0.14, -0.46);
      rot(grip, 0, (i * Math.PI) / 2, 0);
      return grip;
    }),
  ]);
  const hub = new THREE.Mesh(hubGeo, matMetal);
  hub.name = 'Rotor_MainHub';
  g.add(hub);

  const blades = [];
  for (let i = 0; i < 4; i += 1) {
    const b = buildBlade(D.rotorRadius, 0.46);
    at(b, 0, 0.12, -0.55);
    rot(b, 0, (i * Math.PI) / 2, 0);
    blades.push(b);
  }
  const bladeMesh = new THREE.Mesh(merge(blades), matRotor);
  bladeMesh.name = 'Rotor_MainBlades';
  g.add(bladeMesh);

  // Blur disc: a flat ring, invisible until the rotor spools up.
  const disc = new THREE.Mesh(
    new THREE.RingGeometry(D.rotorRadius * 0.22, D.rotorRadius, 24, 1),
    new THREE.MeshBasicMaterial({
      color: HELI_COLORS.rotor, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.14;
  disc.name = 'Blur_Main';
  disc.visible = false;
  g.add(disc);

  return g;
}

/** Tail rotor: canted with the pylon, spins on local X. */
function buildTailRotor(matRotor, matMetal) {
  const g = new THREE.Group();
  g.name = 'Rotor_Tail';
  // Position matches the canted pylon's top, port side.
  g.position.set(-0.46, 2.48, 7.32);
  g.rotation.z = -0.34;

  const hub = new THREE.Mesh(
    lathe([[0.16, -0.08], [0.20, 0], [0.16, 0.14], [0, 0.18]], 7),
    matMetal,
  );
  rot(hub.geometry, 0, 0, Math.PI / 2);
  hub.name = 'Rotor_TailHub';
  g.add(hub);

  const blades = [];
  for (let i = 0; i < 4; i += 1) {
    const b = buildBlade(D.tailRotorRadius, 0.26);
    at(b, 0, 0, -0.18);
    rot(b, 0, 0, (i * Math.PI) / 2);
    // Lay the disc into the XY plane so it spins about X.
    rot(b, 0, Math.PI / 2, 0);
    blades.push(b);
  }
  const bladeMesh = new THREE.Mesh(merge(blades), matRotor);
  bladeMesh.name = 'Rotor_TailBlades';
  g.add(bladeMesh);

  const disc = new THREE.Mesh(
    new THREE.RingGeometry(D.tailRotorRadius * 0.25, D.tailRotorRadius, 16, 1),
    new THREE.MeshBasicMaterial({
      color: HELI_COLORS.rotor, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  disc.rotation.y = Math.PI / 2;
  disc.name = 'Blur_Tail';
  disc.visible = false;
  g.add(disc);

  return g;
}

// ---------------------------------------------------------------------------
// Landing gear
// ---------------------------------------------------------------------------

/** One wheel plus its strut. Wheels do not steer or spin, so they merge. */
function wheelAndStrut(x, z, strutTop) {
  const w = lathe([
    [0, -0.11], [D.gearRadius * 0.55, -0.13], [D.gearRadius, -0.09],
    [D.gearRadius, 0.09], [D.gearRadius * 0.55, 0.13], [0, 0.11],
  ], 9);
  rot(w, 0, 0, Math.PI / 2);
  at(w, x, D.gearRadius, z);

  const strut = tube(
    [x, D.gearRadius, z], [x * 0.72, strutTop, z], 0.055, 5,
  );
  return merge([w, strut]);
}

function buildGear() {
  const parts = [
    wheelAndStrut(1.22, 0.42, 1.30),      // main, starboard
    wheelAndStrut(-1.22, 0.42, 1.30),     // main, port
    // Tailwheel, far aft under the boom.
    wheelAndStrut(0, 6.30, 1.30),
  ];
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/** Door rails, steps, aerials and the nose pitot — cheap silhouette breakers. */
function buildTrim() {
  const parts = [];

  // Door slide rails, top and bottom of the cabin opening.
  for (const y of [1.90, 2.64]) {
    const rail = bevelBox(0.07, 0.07, 2.30, 0.015);
    at(rail, D.cabinWidth / 2 + 0.02, y, -1.55);
    parts.push(rail, mirrorX(rail.clone()));
  }

  // Boarding step under each door.
  const step = bevelBox(0.52, 0.06, 0.34, 0.02);
  at(step, 1.30, 0.66, -1.05);
  parts.push(step, mirrorX(step.clone()));

  // Pitot booms on the nose.
  parts.push(tube([0.42, 2.04, -6.10], [0.52, 2.12, -6.95], 0.030, 5));
  parts.push(tube([-0.42, 2.04, -6.10], [-0.52, 2.12, -6.95], 0.030, 5));

  // Tail bumper under the stabilator.
  parts.push(tube([0, 1.24, 7.05], [0, 0.42, 7.48], 0.045, 5));

  return merge(parts);
}

/**
 * Stub wings (ESSS) carrying the hardpoints.
 *
 * Short, thick pylons either side above the sponsons; the weapon sockets hang
 * off their tips.
 */
function buildStubWings() {
  const wing = loft(
    [[-0.09, -0.16], [0.09, -0.16], [0.11, 0.10], [-0.11, 0.10]],
    [
      { z: -0.55, scale: 1.0 },
      { z: 0.20, scale: [1.0, 1.15] },
      { z: 0.60, scale: [0.8, 0.9] },
    ],
    { capStart: true, capEnd: true },
  );
  rot(wing, 0, 0, -Math.PI / 2);
  at(wing, 1.72, 2.30, -0.60);
  return merge([wing, mirrorX(wing.clone())]);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * @param {object} [opts]
 * @param {boolean} [opts.doorGuns=true]  Include the two door miniguns.
 * @returns {{root: THREE.Group, stats: {triangles:number, meshes:number}}}
 */
export function buildHelicopterPattern(opts = {}) {
  const { doorGuns = true } = opts;
  const root = new THREE.Group();
  root.name = 'Root_Vehicle';

  const matHull = new THREE.MeshStandardMaterial({
    color: HELI_COLORS.hull, roughness: 0.86, metalness: 0.08, flatShading: true,
  });
  const matTrim = new THREE.MeshStandardMaterial({
    color: HELI_COLORS.trim, roughness: 0.82, metalness: 0.22, flatShading: true,
  });
  const matGlass = new THREE.MeshStandardMaterial({
    color: HELI_COLORS.glass, roughness: 0.16, metalness: 0.12, flatShading: true,
  });
  const matMetal = new THREE.MeshStandardMaterial({
    color: HELI_COLORS.metal, roughness: 0.60, metalness: 0.48, flatShading: true,
  });
  const matRotor = new THREE.MeshStandardMaterial({
    color: HELI_COLORS.rotor, roughness: 0.90, metalness: 0.10, flatShading: true,
  });

  // Hull: everything body-coloured, merged into one mesh.
  const hull = new THREE.Mesh(merge([
    buildFuselage(), buildTailPylon(), buildStabilator(),
    buildEngines(), buildSponsons(),
  ]), matHull);
  hull.name = 'Hull';
  root.add(hull);

  // Trim: dark details plus the cabin floor.
  const trim = new THREE.Mesh(merge([
    buildTrim(), buildFloor(), buildStubWings(),
  ]), matTrim);
  trim.name = 'Trim';
  root.add(trim);

  const glass = new THREE.Mesh(buildGlass(), matGlass);
  glass.name = 'Glass';
  root.add(glass);

  const metal = new THREE.Mesh(merge([buildMast(), buildGear()]), matMetal);
  metal.name = 'Metal';
  root.add(metal);

  root.add(buildMainRotor(matRotor, matMetal));
  root.add(buildTailRotor(matRotor, matMetal));

  // --- Sockets ------------------------------------------------------------
  // Empty Object3Ds the runtime looks up by name. Seat sockets are where the
  // occupant's head goes, so they sit at seated eye height above the floor.
  const socket = (name, x, y, z, ry = 0) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    o.rotation.y = ry;
    root.add(o);
    return o;
  };

  socket('Socket_Seat_Pilot', -0.60, 2.10, -4.05);
  socket('Socket_Seat_Copilot', 0.60, 2.10, -4.05);
  socket('Socket_Seat_CrewLeft', -0.72, 2.06, -1.55, Math.PI / 2);
  socket('Socket_Seat_CrewRight', 0.72, 2.06, -1.55, -Math.PI / 2);

  socket('Socket_Door_Pilot', -1.42, 0.30, -3.90);
  socket('Socket_Door_Copilot', 1.42, 0.30, -3.90);
  socket('Socket_Door_CrewLeft', -1.58, 0.30, -1.55);
  socket('Socket_Door_CrewRight', 1.58, 0.30, -1.55);

  socket('Socket_Hardpoint_L', -2.05, 2.30, -0.60);
  socket('Socket_Hardpoint_R', 2.05, 2.30, -0.60);

  // Exhausts, for the heat-haze/smoke emitters.
  socket('Socket_Exhaust_L', -1.10, 2.96, 0.95);
  socket('Socket_Exhaust_R', 1.10, 2.96, 0.95);

  // Rotor wash origin: directly under the disc, used by the VFX layer to
  // throw dust when close to the ground.
  socket('Socket_RotorWash', 0, 0.10, -0.30);

  if (doorGuns) {
    // Door miniguns on pintle mounts, one per crew door. Grouped so they can
    // traverse independently later.
    for (const [side, sign] of [['L', -1], ['R', 1]]) {
      const g = new THREE.Group();
      g.name = `Gun_Door${side}`;
      g.position.set(sign * 1.18, 2.06, -1.95);

      const barrel = tube([0, 0, 0], [0, 0, -0.92], 0.055, 6);
      const body = bevelBox(0.16, 0.18, 0.40, 0.03);
      at(body, 0, 0, 0.16);
      const mount = tube([0, 0, 0.10], [0, -0.42, 0.14], 0.045, 5);
      const gun = new THREE.Mesh(merge([barrel, body, mount]), matMetal);
      gun.name = `Gun_Door${side}_Mesh`;
      g.add(gun);

      const muzzle = new THREE.Object3D();
      muzzle.name = `Socket_Muzzle_Door${side}`;
      muzzle.position.set(0, 0, -0.95);
      g.add(muzzle);

      root.add(g);
    }
  }

  // --- Legacy aliases --------------------------------------------------------
  // The attack-helicopter KILLSTREAK predates this builder and drives the
  // model through an older node contract (Bone_*/Socket_Pilot/Socket_Muzzle_*).
  // Rather than fork the mesh or rename the modern nodes the drivable vehicle
  // depends on, expose zero-cost alias Object3Ds parented to the real ones, so
  // both contracts resolve against a single asset.
  const alias = (name, parent) => {
    if (!parent) return;
    const a = new THREE.Object3D();
    a.name = name;
    parent.add(a);
  };
  alias('Bone_MainRotorHub', root.getObjectByName('Rotor_Main'));
  alias('Bone_TailRotorHub', root.getObjectByName('Rotor_Tail'));
  alias('Socket_Pilot', root.getObjectByName('Socket_Seat_Pilot'));
  alias('Socket_Muzzle_L', root.getObjectByName('Socket_Muzzle_DoorL'));
  alias('Socket_Muzzle_R', root.getObjectByName('Socket_Muzzle_DoorR'));

  // --- Stats ---------------------------------------------------------------
  let triangles = 0;
  let meshes = 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      // The blur discs are not part of the model's real cost: they are hidden
      // at rest and replace the blades when visible.
      if (/^Blur_/.test(o.name)) return;
      triangles += triCount(o.geometry);
      meshes += 1;
    }
  });

  return { root, stats: { triangles, meshes } };
}

export default buildHelicopterPattern;
