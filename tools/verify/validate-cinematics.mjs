#!/usr/bin/env node
/**
 * validate-cinematics.mjs — Document M §8.1/§8.3 step 2: the deterministic
 * sanity gate for the guided-missile jet launch, run against a dev server:
 *
 *   node tools/verify/validate-cinematics.mjs --url http://localhost:5173
 *   (npm run validate:cinematics -- --url ...)
 *
 * Gates (all must pass):
 *   1. fighter_jet.glb exposes the full contract (pylon sockets L/R,
 *      afterburner sockets L/R, Anchor_ChaseCam) through the game's own
 *      AssetLoader — what the runtime will actually find, not just the file.
 *   2. The OFFLINE path validator reports zero GROUND_CLEARANCE /
 *      STRUCTURE_OVERLAP issues across a spread of candidate designation
 *      points covering the level (analytic, before anything renders).
 *   3. Two REAL end-to-end launches emit zero path issues AND zero
 *      anti-clip corrections at runtime (live confirmation of §8.3's "lock").
 *
 * Exit code 1 on any gate failure; the failing details print inline.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, collectDiagnostics } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
void here;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = { url: 'http://localhost:5173' };
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
}

let failed = 0;
const gate = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failed += 1;
};

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const diag = collectDiagnostics(page);

await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await enterMatch(page);

// ---- gate 1: the jet's node contract through the real AssetLoader ---------
const contract = await page.evaluate(async () => {
  const jet = await window.__OPERATOR__.engine.assetLoader
    .loadModel('vehicles/fighter_jet.glb');
  const need = [
    'FighterJet', 'Fuselage', 'Canopy',
    'Socket_MissilePylon_L', 'Socket_MissilePylon_R',
    'Socket_Afterburner_L', 'Socket_Afterburner_R', 'Anchor_ChaseCam',
  ];
  return need.filter((n) => !jet.getObjectByName(n));
});
gate('fighter_jet.glb contract (pylons, afterburners, chase anchor)',
  contract.length === 0, contract.length ? contract : undefined);

// ---- gate 2: offline validator over a spread of designation points --------
const offline = await page.evaluate(async () => {
  // Vive dev serves the TS source modules straight; import the REAL builder
  // and validator the runtime uses — testing anything else proves nothing.
  const { buildJetFlightPath } = await import('/src/killstreaks/JetFlightPathBuilder.ts');
  const { validateCinematicPath } = await import('/src/killstreaks/CinematicPathValidator.ts');
  const ops = window.__OPERATOR__;
  const THREE_V = ops.playerController.camera.threeCamera.position.constructor;
  const level = ops.levelLoader.current;
  const physics = ops.physics;
  const player = ops.playerController.getPosition();
  const ex = level.worldExtents ?? {
    centerX: 0, centerZ: 0, halfWidth: level.groundHalfSize, halfHeight: level.groundHalfSize,
  };
  // Centre + a cardinal + a diagonal spread across the playable ground.
  const targets = [
    [ex.centerX, ex.centerZ],
    [ex.centerX + ex.halfWidth * 0.5, ex.centerZ],
    [ex.centerX - ex.halfWidth * 0.5, ex.centerZ],
    [ex.centerX, ex.centerZ + ex.halfHeight * 0.5],
    [ex.centerX, ex.centerZ - ex.halfHeight * 0.5],
    [ex.centerX + ex.halfWidth * 0.35, ex.centerZ - ex.halfHeight * 0.35],
    [ex.centerX - ex.halfWidth * 0.35, ex.centerZ + ex.halfHeight * 0.35],
  ];
  const all = [];
  for (const [x, z] of targets) {
    const path = buildJetFlightPath(
      level, new THREE_V(x, 0, z), player,
    );
    const issues = validateCinematicPath(path.curve, physics, path.jetBoundingRadius, 100);
    for (const issue of issues) all.push({ target: [x, z], ...issue });
  }
  return { levelId: level.id, issues: all };
});
gate(`offline validator over ${offline.levelId} (7 designation points)`,
  offline.issues.length === 0, offline.issues.slice(0, 5));

// ---- gate 3: two REAL launches — zero issues, zero anti-clip corrections --
await page.evaluate(() => {
  const log = [];
  window.__VLOG = log;
  const bus = window.__OPERATOR__.eventBus;
  for (const ev of ['cinematic:jet:spawned', 'cinematic:jet:antiClipCorrection']) {
    bus.on(ev, (p) => log.push({ ev, issues: p?.pathIssueCount ?? null }));
  }
});
for (let run = 0; run < 2; run += 1) {
  // Clear the post-run cooldown so the second designation isn't denied and
  // the gate measures the authored path, not the earning system.
  await page.evaluate(() => window.__OPERATOR__.killstreakManager.deactivateAll());
  await sleep(300);
  await page.evaluate((r) => window.__OPERATOR__.killstreakTablet.openForDesignation(2), run);
  await sleep(3500);
  await page.evaluate((r) => {
    const t = window.__OPERATOR__.killstreakTablet;
    t.moveCursorByMouse(r === 0 ? 60 : -70, r === 0 ? 80 : -60);
    t.primaryPressed();
  }, run);
  try {
    await page.waitForFunction(
      () => window.__OPERATOR__.inputContexts.current() === 'missileControl',
      { timeout: 45000 },
    );
  } catch { /* gated below by the KLOG/return checks */ }
  await page.waitForFunction(
    () => window.__OPERATOR__.inputContexts.current() === 'gameplay',
    { timeout: 45000 },
  );
}
const live = await page.evaluate(() => window.__VLOG);
const spawned = live.filter((e) => e.ev === 'cinematic:jet:spawned');
const corrections = live.filter((e) => e.ev === 'cinematic:jet:antiClipCorrection');
gate('two real launches both ran', spawned.length === 2, { spawned: spawned.length });
gate('real launches: zero authored path issues',
  spawned.length === 2 && spawned.every((e) => e.issues === 0),
  spawned.map((e) => e.issues));
gate('real launches: zero anti-clip corrections', corrections.length === 0,
  corrections.length ? corrections : undefined);

if (diag.errors.length) {
  console.log('page console errors:', diag.errors.slice(0, 3));
  gate('no page console errors', false);
}
await browser.close();
console.log(failed === 0 ? '\nVALIDATE-CINEMATICS: all gates passed' : `\nVALIDATE-CINEMATICS: ${failed} gate(s) failed`);
process.exit(failed === 0 ? 0 : 1);
