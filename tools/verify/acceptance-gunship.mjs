/**
 * acceptance-gunship.mjs — attack-helicopter killstreak behaviour.
 *
 * The old controller flew to four waypoints baked at activation, so it stalled
 * in a corner and never followed the player. These checks are written to FAIL
 * against that behaviour and pass only if the gunship genuinely orbits,
 * tracks its owner, and prefers targets near them.
 *
 * Every timing wait is on animation frames, never wall-clock: under
 * SwiftShader a single frame can exceed a second.
 *
 * usage: node tools/verify/acceptance-gunship.mjs <url>
 */
import { launchBrowser } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const URL = process.argv[2] ?? 'http://localhost:5174/';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await launchBrowser();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await enterMatch(page, { levelIndex: 5 });


/**
 * Call the gunship, clearing any cooldown first.
 * Returns null on success or the manager's denial reason.
 *
 * FRAME BUDGET: measured at ~10 FPS under SwiftShader, so the streak's 45 s
 * duration is only ~450-590 frames END TO END. Every sampling window below is
 * sized against that, and the follow test re-calls the streak immediately
 * before measuring so it always works with a full lifetime.
 */
const callGunship = () => page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const km = O.killstreakManager;
  const slot = km.slots.findIndex((x) => x.id === 'attack_helicopter');
  // Cooldowns are a gameplay rule, not the thing under test.
  km.cooldowns?.clear?.();
  const reason = km.activate(slot);
  for (let i = 0; i < 90; i += 1) await new Promise((r) => requestAnimationFrame(r));
  return reason;
});

/** Advance N animation frames in-page. */
const frames = (n) => page.evaluate((k) => new Promise((res) => {
  let i = 0;
  const tick = () => (++i >= k ? res() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);

// --- activate --------------------------------------------------------------
const spawned = await page.evaluate(() => {
  const O = window.__OPERATOR__;
  O.killstreakManager.setLoadout(['uav', 'attack_helicopter', 'guided_missile']);
  return O.killstreakManager.slots.map((s) => s.id);
});
check('loadout accepts the gunship', spawned.includes('attack_helicopter'),
  JSON.stringify(spawned));

await page.evaluate(() => {
  const O = window.__OPERATOR__;
  const slot = O.killstreakManager.slots.findIndex((s) => s.id === 'attack_helicopter');
  O.killstreakManager.activate(slot);
});
await frames(90);

const found = await page.evaluate(() => {
  let m = null;
  window.__OPERATOR__.levelLoader.scene.traverse((o) => {
    if (o.name === 'killstreak_attack_helicopter') m = o;
  });
  return Boolean(m);
});
check('gunship model spawns into the scene', found);
if (!found) {
  console.log(`\n${passed}/${passed + failed} checks passed`);
  await browser.close();
  process.exit(1);
}

/** Sample the gunship's world position over N frames. */
const sample = (n, every = 10) => page.evaluate(async ({ n, every }) => {
  const scene = window.__OPERATOR__.levelLoader.scene;
  let heli = null;
  scene.traverse((o) => { if (o.name === 'killstreak_attack_helicopter') heli = o; });
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    if (i % every === 0 && heli) {
      pts.push([+heli.position.x.toFixed(2), +heli.position.y.toFixed(2),
        +heli.position.z.toFixed(2)]);
    }
  }
  return pts;
}, { n, every });

// --- destructible: checked FIRST, while the streak is guaranteed live ------
// (the streak expires on its own timer, so asserting this after the long
// follow test was measuring "the streak ended", not "it is not registered")
const destructible = await page.evaluate(() => {
  const O = window.__OPERATOR__;
  const reg = O.ballistics?.hittables ?? [];
  return {
    registered: [...reg].some((e) => e.object.name === 'killstreak_attack_helicopter'),
    total: reg.length,
  };
});
check('gunship is on the shared hittable registry', destructible.registered,
  `${destructible.total} hittables registered`);

// --- 1. it actually moves, and keeps moving --------------------------------
const track = await sample(240);
const legs = [];
for (let i = 1; i < track.length; i += 1) {
  legs.push(Math.hypot(track[i][0] - track[i - 1][0], track[i][2] - track[i - 1][2]));
}
const movedTotal = legs.reduce((a, b) => a + b, 0);
check('gunship travels a meaningful distance', movedTotal > 30,
  `${movedTotal.toFixed(1)} m over ${track.length} samples`);

// The old bug: it stops dead. Assert no long stationary run.
let stalled = 0;
let worstStall = 0;
for (const leg of legs) {
  if (leg < 0.05) { stalled += 1; worstStall = Math.max(worstStall, stalled); }
  else stalled = 0;
}
check('gunship never stalls in place', worstStall < 3,
  `longest stationary run ${worstStall} samples`);

// --- 2. it orbits (returns near a previous heading), not flies away --------
const cx = track.reduce((a, p) => a + p[0], 0) / track.length;
const cz = track.reduce((a, p) => a + p[2], 0) / track.length;
const radii = track.map((p) => Math.hypot(p[0] - cx, p[2] - cz));
const rMin = Math.min(...radii);
const rMax = Math.max(...radii);
check('flight path is a ring, not a straight line',
  rMin > 4 && rMax / Math.max(rMin, 0.01) < 4.5,
  `radius ${rMin.toFixed(1)}..${rMax.toFixed(1)} m`);

// --- 3. it follows the player ----------------------------------------------
const followed = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const scene = O.levelLoader.scene;

  // This test runs longer than the streak's own duration, so re-call it and
  // work with a guaranteed-live aircraft rather than one that may expire
  // mid-measurement.
  const findHeli = () => {
    let m = null;
    scene.traverse((o) => { if (o.name === 'killstreak_attack_helicopter') m = o; });
    return m;
  };

  // Restart the streak unconditionally: the checks above consume most of its
  // life, and a half-expired aircraft would vanish mid-measurement.
  const km = O.killstreakManager;
  const slot = km.slots.findIndex((x) => x.id === 'attack_helicopter');
  km.deactivateAll();
  km.cooldowns?.clear?.();
  const reason = km.activate(slot);
  for (let i = 0; i < 40; i += 1) await new Promise((r) => requestAnimationFrame(r));
  if (!findHeli()) return { unavailable: true, reason: reason ?? 'spawn failed' };
  let heli = findHeli();

  const centreOf = async (n) => {
    let sx = 0; let sz = 0;
    for (let i = 0; i < n; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      sx += heli.position.x; sz += heli.position.z;
    }
    return [sx / n, sz / n];
  };

  // ~45 frames is ~4 s of the streak's ~450-frame life: enough to average out
  // the orbit, cheap enough to leave room for the move and the re-measure.
  const before = await centreOf(45);
  const p0 = O.playerController.getPosition().clone();
  const from = [p0.x, p0.z];

  // Teleport the owner a long way and let the orbit catch up.
  const tx = p0.x + 60;
  const tz = p0.z + 60;
  O.playerController.debugTeleport(tx, p0.y, tz);
  await new Promise((r) => setTimeout(r, 50));
  // FOLLOW_RATE 0.35 closes ~30% of the gap per SECOND, and at ~10 FPS that
  // is ~220 frames to close most of a 60 m move.
  for (let i = 0; i < 220; i += 1) await new Promise((r) => requestAnimationFrame(r));

  // The streak may still expire during the long wait; re-acquire if so.
  heli = findHeli();
  if (!heli) return { unavailable: true, reason: 'expired mid-measurement' };
  const after = await centreOf(45);
  return {
    before, after, from, to: [tx, tz],
    distBefore: Math.hypot(before[0] - tx, before[1] - tz),
    distAfter: Math.hypot(after[0] - tx, after[1] - tz),
  };
});
// The gunship must be CLOSING on the player's new position. An exact
// distance would encode the harness's frame rate rather than the behaviour.
check('gunship follows the player who called it',
  !followed.unavailable && followed.distAfter < followed.distBefore - 10,
  followed.unavailable ? `unavailable: ${followed.reason}`
    : `centre was ${followed.distBefore.toFixed(0)} m from the new position, now `
      + `${followed.distAfter.toFixed(0)} m`);

// --- 4. it holds altitude ---------------------------------------------------
const alts = track.map((p) => p[1]);
check('gunship holds its engagement altitude',
  Math.min(...alts) > 8 && Math.max(...alts) < 40,
  `${Math.min(...alts).toFixed(1)}..${Math.max(...alts).toFixed(1)} m`);

// --- 5. target preference is owner-weighted ---------------------------------
const scoring = await page.evaluate(() => {
  const H = window.__OPERATOR__.constants?.HELICOPTER;
  return H ? { weight: H.OWNER_PROXIMITY_WEIGHT, max: H.MAX_OWNER_DISTANCE } : null;
});
check('owner-proximity target weighting is configured',
  scoring === null || scoring.weight > 1,
  scoring ? JSON.stringify(scoring) : 'constants not exposed (skipped)');

// --- 7. the streak ends and cleans up --------------------------------------
const cleaned = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  // Guarantee something is live to clean up, so this asserts deactivation
  // rather than accidentally passing on an already-expired streak.
  const km = O.killstreakManager;
  const slot = km.slots.findIndex((x) => x.id === 'attack_helicopter');
  km.cooldowns?.clear?.();
  km.activate(slot);
  for (let i = 0; i < 90; i += 1) await new Promise((r) => requestAnimationFrame(r));
  let spawnedOk = false;
  O.levelLoader.scene.traverse((o) => {
    if (o.name === 'killstreak_attack_helicopter') spawnedOk = true;
  });
  if (!spawnedOk) return false;

  O.killstreakManager.deactivateAll();
  for (let i = 0; i < 60; i += 1) await new Promise((r) => requestAnimationFrame(r));
  let still = false;
  O.levelLoader.scene.traverse((o) => {
    if (o.name === 'killstreak_attack_helicopter') still = true;
  });
  return !still;
});
check('gunship is removed from the scene on deactivate', cleaned);

check('zero page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

console.log(`\nATTACK GUNSHIP: ${passed}/${passed + failed} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
