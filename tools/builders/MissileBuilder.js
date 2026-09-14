/**
 * MissileBuilder.js — detailed procedural air-to-ground missile.
 *
 * Real-world reference: AGM-114 Hellfire proportions.
 *   Total length  : ~1.80 m
 *   Body diameter : ~0.18 m
 *   Fin span      : ~0.33 m (rear), ~0.28 m (canards)
 *
 * Origin convention:
 *   Y = 0  at the centreline of the missile body.
 *   -Z     is forward (nose points along -Z).
 *   +X     is right.
 *
 * Node contract:
 *   Root_Missile
 *   Bone_SeekHead       — rotated by the guidance system for seeker gimbal
 *   Socket_Attach       — snaps to Socket_Hardpoint_R/L on a carrier
 *   Socket_Exhaust      — rocket exhaust particle anchor
 *   Socket_Detonation   — warhead explosion anchor (nose tip)
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const COL = {
  body:      0x76795f, // olive drab missile body
  darkPanel: 0x4c4e42,
  metal:     0x4a4c40,
  seeker:    0x45484a, // seeker dome
  glass:     0x3a5a62, // seeker window
  fin:       0x5c5f48,
  exhaust:   0x42423c,
  warning:   0xcc8800, // caution band
};

function box(size, color, name, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.8, metalness: 0.1, flatShading: true,
    }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

function cyl(radiusTop, radiusBot, height, segs, color, name,
             pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBot, height, segs),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.75, metalness: 0.2, flatShading: true,
    }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

function socket(name, pos, parent) {
  const s = new THREE.Object3D();
  s.name = name;
  s.position.set(...pos);
  if (parent) parent.add(s);
  return s;
}

// ---------------------------------------------------------------------------
// Sub-builders
// ---------------------------------------------------------------------------

function buildMissileBody(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Body';

  grp.add(cyl(0.09, 0.09, 0.60, 10, COL.body,
    'Body_FwdSection', [0, 0, -0.52], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.09, 0.09, 0.55, 10, COL.body,
    'Body_MidSection', [0, 0, 0.08], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.09, 0.09, 0.40, 10, COL.body,
    'Body_AftSection', [0, 0, 0.68], [Math.PI / 2, 0, 0]));

  grp.add(cyl(0.06, 0.09, 0.14, 10, COL.metal,
    'Body_NozzleTaper', [0, 0, 0.97], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.04, 0.06, 0.06, 10, COL.exhaust,
    'Body_NozzleThroat', [0, 0, 1.07], [Math.PI / 2, 0, 0]));

  grp.add(cyl(0.092, 0.092, 0.08, 10, COL.warning,
    'Body_WarheadBand', [0, 0, -0.48], [Math.PI / 2, 0, 0]));

  grp.add(cyl(0.093, 0.093, 0.012, 10, COL.darkPanel,
    'Body_SeamRing1', [0, 0, -0.22], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.093, 0.093, 0.012, 10, COL.darkPanel,
    'Body_SeamRing2', [0, 0, 0.36], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.093, 0.093, 0.012, 10, COL.darkPanel,
    'Body_SeamRing3', [0, 0, 0.88], [Math.PI / 2, 0, 0]));

  grp.add(box([0.008, 0.09, 0.008], COL.metal,
    'Body_Antenna', [0.09, 0.06, 0.08]));

  grp.add(box([0.04, 0.06, 0.18], COL.metal,
    'Body_SuspLugFwd', [0, 0.10, -0.30]));
  grp.add(box([0.04, 0.06, 0.18], COL.metal,
    'Body_SuspLugAft', [0, 0.10, 0.40]));

  root.add(grp);
  return grp;
}

/** Bone_SeekHead — seeker dome + gimbal ring, rotatable for homing look-angle. */
function buildSeekerHead(root) {
  const seekHead = new THREE.Group();
  seekHead.name = 'Bone_SeekHead';
  seekHead.position.set(0, 0, -0.86);

  seekHead.add(cyl(0.09, 0.09, 0.16, 10, COL.seeker,
    'Seeker_Housing', [0, 0, 0], [Math.PI / 2, 0, 0]));
  seekHead.add(cyl(0.00, 0.09, 0.18, 10, COL.seeker,
    'Seeker_DomeCone', [0, 0, -0.17], [Math.PI / 2, 0, 0]));
  seekHead.add(cyl(0.092, 0.092, 0.022, 10, COL.metal,
    'Seeker_GimbalRing', [0, 0, -0.06], [Math.PI / 2, 0, 0]));
  seekHead.add(cyl(0.058, 0.062, 0.025, 10, COL.glass,
    'Seeker_Window', [0, 0, -0.22], [Math.PI / 2, 0, 0]));

  root.add(seekHead);
  return seekHead;
}

/** Four rear delta fins + four forward canard fins. */
function buildMissileFins(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Fins';

  const rearFinAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  rearFinAngles.forEach((angle, i) => {
    const finGrp = new THREE.Group();
    // Named Fin_0..3 as well as the descriptive name so the flight controller
    // can deflect them individually for steering feedback.
    finGrp.name = `Fin_${i}`;
    finGrp.rotation.z = angle;

    finGrp.add(box([0.008, 0.145, 0.38], COL.fin,
      `RearFin_Panel${i}`, [0, 0.10, 0.60]));
    finGrp.add(box([0.012, 0.04, 0.30], COL.darkPanel,
      `RearFin_Fillet${i}`, [0, 0.055, 0.62]));
    finGrp.add(box([0.010, 0.145, 0.012], COL.metal,
      `RearFin_TrailEdge${i}`, [0, 0.10, 0.82]));

    grp.add(finGrp);
  });

  rearFinAngles.forEach((angle, i) => {
    const finGrp = new THREE.Group();
    finGrp.name = `Canard_${i}`;
    finGrp.rotation.z = angle + Math.PI / 4;

    finGrp.add(box([0.007, 0.10, 0.22], COL.fin,
      `Canard_Panel${i}`, [0, 0.07, -0.28]));
    finGrp.add(box([0.009, 0.10, 0.010], COL.metal,
      `Canard_TrailEdge${i}`, [0, 0.07, -0.17]));

    grp.add(finGrp);
  });

  root.add(grp);
  return grp;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function buildMissilePattern() {
  const root = new THREE.Group();
  root.name = 'Root_Missile';

  buildMissileBody(root);
  buildMissileFins(root);
  const seekHead = buildSeekerHead(root);

  socket('Socket_Attach',      [0, 0.10, 0.0],   root);
  socket('Socket_Exhaust',     [0, 0.0,  1.10],  root);
  socket('Socket_Detonation',  [0, 0.0, -1.06],  root);
  // The nose-cam anchor the guided-missile killstreak attaches the camera to.
  socket('Socket_NoseCam',     [0, 0.0, -1.15],  root);

  return { root, seekHead };
}

export default buildMissilePattern;
