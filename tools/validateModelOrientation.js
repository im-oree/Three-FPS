/**
 * validateModelOrientation.js — Document C §3.6 offline orientation validator.
 *
 * Loads a generated .glb (plain JSON parse of the GLB container — no GPU, no
 * three.js), reconstructs each named node's world transform from the scene
 * graph, and prints the socket/joint frame axes so a human can verify:
 *   - Socket_Muzzle −Z points out the barrel
 *   - Socket_Optic −Z points through the lens, +Y up
 *   - Joint pivots' −Y points down the limb
 *
 * usage: node tools/validateModelOrientation.js assets/models/weapons/rifle.glb
 */
import { readFileSync } from 'node:fs';

/** Minimal mat4 helpers (column-major, GLB convention). */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function fromTRS(node) {
  if (node.matrix) return [...node.matrix]; // exporter-baked matrix (column-major)
  const t = node.translation ?? [0, 0, 0];
  const q = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const rot = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  for (let c = 0; c < 3; c += 1) {
    for (let r = 0; r < 3; r += 1) rot[c * 4 + r] *= s[c];
  }
  rot[12] = t[0]; rot[13] = t[1]; rot[14] = t[2];
  return rot;
}
function apply(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}
const fmt = (v) => `[${v.map((n) => (n >= 0 ? '+' : '') + n.toFixed(3)).join(', ')}]`;

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/validateModelOrientation.js <model.glb>');
  process.exit(1);
}
const bin = readFileSync(path);
const jsonLen = bin.readUInt32LE(12);
const json = JSON.parse(bin.subarray(20, 20 + jsonLen).toString('utf8'));

const scene = json.scenes[json.scene ?? 0];
const world = new Array(16).fill(0);
world[0] = world[5] = world[10] = world[15] = 1;

const report = [];
function walk(nodeIndex, parentMatrix) {
  const node = json.nodes[nodeIndex];
  const matrix = mul(parentMatrix, fromTRS(node));
  if (/^Socket_|Pivot|Hand$|^Bone_/.test(node.name ?? '')) {
    const fwd = apply(matrix, [0, 0, -1]);
    const up = apply(matrix, [0, 1, 0]);
    const right = apply(matrix, [1, 0, 0]);
    const pos = [matrix[12], matrix[13], matrix[14]];
    report.push({ name: node.name, pos, fwd, up, right });
  }
  for (const child of node.children ?? []) walk(child, matrix);
}
for (const root of scene.nodes) walk(root, world);

console.log(`\n== ${path} — ${report.length} named frames ==\n`);
for (const r of report) {
  console.log(`${r.name}`);
  console.log(`  pos    ${fmt(r.pos)}`);
  console.log(`  fwd(-Z) ${fmt(r.fwd)}   <- barrel/lens direction`);
  console.log(`  up (+Y) ${fmt(r.up)}`);
  console.log(`  right(+X) ${fmt(r.right)}`);
}
console.log('\nVerify: Muzzle/Optic fwd points out the barrel/lens (−Z);');
console.log('joint pivots carry −Y down the limb (see COORDINATE_CONVENTIONS.md).\n');
