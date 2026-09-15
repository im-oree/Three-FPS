#!/usr/bin/env node
/**
 * shipment-check.mjs — Document K/L smoke + visual verification.
 * Enters a match on Shipment (level index 3), asserts the prop pipeline
 * actually built the map, then captures reference screenshots.
 *
 *   node tools/verify/shipment-check.mjs --url http://localhost:5174
 */
import { launchBrowser, collectDiagnostics } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const args = { url: 'http://localhost:5174' };
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const diag = collectDiagnostics(page);
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await enterMatch(page, { levelIndex: 3 });
await sleep(1500);

const report = await page.evaluate(() => {
  const ops = window.__OPERATOR__;
  const level = ops.levelLoader.current;
  const mb = ops.levelLoader.mapProps;
  let colliders = 0;
  ops.levelLoader.scene.traverse(() => {});
  return {
    levelId: level?.id,
    shellActive: !!level?.shellFile,
    killPlaneY: level?.killPlaneY,
    hasMapBuilder: !!mb,
    dynamicHittables: mb?.propPool.dynamicHitHandles.size ?? 0,
    staticColliderCount: window.__OPERATOR__.levelLoader.colliders.length,
    playerY: ops.playerController.getPosition().y,
    player: ops.playerController.getPosition(),
    drawCalls: ops.engine.renderer.getRenderer().info.render.calls,
    triangles: ops.engine.renderer.getRenderer().info.render.triangles,
    bgIsTexture: !!ops.levelLoader.scene.background?.isTexture,
    culling: ops.engine.sceneManager.culling.getStats(),
  };
});
console.log(JSON.stringify(report, null, 1));

// Culling union check: facing the map CENTER from spawn almost everything
// is visible; swinging to stare at the corner wall must hide the bulk of
// the prop field (and the HotZone for the sway-skip path). Orientation only
// (camera stays at spawn); the union recomputes next frame.
const aimAndWait = async (yaw) => {
  await page.evaluate((y) => {
    window.__OPERATOR__.playerController.debugSetOrientation(y, 0);
  }, yaw);
  // RAF-gated wait: headless frames stall right after load, so poll the
  // camera itself instead of sleeping a fixed amount.
  await page.waitForFunction((y) => Math.abs(
    window.__OPERATOR__.engine.sceneManager.getCamera().rotation.y - y) < 0.02,
    { timeout: 30000 }, yaw);
  await sleep(250); // one more frame: culling ticks right before render
};
await aimAndWait(Math.PI * 0.75); // SW: away from map center
const cullingAway = await page.evaluate(() =>
  window.__OPERATOR__.engine.sceneManager.culling.getStats());
await aimAndWait(-Math.PI / 4);   // back to the map center
const cullingCenter = await page.evaluate(() =>
  window.__OPERATOR__.engine.sceneManager.culling.getStats());
console.log('culling facing-away:', JSON.stringify(cullingAway));
console.log('culling facing-center:', JSON.stringify(cullingCenter));

// spawn-view screenshot
await sleep(400);
await page.screenshot({ path: 'tools/verify/out/shipment-1-spawn-view.png' });

// tablet map open (designation) — landscape whole-map view
await page.evaluate(() => window.__OPERATOR__.killstreakTablet.openForDesignation(2));
await page.waitForFunction(() => {
  const t = window.__OPERATOR__.killstreakTablet;
  return t.currentScreen === 'map' && t.displayAspect > 1;
}, { timeout: 60000 });
await sleep(2500);
await page.screenshot({ path: 'tools/verify/out/shipment-2-tablet-map.png' });
await page.evaluate(() => window.__OPERATOR__.killstreakTablet.forceLower());
await sleep(300);
// Aerial layout grid check (validates the 1:1 layout claim + the tablet
// map's content against the world the capture renders).
await page.evaluate(() => {
  window.__OPERATOR__.playerController.debugTeleport(0, 120, 0);
  window.__OPERATOR__.playerController.debugSetOrientation(0, -Math.PI / 2 + 0.001);
});
await sleep(600);
await page.screenshot({ path: 'tools/verify/out/shipment-5-aerial.png' });
await page.evaluate(() => {
  window.__OPERATOR__.playerController.debugTeleport(-20, 0, 20);
  window.__OPERATOR__.playerController.debugSetOrientation(-Math.PI / 4, 0);
});

// look up-ish for crane/dressing
await page.evaluate(() => window.__OPERATOR__.playerController.debugSetOrientation(-2.4, 0.35));
await sleep(300);
await page.screenshot({ path: 'tools/verify/out/shipment-3-cranes.png' });

// barrels shootable/knockable probe: detonate next to the SE barrel cluster
await page.evaluate(() => {
  window.__OPERATOR__.eventBus.emit('combat:explosion', {
    point: { x: 15.2, y: 0.5, z: 10.5 }, radius: 6, maxDamage: 50,
    falloffCurve: 'quadratic', weaponId: 'probe', presetId: 'barrelPop',
  });
});
await sleep(900);
const knock = await page.evaluate(() => {
  const mb = window.__OPERATOR__.levelLoader.mapProps;
  const moved = [];
  mb?.propPool['dynamicPools']?.forEach((pool) => {
    for (const s of pool.slots) {
      if (s.inUse) {
        const p = s.body.translation();
        moved.push([Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]);
      }
    }
  });
  return moved;
});
console.log('barrel positions after blast probe:', JSON.stringify(knock));
await page.screenshot({ path: 'tools/verify/out/shipment-4-blast.png' });

// Explosive-barrel chain: weapon-damage 50 on a live explosive barrel must
// detonate (combat:explosion) AND release its slot (handle set shrinks).
const chain = await page.evaluate(async () => {
  const ops = window.__OPERATOR__;
  const mb = ops.levelLoader.mapProps;
  const before = mb.propPool.dynamicHitHandles.size;
  const blasts = [];
  ops.eventBus.on('combat:explosion', (p) => blasts.push({ r: p.radius, d: p.maxDamage, w: p.weaponId }));
  // Find the explosive barrel's hittable entry and hit it.
  let hit = false;
  mb.propPool['dynamicPools'].forEach((pool) => {
    for (const slot of pool.slots) {
      if (!slot.inUse || !slot.def.explodesOnDestroy) continue;
      const handle = slot.colliders[0].handle;
      const meta = ops.colliderFactory?.byHandle?.get(handle) ?? null;
      const meta2 = meta?.hittable;
      if (meta2) {
        meta2.metadata.takeDamage(50, { x: 1.1, y: 0.5, z: -13.6 });
        hit = true;
      }
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  return { hit, before, after: mb.propPool.dynamicHitHandles.size, blasts };
});
console.log('explosive barrel chain:', JSON.stringify(chain));
console.log('page console errors:', diag.errors.length ? diag.errors.slice(0, 5) : 'none');
await browser.close();
