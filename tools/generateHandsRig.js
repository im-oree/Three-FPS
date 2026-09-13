/**
 * generateHandsRig.js — the CANONICAL §2.1 arm/hand skeleton generator
 * (Document 2.5 §2.1/§2.4/§6.4).
 *
 * Produces a REAL file: /assets/models/characters/operator_arms.glb
 *
 * CONTRACT IMPLEMENTED HERE (drop-in retarget target for any conforming rig):
 *   - EXACT bone names: Root_Arms → Shoulder_R → UpperArm_R → Forearm_R →
 *     Hand_R → {Thumb,Index,Middle,Ring,Pinky}_R_01..03 (mirror _L).
 *   - ORIENTATION CONVENTION (§2.1): every bone's local +X points down the
 *     length of the limb toward its child; local +Z is the palmar curl axis
 *     (finger curl = rotation about local +Z); A-pose rest (arms relaxed
 *     forward-down), identical in spirit across project rigs.
 *   - Finger bones REQUIRED (§2.1): three phalanges per digit.
 *   - CLIP INVENTORY (§6.4): tier-1 locomotion (idle, walk, walk_back,
 *     strafe_left, strafe_right, sprint, tac_sprint, crouch_idle, crouch_walk,
 *     slide, jump_start, jump_loop, jump_land) + tier-2 grip-style hold poses
 *     (hold_rifle_twoHanded, hold_pistol_oneHanded, hold_fists) authored ONCE
 *     against this named hierarchy — any §2.1-conforming rig retargets them
 *     by name with zero code changes.
 *   - Metre units, identity-clean bind; inverse bind matrices cancel each
 *     joint's rest transform (standard GPU skinning, no bake needed).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLBBuilder } from './weapongen/glb.mjs';
import { addClip, identityQuat, quatAxis } from './weapongen/parts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const OUT = path.join(root, 'assets', 'models', 'characters', 'operator_arms.glb');

// --- tiny quaternion / matrix kit (local to this tool) -----------------------
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Quaternion rotating +X onto `dir` with controlled twist: local +Z aims at
 *  `zHint` (orthogonalized) — the palmar curl axis (§2.1 orientation note). */
function basisQuat(dir, zHint) {
  const x = vnorm(dir);
  let z = vnorm(zHint);
  z = vnorm(vsub(z, [x[0] * vdot(z, x), x[1] * vdot(z, x), x[2] * vdot(z, x)]));
  if (vlen(z) < 0.5) z = [0, 0, 1];
  const y = vcross(z, x);
  // TRUE column-major 3x3 (m[c*3+r]): column 0 = x basis, 1 = y, 2 = z — the
  // rotation that maps local (1,0,0) onto x. (The transposed layout fed the
  // extraction the INVERSE matrix and mirrored the whole skeleton.)
  const m = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  const trace = m[0] + m[4] + m[8];
  let q;
  // Matrix (columns = basis x,y,z; storage m[c*3+r] = M[r][c]) -> quaternion.
  // Cross-checked against THREE.Quaternion.setFromRotationMatrix:
  //   qx=(M21-M12)/4qw=(m5-m7)/s, qy=(M02-M20)/4qw=(m6-m2)/s,
  //   qz=(M10-M01)/4qw=(m1-m3)/s. Verified numerically: rot(+X) === dir.
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m[5] - m[7]) / s, (m[6] - m[2]) / s, (m[1] - m[3]) / s, 0.25 * s];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = [0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[5] - m[7]) / s];
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = [(m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s, (m[2] - m[6]) / s];
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s, (m[3] - m[1]) / s];
  }
  return q; // [x, y, z, w]
}

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (a) => [-a[0], -a[1], -a[2], a[3]];

/** Rigid global transform (quat q, pos p) → column-major mat4. */
function rigidMat4(q, p) {
  const x = q[0]; const y = q[1]; const z = q[2]; const w = q[3];
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    p[0], p[1], p[2], 1,
  ];
}
function invertRigid(m) {
  const r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; // column-major 3x3
  const t = [m[12], m[13], m[14]];
  const rT = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  const it = [
    -(rT[0] * t[0] + rT[1] * t[1] + rT[2] * t[2]),
    -(rT[3] * t[0] + rT[4] * t[1] + rT[5] * t[2]),
    -(rT[6] * t[0] + rT[7] * t[1] + rT[8] * t[2]),
  ];
  return [rT[0], rT[1], rT[2], 0, rT[3], rT[4], rT[5], 0, rT[6], rT[7], rT[8], 0, it[0], it[1], it[2], 1];
}

// --- oriented-box geometry emitter -------------------------------------------
class OrientedAccumulator {
  constructor() { this.byMaterial = new Map(); }
  prim(material) {
    let p = this.byMaterial.get(material);
    if (!p) { p = { positions: [], normals: [], joints: [], weights: [], indices: [] }; this.byMaterial.set(material, p); }
    return p;
  }

  /** Tapered box from A to B, oriented along the segment, rigidly skinned to
   *  `joint`. Face winding is CCW-seen-from-outside; normals are per-face. */
  addSegmentBox(pA, pB, thickA, thickB, joint, material) {
    const p = this.prim(material);
    const x = vnorm(vsub(pB, pA));
    let z = [0, 1, 0];
    if (Math.abs(vdot(z, x)) > 0.9) z = [1, 0, 0];
    z = vnorm(vsub(z, [x[0] * vdot(z, x), x[1] * vdot(z, x), x[2] * vdot(z, x)]));
    const y = vcross(z, x);
    const center = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2];
    const hl = vlen(vsub(pB, pA)) / 2;
    const ha = thickA / 2;
    const hb = thickB / 2;
    const corner = (t, du, dw) => [
      center[0] + x[0] * t * hl + y[0] * du * (t > 0 ? hb : ha) + z[0] * dw * (t > 0 ? hb : ha),
      center[1] + x[1] * t * hl + y[1] * du * (t > 0 ? hb : ha) + z[1] * dw * (t > 0 ? hb : ha),
      center[2] + x[2] * t * hl + y[2] * du * (t > 0 ? hb : ha) + z[2] * dw * (t > 0 ? hb : ha),
    ];
    const quad = (corners, nrm) => {
      const vBase = p.positions.length / 3;
      for (const c of corners) { p.positions.push(c[0], c[1], c[2]); p.normals.push(...nrm); p.joints.push(joint, 0, 0, 0); p.weights.push(1, 0, 0, 0); }
      p.indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
    };
    // +X cap, -X cap (ring in the y/z plane), ±Y, ±Z sides (tapered)
    quad([corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1)], x);
    quad([corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1)], [-x[0], -x[1], -x[2]]);
    quad([corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1), corner(1, -1, -1)], [-y[0], -y[1], -y[2]]);
    quad([corner(-1, 1, -1), corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, 1)], y);
    quad([corner(-1, -1, 1), corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1)], [-z[0], -z[1], -z[2]]);
    quad([corner(-1, 1, 1), corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1)], z);
  }
}

// --- armature authoring ------------------------------------------------------
// Joint positions in Root_Arms space (metres). A-pose: arms relaxed forward-
// down; hands pass roughly where a viewmodel anchor expects them.
// CAMERA-SPACE CONVENTION: -Z is forward (three.js camera looks down -Z).
// A-pose reaches forward-down; hands land near where a grip anchor sits.
const P = {
  chest: [0, 0, 0],
  shoulderR: [0.085, -0.015, -0.045],
  elbowR: [0.235, -0.335, -0.115],
  wristR: [0.2, -0.545, -0.27],
  palmR: [0.185, -0.575, -0.36],
  shoulderL: [-0.085, -0.015, -0.045],
  elbowL: [-0.235, -0.335, -0.115],
  wristL: [-0.2, -0.545, -0.27],
  palmL: [-0.185, -0.575, -0.36],
};
// Palmar axis hint: palms face INWARD (thumbs up), curl axis local +Z.
const Z_HINT = { R: [-0.6, 0.5, -0.6], L: [0.6, 0.5, -0.6] };

function build() {
  const b = new GLBBuilder();
  const acc = new OrientedAccumulator();

  const matSkin = b.addMaterial({
    name: 'operator_skin',
    pbrMetallicRoughness: { baseColorFactor: [0.82, 0.66, 0.55, 1], metallicFactor: 0.02, roughnessFactor: 0.75 },
  });
  const matSleeve = b.addMaterial({
    name: 'operator_sleeve',
    pbrMetallicRoughness: { baseColorFactor: [0.16, 0.17, 0.2, 1], metallicFactor: 0.05, roughnessFactor: 0.9 },
  });

  const nRoot = b.addNode({ name: 'Root_Arms', translation: [0, 0, 0] });
  const joints = [nRoot];
  const rest = new Map(); // node index -> { q: localQuat, t: localTranslation, gq: globalQuat, gp: globalPos, len }
  rest.set(nRoot, { q: identityQuat(), t: [0, 0, 0], gq: identityQuat(), gp: P.chest, len: 0 });

  const rotVec = (q, v) => {
    // v' = q v q^-1. The intermediate product (q v) is a FULL quaternion
    // whose w = -q.dot(v) must be carried into the second multiply —
    // dropping it (an earlier bug) silently shrank/skewed every
    // parent-local bone translation. Same arithmetic as
    // THREE.Vector3.applyQuaternion (numerically verified against three).
    const ix = q[3] * v[0] + q[1] * v[2] - q[2] * v[1];
    const iy = q[3] * v[1] + q[2] * v[0] - q[0] * v[2];
    const iz = q[3] * v[2] + q[0] * v[1] - q[1] * v[0];
    const iw = -q[0] * v[0] - q[1] * v[1] - q[2] * v[2];
    return [
      ix * q[3] + iw * -q[0] + iy * -q[2] - iz * -q[1],
      iy * q[3] + iw * -q[1] + iz * -q[0] - ix * -q[2],
      iz * q[3] + iw * -q[2] + ix * -q[1] - iy * -q[0],
    ];
  };

  /** Add a bone pivoted at `pivot` (its true global position), +X aiming at
   *  `to`. Local translation = parent-frame inverse of the pivot — geometry
   *  bases and bone pivots coincide EXACTLY (correct rotation centres). */
  function addBone(name, parentIdx, pivot, to, zHint) {
    const dir = vsub(to, pivot);
    const len = vlen(dir);
    const parent = rest.get(parentIdx);
    const gq = basisQuat(dir, zHint ?? [0, 1, 0]);
    const q = qMul(qConj(parent.gq), gq);
    const localP = rotVec(qConj(parent.gq), vsub(pivot, parent.gp));
    const idx = b.addNode({ name, rotation: q, translation: localP });
    b.json.nodes[parentIdx].children = [...(b.json.nodes[parentIdx].children ?? []), idx];
    rest.set(idx, { q, t: localP, gq, gp: pivot, len });
    joints.push(idx);
    return idx;
  }

  const armSpecs = [
    { S: 'R', m: 1, shoulder: P.shoulderR, elbow: P.elbowR, wrist: P.wristR, palm: P.palmR },
    { S: 'L', m: -1, shoulder: P.shoulderL, elbow: P.elbowL, wrist: P.wristL, palm: P.palmL },
  ];
  const bonesBySide = {};
  for (const spec of armSpecs) {
    const zHint = Z_HINT[spec.S];
    const shoulder = addBone(`Shoulder_${spec.S}`, nRoot, spec.m === 1 ? [0, 0.01, 0.02] : [0, 0.01, 0.02], spec.shoulder, [0, 1, 0]);
    const upper = addBone(`UpperArm_${spec.S}`, shoulder, spec.shoulder, spec.elbow, [zHint[0], 1, zHint[2]]);
    const fore = addBone(`Forearm_${spec.S}`, upper, spec.elbow, spec.wrist, [zHint[0], 1, zHint[2]]);
    const hand = addBone(`Hand_${spec.S}`, fore, spec.wrist, spec.palm, zHint);
    // geometry: clavicle+upper+sleeve, forearm skin, palm block
    acc.addSegmentBox(spec.m === 1 ? [0, 0.01, 0.02] : [0, 0.01, 0.02], spec.shoulder, 0.09, 0.075, shoulder, matSleeve);
    acc.addSegmentBox(spec.shoulder, spec.elbow, 0.085, 0.06, upper, matSleeve);
    acc.addSegmentBox(spec.elbow, spec.wrist, 0.055, 0.042, fore, matSkin);
    // palm: box centered slightly ahead of the hand joint
    const palmDir = vnorm(vsub(spec.palm, spec.wrist));
    const palmEnd = [
      spec.wrist[0] + palmDir[0] * 0.1, spec.wrist[1] + palmDir[1] * 0.1, spec.wrist[2] + palmDir[2] * 0.1,
    ];
    acc.addSegmentBox(spec.wrist, palmEnd, 0.075, 0.06, hand, matSkin);
    bonesBySide[spec.S] = { shoulder, upper, fore, hand };

    // --- fingers (3 phalanges each; §2.1 required) ---------------------------
    const handFrameX = (() => { const m = rigidMat4(rest.get(hand).gq, [0, 0, 0]); return [m[0], m[1], m[2]]; })();
    const handFrameZ = (() => { const m = rigidMat4(rest.get(hand).gq, [0, 0, 0]); return [m[8], m[9], m[10]]; })();
    const fingerDefs = [
      ['Index', -0.75, 0.030], ['Middle', -0.28, 0.033], ['Ring', 0.2, 0.030], ['Pinky', 0.66, 0.024],
    ];
    for (const [fingerName, lateral, thickness] of fingerDefs) {
      let parentIdx = hand;
      let tip = spec.palm;
      const segLens = [0.042, 0.03, 0.022];
      for (let ph = 1; ph <= 3; ph += 1) {
        const lateralOffset = lateral * (0.018 + (ph === 1 ? 0.012 : 0));
        const base = [
          tip[0] + handFrameZ[0] * lateralOffset - handFrameX[0] * 0.02,
          tip[1] + handFrameZ[1] * lateralOffset - handFrameX[1] * 0.02,
          tip[2] + handFrameZ[2] * lateralOffset - handFrameX[2] * 0.02,
        ];
        const curl = ph === 1 ? 0.18 : 0.32; // relaxed A-pose half-curl
        const dir = vnorm([
          handFrameX[0] * (1 - curl * 0.25) + handFrameZ[0] * (-0.28 * curl * Math.sign(lateralOffset || 1) * -1) + 0,
          handFrameX[1] * (1 - curl * 0.25),
          handFrameX[2] * (1 - curl * 0.25),
        ]);
        const next = [
          base[0] + dir[0] * segLens[ph - 1],
          base[1] + dir[1] * segLens[ph - 1],
          base[2] + dir[2] * segLens[ph - 1],
        ];
        parentIdx = addBone(`${fingerName}_${spec.S}_0${ph}`, parentIdx, base, next, zHint);
        acc.addSegmentBox(base, next, thickness, thickness * (ph === 3 ? 0.85 : 0.95), parentIdx, matSkin);
        tip = next;
      }
    }
    // thumb: from the palm's inner edge, angled inward/forward
    const thumbBase = [
      spec.palm[0] - handFrameZ[0] * 0.045 * spec.m + handFrameX[0] * 0.015,
      spec.palm[1] + 0.005,
      spec.palm[2] - handFrameZ[2] * 0.045 * spec.m + handFrameX[2] * 0.015,
    ];
    let thumbParent = hand;
    let thumbTip = thumbBase;
    const thumbLens = [0.045, 0.032, 0.024];
    for (let ph = 1; ph <= 3; ph += 1) {
      const dir = vnorm([
        handFrameX[0] * 0.55 - handFrameZ[0] * 0.8 * spec.m + (ph > 1 ? handFrameX[0] * 0.2 : 0),
        handFrameX[1] * 0.55 - handFrameZ[1] * 0.8 * spec.m + 0.25,
        handFrameX[2] * 0.55 - handFrameZ[2] * 0.8 * spec.m + (ph > 1 ? handFrameX[2] * 0.2 : 0),
      ]);
      const base = thumbTip;
      const next = [base[0] + dir[0] * thumbLens[ph - 1], base[1] + dir[1] * thumbLens[ph - 1], base[2] + dir[2] * thumbLens[ph - 1]];
      thumbParent = addBone(`Thumb_${spec.S}_0${ph}`, thumbParent, base, next, zHint);
      acc.addSegmentBox(base, next, 0.024, ph === 3 ? 0.02 : 0.023, thumbParent, matSkin);
      thumbTip = next;
    }
  }

  // --- mesh node + skin -------------------------------------------------------
  const primitives = [];
  for (const [matIndex, prim] of acc.byMaterial.entries()) {
    const posMin = [Infinity, Infinity, Infinity];
    const posMax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < prim.positions.length; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        posMin[k] = Math.min(posMin[k], prim.positions[i + k]);
        posMax[k] = Math.max(posMax[k], prim.positions[i + k]);
      }
    }
    primitives.push({
      attributes: {
        POSITION: b.addFloatAccessor(prim.positions, 'VEC3', { min: posMin, max: posMax, target: 34962 }),
        NORMAL: b.addFloatAccessor(prim.normals, 'VEC3', { target: 34962 }),
        JOINTS_0: b.addUByteAccessor(prim.joints, 'VEC4'),
        WEIGHTS_0: b.addFloatAccessor(prim.weights, 'VEC4'),
      },
      indices: b.addUShortAccessor(prim.indices),
      material: matIndex,
    });
  }
  const mesh = b.addMesh({ name: 'operator_arms_mesh', primitives });
  const ibm = b.addFloatAccessor(joints.flatMap((j) => {
    const r = rest.get(j);
    return invertRigid(rigidMat4(r.gq, r.gp));
  }), 'MAT4');
  b.addSkin({ joints, inverseBindMatrices: ibm, skeleton: nRoot });
  const nMesh = b.addNode({ name: 'operator_arms', mesh, skin: 0 });
  b.json.nodes[nRoot].children = [...(b.json.nodes[nRoot].children ?? []), nMesh];
  b.addSceneRoot(nRoot);

  // --- clips (§6.4 tiers 1+2, authored ONCE against this hierarchy) -----------
  const D = (deg) => (deg * Math.PI) / 180;
  const localDelta = (node, degX, degY, degZ) => {
    const restQ = rest.get(node).q;
    const delta = (() => {
      const qx = quatAxis(1, 0, 0, D(degX));
      const qy = quatAxis(0, 1, 0, D(degY));
      const qz = quatAxis(0, 0, 1, D(degZ));
      return qMul(qx, qMul(qy, qz));
    })();
    return qMul(restQ, delta);
  };
  const rotTrack = (node, times, values) => ({ node, path: 'rotation', times, values });
  const staticRot = (node, deg) => rotTrack(node, [0, 1], [localDelta(node, ...deg), localDelta(node, ...deg)]);

  // Tier 2: hold poses (additive-consumed; grip style, not per weapon).
  const curlFinger = (side, name, segs, deg) => segs.map((s, i) => staticRot(bonesBySide[side] ? fingerNode(name, side, s) : -1, [0, 0, deg[i]]));
  function fingerNode(name, side, phalanx) {
    const found = b.json.nodes.findIndex((n) => n.name === `${name}_${side}_0${phalanx}`);
    if (found < 0) throw new Error(`generateHandsRig: missing finger node ${name}_${side}_0${phalanx}`);
    return found;
  }
  function holdPose(name, side, curls) {
    const tracks = [];
    for (const [finger, deg] of Object.entries(curls)) {
      for (let ph = 1; ph <= 3; ph += 1) {
        tracks.push(staticRot(fingerNode(finger, side, ph), [0, 0, deg[ph - 1]]));
      }
    }
    addClip(b, name, tracks);
  }
  const FULL = [38, 42, 30];
  const HALF = [16, 22, 16];
  holdPose('hold_rifle_twoHanded', 'R', { Index: HALF, Middle: FULL, Ring: FULL, Pinky: FULL, Thumb: [30, 34, 24] });
  holdPose('hold_rifle_twoHanded_L', 'L', { Index: FULL, Middle: FULL, Ring: FULL, Pinky: FULL, Thumb: [30, 34, 24] });
  holdPose('hold_pistol_oneHanded', 'R', { Index: [10, 14, 10], Middle: FULL, Ring: FULL, Pinky: FULL, Thumb: [26, 30, 20] });
  holdPose('hold_fists', 'R', { Index: FULL, Middle: FULL, Ring: FULL, Pinky: FULL, Thumb: [40, 44, 32] });
  holdPose('hold_fists_L', 'L', { Index: FULL, Middle: FULL, Ring: FULL, Pinky: FULL, Thumb: [40, 44, 32] });

  // Tier 1: locomotion (subtle arm life; weapon-side sway rides the weapon GLB).
  const swayClip = (name, seconds, deg, degY = 0) => {
    const R = bonesBySide.R;
    const L = bonesBySide.L;
    addClip(b, name, [
      rotTrack(R.upper, [0, seconds / 2, seconds], [localDelta(R.upper, 0, 0, 0), localDelta(R.upper, deg * 0.4, degY, deg), localDelta(R.upper, 0, 0, 0)]),
      rotTrack(L.upper, [0, seconds / 2, seconds], [localDelta(L.upper, 0, 0, 0), localDelta(L.upper, deg * 0.4, -degY, -deg), localDelta(L.upper, 0, 0, 0)]),
      rotTrack(R.fore, [0, seconds / 2, seconds], [localDelta(R.fore, 0, 0, 0), localDelta(R.fore, -deg * 0.6, 0, 0), localDelta(R.fore, 0, 0, 0)]),
      rotTrack(L.fore, [0, seconds / 2, seconds], [localDelta(L.fore, 0, 0, 0), localDelta(L.fore, -deg * 0.6, 0, 0), localDelta(L.fore, 0, 0, 0)]),
    ]);
  };
  swayClip('idle', 2.4, 0.9);
  swayClip('walk', 0.6, 2.4);
  swayClip('walk_back', 0.65, 2.0);
  swayClip('strafe_left', 0.6, 2.6, 2);
  swayClip('strafe_right', 0.6, 2.6, -2);
  swayClip('sprint', 0.45, 4.6);
  swayClip('tac_sprint', 0.45, 6.2, 3);
  swayClip('crouch_walk', 0.8, 1.6);
  swayClip('crouch_idle', 1.2, 0.7);
  addClip(b, 'slide', [
    staticRot(bonesBySide.R.upper, [6, 8, -4]),
    staticRot(bonesBySide.L.upper, [6, 8, 4]),
    rotTrack(bonesBySide.R.fore, [0, 0.4, 0.8], [localDelta(bonesBySide.R.fore, 0, 0, 0), localDelta(bonesBySide.R.fore, -3, 0, 0), localDelta(bonesBySide.R.fore, 0, 0, 0)]),
  ]);
  addClip(b, 'jump_start', [
    rotTrack(bonesBySide.R.upper, [0, 0.25], [localDelta(bonesBySide.R.upper, 0, 0, 0), localDelta(bonesBySide.R.upper, -5, 0, -4)]),
    rotTrack(bonesBySide.L.upper, [0, 0.25], [localDelta(bonesBySide.L.upper, 0, 0, 0), localDelta(bonesBySide.L.upper, -5, 0, 4)]),
  ]);
  addClip(b, 'jump_loop', [
    rotTrack(bonesBySide.R.upper, [0, 0.25, 0.5], [localDelta(bonesBySide.R.upper, -5, 0, -4), localDelta(bonesBySide.R.upper, -3, 0, -2), localDelta(bonesBySide.R.upper, -5, 0, -4)]),
    rotTrack(bonesBySide.L.upper, [0, 0.25, 0.5], [localDelta(bonesBySide.L.upper, -5, 0, 4), localDelta(bonesBySide.L.upper, -3, 0, 2), localDelta(bonesBySide.L.upper, -5, 0, 4)]),
  ]);
  addClip(b, 'jump_land', [
    rotTrack(bonesBySide.R.upper, [0, 0.12, 0.3], [localDelta(bonesBySide.R.upper, -5, 0, -4), localDelta(bonesBySide.R.upper, 4, 0, 3), localDelta(bonesBySide.R.upper, 0, 0, 0)]),
    rotTrack(bonesBySide.L.upper, [0, 0.12, 0.3], [localDelta(bonesBySide.L.upper, -5, 0, 4), localDelta(bonesBySide.L.upper, 4, 0, -3), localDelta(bonesBySide.L.upper, 0, 0, 0)]),
  ]);

  return b;
}

mkdirSync(path.dirname(OUT), { recursive: true });
const builder = build();
const bytes = builder.write(OUT);
console.log(`[generateHandsRig] operator_arms.glb (${bytes} bytes), canonical §2.1 rig, ${builder.json.animations.length} clips, ${builder.json.nodes.length} nodes`);
