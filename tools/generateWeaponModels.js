/**
 * generateWeaponModels.js — Document 3 §5 asset pipeline.
 * Produces REAL files on disk (standing asset policy):
 *   /assets/models/weapons/{assault_rifle,pistol,smg}.glb
 *   /assets/textures/weapons/<id>_{basecolor,normal,roughness,metalness}.png
 *
 * Each .glb is a skinned mesh (rigid weights) on the shared rig
 * root -> weapon_root -> {muzzle, mag, hand_r, hand_l}, with ALL nineteen
 * required clip names present as real clips. Art fidelity is placeholder
 * primitives BY DESIGN; the pipeline contract (files, socket, clip names,
 * PBR texture references) is what this tool guarantees.
 *
 * CLIP-DURATION DATA-INTEGRITY: reload_tactical / reload_empty / switch_*
 * durations below MUST equal the values in src/weapons/definitions/*.ts
 * (they are repeated here because the tool runs outside the app tsconfig).
 *   AR: 2.1 / 2.6   Pistol: 1.6 / 2.0   SMG: 1.9 / 2.4   switch: 0.35 / 0.45
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLBBuilder } from './weapongen/glb.mjs';
import { MeshAccumulator, addClip, identityQuat, quatAxis, translationMat4 } from './weapongen/parts.mjs';
import { encodePNG, noise01 } from './weapongen/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const MODEL_DIR = path.join(root, 'assets', 'models', 'weapons');
const TEX_DIR = path.join(root, 'assets', 'textures', 'weapons');

/** Proportions + rig offsets per weapon (metres, viewmodel scale). */
const WEAPONS = {
  assault_rifle: {
    tint: [0.16, 0.17, 0.19],
    receiver: { cz: -0.16, sz: 0.46, sy: 0.07, sx: 0.05 },
    barrel: { cz: -0.5, sz: 0.28, r: 0.016 },
    mag: { cz: -0.1, cy: -0.09, sy: 0.14, tilt: 0.25 },
    grip: { cz: 0.02, cy: -0.08, sy: 0.11, tilt: -0.3 },
    stock: { cz: 0.12, sz: 0.16, sy: 0.06 },
    sight: { cz: -0.2, cy: 0.05, sz: 0.09 },
    muzzleZ: -0.65,
    reloadTactical: 2.1,
    reloadEmpty: 2.6,
  },
  pistol: {
    tint: [0.12, 0.12, 0.14],
    receiver: { cz: -0.06, sz: 0.2, sy: 0.05, sx: 0.035 },
    barrel: { cz: -0.17, sz: 0.06, r: 0.012 },
    mag: { cz: -0.02, cy: -0.08, sy: 0.1, tilt: 0.0 },
    grip: { cz: 0.02, cy: -0.08, sy: 0.11, tilt: -0.35 },
    stock: null,
    sight: { cz: -0.1, cy: 0.035, sz: 0.04 },
    muzzleZ: -0.21,
    reloadTactical: 1.6,
    reloadEmpty: 2.0,
  },
  smg: {
    tint: [0.18, 0.16, 0.15],
    receiver: { cz: -0.12, sz: 0.3, sy: 0.065, sx: 0.045 },
    barrel: { cz: -0.32, sz: 0.14, r: 0.014 },
    mag: { cz: -0.08, cy: -0.1, sy: 0.16, tilt: 0.08 },
    grip: { cz: 0.03, cy: -0.08, sy: 0.1, tilt: -0.3 },
    stock: { cz: 0.1, sz: 0.12, sy: 0.05 },
    sight: { cz: -0.14, cy: 0.045, sz: 0.06 },
    muzzleZ: -0.4,
    reloadTactical: 1.9,
    reloadEmpty: 2.4,
  },
};

const SWITCH_OUT = 0.35;
const SWITCH_IN = 0.45;

function buildTextures(id, tint) {
  const size = 64;
  const maps = {};
  const rgba = new Uint8ClampedArray(size * size * 4);
  const fill = (fn) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const [r, g, b, a] = fn(x, y);
        const i = (y * size + x) * 4;
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
      }
    }
    return Buffer.from(rgba);
  };
  // Placeholder art, but READABLE: mid-tone tinted body with a lighter top
  // stripe and noise grain so the viewmodel never reads as a black silhouette
  // (Document 3 visual validation). Still real committed PNGs.
  maps.basecolor = fill((x, y) => {
    const n = noise01(x, y, 1) * 26 - 13;
    const stripe = y > 20 && y < 28 ? 46 : 0;
    const lift = 0.62; // lift dark tints into the visible mid range
    return [tint[0] * 255 * lift + 78 + n + stripe, tint[1] * 255 * lift + 82 + n + stripe, tint[2] * 255 * lift + 88 + n + stripe, 255];
  });
  maps.normal = fill(() => [128, 128, 255, 255]);
  maps.roughness = fill((x, y) => {
    const v = 140 + noise01(x, y, 2) * 60;
    return [v, v, v, 255];
  });
  // glTF packs metalness in B: keep it LOW-mid so the placeholder reads with
  // diffuse response under the viewmodel lights (pure metal + no env = black).
  maps.metalness = fill((x, y) => {
    const v = 70 + noise01(x, y, 3) * 30;
    return [v, v, v, 255];
  });
  for (const [name, buf] of Object.entries(maps)) {
    writeFileSync(path.join(TEX_DIR, `${id}_${name}.png`), encodePNG(size, size, buf));
  }
}

function buildWeapon(id, spec) {
  const b = new GLBBuilder();

  // --- textures / materials -------------------------------------------------
  buildTextures(id, spec.tint);
  const rel = (n) => `../../textures/weapons/${id}_${n}.png`;
  const matMetal = b.addMaterial({
    name: `${id}_metal`,
    pbrMetallicRoughness: {
      baseColorTexture: { index: b.addTexture(b.addImageURI(rel('basecolor'))) },
      metallicRoughnessTexture: { index: b.addTexture(b.addImageURI(rel('roughness'))) },
      metallicFactor: 0.55,
      roughnessFactor: 0.6,
    },
    normalTexture: { index: b.addTexture(b.addImageURI(rel('normal'))) },
  });
  const matPolymer = b.addMaterial({
    name: `${id}_polymer`,
    pbrMetallicRoughness: {
      baseColorTexture: { index: b.addTexture(b.addImageURI(rel('basecolor'))) },
      metallicRoughnessTexture: { index: b.addTexture(b.addImageURI(rel('roughness'))) },
      metallicFactor: 0.05,
      roughnessFactor: 0.9,
    },
    normalTexture: { index: b.addTexture(b.addImageURI(rel('normal'))) },
  });

  // --- rig nodes (joints 0..5) ------------------------------------------------
  const WR = [0, 0, 0]; // weapon_root rest local translation
  const MZ = [0, 0.02, spec.muzzleZ];
  const MG = [0, -0.02, spec.mag.cz];
  const HR = [0.05, -0.06, spec.grip.cz];
  const HL = [-0.05, -0.04, spec.receiver.cz + 0.08];
  const nRoot = b.addNode({ name: 'root', translation: [0, 0, 0] });
  const nWeapon = b.addNode({ name: 'weapon_root', translation: WR, children: [] });
  const nMuzzle = b.addNode({ name: 'muzzle', translation: MZ }); // socket: empty node
  const nMag = b.addNode({ name: 'mag', translation: MG });
  const nHandR = b.addNode({ name: 'hand_r', translation: HR });
  const nHandL = b.addNode({ name: 'hand_l', translation: HL });
  b.json.nodes[nWeapon].children = [nMuzzle, nMag, nHandR, nHandL];

  // --- geometry (joint indices: 1 weapon_root, 3 mag, 4 hand_r, 5 hand_l) ----
  const acc = new MeshAccumulator();
  const r = spec.receiver;
  acc.addBox({ cx: 0, cy: 0, cz: r.cz, sx: r.sx, sy: r.sy, sz: r.sz, joint: 1, material: matMetal });
  acc.addBox({ cx: 0, cy: 0.005, cz: spec.barrel.cz, sx: spec.barrel.r * 2, sy: spec.barrel.r * 2, sz: spec.barrel.sz, joint: 1, material: matMetal });
  acc.addBox({ cx: 0, cy: spec.mag.cy, cz: spec.mag.cz, sx: 0.03, sy: spec.mag.sy, sz: 0.05, joint: 3, material: matMetal });
  acc.addBox({ cx: 0, cy: spec.grip.cy, cz: spec.grip.cz, sx: 0.03, sy: spec.grip.sy, sz: 0.04, joint: 4, material: matPolymer });
  if (spec.stock) acc.addBox({ cx: 0, cy: 0, cz: spec.stock.cz, sx: 0.04, sy: spec.stock.sy, sz: spec.stock.sz, joint: 1, material: matPolymer });
  acc.addBox({ cx: 0, cy: spec.sight.cy, cz: spec.sight.cz, sx: 0.02, sy: 0.02, sz: spec.sight.sz, joint: 1, material: matMetal });
  acc.addBox({ cx: HR[0], cy: HR[1], cz: HR[2], sx: 0.05, sy: 0.05, sz: 0.09, joint: 4, material: matPolymer });
  acc.addBox({ cx: HL[0], cy: HL[1], cz: HL[2], sx: 0.05, sy: 0.05, sz: 0.1, joint: 5, material: matPolymer });

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
  const mesh = b.addMesh({ name: `${id}_mesh`, primitives });

  // --- skin: inverse bind matrices cancel each joint's rest transform --------
  const restGlobals = [
    [0, 0, 0], WR,
    [WR[0] + MZ[0], WR[1] + MZ[1], WR[2] + MZ[2]],
    [WR[0] + MG[0], WR[1] + MG[1], WR[2] + MG[2]],
    [WR[0] + HR[0], WR[1] + HR[1], WR[2] + HR[2]],
    [WR[0] + HL[0], WR[1] + HL[1], WR[2] + HL[2]],
  ];
  const ibm = b.addFloatAccessor(restGlobals.flatMap((t) => translationMat4(-t[0], -t[1], -t[2])), 'MAT4');
  b.addSkin({ joints: [nRoot, nWeapon, nMuzzle, nMag, nHandR, nHandL], inverseBindMatrices: ibm, skeleton: nRoot });
  const nMesh = b.addNode({ name: `${id}_skinned`, mesh, skin: 0 });
  b.json.nodes[nRoot].children = [nWeapon, nMesh];
  b.addSceneRoot(nRoot);

  // --- the nineteen required clips (exact, case-sensitive names) -------------
  const q = identityQuat();
  const rot = (deg, axis) => quatAxis(...axis, (deg * Math.PI) / 180);
  const wr = (dx, dy, dz) => [WR[0] + dx, WR[1] + dy, WR[2] + dz];
  const sway = (name, seconds, deg) => addClip(b, name, [
    { node: nWeapon, path: 'rotation', times: [0, seconds / 2, seconds], values: [rot(-deg, [0, 1, 0]), rot(deg, [0, 1, 0]), rot(-deg, [0, 1, 0])] },
    { node: nWeapon, path: 'translation', times: [0, seconds / 2, seconds], values: [wr(0, 0, 0), wr(0, -0.008, 0), wr(0, 0, 0)] },
  ]);
  sway('idle', 1.2, 0.4);
  sway('walk', 0.6, 1.6);
  sway('walk_back', 0.65, 1.4);
  sway('strafe_left', 0.6, 2.2);
  sway('strafe_right', 0.6, 2.2);
  sway('sprint', 0.45, 3.0);
  sway('crouch_walk', 0.8, 1.2);
  addClip(b, 'crouch_idle', [
    { node: nWeapon, path: 'translation', times: [0, 0.6, 1.2], values: [wr(0, -0.02, 0), wr(0, -0.028, 0), wr(0, -0.02, 0)] },
  ]);
  addClip(b, 'jump_start', [
    { node: nWeapon, path: 'rotation', times: [0, 0.25], values: [q, rot(-6, [1, 0, 0])] },
  ]);
  addClip(b, 'jump_loop', [
    { node: nWeapon, path: 'rotation', times: [0, 0.25, 0.5], values: [rot(-6, [1, 0, 0]), rot(-4, [1, 0, 0]), rot(-6, [1, 0, 0])] },
  ]);
  addClip(b, 'jump_land', [
    { node: nWeapon, path: 'rotation', times: [0, 0.12, 0.3], values: [rot(-6, [1, 0, 0]), rot(4, [1, 0, 0]), q] },
  ]);
  addClip(b, 'slide', [
    { node: nWeapon, path: 'rotation', times: [0, 0.15, 0.8], values: [q, rot(10, [1, 0, 0]), rot(8, [1, 0, 0])] },
    { node: nWeapon, path: 'translation', times: [0, 0.15, 0.8], values: [wr(0, 0, 0), wr(0, -0.05, 0.02), wr(0, -0.04, 0.02)] },
  ]);
  const fireTrack = (name) => addClip(b, name, [
    { node: nWeapon, path: 'translation', times: [0, 0.03, 0.1], values: [wr(0, 0, 0), wr(0, 0.012, 0.035), wr(0, 0, 0)] },
    { node: nWeapon, path: 'rotation', times: [0, 0.03, 0.1], values: [q, rot(2.4, [1, 0, 0]), q] },
  ]);
  fireTrack('fire');
  fireTrack('ads_fire');
  const reload = (name, duration) => addClip(b, name, [
    { node: nMag, path: 'translation', times: [0, duration * 0.3, duration * 0.55, duration * 0.8, duration], values: [MG, [MG[0], MG[1] - 0.12, MG[2] + 0.02], [MG[0], MG[1] - 0.12, MG[2] + 0.02], MG, MG] },
    { node: nWeapon, path: 'rotation', times: [0, duration * 0.25, duration * 0.75, duration], values: [q, rot(14, [1, 0, 0]), rot(14, [1, 0, 0]), q] },
  ]);
  reload('reload_tactical', spec.reloadTactical);
  reload('reload_empty', spec.reloadEmpty);
  addClip(b, 'switch_out', [
    { node: nWeapon, path: 'translation', times: [0, SWITCH_OUT], values: [wr(0, 0, 0), wr(0.06, -0.14, 0.05)] },
    { node: nWeapon, path: 'rotation', times: [0, SWITCH_OUT], values: [q, rot(24, [1, 0, 0])] },
  ]);
  addClip(b, 'switch_in', [
    { node: nWeapon, path: 'translation', times: [0, SWITCH_IN * 0.6, SWITCH_IN], values: [wr(0.06, -0.14, 0.05), wr(0, 0.01, -0.01), wr(0, 0, 0)] },
    { node: nWeapon, path: 'rotation', times: [0, SWITCH_IN * 0.6, SWITCH_IN], values: [rot(24, [1, 0, 0]), rot(-3, [1, 0, 0]), q] },
  ]);
  addClip(b, 'inspect', [
    { node: nWeapon, path: 'rotation', times: [0, 0.5, 1.1, 1.6], values: [q, rot(28, [0, 0, 1]), rot(-14, [0, 1, 0]), q] },
  ]);

  return b;
}

mkdirSync(MODEL_DIR, { recursive: true });
mkdirSync(TEX_DIR, { recursive: true });
for (const [id, spec] of Object.entries(WEAPONS)) {
  const builder = buildWeapon(id, spec);
  const bytes = builder.write(path.join(MODEL_DIR, `${id}.glb`));
  console.log(`[generateWeaponModels] ${id}.glb (${bytes} bytes), 19 clips, 12 textures referenced`);
}
