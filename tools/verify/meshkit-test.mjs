import * as THREE from 'three';
import { extrude, loft, lathe, bevelBox, tube, merge, triCount } from '../lib/MeshKit.js';

const checks = [];
const ok = (name, cond, detail = '') => checks.push({ name, pass: !!cond, detail });

function audit(label, geo, expectTris) {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  let finite = true;
  for (let i = 0; i < pos.array.length; i += 1) {
    if (!Number.isFinite(pos.array[i])) finite = false;
  }
  ok(`${label}: finite positions`, finite);
  let inRange = true;
  if (idx) {
    for (let i = 0; i < idx.count; i += 1) if (idx.array[i] >= pos.count) inRange = false;
  }
  ok(`${label}: indices in range`, inRange);

  let vol = 0;
  let degenerate = 0;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.array[i] : i;
    const ib = idx ? idx.array[i + 1] : i + 1;
    const ic = idx ? idx.array[i + 2] : i + 2;
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    vol += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
    const cross = new THREE.Vector3().subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    if (cross.length() < 1e-12) degenerate += 1;
  }
  ok(`${label}: outward winding (vol>0)`, vol > 0, `vol=${vol.toFixed(4)}`);
  ok(`${label}: no degenerate tris`, degenerate === 0, `${degenerate} degenerate`);
  if (expectTris) ok(`${label}: tri budget`, triCount(geo) <= expectTris, `${triCount(geo)} tris`);
  return vol;
}

const sq = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];

const prism = extrude(sq, 2);
const v1 = audit('extrude(square,2)', prism);
ok('extrude: volume == 2.0', Math.abs(v1 - 2) < 1e-6, `got ${v1.toFixed(6)}`);

const lofted = loft(sq, [{ z: -1 }, { z: 1 }]);
const v2 = audit('loft(square)', lofted);
ok('loft: volume == 2.0', Math.abs(v2 - 2) < 1e-6, `got ${v2.toFixed(6)}`);

const frust = loft(sq, [{ z: -1, scale: 1 }, { z: 1, scale: 0.5 }]);
const v3 = audit('loft(taper)', frust);
ok('loft taper: 0 < vol < 2', v3 > 0 && v3 < 2, `got ${v3.toFixed(4)}`);

const cyl = lathe([[1, -1], [1, 1]], 8);
const v4 = audit('lathe(cylinder)', cyl);
// Regular octagon of circumradius 1 has area 2.8284, so h=2 gives 5.6569.
// (The circle value 6.2832 is the WRONG target - an 8-gon is inscribed.)
ok('lathe: volume == inscribed octagon 5.6569', Math.abs(v4 - 5.6569) < 1e-3, `got ${v4.toFixed(4)}`);

const bb = bevelBox(1, 1, 1, 0.1);
const v5 = audit('bevelBox(1,1,1)', bb, 64);
// A 1m cube chamfered by 0.1 loses 4 edge wedges per axis plus 8 corners:
// analytically ~0.9553. Anything near 1.0 means the bevel is not being cut;
// anything near 0.64 means the ends are being SCALED instead of inset.
// Analytic: mid cross-section 0.98 over length 0.8, plus two frustum caps
// tapering 0.98 -> 0.62 over 0.1 each => 0.9426. Derived independently of the
// implementation, so this pins the geometry rather than blessing the output.
ok('bevelBox: volume == 0.9426', Math.abs(v5 - 0.9426) < 5e-3, `got ${v5.toFixed(4)}`);

const tb = tube([0, 0, 0], [0, 2, 0], 0.5, 6);
const v6 = audit('tube', tb);
ok('tube: volume>0 reasonable', v6 > 1.2 && v6 < 1.6, `got ${v6.toFixed(4)}`);

// REGRESSION: a profile supplied in the opposite winding must still produce
// an outward-facing solid. This is the bug that made the car hull render
// inside-out - seats visible through the bodywork from the rear quarter.
const sqCW = sq.slice().reverse();
const v7 = audit('loft(reversed profile)', loft(sqCW, [{ z: -1 }, { z: 1 }]));
ok('loft: winding auto-corrected', Math.abs(v7 - 2) < 1e-6, `got ${v7.toFixed(6)}`);
const v8 = audit('extrude(reversed profile)', extrude(sqCW, 2));
ok('extrude: winding auto-corrected', Math.abs(v8 - 2) < 1e-6, `got ${v8.toFixed(6)}`);

// REGRESSION: stations ordered +Z -> -Z (authoring a vehicle from the rear
// bumper forwards) must still give an outward solid. This inverted the whole
// car hull and only showed up as "you can see the seats through the body".
const vDesc = audit('loft(descending stations)', loft(sq, [{ z: 1 }, { z: -1 }]));
ok('loft: descending sweep auto-corrected', Math.abs(vDesc - 2) < 1e-6, `got ${vDesc.toFixed(6)}`);
const vDescRev = audit('loft(descending + reversed)', loft(sq.slice().reverse(), [{ z: 1 }, { z: -1 }]));
ok('loft: descending+reversed auto-corrected', Math.abs(vDescRev - 2) < 1e-6, `got ${vDescRev.toFixed(6)}`);

const tA = triCount(extrude(sq, 1));
const tB = triCount(lathe([[1, -1], [1, 1]], 8));
const m = merge([extrude(sq, 1), lathe([[1, -1], [1, 1]], 8)]);
ok('merge: tris preserved', triCount(m) === tA + tB, `${triCount(m)} vs ${tA + tB}`);

let pass = 0;
for (const c of checks) {
  if (c.pass) pass += 1;
  console.log((c.pass ? 'PASS' : 'FAIL'), c.name.padEnd(42), c.detail);
}
console.log(`\n${pass}/${checks.length} passed`);
process.exit(pass === checks.length ? 0 : 1);
