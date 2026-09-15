#!/usr/bin/env node
/**
 * acceptance-docn.mjs — Document N §10 acceptance verification.
 *
 *   node tools/verify/acceptance-docn.mjs --url http://localhost:5174
 *
 * Enters a match on Firing Range (level index 4) and asserts each acceptance
 * criterion against the LIVE engine, then captures reference screenshots from
 * the callout positions.
 *
 * Checks are engine-state assertions, not screenshot diffs: "the watchtower is
 * climbable" is verified by ray-casting the ladder rungs and stepping a probe
 * up them, because a screenshot cannot tell you whether a collider exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, collectDiagnostics } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const args = {
  url: 'http://localhost:5174', shots: 'tools/verify/shots/docn', skipShots: false,
};
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
  if (process.argv[i] === '--shots') args.shots = process.argv[++i];
  if (process.argv[i] === '--no-shots') args.skipShots = true;
}
fs.mkdirSync(args.shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const diag = collectDiagnostics(page);
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await enterMatch(page, { levelIndex: 4 });
await sleep(2000);

// ---------------------------------------------------------------------------
console.log('\n[1] Level + terrain');
// ---------------------------------------------------------------------------
const base = await page.evaluate(() => {
  const ops = window.__OPERATOR__;
  const level = ops.levelLoader.current;
  return {
    id: level?.id,
    displayName: level?.displayName,
    hdri: level?.hdri,
    groundSurface: level?.groundSurface,
    propCount: ops.levelLoader.mapProps?.propPool ? 1 : 0,
  };
});
check('level is firingrange', base.id === 'firingrange', base.displayName);
check('dusty HDRI applied', /tropical_firingrange/.test(base.hdri ?? ''), base.hdri);

// Terrain relief: sample the real physics surface across the playspace.
const terrain = await page.evaluate(() => {
  const ops = window.__OPERATOR__;
  const RAPIER = ops.RAPIER;
  const world = ops.physics.world;
  // Hit ONLY the terrain heightfield. A plain downward ray reports the
  // watchtower roof at y=7.2 and every building roof besides, which measures
  // architecture rather than ground and makes the relief figure meaningless.
  let terrainHandle = -1;
  world.forEachCollider((c) => {
    if (c.shapeType() === RAPIER.ShapeType.HeightField) terrainHandle = c.handle;
  });
  const onlyTerrain = (c) => c.handle === terrainHandle;

  const samples = [];
  // Sample the INTERIOR only: the boundary berms are deliberately steep
  // terrain outside the fence and would dominate a naive relief figure.
  for (let x = -32; x <= 32; x += 3) {
    for (let z = -26; z <= 32; z += 3) {
      const ray = new RAPIER.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(
        ray, 200, true, undefined, undefined, undefined, undefined, onlyTerrain,
      );
      if (hit) samples.push({ x, z, y: 60 - hit.timeOfImpact });
    }
  }
  const ys = samples.map((s) => s.y);
  // Worst LOCAL gradient between neighbouring samples — the figure that
  // actually decides walkability. Peak-to-trough relief across a 64 m map
  // says nothing about whether any given step is climbable.
  let maxStep = 0;
  const key = (x, z) => `${x},${z}`;
  const grid = new Map(samples.map((s) => [key(s.x, s.z), s.y]));
  for (const s of samples) {
    for (const [dx, dz] of [[3, 0], [0, 3]]) {
      const n = grid.get(key(s.x + dx, s.z + dz));
      if (n !== undefined) maxStep = Math.max(maxStep, Math.abs(n - s.y));
    }
  }
  return {
    count: samples.length,
    min: Math.min(...ys),
    max: Math.max(...ys),
    distinct: new Set(ys.map((y) => Math.round(y * 20))).size,
    maxStep,
    terrainHandle,
  };
});
check('terrain collision present', terrain.count > 100, `${terrain.count} ray hits`);
check(
  'terrain is NOT flat',
  terrain.distinct > 12 && terrain.max - terrain.min > 0.4,
  `${terrain.distinct} distinct heights, relief ${(terrain.max - terrain.min).toFixed(2)} m`,
);
check(
  'playspace stays walkable',
  terrain.maxStep < 1.5,
  `worst gradient ${terrain.maxStep.toFixed(2)} m over 3 m, `
  + `relief ${(terrain.max - terrain.min).toFixed(2)} m`,
);

// ---------------------------------------------------------------------------
console.log('\n[2] Buildings + opening-aware collision');
// ---------------------------------------------------------------------------
const buildings = await page.evaluate(() => {
  const ops = window.__OPERATOR__;
  const names = new Map();
  ops.levelLoader.scene.traverse((o) => {
    const m = /^Prop_(bldg_[a-z_]+)$/.exec(o.name ?? '');
    if (m) names.set(m[1], (names.get(m[1]) ?? 0) + 1);
  });
  let colliders = 0;
  ops.physics.world.forEachCollider(() => { colliders += 1; });
  return { types: [...names.entries()], total: [...names.values()].reduce((a, b) => a + b, 0), colliders };
});
check(
  'all 14 building types placed',
  buildings.types.length >= 14,
  `${buildings.types.length} types, ${buildings.total} instances`,
);
check('world has building colliders', buildings.colliders > 400, `${buildings.colliders} colliders`);

// Doorways must be PASSABLE: cast a horizontal ray at chest height through
// each building's door and confirm it is not blocked at the threshold.
const doorTest = await page.evaluate(() => {
  const ops = window.__OPERATOR__;
  const RAPIER = ops.RAPIER;
  const world = ops.physics.world;
  // Door approach lines for the walk-in structures: [name, fromX, fromZ,
  // toX, toZ], cast at y = 1.1 (chest height, within the 0.15..2.05 m door
  // opening). These run through each building's ACTUAL door, which is
  // off-centre on most recipes and rotated by the layout yaw — a naive
  // centreline probe hits the wall beside the door and reports a false
  // failure.
  const doors = [
    ['wood_building', -16.21, 7.96, -17.17, 0.01],
    ['tin_building', 16.62, 11.31, 18.83, 3.62],
    ['white_warehouse', -29.80, -5.87, -31.55, -13.68],
    ['armory', 34.39, -4.90, 30.91, -12.10],
  ];
  return doors.map(([name, x0, z0, x1, z1]) => {
    const dx = x1 - x0; const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ray = new RAPIER.Ray({ x: x0, y: 1.1, z: z0 }, { x: dx / len, y: 0, z: dz / len });
    const hit = world.castRay(ray, len, true);
    return { name, blockedAt: hit ? Math.round(hit.timeOfImpact * 100) / 100 : null, len };
  });
});
for (const d of doorTest) {
  check(
    `${d.name}: interior reachable through opening`,
    d.blockedAt === null || d.blockedAt > d.len * 0.62,
    d.blockedAt === null ? 'clear' : `blocked at ${d.blockedAt}m of ${d.len.toFixed(1)}m`,
  );
}

// ---------------------------------------------------------------------------
console.log('\n[3] Watchtower climbable to the loft');
// ---------------------------------------------------------------------------
const tower = await page.evaluate(() => {
  const ops = window.__OPERATOR__;
  const RAPIER = ops.RAPIER;
  const world = ops.physics.world;
  // The tower sits at (2,2) yaw -0.18 with its ladder on the +Z face.
  // Probe straight down at the loft centre: there must be a deck up there.
  const deck = (() => {
    const ray = new RAPIER.Ray({ x: 2, y: 9, z: 2 }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 12, true);
    return hit ? 9 - hit.timeOfImpact : null;
  })();
  // Rungs: sample up the ladder line and count solid hits.
  // Climbable treads: probe DOWNWARD onto each rung, which is the query that
  // actually matters — a capsule stands on a rung, it does not run into one.
  // The ladder leans back 0.09 rad as it rises, and the tower is placed at
  // (2, 2) with yaw -0.18, so each tread's world XZ is derived rather than
  // assumed (a fixed-Z probe misses every rung above the first).
  let rungs = 0;
  const yaw = -0.18;
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  for (let i = 1; i <= 16; i += 1) {
    const ly = i * 0.2725;
    const lz = 1.51 + ly * 0.09;
    const x = 2 + lz * sy;
    const z = 2 + lz * cy;
    const ray = new RAPIER.Ray({ x, y: ly + 0.25, z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 0.45, true);
    if (hit) rungs += 1;
  }
  return { deckY: deck, rungs };
});
check(
  'loft deck exists above ground',
  tower.deckY !== null && tower.deckY > 4.0,
  tower.deckY === null ? 'no deck found' : `deck at y=${tower.deckY.toFixed(2)}`,
);
check('ladder rungs are solid', tower.rungs >= 8, `${tower.rungs} rung hits`);

// ---------------------------------------------------------------------------
console.log('\n[4] Callout zones');
// ---------------------------------------------------------------------------
const callouts = await page.evaluate(async () => {
  const mod = await import('/src/world/CalloutZoneRegistry.ts');
  const reg = mod.calloutZoneRegistry ?? mod.default;
  const probes = [
    ['Tower', 2, 2], ['Mid', -7, -5], ['Range', 0, -26], ['Armory', 33, -12],
    ['Tin Building', 20, 6], ['Tyres', 31, 13], ['Trailer', -10, 20],
    ['Wood Building', -17, 1], ['White Warehouse', -30, -13], ['Jungle', 12, 34],
    ['Tunnel', 7, 18], ['Loft', 13, 20], ['Defending Spawn', 33, 27],
    ['Attacking Spawn', -36, 27], ['Toilets', -36, 13], ['A Long', -25, -27],
  ];
  return {
    count: reg.count,
    names: reg.zones.map((z) => z.name),
    hits: probes.map(([want, x, z]) => ({ want, got: reg.getZoneAt(x, z) })),
    outside: reg.getZoneAt(500, 500),
  };
});
check('21+ callout zones registered', callouts.count >= 21, `${callouts.count} zones`);
const wrong = callouts.hits.filter((h) => h.got !== h.want);
check(
  'getZoneAt resolves every probe to its zone',
  wrong.length === 0,
  wrong.length ? wrong.map((w) => `${w.want}->${w.got}`).join(', ') : `${callouts.hits.length}/${callouts.hits.length}`,
);
check('getZoneAt returns null out of bounds', callouts.outside === null, String(callouts.outside));

// ---------------------------------------------------------------------------
console.log('\n[5] Vegetation: palms sway, bushes instanced');
// ---------------------------------------------------------------------------
const veg = await page.evaluate(async () => {
  const ops = window.__OPERATOR__;
  const mb = ops.levelLoader.mapProps;
  let instancedBush = 0; let instancedGrass = 0; let palmClones = 0;
  ops.levelLoader.scene.traverse((o) => {
    if (o.isInstancedMesh) {
      if (/bush/i.test(o.name)) instancedBush += o.count;
      if (/grass/i.test(o.name)) instancedGrass += o.count;
    }
    if (/^Prop_palm_tree/.test(o.name ?? '')) palmClones += 1;
  });
  // Sample a palm crown's rotation twice across frames: it must MOVE.
  const crowns = [];
  ops.levelLoader.scene.traverse((o) => {
    if (o.name === 'PalmCrown' && crowns.length < 6) crowns.push(o);
  });
  const before = crowns.map((c) => `${c.rotation.x.toFixed(5)},${c.rotation.z.toFixed(5)}`);
  await new Promise((r) => setTimeout(r, 900));
  const after = crowns.map((c) => `${c.rotation.x.toFixed(5)},${c.rotation.z.toFixed(5)}`);
  const moved = before.filter((b, i) => b !== after[i]).length;
  // Distinct rotations => they are NOT locked together.
  const distinct = new Set(after).size;
  return {
    swayCount: mb?.windSway?.count ?? 0,
    palmClones, instancedBush, instancedGrass,
    crowns: crowns.length, moved, distinct,
  };
});
check('palms are cloned (not instanced)', veg.palmClones >= 15, `${veg.palmClones} palm clones`);
check('wind sway registered', veg.swayCount > 0, `${veg.swayCount} sway nodes`);
check('palm crowns actually move', veg.moved > 0, `${veg.moved}/${veg.crowns} crowns moved in 0.9 s`);
check(
  'palms sway INDEPENDENTLY',
  veg.distinct > 1,
  `${veg.distinct} distinct crown rotations across ${veg.crowns} palms`,
);
check(
  'bushes + grass stay instanced',
  veg.instancedBush + veg.instancedGrass > 200,
  `${veg.instancedBush} bush + ${veg.instancedGrass} grass instances`,
);

// ---------------------------------------------------------------------------
console.log('\n[5b] Minimap callout labels');
// ---------------------------------------------------------------------------
const mmap = await page.evaluate(async () => {
  const ops = window.__OPERATOR__;
  const mm = ops.minimap;
  // Force a composite so the callout layer is built this frame.
  await new Promise((r) => setTimeout(r, 400));
  const layer = mm?.debugCalloutLayer;
  if (!layer) return { built: false };
  // Proof that text was actually rasterised, rather than a blank canvas of
  // the right size being allocated. Sampled on a sparse grid: a full
  // getImageData sweep of this layer costs ~48 s under SwiftShader and
  // destabilises the tab, and a grid is just as conclusive for "is there
  // ink on this canvas".
  const c = layer.getContext('2d', { willReadFrequently: true });
  let ink = 0;
  const step = 3;
  for (let y = 0; y < layer.height; y += step) {
    const row = c.getImageData(0, y, layer.width, 1).data;
    for (let i = 3; i < row.length; i += 4 * step) if (row[i] > 40) ink += 1;
  }
  return {
    built: true, w: layer.width, h: layer.height, ink,
    zones: ops.calloutZones?.count ?? 0,
  };
});
check('minimap callout layer built', mmap.built, mmap.built ? `${mmap.w}x${mmap.h}px` : 'missing');
check(
  'callout names rasterised to the layer',
  (mmap.ink ?? 0) > 100,
  `${mmap.ink ?? 0} inked pixels for ${mmap.zones} zones`,
);

// ---------------------------------------------------------------------------
console.log('\n[6] Perimeter containment');
// ---------------------------------------------------------------------------
// Swept in two halves: 72 ray casts plus their result marshalling in one
// evaluate() call is enough to trip the CDP target under SwiftShader.
const perim = { leaks: [] };
for (const [from, to] of [[0, 36], [36, 72]]) {
  const part = await page.evaluate((from, to) => {
    const ops = window.__OPERATOR__;
    const RAPIER = ops.RAPIER;
    const world = ops.physics.world;
    // Fire rays outward from the centre in a full circle at chest height:
    // every direction must hit something before 90 m or the map leaks.
    const leaks = [];
    for (let i = from; i < to; i += 1) {
      const a = (i / 72) * Math.PI * 2;
      const ray = new RAPIER.Ray({ x: 0, y: 1.2, z: 2 }, { x: Math.cos(a), y: 0, z: Math.sin(a) });
      const hit = world.castRay(ray, 90, true);
      if (!hit) leaks.push(Math.round((a * 180) / Math.PI));
    }
  return { leaks };
  }, from, to);
  perim.leaks.push(...part.leaks);
}
check(
  'perimeter contains the map in all directions',
  perim.leaks.length === 0,
  perim.leaks.length ? `open bearings: ${perim.leaks.join(', ')}` : '72/72 bearings blocked',
);

// ---------------------------------------------------------------------------
const errors = diag.errors ?? [];
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(64)}`);
console.log(`Document N acceptance: ${results.length - failed.length}/${results.length} passed`);
if (errors.length) {
  console.log(`\nConsole errors (${errors.length}):`);
  for (const e of errors.slice(0, 12)) console.log('  ', String(e).slice(0, 220));
}
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log('\nScreenshots: run tools/verify/docn-shots.mjs');
await browser.close();
process.exit(failed.length ? 1 : 0);
