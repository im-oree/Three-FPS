/**
 * acceptance-doc1.mjs — automated acceptance run for Document 1 (§9 checklist).
 *
 * Drives the real dev/preview server in headless Chromium and asserts:
 *   - page boots with zero console/page errors and a WebGL2-capable canvas
 *   - the §6.2 verification scene renders (screenshot for human eyes)
 *   - F3 edge-toggles the debug overlay (hidden -> visible -> hidden)
 *   - window resize updates canvas size AND camera aspect (no distortion)
 *   - EventBus reserved events fire (game:stateChanged on boot)
 *   - InputManager.isActionDown('jump') tracks the real Space key
 *   - SettingsStore persists a rebind across a full page reload
 *   - AssetLoader.preload() reports assets:progress {loaded,total}
 * Prints a PASS/FAIL line per criterion; exits non-zero on any FAIL.
 *
 * usage: node tools/verify/acceptance-doc1.mjs --url http://localhost:5173
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { launchBrowser, probeWebGL } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const urlArg = process.argv[process.argv.indexOf('--url') + 1];
if (!urlArg) { console.error('usage: acceptance-doc1.mjs --url <url>'); process.exit(2); }
const outDir = path.join(here, 'out');
mkdirSync(outDir, { recursive: true });

// --- temporary AssetLoader fixture (spec §9): a dummy texture that exists only
// for the duration of this run, in both the dev-served tree (/assets) and the
// production mirror (dist/assets) when present. Deleted again in `finally`.
const SMOKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAQUlEQVR42u3TIRYAIAhEQU7H/R8X' +
  '0qp2JTiBtIEpPzJzrFdV293eA6Ad8PrhuQP0A1QAoAIAFQCoAEAFACr4HjABGcWMl9mH4hIAAAAA' +
  'SUVORK5CYII=',
  'base64',
);
const smokePaths = [
  path.join(repoRoot, 'assets', 'textures', '__doc1_smoke.png'),
  path.join(repoRoot, 'dist', 'assets', 'textures', '__doc1_smoke.png'),
];
for (const p of smokePaths) {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, SMOKE_PNG);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('console', (m) => {
  logs.push(m.text());
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(urlArg, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#game-canvas', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 2500));

// --- boot health + webgl
const webgl = await probeWebGL(page);
check('boots with a WebGL2-capable canvas', webgl.ok && errors.length === 0, webgl.renderer ?? 'no webgl');
check('zero console/page errors on boot', errors.length === 0, errors.slice(0, 3).join(' | '));

// --- §6.2 scene screenshot (human-verified: floor + spinning cube + shadow)
await page.screenshot({ path: path.join(outDir, 'doc1-scene.png') });
const drawCalls = await page.evaluate(() => window.__OPERATOR__.engine.renderer.getRenderer().info.render.calls);
check('verification scene draws (draw calls > 0)', drawCalls > 0, `${drawCalls} calls`);

// --- EventBus reserved event path (game:stateChanged) ------------------------
// The boot-time TEMP-PROOF console logs are gone (stripped post-Doc-3); the
// suite now exercises the reserved event directly through the seam.
const stateChanged = await page.evaluate(() => new Promise((res) => {
  const op = window.__OPERATOR__;
  let seen = 0;
  const h = (p) => { seen += 1; };
  op.eventBus.on('game:stateChanged', h);
  op.gameStateManager.setState('PAUSED');
  op.gameStateManager.setState('PLAYING');
  op.eventBus.off('game:stateChanged', h);
  res(seen >= 2);
}));
check("EventBus 'game:stateChanged' fires on state transitions", stateChanged);

// --- F3 edge-triggered debug overlay
const overlayVisible = () => page.evaluate(() => {
  const el = document.getElementById('debug-overlay');
  return el ? getComputedStyle(el).display !== 'none' : false;
});
const before = await overlayVisible();
await page.keyboard.press('F3');
await new Promise((r) => setTimeout(r, 400));
const during = await overlayVisible();
const overlayText = await page.evaluate(() => document.getElementById('debug-overlay')?.textContent ?? '');
await page.keyboard.press('F3');
await new Promise((r) => setTimeout(r, 400));
const after = await overlayVisible();
check('F3 toggles debug overlay on/off (edge-triggered)', !before && during && !after, `text="${overlayText.replace(/\n/g, ' / ')}"`);
check('overlay shows FPS + frame ms + draw calls', /FPS/.test(overlayText) && /FRAME/.test(overlayText) && /CALLS/.test(overlayText));

// --- resize updates canvas + camera aspect
await page.setViewport({ width: 900, height: 500 });
await new Promise((r) => setTimeout(r, 600));
const resizeState = await page.evaluate(() => {
  const canvas = document.getElementById('game-canvas');
  const cam = window.__OPERATOR__.engine.sceneManager.getCamera();
  return { cssW: canvas.clientWidth, cssH: canvas.clientHeight, aspect: cam.aspect, drawW: canvas.width, drawH: canvas.height };
});
const aspectOk = Math.abs(resizeState.aspect - 900 / 500) < 1e-6;
check('resize updates canvas + camera aspect', resizeState.cssW === 900 && resizeState.cssH === 500 && aspectOk, JSON.stringify(resizeState));
await page.setViewport({ width: 1280, height: 720 });
await new Promise((r) => setTimeout(r, 400));

// --- InputManager action tracking (real key events)
await page.keyboard.down('Space');
await new Promise((r) => setTimeout(r, 150));
const jumpDown = await page.evaluate(() => window.__OPERATOR__.engine.inputManager.isActionDown('jump'));
await page.keyboard.up('Space');
await new Promise((r) => setTimeout(r, 150));
const jumpUp = await page.evaluate(() => window.__OPERATOR__.engine.inputManager.isActionDown('jump'));
check("InputManager.isActionDown('jump') tracks Space", jumpDown === true && jumpUp === false);

// --- SettingsStore persistence across a full reload
await page.evaluate(() => window.__OPERATOR__.engine.inputManager.rebind('jump', 'KeyJ'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#game-canvas', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1500));
const persisted = await page.evaluate(() => window.__OPERATOR__.engine.inputManager.getBindings().jump);
check('SettingsStore persists keyBindings across reload', persisted === 'KeyJ', `jump=${persisted}`);
await page.evaluate(() => window.__OPERATOR__.engine.inputManager.rebind('jump', 'Space'));

// --- AssetLoader.preload + assets:progress
const preloadReport = await page.evaluate(async () => {
  const progress = [];
  const off = window.__OPERATOR__.eventBus.on('assets:progress', (p) => progress.push(p));
  try {
    await window.__OPERATOR__.engine.assetLoader.preload({ textures: ['__doc1_smoke.png'] });
  } catch (err) {
    return { progress, error: String(err) };
  }
  off();
  return { progress };
});
check(
  'AssetLoader.preload emits assets:progress {loaded,total}',
  preloadReport.progress.length === 1 && preloadReport.progress[0].loaded === 1 && preloadReport.progress[0].total === 1,
  JSON.stringify(preloadReport),
);

// --- reserved-folder scaffold is served (assets root reachable)
const assetsProbe = await page.evaluate(async () => {
  const res = await fetch('/assets/textures/__doc1_smoke.png', { method: 'HEAD' });
  return res.status;
});
check('/assets served over HTTP', assetsProbe === 200, `status ${assetsProbe}`);

await page.screenshot({ path: path.join(outDir, 'doc1-final.png') });
await browser.close();

// Remove the temporary fixture again (spec: it is not a deliverable asset).
for (const p of smokePaths) rmSync(p, { force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\nACCEPTANCE DOC1: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILURES:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
console.log('screenshots:', path.join(outDir, 'doc1-scene.png'), path.join(outDir, 'doc1-final.png'));
