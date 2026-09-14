#!/usr/bin/env node
/**
 * validateWeaponModel.js — check a replacement weapon model against the
 * contract in WEAPON_MODEL_SPEC.md.
 *
 *   node tools/validateWeaponModel.js <path-to.glb> <weaponId>
 *   node tools/validateWeaponModel.js --all        # every model on disk
 *
 * Exits non-zero if anything would break the game. Every rule checked here is
 * something the runtime actually depends on: a socket the IK looks up by name,
 * an axis the ADS math projects along, a node the part animator translates.
 *
 * Like tools/validateModelOrientation.js this parses the GLB container
 * directly — no three.js, no GPU — so whoever is authoring the models can run
 * it with nothing but Node installed.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// The contract, mirrored from WEAPON_MODEL_SPEC.md.
// ---------------------------------------------------------------------------

const REQUIRED_SOCKETS = [
  'Socket_Grip', 'Socket_GripSecondary', 'Socket_Muzzle',
  'Socket_Magazine', 'Socket_Ejection', 'Socket_Optic',
];

const WEAPONS = {
  rifle: {
    parts: ['Bone_Magazine', 'Bone_ChargingHandle'],
    extraSockets: [], lengthRange: [0.6, 1.35],
  },
  pistol: {
    parts: ['Bone_Magazine'],
    extraSockets: [], lengthRange: [0.12, 0.45], shortWeapon: true,
  },
  shotgun: {
    parts: ['Bone_Magazine', 'Bone_ChargingHandle', 'Bone_Pump'],
    extraSockets: [], lengthRange: [0.6, 1.3],
    socketParent: { Socket_GripSecondary: 'Bone_Pump' },
  },
  smg: {
    parts: ['Bone_Magazine', 'Bone_ChargingHandle'],
    extraSockets: [], lengthRange: [0.3, 0.8],
  },
  sniper: {
    parts: ['Bone_Magazine', 'Bone_ChargingHandle'],
    extraSockets: [], lengthRange: [0.8, 1.6],
  },
  rocket_launcher: {
    parts: ['Bone_Magazine'],
    extraSockets: ['Socket_ShoulderRest'], lengthRange: [0.7, 1.6],
  },
  rocket_projectile: {
    root: 'Root_Projectile', parts: [], extraSockets: [],
    skipSockets: true, lengthRange: [0.05, 0.5], shortWeapon: true,
  },
};

// --- minimal mat4 / GLB plumbing (same approach as the orientation tool) ----

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function fromTRS(node) {
  if (node.matrix) return [...node.matrix];
  const t = node.translation ?? [0, 0, 0];
  const q = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  for (let c = 0; c < 3; c += 1) {
    for (let r = 0; r < 3; r += 1) m[c * 4 + r] *= s[c];
  }
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rotate = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];
const translation = (m) => [m[12], m[13], m[14]];
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fmt = (v) => `[${v.map((n) => (n >= 0 ? '+' : '') + n.toFixed(3)).join(', ')}]`;

/** Read a GLB into { json, bin }. */
function readGLB(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = null;
  let off = 20 + jsonLen;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x004e4942) { bin = buf.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len;
  }
  return { json, bin };
}

/** Flatten the node graph into { name, world, node, parentNames[] }. */
function flatten(json) {
  const nodes = json.nodes ?? [];
  const scene = json.scenes?.[json.scene ?? 0];
  const out = [];
  const visit = (index, parentMatrix, chain) => {
    const node = nodes[index];
    if (!node) return;
    const world = mul(parentMatrix, fromTRS(node));
    out.push({ index, name: node.name ?? '', node, world, chain });
    for (const child of node.children ?? []) {
      visit(child, world, [...chain, node.name ?? '']);
    }
  };
  for (const rootIndex of scene?.nodes ?? []) visit(rootIndex, IDENTITY, []);
  return out;
}

/** Accessor min/max give exact bounds with no mesh decoding. */
function boundsOf(json, flat) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const entry of flat) {
    if (entry.node.mesh === undefined) continue;
    const mesh = json.meshes?.[entry.node.mesh];
    for (const prim of mesh?.primitives ?? []) {
      const accessor = json.accessors?.[prim.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      found = true;
      // Transform all 8 corners of the local AABB into world space.
      for (let i = 0; i < 8; i += 1) {
        const corner = [
          (i & 1) ? accessor.max[0] : accessor.min[0],
          (i & 2) ? accessor.max[1] : accessor.min[1],
          (i & 4) ? accessor.max[2] : accessor.min[2],
        ];
        const w = rotate(entry.world, corner);
        const t = translation(entry.world);
        for (let a = 0; a < 3; a += 1) {
          const v = w[a] + t[a];
          if (v < lo[a]) lo[a] = v;
          if (v > hi[a]) hi[a] = v;
        }
      }
    }
  }
  return found ? { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] } : null;
}

// ---------------------------------------------------------------------------

let failures = 0;
let warnings = 0;
const fail = (m, d = '') => { console.log(`  FAIL  ${m}${d ? ` — ${d}` : ''}`); failures += 1; };
const ok = (m, d = '') => console.log(`  ok    ${m}${d ? ` — ${d}` : ''}`);
const warn = (m, d = '') => { console.log(`  warn  ${m}${d ? ` — ${d}` : ''}`); warnings += 1; };

function validate(file, weaponId) {
  console.log(`\n${path.basename(file)}  (as "${weaponId}")`);
  const spec = WEAPONS[weaponId];
  if (!spec) {
    fail(`unknown weapon id "${weaponId}"`, `known: ${Object.keys(WEAPONS).join(', ')}`);
    return;
  }
  if (!existsSync(file)) { fail('file not found', file); return; }

  let json;
  try { ({ json } = readGLB(file)); } catch (err) {
    fail('could not parse as .glb', String(err.message ?? err).slice(0, 120));
    return;
  }

  const flat = flatten(json);
  const byName = new Map();
  for (const entry of flat) if (entry.name) byName.set(entry.name, entry);

  // --- root -----------------------------------------------------------------
  const wantRoot = spec.root ?? 'Root_Weapon';
  const root = byName.get(wantRoot);
  if (!root) {
    fail(`no node named "${wantRoot}"`,
      `found: ${flat.filter((e) => e.chain.length === 0).map((e) => e.name || '(unnamed)').join(', ')}`);
  } else {
    ok(`root node "${wantRoot}" present`);
  }
  const rootFwd = root ? norm(rotate(root.world, [0, 0, -1])) : [0, 0, -1];

  // --- baked animation ------------------------------------------------------
  if (json.animations?.length) {
    fail('.glb contains baked animation clips',
      `${json.animations.length} found — all weapon motion is procedural`);
  } else {
    ok('no baked animation clips');
  }

  // --- skinning, lights, cameras -------------------------------------------
  if (json.skins?.length) {
    fail('contains skinned meshes', `${json.skins.length} skin(s) — rigid hierarchy only`);
  } else {
    ok('no skinning (rigid hierarchy)');
  }
  const extLights = json.extensions?.KHR_lights_punctual?.lights?.length ?? 0;
  if (extLights || json.cameras?.length) {
    fail('contains lights or cameras', `${extLights} light(s), ${json.cameras?.length ?? 0} camera(s)`);
  }

  const meshNodes = flat.filter((e) => e.node.mesh !== undefined);
  if (meshNodes.length === 0) fail('no meshes at all');
  else ok(`${meshNodes.length} mesh nodes`);

  // --- materials ------------------------------------------------------------
  const textured = (json.materials ?? []).filter((m) => m.pbrMetallicRoughness?.baseColorTexture);
  if (textured.length) {
    warn('base-colour textures present — SkinManager overwrites these at runtime',
      `${textured.length} material(s)`);
  }
  const nonPbr = (json.materials ?? []).filter((m) => !m.pbrMetallicRoughness);
  if (nonPbr.length) warn('materials without PBR metallic-roughness', `${nonPbr.length}`);

  // --- scale ----------------------------------------------------------------
  const bounds = boundsOf(json, flat);
  if (!bounds) {
    fail('could not compute bounds (no POSITION accessors)');
  } else {
    const longest = Math.max(...bounds.size);
    const [lo, hi] = spec.lengthRange;
    if (longest < lo || longest > hi) {
      fail(`scale looks wrong: longest axis ${longest.toFixed(3)} m`,
        `expected roughly ${lo}-${hi} m (metres, 1:1)`);
    } else {
      ok(`scale sane: ${longest.toFixed(3)} m along its longest axis`);
    }
    if (!spec.shortWeapon && bounds.size[2] < Math.max(bounds.size[0], bounds.size[1])) {
      warn('Z is not the longest axis — is the model rotated?', `size ${fmt(bounds.size)}`);
    }
  }

  // --- sockets --------------------------------------------------------------
  if (!spec.skipSockets) {
    const need = [...REQUIRED_SOCKETS, ...spec.extraSockets];
    const missing = [];
    for (const name of need) {
      const entry = byName.get(name);
      if (!entry) { missing.push(name); continue; }
      if (entry.node.mesh !== undefined) {
        warn(`${name} carries mesh geometry`, 'sockets should be empty markers');
      }
      ok(`${name} ${fmt(translation(entry.world))}`);
    }
    if (missing.length) fail('missing sockets', missing.join(', '));

    // Muzzle and optic must face down the barrel.
    for (const name of ['Socket_Muzzle', 'Socket_Optic']) {
      const entry = byName.get(name);
      if (!entry) continue;
      const fwd = norm(rotate(entry.world, [0, 0, -1]));
      const d = dot(fwd, rootFwd);
      if (d < 0.99) {
        fail(`${name} does not point down the barrel`,
          `its -Z is ${fmt(fwd)}, root -Z is ${fmt(rootFwd)} (dot ${d.toFixed(3)})`);
      } else {
        ok(`${name} faces -Z down the barrel`);
      }
    }

    // Muzzle must be forward of the grip, or the model is back to front.
    const muzzle = byName.get('Socket_Muzzle');
    const grip = byName.get('Socket_Grip');
    if (muzzle && grip) {
      const mz = translation(muzzle.world)[2];
      const gz = translation(grip.world)[2];
      if (mz >= gz) {
        fail('Socket_Muzzle is not in front of Socket_Grip',
          `muzzle z ${mz.toFixed(3)} vs grip z ${gz.toFixed(3)} — model may be backwards`);
      } else {
        ok('muzzle sits forward of the grip');
      }
    }

    for (const [socketName, parentName] of Object.entries(spec.socketParent ?? {})) {
      const entry = byName.get(socketName);
      if (!entry) continue;
      if (entry.chain.includes(parentName)) {
        ok(`${socketName} is parented under ${parentName}`);
      } else {
        warn(`${socketName} is not parented under ${parentName}`,
          'the support hand will not track the pump');
      }
    }
  }

  // --- animated parts -------------------------------------------------------
  for (const name of spec.parts) {
    const entry = byName.get(name);
    if (!entry) { fail(`missing animated part "${name}"`); continue; }
    const hasGeometry = entry.node.mesh !== undefined
      || flat.some((e) => e.chain.includes(name) && e.node.mesh !== undefined);
    if (!hasGeometry) warn(`${name} has no geometry`, 'it will move but show nothing');
    else ok(`${name} present with geometry`);
  }
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log('usage: node tools/validateWeaponModel.js <file.glb> <weaponId>');
  console.log('       node tools/validateWeaponModel.js --all');
  console.log(`\nweapon ids: ${Object.keys(WEAPONS).join(', ')}`);
  console.log('\nSee WEAPON_MODEL_SPEC.md for the full contract.');
  process.exit(0);
}

if (args[0] === '--all') {
  for (const id of Object.keys(WEAPONS)) {
    validate(`assets/models/weapons/${id}.glb`, id);
  }
} else {
  validate(args[0], args[1] ?? path.basename(args[0], '.glb'));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} blocking issue(s), ${warnings} warning(s)`);
console.log(failures === 0
  ? 'This model satisfies the contract and will drop into the game.'
  : 'See WEAPON_MODEL_SPEC.md for what each rule means.');
process.exit(failures === 0 ? 0 : 1);
