/**
 * MilitaryCarBuilder.js — 4-seat military light utility vehicle (Humvee class).
 *
 * MODELLING APPROACH
 * ------------------
 * Built with tools/lib/MeshKit.js, not stacked boxes. The difference matters:
 *
 *   old JeepBuilder style : ~60 separate box Meshes, ~1000 tris, 60 draw
 *                           calls, boxy silhouette, 256 KB of .glb
 *   this builder          : 5 meshes (hull, trim, glass, + 4 wheel groups),
 *                           every static part MERGED into one geometry per
 *                           material, ~2.3k tris, sloped/chamfered silhouette
 *
 * The silhouette comes from real reference (see image-search/): a deep sloped
 * hood, a near-vertical windscreen, flared wheel arches that stand proud of
 * the body, a flat roof with a turret ring, and a high ground clearance with
 * visible suspension. Those five lines are what makes it read as a Humvee at
 * 50 m; panel-line detail contributes nothing at that range and is left out.
 *
 * WHAT IS GROUPED (and why)
 * -------------------------
 * The runtime needs to move parts independently, so those parts must NOT be
 * merged into the hull:
 *   Wheel_FL/FR/RL/RR   spin on local X; the front pair also steer on Y.
 *                       Each is a Group so the steer and spin rotations
 *                       compose without fighting each other.
 *   Bone_SteeringWheel  rotates with steer input.
 *   Turret_Ring/Yaw     the gunner mount (present but inert on this variant;
 *                       the gunner truck subclasses it).
 * Everything else is static and gets merged.
 *
 * FRAME: Y=0 at the ground, -Z forward, +X right. Origin centred between the
 * axles so the physics body's centre of mass lines up with the visual.
 */
import * as THREE from 'three';
import {
  extrude, loft, lathe, bevelBox, tube, at, rot, mirrorX, merge, triCount,
} from '../lib/MeshKit.js';

// ---------------------------------------------------------------------------
// Palette — desert tan, matching the reference photography.
// ---------------------------------------------------------------------------
export const CAR_COLORS = {
  hull: 0x9a8b6a,
  trim: 0x3c3a33,
  glass: 0x2b3a3d,
  rubber: 0x191917,
  metal: 0x55524a,
  lamp: 0xf2e6c4,
};

// Key dimensions (metres) — from the reference's proportions.
// Real M998 HMMWV: 4.57 m long, 2.16 m wide, 1.83 m tall, 3.30 m wheelbase.
// The width:height ratio of 1.18 is the whole character of the vehicle - it
// is famously WIDE and LOW. An earlier pass had it at 1.07, which read as a
// van; matching the real numbers fixed the silhouette more than any detail.
export const CAR_DIMS = {
  length: 4.57,
  width: 2.16,
  wheelbase: 3.30,
  track: 1.83,
  wheelRadius: 0.44,
  wheelWidth: 0.32,
  hullFloor: 0.58,   // underside of the body
  roofY: 1.83,
  groundClearance: 0.40,
};

const D = CAR_DIMS;

// ---------------------------------------------------------------------------
// Hull — one lofted solid carrying the whole silhouette
// ---------------------------------------------------------------------------
/**
 * The body is a single loft through 9 stations from rear bumper to front
 * bumper. Each station is the same 8-point cross-section, scaled and offset,
 * which is what produces the continuous sloped-hood-into-windscreen line that
 * a stack of boxes can never express.
 */
function buildHull() {
  const hw = D.width / 2;
  const floor = D.hullFloor;

  // ONE continuous volume from bumper to bumper.
  //
  // Earlier passes modelled the cab as a separate box stacked on a closed
  // body tub. That is how you build with boxes, and it renders exactly like
  // it sounds: a pod floating on a flat deck, with a hard step where the two
  // volumes meet and no door line connecting them. A real vehicle body is
  // one surface whose HEIGHT varies along its length, which is precisely what
  // a loft expresses — so the cab here is just the stations where the section
  // is tall, and the hood is where it is short. The windscreen rake is the
  // interpolation between them, for free.
  //
  // Section spans y 0..1 and is scaled per station; `sy` below is the real
  // height in metres above `floor`.
  const section = [
    [-hw + 0.12, 0.00], [hw - 0.12, 0.00],   // chamfered sill
    [hw, 0.10], [hw, 0.86],
    [hw - 0.10, 1.00], [-hw + 0.10, 1.00],   // chamfered roof edge
    [-hw, 0.86], [-hw, 0.10],
  ];

  const CAB = D.roofY - floor;   // 1.25
  const HOOD = 0.46;
  const BED = 0.70;

  const body = loft(section, [
    { z: 2.14, scale: [0.86, BED * 0.72], offset: [0, 0.04] },  // rear taper
    { z: 1.96, scale: [0.97, BED * 0.94], offset: [0, 0.01] },
    { z: 1.30, scale: [1.00, BED], offset: [0, 0] },            // cargo bed
    { z: 1.16, scale: [1.00, CAB], offset: [0, 0] },            // cab rear wall
    { z: -0.30, scale: [1.00, CAB], offset: [0, 0] },           // cab front
    { z: -0.56, scale: [0.99, HOOD * 1.06], offset: [0, 0] },   // cowl
    { z: -1.40, scale: [0.97, HOOD], offset: [0, -0.01] },      // hood
    { z: -2.02, scale: [0.94, HOOD * 0.92], offset: [0, -0.02] },
    { z: -2.20, scale: [0.82, HOOD * 0.74], offset: [0, -0.01] },
  ]);
  at(body, 0, floor, 0);

  // Wheel arches: flared lips that straddle each wheel. Anchored to the
  // wheel centre, not to a body height, or they hover above the tyre.
  const arch = (z) => {
    const a = loft(
      [[0, 0], [0.26, 0], [0.26, 0.09], [0, 0.09]],
      [
        { z: -0.58, scale: [0.5, 1] },
        { z: -0.28, scale: [1, 1] },
        { z: 0.28, scale: [1, 1] },
        { z: 0.58, scale: [0.5, 1] },
      ],
    );
    at(a, hw - 0.03, D.wheelRadius + 0.15, z);
    return a;
  };
  const archesR = merge([arch(-D.wheelbase / 2), arch(D.wheelbase / 2)]);
  const archesL = mirrorX(archesR);

  return merge([body, archesR, archesL]);
}

// ---------------------------------------------------------------------------
// Trim — bumpers, grille, lights housings, fuel can, spare, exhaust
// ---------------------------------------------------------------------------
function buildTrim(withTurret) {
  const hw = D.width / 2;
  const parts = [];

  // Front bumper: a heavy chamfered bar with two tow shackles.
  const bumper = bevelBox(D.width + 0.06, 0.20, 0.22, 0.04);
  at(bumper, 0, 0.66, -2.32);
  parts.push(bumper);
  for (const sx of [-1, 1]) {
    parts.push(tube([sx * 0.42, 0.58, -2.38], [sx * 0.42, 0.74, -2.38], 0.032, 5));
  }

  // Rear bumper.
  const rbump = bevelBox(D.width - 0.04, 0.18, 0.20, 0.04);
  at(rbump, 0, 0.68, 2.30);
  parts.push(rbump);

  // Grille: seven vertical slats as ONE extruded comb. Extruding a comb
  // profile is far cheaper than seven boxes and gives real depth.
  const slatProfile = [];
  for (let i = 0; i < 7; i += 1) {
    const x = -0.52 + i * 0.175;
    slatProfile.push([x, 0], [x + 0.10, 0], [x + 0.10, 0.34], [x, 0.34]);
  }
  for (let i = 0; i < 7; i += 1) {
    const x = -0.52 + i * 0.175;
    const slat = loft(
      [[x, 0], [x + 0.10, 0], [x + 0.10, 0.34], [x, 0.34]],
      [{ z: 0 }, { z: 0.07 }],
    );
    at(slat, 0, 0.82, -2.16);
    parts.push(slat);
  }

  // Headlight housings: lathed cylinders recessed into the front face.
  for (const sx of [-1, 1]) {
    // Shallow (0.05 deep) so the lens sits flush in the grille panel rather
    // than protruding on a stalk, which is what the first render showed.
    const housing = lathe([[0.00, 0], [0.12, 0], [0.12, 0.05]], 8);
    rot(housing, Math.PI / 2, 0, 0);
    at(housing, sx * 0.74, 0.96, -2.14);
    parts.push(housing);
  }

  // Roof turret ring — ONLY on the gunner variant. The base truck was
  // rendering a hatch ring it has no hatch for, which looked like a mistake
  // because it was one.
  if (withTurret) {
    const ring = lathe([[0.40, 0], [0.48, 0], [0.48, 0.08], [0.40, 0.08]], 10);
    at(ring, 0, D.roofY, 0.30);
    parts.push(ring);
  }

  // Spare wheel on the rear. Deliberately coarser than a driven wheel (8
  // segments, no separate rim): it never rotates and is only ever seen
  // edge-on from behind, so the extra segments of buildTyreGeo would be 100
  // triangles spent on a silhouette nobody can resolve.
  const spare = lathe([
    [0.16, -0.16], [0.38, -0.16], [0.44, -0.10],
    [0.44, 0.10], [0.38, 0.16], [0.16, 0.16],
  ], 8);
  rot(spare, 0, 0, Math.PI / 2);
  at(spare, 0, 1.12, 2.40);
  parts.push(spare);

  // Jerry can — a chamfered slab with the classic X-brace suggested by a
  // shallow inset panel.
  const can = bevelBox(0.20, 0.44, 0.34, 0.03);
  at(can, hw - 0.22, 0.98, 2.12);
  parts.push(can);

  // Exhaust: a vertical stack up the rear pillar, very visible on the real
  // vehicle's silhouette.
  parts.push(tube([hw - 0.09, 0.76, 1.72], [hw - 0.09, 1.92, 1.70], 0.05, 6));

  // Side steps.
  for (const sx of [-1, 1]) {
    const step = extrude(
      [[-0.75, -0.03], [0.75, -0.03], [0.75, 0.03], [-0.75, 0.03]], 0.16,
    );
    at(step, sx * (hw - 0.02), 0.50, 0.30);
    parts.push(step);
  }

  // Mirrors.
  for (const sx of [-1, 1]) {
    parts.push(tube([sx * (hw - 0.04), 1.36, -0.56], [sx * (hw + 0.17), 1.40, -0.60], 0.02, 4));
    const glassG = extrude(
      [[-0.065, -0.10], [0.065, -0.10], [0.065, 0.10], [-0.065, 0.10]], 0.05,
    );
    at(glassG, sx * (hw + 0.21), 1.42, -0.60);
    parts.push(glassG);
  }

  // Antenna — a long thin tube; reads instantly as military.
  parts.push(tube([hw - 0.14, 1.06, 2.00], [hw - 0.09, 2.52, 2.06], 0.011, 4));

  return merge(parts);
}

// ---------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------
function buildGlass() {
  const hw = D.width / 2;
  const parts = [];

  // Windscreen: raked plate.
  const ws = loft(
    [[-hw + 0.14, 0], [hw - 0.14, 0], [hw - 0.14, 0.03], [-hw + 0.14, 0.03]],
    [{ z: 0 }, { z: 0.74 }],
  );
  rot(ws, 0.40, 0, 0);
  at(ws, 0, 1.30, -0.44);
  parts.push(ws);

  // Door windows — small and square, like the reference.
  for (const sx of [-1, 1]) {
    // Panes sit 1 cm PROUD of the hull skin. Sitting flush z-fights; sitting
    // inside (as an earlier pass did at hw-0.06) hides them completely, which
    // is why the cab rendered as a blank slab with no windows at all.
    for (const z of [-0.02, 0.72]) {
      const win = bevelBox(0.03, 0.40, 0.58, 0.01);
      at(win, sx * (hw + 0.005), 1.52, z);
      parts.push(win);
    }
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Wheels — lathed tyre with a real tread ring, shared across all four
// ---------------------------------------------------------------------------
function buildTyreGeo() {
  // Lathe profile gives the bulged sidewall that a cylinder cannot.
  const r = D.wheelRadius;
  const hwid = D.wheelWidth / 2;
  return lathe([
    [0.17, -hwid],
    [r - 0.10, -hwid],
    [r, -hwid + 0.07],
    [r, hwid - 0.07],
    [r - 0.10, hwid],
    [0.17, hwid],
  ], 12);
}

function buildWheel(name) {
  const grp = new THREE.Group();
  grp.name = name;

  const tyre = new THREE.Mesh(buildTyreGeo(), null);
  tyre.name = `${name}_Tyre`;
  // Lathe revolves around Y; a wheel spins around X.
  tyre.geometry.rotateZ(Math.PI / 2);
  grp.add(tyre);

  // Rim: a dished lathe with visible depth, plus lug bolts as one merged ring.
  const rimGeo = lathe([
    [0.00, 0.02], [0.14, 0.03], [0.17, 0.08], [0.17, 0.16], [0.10, 0.17],
  ], 10);
  rimGeo.rotateZ(Math.PI / 2);
  const lugs = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    lugs.push(tube(
      [D.wheelWidth / 2 - 0.02, Math.sin(a) * 0.09, Math.cos(a) * 0.09],
      [D.wheelWidth / 2 + 0.01, Math.sin(a) * 0.09, Math.cos(a) * 0.09],
      0.018, 4,
    ));
  }
  const rim = new THREE.Mesh(merge([rimGeo, ...lugs]), null);
  rim.name = `${name}_Rim`;
  grp.add(rim);

  return grp;
}

// ---------------------------------------------------------------------------
// Interior — seats and steering, visible through the glass in 3rd person
// ---------------------------------------------------------------------------
function buildInterior() {
  const parts = [];
  // Four seats: base + back, chamfered so they catch light.
  // Seats use a plain chamfer-free prism, not bevelBox. They sit behind
  // tinted glass and are never the silhouette, so a 60-tri chamfered box per
  // seat (480 for four seats) buys nothing a 12-tri prism does not.
  const slab = (w, h, d) => extrude(
    [[-d / 2, -h / 2], [d / 2, -h / 2], [d / 2, h / 2], [-d / 2, h / 2]], w,
  );
  const seatAt = (x, z) => {
    const base = slab(0.48, 0.12, 0.46);
    at(base, x, 0.92, z);
    const back = slab(0.48, 0.56, 0.12);
    at(back, x, 1.20, z + 0.27);
    parts.push(base, back);
  };
  seatAt(-0.46, -0.10);
  seatAt(0.46, -0.10);
  seatAt(-0.46, 0.86);
  seatAt(0.46, 0.86);

  // Dashboard.
  const dash = slab(D.width - 0.22, 0.22, 0.34);
  at(dash, 0, 1.14, -0.50);
  parts.push(dash);

  return merge(parts);
}

function buildSteeringWheel() {
  const bone = new THREE.Group();
  bone.name = 'Bone_SteeringWheel';
  bone.position.set(-0.46, 1.26, -0.38);
  bone.rotation.set(-1.20, 0, 0);

  // Torus-like rim from a lathe of a small circle is expensive; a 12-gon
  // ring of tubes is cheaper and reads identically at this size.
  const segs = [];
  const R = 0.17;
  const N = 8;
  for (let i = 0; i < N; i += 1) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    segs.push(tube(
      [Math.cos(a0) * R, Math.sin(a0) * R, 0],
      [Math.cos(a1) * R, Math.sin(a1) * R, 0],
      0.022, 4,
    ));
  }
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    segs.push(tube([0, 0, 0], [Math.cos(a) * R, Math.sin(a) * R, 0], 0.015, 4));
  }
  segs.push(tube([0, 0, 0], [0, 0, -0.16], 0.03, 5));
  const mesh = new THREE.Mesh(merge(segs), null);
  mesh.name = 'Steering_Rim';
  bone.add(mesh);
  return bone;
}

// ---------------------------------------------------------------------------
// Turret (used by the gunner variant; the ring is always present)
// ---------------------------------------------------------------------------
function buildTurret() {
  const yaw = new THREE.Group();
  yaw.name = 'Turret_Yaw';
  yaw.position.set(0, D.roofY + 0.08, 0.30);

  const parts = [];
  // Gun shield: a chamfered plate with angled wings, as in the reference.
  const shield = bevelBox(0.86, 0.52, 0.06, 0.02);
  at(shield, 0, 0.42, -0.34);
  parts.push(shield);
  for (const sx of [-1, 1]) {
    const wing = bevelBox(0.30, 0.44, 0.05, 0.02);
    rot(wing, 0, sx * 0.5, 0);
    at(wing, sx * 0.54, 0.40, -0.26);
    parts.push(wing);
  }
  const shieldMesh = new THREE.Mesh(merge(parts), null);
  shieldMesh.name = 'Turret_Shield';
  yaw.add(shieldMesh);

  // Pitch group holds the gun so it can elevate independently of yaw.
  const pitch = new THREE.Group();
  pitch.name = 'Turret_Pitch';
  pitch.position.set(0, 0.34, -0.30);

  const gun = [];
  gun.push(tube([0, 0, 0.30], [0, 0, -0.30], 0.055, 6));      // receiver
  gun.push(tube([0, 0, -0.30], [0, 0, -0.96], 0.028, 6));     // barrel
  gun.push(tube([0, 0, -0.96], [0, 0, -1.04], 0.045, 6));     // muzzle device
  const box = bevelBox(0.18, 0.16, 0.24, 0.02);
  at(box, 0.14, -0.06, 0.16);
  gun.push(box);                                               // ammo box
  const gunMesh = new THREE.Mesh(merge(gun), null);
  gunMesh.name = 'Turret_Gun';
  pitch.add(gunMesh);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'Socket_Muzzle_Turret';
  muzzle.position.set(0, 0, -1.06);
  pitch.add(muzzle);

  yaw.add(pitch);
  return yaw;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * @param {object} [opts]
 * @param {boolean} [opts.turret=false]  Include the roof gunner turret.
 * @returns {{root: THREE.Group, stats: {triangles:number, meshes:number}}}
 */
export function buildMilitaryCarPattern(opts = {}) {
  const { turret = false } = opts;
  const root = new THREE.Group();
  root.name = 'Root_Vehicle';

  const matHull = new THREE.MeshStandardMaterial({
    color: CAR_COLORS.hull, roughness: 0.88, metalness: 0.05, flatShading: true,
  });
  const matTrim = new THREE.MeshStandardMaterial({
    color: CAR_COLORS.trim, roughness: 0.80, metalness: 0.25, flatShading: true,
  });
  const matGlass = new THREE.MeshStandardMaterial({
    color: CAR_COLORS.glass, roughness: 0.18, metalness: 0.10, flatShading: true,
  });
  const matRubber = new THREE.MeshStandardMaterial({
    color: CAR_COLORS.rubber, roughness: 0.97, metalness: 0.0, flatShading: true,
  });
  const matMetal = new THREE.MeshStandardMaterial({
    color: CAR_COLORS.metal, roughness: 0.62, metalness: 0.45, flatShading: true,
  });

  const hull = new THREE.Mesh(buildHull(), matHull);
  hull.name = 'Hull';
  root.add(hull);

  const trim = new THREE.Mesh(merge([buildTrim(turret), buildInterior()]), matTrim);
  trim.name = 'Trim';
  root.add(trim);

  const glass = new THREE.Mesh(buildGlass(), matGlass);
  glass.name = 'Glass';
  root.add(glass);

  // Wheels: four Groups at the axle positions.
  const hx = D.track / 2;
  const hz = D.wheelbase / 2;
  const wheelDefs = [
    ['Wheel_FL', -hx, -hz], ['Wheel_FR', hx, -hz],
    ['Wheel_RL', -hx, hz], ['Wheel_RR', hx, hz],
  ];
  for (const [name, x, z] of wheelDefs) {
    const w = buildWheel(name);
    w.position.set(x, D.wheelRadius, z);
    // Assign the shared materials to the two child meshes.
    w.children[0].material = matRubber;
    w.children[1].material = matMetal;
    root.add(w);
  }

  root.add(buildSteeringWheel());
  // The steering wheel mesh needs a material too.
  root.getObjectByName('Steering_Rim').material = matTrim;

  if (turret) {
    const t = buildTurret();
    t.getObjectByName('Turret_Shield').material = matHull;
    t.getObjectByName('Turret_Gun').material = matMetal;
    root.add(t);
  }

  // --- sockets -------------------------------------------------------------
  // Seat sockets are where the character's hips go; the camera sockets are
  // reference points the runtime reads rather than parents to.
  const socket = (name, x, y, z) => {
    const s = new THREE.Object3D();
    s.name = name;
    s.position.set(x, y, z);
    root.add(s);
    return s;
  };
  socket('Socket_Seat_Driver', -0.46, 1.00, -0.10);
  socket('Socket_Seat_Passenger', 0.46, 1.00, -0.10);
  socket('Socket_Seat_RearLeft', -0.46, 1.00, 0.86);
  socket('Socket_Seat_RearRight', 0.46, 1.00, 0.86);
  if (turret) socket('Socket_Seat_Gunner', 0.00, 1.16, 0.30);
  socket('Socket_Exhaust', D.width / 2 - 0.09, 1.92, 1.70);
  socket('Socket_HeadlightL', -0.74, 0.96, -2.20);
  socket('Socket_HeadlightR', 0.74, 0.96, -2.20);
  // Entry points: where the player must stand to be offered a seat.
  socket('Socket_Door_Driver', -1.55, 0.20, -0.10);
  socket('Socket_Door_Passenger', 1.55, 0.20, -0.10);
  socket('Socket_Door_RearLeft', -1.55, 0.20, 0.86);
  socket('Socket_Door_RearRight', 1.55, 0.20, 0.86);

  // Shadow flags on every mesh.
  let triangles = 0;
  let meshes = 0;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      triangles += triCount(o.geometry);
      meshes += 1;
    }
  });

  return { root, stats: { triangles, meshes } };
}

export default buildMilitaryCarPattern;
