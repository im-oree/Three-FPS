/**
 * repro-killstreak.mjs — live diagnostic for the killstreak/tablet/missile
 * bug batch. NOT part of the acceptance suite; run manually against a dev
 * server:
 *   node tools/verify/repro-killstreak.mjs --url http://localhost:5173
 *
 * Look input is injected through the game's own registered onMouseMove
 * handler: headless Chromium's CDP mouse delivery does not surface
 * movementX under pointer lock, which is a harness quirk, not a game path.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { launchBrowser, collectDiagnostics } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out', 'repro-killstreak');
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = { url: 'http://localhost:5173' };
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
}

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const diag = collectDiagnostics(page);

const report = { steps: [], errors: [] };
const step = (name, ok, detail) => {
  report.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
};
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
};

await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await enterMatch(page);
console.log('entered match');

// event timeline inside the page
await page.evaluate(() => {
  const log = [];
  window.__KLOG = log;
  const bus = window.__OPERATOR__.eventBus;
  for (const ev of [
    'tablet:raised', 'tablet:lowered', 'tablet:mapOpened',
    'killstreak:activated', 'killstreak:ended', 'killstreak:denied',
    'killstreak:missile:launching', 'killstreak:missile:flying', 'killstreak:missile:impact',
    'cinematic:jet:spawned', 'cinematic:jet:released', 'cinematic:jet:closepass',
    'killstreak:missile:ignition', 'cinematic:jet:antiClipCorrection',
    'cinematic:started', 'cinematic:ended',
    'input:contextChanged', 'combat:explosion',
  ]) {
    bus.on(ev, (p) => log.push({ t: performance.now() / 1000, ev, p: p && typeof p === 'object' ? { ...p } : p }));
  }
  // look-input injector for all later steps
  window.__LOOK = (dx, dy) => {
    for (let i = 0; i < 6; i += 1) {
      window.__OPERATOR__.inputManager.onMouseMove({ movementX: dx / 6, movementY: dy / 6 });
    }
  };
});

// ---- 1. mouselook on entry ------------------------------------------------
const yawBefore = await page.evaluate(() => window.__OPERATOR__.playerController.getYaw());
await page.evaluate(() => window.__LOOK(240, 0));
await sleep(700);
const yawAfter = await page.evaluate(() => window.__OPERATOR__.playerController.getYaw());
step('mouselook on entry', Math.abs(yawAfter - yawBefore) > 0.05, {
  yawBefore: +yawBefore.toFixed(3), yawAfter: +yawAfter.toFixed(3),
});

// ---- 2. UAV facing vs travel ----------------------------------------------
await page.evaluate(() => window.__OPERATOR__.killstreakManager.activate(0));
await sleep(2000);
const uavDir = await page.evaluate(async () => {
  // The controlled node is the NEWEST 'Root_Vehicle' top-level gltf root —
  // nothing in the drone model is named 'uav'/'drone', and every other glb
  // root is 'AuxScene', so name matching must target exactly this.
  const scene = window.__OPERATOR__.levelLoader.scene;
  const cands = [];
  scene.traverse((o) => { if (o.name === 'Root_Vehicle' && o.parent) cands.push(o); });
  const root = cands[cands.length - 1];
  if (!root) return { found: false };
  const V3 = root.position.constructor;
  const p0 = new V3(); root.getWorldPosition(p0);
  const q0 = new (root.quaternion.constructor)(); root.getWorldQuaternion(q0);
  const noseAt = new V3(0, 0, -1).applyQuaternion(q0);
  noseAt.y = 0; noseAt.normalize();
  await new Promise((r) => setTimeout(r, 1500));
  const p1 = new V3(); root.getWorldPosition(p1);
  const vel = p1.clone().sub(p0); vel.y = 0; vel.normalize();
  return {
    found: true,
    noseDot: +noseAt.dot(vel).toFixed(3),
    moved: +p1.distanceTo(p0).toFixed(2),
    alt: +p1.y.toFixed(1),
  };
});
step('UAV nose points along travel', uavDir.found && uavDir.noseDot > 0.5, uavDir);

// ---- 3. guided missile: designation through the tablet ---------------------
await page.evaluate(() => {
  window.__OPERATOR__.killstreakTablet.openForDesignation(2);
});
// raise blend + boot intro (1.1s) + map reveal sweep, plus screen frames
await sleep(2200);
await shot('03a-tablet-map');
const designation = await page.evaluate(() => {
  const t = window.__OPERATOR__.killstreakTablet;
  window.__LOOK(50, 70);
  t.moveCursorByMouse(50, 70);
  return { screen: t.currentScreen, cursorValid: t.isCursorValid, ctx: window.__OPERATOR__.inputContexts.current() };
});
step('tablet map opens with valid cursor', designation.screen === 'map' && designation.cursorValid, designation);

const designatedAt = Date.now();
await page.evaluate(() => window.__OPERATOR__.killstreakTablet.primaryPressed());
// DOCUMENT M: a ~4.3s choreographed fighter-jet launch replaced the instant
// nose-cam cut — establishing dolly -> chase -> release+whip-pan -> swoop ->
// seat. Input is locked from designation (was 'gameplay' once — WASD/mouse
// leaked through the launch shots).
await sleep(1100);
const cineState = await page.evaluate(() => ({
  ctx: window.__OPERATOR__.inputContexts.current(),
  cine: window.__OPERATOR__.cinematicCamera.isActive,
  detached: window.__OPERATOR__.cinematicCamera.isDetached,
}));
await shot('03b-jet-establishing');
step('input locked from designation (cinematic or already flying)',
  cineState.ctx === 'cinematic' || cineState.ctx === 'missileControl', cineState);

// Wall-clock dilates ~3x under headless software GL, so the remaining shots
// are scheduled NON-BLOCKING (a blocking sleep here once delayed the
// missileControl wait past its own timeout — a harness race, not a game bug).
const pendingShots = [
  sleep(3100).then(() => shot('03b2-jet-chase')),          // ~chase phase
  sleep(4800).then(() => shot('03b3-whip-to-missile')),    // ~release/whip
];

// wait for missileControl, screenshot the nose feed, steer it
let steered = { ok: false };
try {
  await page.waitForFunction(
    () => window.__OPERATOR__.inputContexts.current() === 'missileControl', { timeout: 45000 },
  );
  const controlLatency = Date.now() - designatedAt;
  await Promise.all(pendingShots);
  await sleep(700);
  await shot('03c-nose-cam');
  // Doc M budget: ~5s designation -> control in game time; gate the wall
  // bound generously (x3 dilation) — it exists to catch runaway regressions.
  step('confirm -> control within Document M budget', controlLatency < 20000,
    { controlLatencyMs: controlLatency });
  const flyBefore = await page.evaluate(() => {
    const st = [...window.__KLOG].pop();
    return { camY: window.__OPERATOR__.playerController.camera.threeCamera.getWorldPosition(new (window.__OPERATOR__.playerController.camera.threeCamera.position.constructor)()).y };
  });
  // steer hard yaw-left via the real steering pipeline for ~1.2s of frames
  await page.evaluate(() => {
    const id = setInterval(() => window.__LOOK(45, -6), 80);
    window.__STEER_ID = id;
  });
  await sleep(1400);
  await page.evaluate(() => clearInterval(window.__STEER_ID));
  const headingDrift = await page.evaluate(() => window.__KLOG.length);
  steered = { ok: true, flyBefore, headingDrift };
} catch {
  steered = { ok: false, note: 'never reached missileControl' };
}
await shot('03d-steered');
step('missile control reached + steering wired', steered.ok, steered);

// wait for the streak to end fully, then clear our own UAV (still inside its
// 30s active window) so 'activeCount === 0' measures the missile's return,
// not a different streak we deliberately left running.
await sleep(16000);
await page.evaluate(() => window.__OPERATOR__.killstreakManager.deactivateAll());
await sleep(400);
const after = await page.evaluate(() => ({
  ctx: window.__OPERATOR__.inputContexts.current(),
  active: window.__OPERATOR__.killstreakManager.activeCount,
  detached: window.__OPERATOR__.cinematicCamera.isDetached,
  camParent: window.__OPERATOR__.playerController.camera.threeCamera.parent?.name ?? 'null',
  log: window.__KLOG.map((e) => e.ev),
  logEntries: window.__KLOG,
  impact: window.__KLOG.find((e) => e.ev === 'combat:explosion' && e.p && e.p.weaponId === 'guided_missile') ?? null,
}));
await shot('03e-after-missile');
const order = after.log.join(' > ');
console.log('event order:', order);
step('missile impacted ground (not airburst)', after.impact && after.impact.p.presetId === 'missileKillstreak', after.impact?.p);
step('control returned (gameplay + camera restored)',
  after.ctx === 'gameplay' && !after.detached && after.active === 0,
  { ctx: after.ctx, detached: after.detached, active: after.active, camParent: after.camParent });

// ---- 4. mouselook AFTER missile -------------------------------------------
const yawB = await page.evaluate(() => window.__OPERATOR__.playerController.getYaw());
await page.evaluate(() => window.__LOOK(-200, 0));
await sleep(700);
const yawA = await page.evaluate(() => window.__OPERATOR__.playerController.getYaw());
step('mouselook after missile', Math.abs(yawA - yawB) > 0.05, {
  yawBefore: +yawB.toFixed(3), yawAfter: +yawA.toFixed(3),
});

// ---- 5. events sanity ------------------------------------------------------
step('launch order: map open -> launching -> cinematic -> flying', (() => {
  const l = after.log;
  const iMap = l.indexOf('tablet:mapOpened');
  const iLaunch = l.indexOf('killstreak:missile:launching');
  const iCine = l.indexOf('cinematic:started');
  const iFly = l.indexOf('killstreak:missile:flying');
  return iMap !== -1 && iLaunch !== -1 && iCine !== -1 && iFly !== -1
    && iMap < iLaunch && iLaunch < iCine && iCine < iFly;
})(), order);

// ---- 5b. Document M sequence sanity ----------------------------------------
step('jet sequence ran in order: spawned -> released -> ignition', (() => {
  const l = after.log;
  const iSpawn = l.indexOf('cinematic:jet:spawned');
  const iRel = l.indexOf('cinematic:jet:released');
  const iIgn = l.indexOf('killstreak:missile:ignition');
  const iFly2 = l.indexOf('killstreak:missile:flying');
  return iSpawn !== -1 && iRel !== -1 && iIgn !== -1
    && iSpawn < iRel && iRel < iIgn;
})(), order);
// Doc M §6.3: player control begins only AFTER motor ignition.
step('control begins only after ignition', (() => {
  const l = after.log;
  return l.indexOf('killstreak:missile:ignition') !== -1
    && l.indexOf('killstreak:missile:ignition') < l.indexOf('killstreak:missile:flying');
})(), order);
// Doc M §8: the anti-clip layer must never actually fire for authored paths.
step('zero anti-clip corrections during authored cinematic',
  !after.log.includes('cinematic:jet:antiClipCorrection'),
  after.log.filter((e) => e === 'cinematic:jet:antiClipCorrection'));
// Doc M §8.1: the offline path validator must report ZERO clip issues —
// gate on the payload the controller attaches to cinematic:jet:spawned.
step('authored jet path validates clean (zero clip issues)', (() => {
  const e = after.logEntries?.find((x) => x.ev === 'cinematic:jet:spawned');
  return e && e.p && e.p.pathIssueCount === 0;
})(), after.logEntries?.find((x) => x.ev === 'cinematic:jet:spawned')?.p?.pathIssueCount);

// ---- 6. denied activation is surfaced, never silent ------------------------
// An impossible slot must refuse with a reason AND the event — and with the
// infinite-stuff cheat OFF, a slot stuck in cooldown also refuses.
await page.evaluate(() => window.__OPERATOR__.killstreakManager.activate(96));
await sleep(300);
const denied = await page.evaluate(() => window.__KLOG.find((e) => e.ev === 'killstreak:denied') ?? null);
step('denied activation surfaces killstreak:denied', !!denied && denied.p, denied);

report.errors.push(...diag.errors);
console.log('\nconsole errors:', diag.errors.length ? diag.errors : 'none');
await browser.close();
const failed = report.steps.filter((s) => !s.ok);
console.log(`\nREPRO: ${report.steps.length - failed.length}/${report.steps.length} passed`);
process.exit(failed.length ? 1 : 0);
