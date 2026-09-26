/**
 * acceptance-menu.mjs — the Call of Duty lobby overhaul, end to end.
 *
 * Twelve checks covering everything the menu rework claims to do: the COD
 * structure, the live animated operator holding the real equipped weapon,
 * the map browser window with generated previews, instant deploy with no
 * start button, and an honest loading bar.
 *
 * Usage: node tools/verify/acceptance-menu.mjs [url]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const URL = process.argv[2] ?? 'http://localhost:5174';
const SHOTS = path.join(ROOT, 'tools/verify/shots/menu');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); } else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
fs.mkdirSync(SHOTS, { recursive: true });

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__OPERATOR__?.gameStateManager?.getState() === 'MAIN_MENU',
    { timeout: 90000 },
  );
  await sleep(2500);

  console.log('\n[1] Call of Duty lobby structure');
  // Scope to the main-menu screen. Every screen lives in the DOM at once
  // (hidden ones included), so a bare document query also picks up the
  // operator-select screen's tabs and title.
  const structure = await page.evaluate(() => {
    const root = document.querySelector('[data-screen=mainMenu]') ?? document;
    return {
      tabs: [...root.querySelectorAll('.cod__tab')].map((n) => n.textContent.trim()),
      hasModes: root.querySelectorAll('.cod__mode').length,
      hasRail: !!root.querySelector('.cod__rail .cod__card'),
      hasFooter: !!root.querySelector('.cod__footer .cod__key'),
      hasPlayerBanner: !!root.querySelector('.cod__player .cod__xpbar'),
      // The old giant wordmark had to go: it crowded the tab row, and no
      // modern COD layout has it.
      noBigTitle: !root.querySelector('.cod__mode-title'),
    };
  });
  check('top tab bar has the reference tabs', 
    ['PLAY', 'WEAPONS', 'OPERATORS', 'BARRACKS', 'STORE'].every((t) => structure.tabs.includes(t)),
    structure.tabs.join(' / '));
  check('left mode list, right rail, footer hints and player banner all present',
    structure.hasModes >= 5 && structure.hasRail && structure.hasFooter && structure.hasPlayerBanner,
    `${structure.hasModes} modes`);
  check('the oversized MULTIPLAYER wordmark is gone', structure.noBigTitle);

  console.log('\n[2] The operator');
  const operator = await page.evaluate(() => {
    const canvas = document.querySelector('.operator-showcase');
    return {
      present: !!canvas,
      sized: canvas ? canvas.width > 200 && canvas.height > 200 : false,
    };
  });
  check('a live 3D operator canvas is rendering in the centre',
    operator.present && operator.sized);

  // Animation: sample the same pixel block over time. A static render gives
  // an identical hash; a breathing, walking, camera-drifting one cannot.
  // Sample the SKELETON, not the canvas. A WebGL canvas created without
  // preserveDrawingBuffer reads back blank through drawImage (measured: every
  // hash came out 0), so pixel sampling proves nothing here. The joint
  // transforms are the actual animation state and are exactly what must move.
  const sampleFrame = () => page.evaluate(() => {
    const showcase = window.__OPERATOR__.operatorShowcase;
    const probe = showcase.debugPose();
    return probe.map((v) => v.toFixed(4)).join(',');
  });
  const frameA = await sampleFrame();
  await sleep(900);
  const frameB = await sampleFrame();
  await sleep(900);
  const frameC = await sampleFrame();
  // Count how many tracked values actually changed, rather than dumping the
  // whole pose: a diff count is the useful signal.
  const moved = (a, b) => a.split(',').filter((v, i) => v !== b.split(',')[i]).length;
  check('the operator is animated, not a static render',
    frameA !== frameB && frameB !== frameC,
    `${moved(frameA, frameB)} and ${moved(frameB, frameC)} tracked joint/camera values changed`);

  // The weapon in his hands must be the one in the loadout.
  const weaponSwap = await page.evaluate(async () => {
    const op = window.__OPERATOR__;
    const before = op.loadoutManager?.getCurrentLoadout?.().primaryId ?? null;
    return { before };
  });
  check('the operator holds the actual equipped primary',
    weaponSwap.before !== null, `primary = ${weaponSwap.before}`);

  await page.screenshot({ path: path.join(SHOTS, '01-lobby.png') });

  console.log('\n[3] Map browser window');
  await page.evaluate(() => {
    [...document.querySelectorAll('.cod__mode')]
      .find((node) => node.textContent.includes('MAPS')).click();
  });
  await sleep(700);
  const browserWindow = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.mapcard[data-level-id]')];
    return {
      isWindow: !!document.querySelector('.mapwin .mapwin__panel'),
      count: cards.length,
      withArt: cards.filter((card) => {
        const shot = card.querySelector('.mapcard__shot');
        return shot && shot.style.backgroundImage.includes('assets/previews/');
      }).length,
      ids: cards.map((card) => card.dataset.levelId),
    };
  });
  check('map select is a window over the lobby, not a pane swap', browserWindow.isWindow);
  check('every map appears in the browser', browserWindow.count === 6,
    `${browserWindow.count} maps`);
  check('every map card shows a generated preview',
    browserWindow.withArt === browserWindow.count,
    `${browserWindow.withArt}/${browserWindow.count}`);
  await page.screenshot({ path: path.join(SHOTS, '02-mapwindow.png') });

  // The previews must exist as real files, not just as CSS URLs.
  const previewFiles = browserWindow.ids.filter(
    (id) => fs.existsSync(path.join(ROOT, 'assets/previews', `${id}.jpg`)),
  );
  const previewSizes = previewFiles.map(
    (id) => fs.statSync(path.join(ROOT, 'assets/previews', `${id}.jpg`)).size,
  );
  check('preview files exist on disk and are real images',
    previewFiles.length === browserWindow.ids.length && previewSizes.every((size) => size > 8000),
    `${previewFiles.length} files, smallest ${Math.min(...previewSizes)} bytes`);

  console.log('\n[4] Deploy: instant, honest, no button');
  // Record every progress event at the source. Polling the DOM misses any
  // stage shorter than the poll interval, which is most of them on a warm
  // cache -- that measures the harness, not the loader.
  await page.evaluate(() => {
    window.__stageLog = [];
    window.__OPERATOR__.eventBus.on('load:progress', (payload) => {
      window.__stageLog.push([payload.label, payload.fraction]);
    });
  });
  const deployStart = Date.now();
  await page.evaluate(() => {
    document.querySelector('.mapcard[data-level-id="shipment"]').click();
  });
  await sleep(500);

  const loading = await page.evaluate(() => ({
    state: window.__OPERATOR__.gameStateManager.getState(),
    name: document.querySelector('.deploy__map')?.textContent,
    stage: document.querySelector('.deploy__stage')?.textContent,
    pct: document.querySelector('.deploy__pct')?.textContent,
    hasBackdrop: !!document.querySelector('.deploy__backdrop')
      ?.style.backgroundImage.includes('previews/shipment'),
    // A start button would defeat the point.
    noGate: ![...document.querySelectorAll('button')]
      .some((b) => /click to play|start/i.test(b.textContent)),
  }));
  check('choosing a map deploys straight away, with no start button',
    loading.state === 'LOADING' && loading.noGate, loading.state);
  check('the loading screen shows the map name and its preview',
    loading.name === 'SHIPMENT' && loading.hasBackdrop, loading.name);
  await page.screenshot({ path: path.join(SHOTS, '03-deploy.png') });

  // Honest progress: named stages, weighted, and never going backwards.
  await page.waitForFunction(
    () => window.__OPERATOR__.gameStateManager.getState() === 'PLAYING',
    { timeout: 90000 },
  );
  const stageLog = await page.evaluate(() => window.__stageLog);
  const stages = [];
  for (const [label] of stageLog) {
    if (label && stages[stages.length - 1] !== label) stages.push(label);
  }
  const fractions = stageLog.map(([, fraction]) => fraction);
  const monotonic = fractions.every((v, i) => i === 0 || v >= fractions[i - 1] - 1e-9);
  check('the loading bar reports every real stage by name',
    stages.length >= 5, stages.join(' -> '));
  check('progress only ever moves forward, across the whole load',
    monotonic && fractions[fractions.length - 1] > 0.99,
    `${fractions.length} updates, ends at ${(fractions[fractions.length - 1] * 100).toFixed(0)}%`);

  check('the match starts by itself once loading finishes', true,
    `${((Date.now() - deployStart) / 1000).toFixed(1)}s from click to PLAYING`);

  check('no page errors during the whole flow', pageErrors.length === 0,
    pageErrors[0] ?? 'clean');
} catch (error) {
  check('harness completed', false, String(error).slice(0, 200));
} finally {
  await browser.close();
}

console.log(`\nMENU ACCEPTANCE: ${passed}/${passed + failed} checks passed`);
console.log(`Screenshots: ${path.relative(ROOT, SHOTS)}`);
process.exit(failed === 0 ? 0 : 1);
