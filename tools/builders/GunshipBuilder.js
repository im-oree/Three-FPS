/**
 * GunshipBuilder.js — light attack helicopter (AH-6 "Little Bird" class).
 *
 * WHY A SEPARATE BUILDER
 * ----------------------
 * The killstreak gunship and the drivable UH-60 are different aircraft doing
 * different jobs, and sharing one mesh made both worse: the transport had to
 * carry weapon pylons it never used, and the killstreak inherited a cabin,
 * four doors and crew seats it has no use for. This is the attack airframe —
 * no cabin, no doors, no seats, no landing gear worth the name.
 *
 * SILHOUETTE (see image-search/ah-6-little-bird-*)
 * ------------------------------------------------
 * The Little Bird is unmistakable from five lines, and none of them are the
 * Black Hawk's:
 *
 *   1. A near-SPHERICAL cockpit egg — the defining feature. Lathed, not
 *      lofted, because the cross-section is round in every axis.
 *   2. A thin open-lattice tailboom that looks skeletal next to the egg.
 *   3. A tall T-tail with a horizontal stabiliser at the very top.
 *   4. Tube SKIDS, not wheels.
 *   5. Stub weapon pylons carrying rocket pods and miniguns, mounted low and
 *      wide so they read clearly from above — the angle a killstreak is
 *      almost always seen from.
 *
 * A five-blade main rotor (vs the UH-60's four) completes the read.
 *
 * FRAME: Y=0 at the bottom of the skids, -Z forward, +X right. Origin under
 * the mast so lift and centre of mass coincide.
 *
 * The runtime drives Rotor_Main / Rotor_Tail (and their blur discs) exactly
 * as it does for the transport, so both aircraft animate through one code
 * path in Vehicle.applyRotorVisuals / VehicleAnimator.
 */
import * as THREE from 'three';
import {
  loft, lathe, bevelBox, plate, tube, at, rot, mirrorX, merge, triCount,
} from '../lib/MeshKit.js';

// ---------------------------------------------------------------------------
// Palette — near-black special-operations scheme, deliberately darker than the
// transport's olive so the two are never confused in the air.
// ---------------------------------------------------------------------------
export const GUNSHIP_COLORS = {
  hull: 0x24282b,
  trim: 0x16181a,
  glass: 0x1b2730,
  metal: 0x44484b,
  rotor: 0x121415,
};

/**
 * AH-6 dimensions, metres. The real aircraft is 9.8 m long with an 8.3 m
 * rotor; this is held close to full scale because the Little Bird is already
 * small — shrinking it further would make it read as a toy.
 */
export const GUNSHIP_DIMS = {
  length: 9.4,
  eggRadius: 1.02,      // cockpit sphere
  rotorRadius: 4.15,
  rotorHeight: 2.62,
  tailRotorRadius: 0.72,
  boomLength: 3.35,
  skidHeight: 0.62,     // ground to fuselage underside
};

const D = GUNSHIP_DIMS;

/**
 * The cockpit egg.
 *
 * Lathed about Y then squashed: the real fuselage is slightly taller than it
 * is wide and is cut off flat at the back where the boom leaves. Building it
 * as a lathe rather than a loft is what makes the compound curvature read —
 * a lofted egg shows its stations as visible facet rings.
 */
function buildEgg() {
  const r = D.eggRadius;
  const geo = lathe([
    [0.00, -r * 0.98],
    [r * 0.42, -r * 0.86],
    [r * 0.74, -r * 0.55],
    [r * 0.94, -r * 0.12],
    [r * 1.00, r * 0.28],
    [r * 0.86, r * 0.64],
    [r * 0.52, r * 0.90],
    [0.00, r * 1.00],
  ], 12);
  // Slightly narrower than tall, and stretched along Z into the nose.
  geo.scale(0.94, 1.0, 1.18);
  at(geo, 0, D.skidHeight + r * 0.98, -2.35);
  return geo;
}

/**
 * Tailboom: a thin tapering tube from the back of the egg to the tail.
 *
 * Kept deliberately slender — the visual contrast between the fat egg and the
 * skinny boom is most of what identifies the aircraft.
 */
function buildBoom() {
  const y = D.skidHeight + D.eggRadius * 1.05;
  const boom = loft(
    [[-0.19, -0.19], [0.19, -0.19], [0.19, 0.19], [-0.19, 0.19]],
    [
      { z: -1.30, scale: 1.25 },
      { z: 0.60, scale: 1.0 },
      { z: 2.60, scale: 0.72 },
      { z: D.boomLength, scale: 0.58 },
    ],
    { capStart: true, capEnd: true },
  );
  at(boom, 0, y, 0);
  return boom;
}

/**
 * T-tail: a vertical fin with the horizontal stabiliser across its TOP.
 *
 * The high-mounted stabiliser is the Little Bird's tail signature; putting it
 * low (as on the Black Hawk) loses the read entirely.
 */
function buildTail() {
  const parts = [];
  const y = D.skidHeight + D.eggRadius * 1.05;
  const zEnd = D.boomLength;

  // Vertical fin, swept back.
  const fin = loft(
    [[-0.07, -0.42], [0.07, -0.42], [0.07, 0.42], [-0.07, 0.42]],
    [
      { z: -0.55, scale: [1.0, 1.25] },
      { z: 0.30, scale: [0.9, 1.0] },
      { z: 0.72, scale: [0.8, 0.55] },
    ],
    { capStart: true, capEnd: true },
  );
  rot(fin, 0, 0, Math.PI / 2);        // stand it upright
  at(fin, 0, y + 0.78, zEnd - 0.1);
  parts.push(fin);

  // Horizontal stabiliser across the top of the fin.
  const stab = plate(2.05, 0.52, 0.07, 0.02);
  at(stab, 0, y + 1.22, zEnd - 0.12);
  parts.push(stab);

  // Endplate fins, small verticals at each stabiliser tip.
  const endplate = plate(0.06, 0.40, 0.30, 0.02);
  rot(endplate, Math.PI / 2, 0, 0);
  at(endplate, 0.98, y + 1.36, zEnd - 0.12);
  parts.push(endplate, mirrorX(endplate.clone()));

  // Lower tail skid, protects the rotor in a flared landing.
  parts.push(tube(
    [0, y - 0.12, zEnd - 0.2], [0, y - 0.52, zEnd + 0.28], 0.035, 5,
  ));
  return merge(parts);
}

/**
 * Skids: two long tubes on four struts.
 *
 * Tube skids rather than wheels — the single quickest way to tell a light
 * observation/attack helicopter from a transport at a glance.
 */
function buildSkids() {
  const parts = [];
  const x = 0.96;
  const yTop = D.skidHeight;

  for (const sign of [1, -1]) {
    // The skid tube itself, turned up at the front.
    parts.push(tube([sign * x, 0.07, -3.55], [sign * x, 0.07, 1.30], 0.062, 6));
    parts.push(tube([sign * x, 0.07, -3.55], [sign * x, 0.30, -4.05], 0.058, 6));

    // Struts up to the fuselage, splayed outward like the real aircraft.
    parts.push(tube([sign * x, 0.10, -2.95], [sign * 0.45, yTop + 0.18, -2.75], 0.048, 5));
    parts.push(tube([sign * x, 0.10, 0.55], [sign * 0.45, yTop + 0.18, 0.35], 0.048, 5));
  }
  return merge(parts);
}

/**
 * Weapon pylons with rocket pods and miniguns.
 *
 * Mounted low and wide: a killstreak helicopter is usually viewed from below
 * or from a shallow angle, and armament tucked against the fuselage simply
 * disappears at that angle.
 */
function buildWeapons() {
  const parts = [];
  const y = D.skidHeight + D.eggRadius * 0.45;

  for (const sign of [1, -1]) {
    // Pylon arm out to the store. Built as a plate rather than a thin tube:
    // at gameplay distance a 0.075 m tube disappears and the pods read as
    // floating next to the aircraft with nothing holding them on.
    const arm = plate(0.95, 0.34, 0.10, 0.02);
    at(arm, sign * 1.20, y - 0.05, -2.30);
    parts.push(arm);
    // Diagonal brace down to the skid strut, as on the real aircraft.
    parts.push(tube(
      [sign * 1.55, y - 0.10, -2.30], [sign * 1.00, 0.30, -2.60], 0.040, 5,
    ));

    // Seven-tube rocket pod: one cylinder plus a muzzle face, not seven tubes.
    const pod = lathe([
      [0.00, -0.62], [0.26, -0.62], [0.28, -0.40],
      [0.28, 0.40], [0.26, 0.62], [0.00, 0.62],
    ], 10);
    rot(pod, Math.PI / 2, 0, 0);
    at(pod, sign * 1.66, y - 0.08, -2.30);
    parts.push(pod);

    // Minigun, slung under the pylon and pointing forward.
    parts.push(tube(
      [sign * 1.34, y - 0.26, -2.55], [sign * 1.34, y - 0.26, -3.58], 0.055, 6,
    ));
    const breech = bevelBox(0.20, 0.20, 0.46, 0.03);
    at(breech, sign * 1.34, y - 0.26, -2.30);
    parts.push(breech);
  }
  return merge(parts);
}

/** Cockpit glazing: the egg's whole front is glass on a Little Bird. */
function buildGlass() {
  const r = D.eggRadius;
  const geo = lathe([
    [0.00, -r * 0.92],
    [r * 0.40, -r * 0.80],
    [r * 0.70, -r * 0.50],
    [r * 0.88, -r * 0.10],
    [r * 0.92, r * 0.26],
  ], 12);
  geo.scale(0.94, 1.0, 1.18);
  // Pull it forward so it occupies the nose hemisphere only.
  at(geo, 0, D.skidHeight + r * 0.98, -2.86);
  return geo;
}

/** Engine/exhaust fairing on the spine, behind the mast. */
function buildEngine() {
  const parts = [];
  const y = D.skidHeight + D.eggRadius * 1.55;
  const cowl = loft(
    [[-0.30, -0.24], [0.30, -0.24], [0.26, 0.22], [-0.26, 0.22]],
    [
      { z: -1.05, scale: 0.75 },
      { z: -0.30, scale: 1.0 },
      { z: 0.55, scale: 0.92 },
    ],
    { capStart: true, capEnd: true },
  );
  at(cowl, 0, y, -1.75);
  parts.push(cowl);

  // Exhaust stack, angled up and out on the port side as on the real MD 500.
  parts.push(tube([-0.20, y + 0.05, -1.30], [-0.62, y + 0.24, -0.92], 0.13, 6));
  return merge(parts);
}

/** Main rotor mast and hub. */
function buildMast() {
  const parts = [];
  const top = D.rotorHeight;
  parts.push(tube([0, D.skidHeight + D.eggRadius * 1.5, -2.20], [0, top, -2.20], 0.085, 6));
  return merge(parts);
}

/**
 * Five-blade main rotor.
 *
 * Blade COUNT is a real identifier: the AH-6 runs five (later six) where the
 * Black Hawk runs four, and at rest the difference is obvious.
 */
function buildMainRotor() {
  const blades = [];
  const hubR = 0.30;
  const count = 5;
  for (let i = 0; i < count; i += 1) {
    const span = D.rotorRadius - hubR;
    // Width along X, LENGTH along Z, so the blade points down +Z.
    const blade = plate(0.20, span, 0.035, 0.012);
    // Push it out along +Z so its inboard end sits at the hub, THEN spin
    // about Y. Offsetting along X first and rotating about the origin makes
    // every blade but the first orbit a point off to one side.
    at(blade, 0, 0, hubR + span / 2);
    rot(blade, 0, (i / count) * Math.PI * 2, 0);
    blades.push(blade);
  }
  return merge(blades);
}

/** Two-blade tail rotor, on the port side of the fin. */
function buildTailRotor() {
  const blades = [];
  for (let i = 0; i < 2; i += 1) {
    const blade = plate(0.10, D.tailRotorRadius * 1.9, 0.028, 0.01);
    rot(blade, Math.PI / 2, 0, 0);
    rot(blade, 0, 0, (i / 2) * Math.PI * 2);
    blades.push(blade);
  }
  return merge(blades);
}

/**
 * Build the gunship.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.weapons=true] Fit pylons, pods and miniguns.
 */
export function buildGunshipPattern(opts = {}) {
  const { weapons = true } = opts;
  const root = new THREE.Group();
  root.name = 'Root_Vehicle';

  const matHull = new THREE.MeshStandardMaterial({
    color: GUNSHIP_COLORS.hull, roughness: 0.78, metalness: 0.16, flatShading: true,
  });
  const matTrim = new THREE.MeshStandardMaterial({
    color: GUNSHIP_COLORS.trim, roughness: 0.80, metalness: 0.28, flatShading: true,
  });
  const matGlass = new THREE.MeshStandardMaterial({
    color: GUNSHIP_COLORS.glass, roughness: 0.12, metalness: 0.18, flatShading: true,
  });
  const matMetal = new THREE.MeshStandardMaterial({
    color: GUNSHIP_COLORS.metal, roughness: 0.55, metalness: 0.52, flatShading: true,
  });
  const matRotor = new THREE.MeshStandardMaterial({
    color: GUNSHIP_COLORS.rotor, roughness: 0.88, metalness: 0.12, flatShading: true,
  });

  // --- Static bodies, merged per material ------------------------------------
  const hull = new THREE.Mesh(merge([buildEgg(), buildBoom(), buildEngine()]), matHull);
  hull.name = 'Hull';
  root.add(hull);

  const trim = new THREE.Mesh(buildTail(), matTrim);
  trim.name = 'Trim';
  root.add(trim);

  const glass = new THREE.Mesh(buildGlass(), matGlass);
  glass.name = 'Glass';
  root.add(glass);

  const metalParts = [buildSkids(), buildMast()];
  if (weapons) metalParts.push(buildWeapons());
  const metal = new THREE.Mesh(merge(metalParts), matMetal);
  metal.name = 'Metal';
  root.add(metal);

  // --- Main rotor ------------------------------------------------------------
  const rotorMain = new THREE.Group();
  rotorMain.name = 'Rotor_Main';
  rotorMain.position.set(0, D.rotorHeight, -2.20);
  root.add(rotorMain);

  const mainHub = new THREE.Mesh(
    lathe([[0, -0.10], [0.24, -0.10], [0.26, 0.10], [0, 0.16]], 8), matRotor,
  );
  mainHub.name = 'Rotor_MainHub';
  rotorMain.add(mainHub);

  const mainBlades = new THREE.Mesh(buildMainRotor(), matRotor);
  mainBlades.name = 'Rotor_MainBlades';
  rotorMain.add(mainBlades);

  const blurMain = new THREE.Mesh(
    new THREE.RingGeometry(0.55, D.rotorRadius, 24),
    new THREE.MeshBasicMaterial({
      color: GUNSHIP_COLORS.rotor, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  blurMain.name = 'Blur_Main';
  blurMain.rotation.x = -Math.PI / 2;
  blurMain.visible = false;
  rotorMain.add(blurMain);

  // --- Tail rotor ------------------------------------------------------------
  const rotorTail = new THREE.Group();
  rotorTail.name = 'Rotor_Tail';
  rotorTail.position.set(-0.16, D.skidHeight + D.eggRadius * 1.05 + 0.78, D.boomLength - 0.1);
  root.add(rotorTail);

  const tailHub = new THREE.Mesh(
    lathe([[0, -0.07], [0.13, -0.07], [0.13, 0.07], [0, 0.07]], 6), matRotor,
  );
  rot(tailHub.geometry, 0, 0, Math.PI / 2);
  tailHub.name = 'Rotor_TailHub';
  rotorTail.add(tailHub);

  const tailBlades = new THREE.Mesh(buildTailRotor(), matRotor);
  tailBlades.name = 'Rotor_TailBlades';
  rotorTail.add(tailBlades);

  const blurTail = new THREE.Mesh(
    new THREE.RingGeometry(0.16, D.tailRotorRadius, 16),
    new THREE.MeshBasicMaterial({
      color: GUNSHIP_COLORS.rotor, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  blurTail.name = 'Blur_Tail';
  blurTail.rotation.y = Math.PI / 2;
  blurTail.visible = false;
  rotorTail.add(blurTail);

  // --- Sockets ---------------------------------------------------------------
  const socket = (name, x, y, z, ry = 0) => {
    const s = new THREE.Object3D();
    s.name = name;
    s.position.set(x, y, z);
    s.rotation.y = ry;
    root.add(s);
    return s;
  };

  const wy = D.skidHeight + D.eggRadius * 0.45;
  // Muzzles sit at the FRONT of each minigun barrel, so tracers originate
  // where the player sees the gun, not at the aircraft's centre.
  socket('Socket_Muzzle_L', -1.34, wy - 0.26, -3.58);
  socket('Socket_Muzzle_R', 1.34, wy - 0.26, -3.58);
  socket('Socket_Rocket_L', -1.66, wy - 0.08, -2.92);
  socket('Socket_Rocket_R', 1.66, wy - 0.08, -2.92);
  socket('Socket_Pilot', -0.34, D.skidHeight + 0.62, -2.75);
  socket('Socket_Hardpoint_L', -1.62, wy - 0.10, -2.30);
  socket('Socket_Hardpoint_R', 1.62, wy - 0.10, -2.30);
  socket('Socket_Exhaust', -0.62, D.skidHeight + D.eggRadius * 1.55 + 0.24, -0.92);
  socket('Socket_RotorWash', 0, 0, -2.20);

  // Legacy aliases for the killstreak's older node contract, parented to the
  // real nodes so one asset satisfies both contracts.
  const alias = (name, parent) => {
    if (!parent) return;
    const a = new THREE.Object3D();
    a.name = name;
    parent.add(a);
  };
  alias('Bone_MainRotorHub', rotorMain);
  alias('Bone_TailRotorHub', rotorTail);

  // --- Stats -----------------------------------------------------------------
  let triangles = 0;
  let meshes = 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      if (/^Blur_/.test(o.name)) return;   // hidden at rest; not a real cost
      triangles += triCount(o.geometry);
      meshes += 1;
    }
  });

  return { root, stats: { triangles, meshes } };
}

export default buildGunshipPattern;
