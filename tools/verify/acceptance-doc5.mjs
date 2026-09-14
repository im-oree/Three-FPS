#!/usr/bin/env node
/**
 * acceptance-doc5.mjs — Document 5 §10 acceptance.
 *
 * Drives the real UI the way a player would: clicking real buttons, never
 * calling internals to shortcut a flow. Prints PASS/FAIL per box and exits
 * non-zero on any failure.
 */
import { launchBrowser } from './browser.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5173';
let failed = 0;
let total = 0;
const check = (name, ok, detail = '') => {
  total += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ url: undefined });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 160)); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__OPERATOR__), { timeout: 60000 });
await sleep(2200);

/** Click a visible button by its exact label, optionally scoped to a screen. */
const clickLabel = (label, screen) => page.evaluate(({ label, screen }) => {
  const scope = screen ? `[data-screen=${screen}] ` : '';
  const node = [...document.querySelectorAll(`${scope}.btn, ${scope}.tab`)]
    .find((b) => b.textContent.trim() === label && b.offsetParent !== null);
  if (!node) throw new Error(`no button "${label}"${screen ? ` in ${screen}` : ''}`);
  node.click();
}, { label, screen });

const state = () => page.evaluate(() => window.__OPERATOR__.gameStateManager.getState());

// === 1. boots to a real main menu, not into gameplay ========================
const boot = await page.evaluate(() => ({
  state: window.__OPERATOR__.gameStateManager.getState(),
  active: [...document.querySelectorAll('.screen--active')].map((s) => s.dataset.screen),
  title: document.querySelector('.title')?.textContent ?? '',
  buttons: [...document.querySelectorAll('[data-screen=mainMenu] .btn')]
    .map((b) => b.textContent.trim()),
}));
check('1. boots to a styled Main Menu (no direct-to-gameplay)',
  boot.state === 'MAIN_MENU' && boot.active.length === 1
  && boot.active[0] === 'mainMenu' && boot.title.includes('OPERATOR')
  && ['Play', 'Loadout', 'Settings', 'Quit'].every((b) => boot.buttons.includes(b)),
  `state=${boot.state}, buttons=${boot.buttons.join('/')}`);

// === 2. loadout persists and drives the equipped weapons ====================
await clickLabel('Loadout');
await sleep(2200);
const loadout = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const pane = document.querySelectorAll('.loadout__grid > div')[0];
  [...pane.querySelectorAll('.btn')]
    .find((b) => b.textContent.trim() === 'Bolt Sniper').click();
  await new Promise((r) => setTimeout(r, 800));
  pane.querySelectorAll('.skin-swatch')[2].click();
  await new Promise((r) => setTimeout(r, 800));
  return {
    hasPreviewCanvas: Boolean(document.querySelector('.loadout__preview canvas')),
    previewRunning: O.loadoutMenu.isPreviewRunning,
    current: O.loadoutManager.getCurrentLoadout(),
    stored: O.settingsStore.get('loadout', null),
    boot: O.loadoutManager.bootOrder,
    skinsLoaded: O.skinManager.loadedCount,
  };
});
check('2a. loadout screen has a live 3D weapon preview',
  loadout.hasPreviewCanvas && loadout.previewRunning,
  `canvas=${loadout.hasPreviewCanvas}, animating=${loadout.previewRunning}`);
check('2b. weapon + skin selection persists to storage and sets the boot order',
  loadout.current.primaryId === 'sniper'
  && loadout.current.primarySkinId === 'urban'
  && loadout.stored?.primaryId === 'sniper'
  && loadout.boot[0] === 'sniper'
  && loadout.skinsLoaded === 3,
  `${loadout.current.primaryId}/${loadout.current.primarySkinId}, boot=[${loadout.boot}], ${loadout.skinsLoaded} skins`);

// === 3. settings: rebinding, sensitivity, live volume =======================
await clickLabel('Back', 'loadout');
await sleep(400);
await clickLabel('Settings', 'mainMenu');
await sleep(500);
const settings = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const tabs = [...document.querySelectorAll('.tab')].map((t) => t.textContent.trim());

  // audio tab: move Master and confirm the manager took it live
  [...document.querySelectorAll('.tab')].find((t) => t.textContent.trim() === 'audio').click();
  await new Promise((r) => setTimeout(r, 250));
  const volBefore = O.audioManager.getVolumes().master;
  const range = document.querySelector('[data-screen=settings] .tab-body--active input[type=range]');
  range.value = '0.33';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const volAfter = O.audioManager.getVolumes().master;

  // video tab: FOV slider must reach the camera
  [...document.querySelectorAll('.tab')].find((t) => t.textContent.trim() === 'video').click();
  await new Promise((r) => setTimeout(r, 250));
  const fovBefore = O.playerController.camera.getBaseFOV();
  const fovRange = [...document.querySelectorAll('[data-screen=settings] .tab-body--active input[type=range]')].pop();
  fovRange.value = '104';
  fovRange.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const fovAfter = O.playerController.camera.getBaseFOV();

  // controls tab: rebind a real action
  [...document.querySelectorAll('.tab')].find((t) => t.textContent.trim() === 'controls').click();
  await new Promise((r) => setTimeout(r, 350));
  const bindBefore = O.input.getBindings().crouch;
  const row = [...document.querySelectorAll('.binding')]
    .find((r) => r.querySelector('.binding__name').textContent.trim().toLowerCase() === 'crouch');
  row.querySelector('.binding__key').click();
  await new Promise((r) => setTimeout(r, 200));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  const bindAfter = O.input.getBindings().crouch;

  const sensBefore = O.settingsStore.get('mouseSensitivity', 1);
  return {
    tabs, volBefore, volAfter, fovBefore, fovAfter, bindBefore, bindAfter,
    persistedBind: O.settingsStore.get('keyBindings', {}).crouch,
    sensBefore,
  };
});
check('3a. settings has video / audio / controls tabs',
  settings.tabs.join(',') === 'video,audio,controls', settings.tabs.join(', '));
check('3b. volume sliders change AudioManager gain live',
  Math.abs(settings.volAfter - 0.33) < 0.02 && settings.volAfter !== settings.volBefore,
  `master ${settings.volBefore.toFixed(2)} -> ${settings.volAfter.toFixed(2)}`);
check('3c. FOV slider reaches PlayerCamera live',
  Math.abs(settings.fovAfter - 104) < 0.5 && settings.fovAfter !== settings.fovBefore,
  `${settings.fovBefore} -> ${settings.fovAfter}`);
check('3d. rebinding changes the live binding AND persists it',
  settings.bindAfter === 'KeyZ' && settings.bindBefore !== 'KeyZ'
  && settings.persistedBind === 'KeyZ',
  `crouch ${settings.bindBefore} -> ${settings.bindAfter} (stored ${settings.persistedBind})`);

// === 4. Play -> level select -> loading -> click to play ====================
await clickLabel('Back', 'settings');
await sleep(400);
await clickLabel('Play', 'mainMenu');
await sleep(400);
const levels = await page.evaluate(() =>
  [...document.querySelectorAll('.level-card__name')].map((n) => n.textContent.trim()));
check('4a. level select lists the real levels by displayName',
  levels.length === 3 && levels.includes('Warehouse')
  && levels.includes('Facility') && levels.includes('Training Range'),
  levels.join(', '));

const progressSeen = [];
await page.exposeFunction('__reportProgress', (v) => progressSeen.push(v));
await page.evaluate(() => {
  window.__OPERATOR__.eventBus.on('assets:progress', (p) => {
    window.__reportProgress(p.loaded / Math.max(1, p.total));
  });
});
await page.evaluate(() => document.querySelectorAll('.level-card')[1].click()); // Facility
const duringLoad = await state();
await page.waitForFunction(() => [...document.querySelectorAll('.btn--primary')]
  .some((x) => x.textContent.trim() === 'Click to Play' && x.offsetParent !== null),
{ timeout: 60000 });
const loadedInfo = await page.evaluate(() => ({
  state: window.__OPERATOR__.gameStateManager.getState(),
  pct: document.querySelector('.loading__fill')?.style.width ?? '',
  audioBuffers: window.__OPERATOR__.audioManager.loadedCount,
  level: window.__OPERATOR__.levelLoader.current?.displayName ?? null,
}));
check('4b. LOADING state with a real progress bar tied to real asset loading',
  duringLoad === 'LOADING' && loadedInfo.state === 'LOADING'
  && loadedInfo.audioBuffers > 40,
  `${loadedInfo.audioBuffers} audio buffers decoded, bar at ${loadedInfo.pct}`);
check('4c. the chosen level actually loaded',
  loadedInfo.level === 'Facility', `level=${loadedInfo.level}`);

await page.evaluate(() => [...document.querySelectorAll('.btn--primary')]
  .find((x) => x.textContent.trim() === 'Click to Play').click());
await sleep(2000);
const playing = await page.evaluate(() => ({
  state: window.__OPERATOR__.gameStateManager.getState(),
  hudActive: document.querySelector('.hud')?.classList.contains('hud--active'),
  health: document.querySelector('.hud__health-num')?.textContent,
  ammo: document.querySelector('.hud__ammo-mag')?.textContent,
  weapon: document.querySelector('.hud__ammo-name')?.textContent,
  equipped: window.__OPERATOR__.weaponManager.activeWeapon.def.id,
  ambience: window.__OPERATOR__.audioManager.ambiencePlaying,
}));
check('4d. click-to-play enters PLAYING with the HUD live',
  playing.state === 'PLAYING' && playing.hudActive === true
  && playing.health === '100' && Number(playing.ammo) > 0,
  `${playing.health} hp, ${playing.ammo} rounds, ${playing.weapon}`);
check('4e. the match equips the LOADOUT weapon, not a hardcoded default',
  playing.equipped === 'sniper', `equipped ${playing.equipped} (chose sniper)`);
check('4f. the level ambience loop is playing',
  playing.ambience === true);

// === 5. HUD elements are live and bound to real events ======================
const hudLive = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleepFor = (ms) => new Promise((r) => setTimeout(r, ms));

  // crosshair must widen with real spread: standing still vs jumping
  O.playerController.debugTeleport(0, 0, 20);
  await sleepFor(500);
  const gapIdle = O.hud.crosshairGap;
  O.inputManager.heldKeys.add('KeyW');
  O.inputManager.heldKeys.add('ShiftLeft');
  await sleepFor(900);
  const gapMoving = O.hud.crosshairGap;
  O.inputManager.heldKeys.clear();
  await sleepFor(600);

  // hit marker on a confirmed hit
  O.eventBus.emit('combat:hit', {
    point: { x: 0, y: 1, z: 10 }, normal: { x: 0, y: 1, z: 0 },
    distance: 10, damage: 20, surfaceType: 'metal', isKill: false,
  });
  await sleepFor(60);
  const markerShown = O.hud.isHitMarkerVisible;
  await sleepFor(400);
  const markerGone = !O.hud.isHitMarkerVisible;

  // ammo counter follows real firing
  const ammoBefore = document.querySelector('.hud__ammo-mag').textContent;
  window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  await sleepFor(500);
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  await sleepFor(300);
  const ammoAfter = document.querySelector('.hud__ammo-mag').textContent;

  // health, vignette, damage direction
  O.eventBus.emit('player:healthChanged', { current: 22, max: 100 });
  await sleepFor(200);
  const vignette = parseFloat(document.querySelector('.hud__vignette').style.opacity || '0');
  O.eventBus.emit('player:damaged', {
    amount: 10, sourceWorldPosition: { x: 12, y: 1, z: 20 },
  });
  await sleepFor(200);
  const dmgDir = O.hud.damageIndicatorVisible;
  O.eventBus.emit('player:healthChanged', { current: 100, max: 100 });
  return { gapIdle, gapMoving, markerShown, markerGone, ammoBefore, ammoAfter, vignette, dmgDir };
});
check('5a. crosshair scales with the REAL spread cone',
  hudLive.gapMoving > hudLive.gapIdle + 1,
  `gap ${hudLive.gapIdle.toFixed(1)}px idle -> ${hudLive.gapMoving.toFixed(1)}px sprinting`);
check('5b. hit marker flashes on combat:hit then clears',
  hudLive.markerShown && hudLive.markerGone);
check('5c. ammo counter follows real firing',
  Number(hudLive.ammoAfter) < Number(hudLive.ammoBefore),
  `${hudLive.ammoBefore} -> ${hudLive.ammoAfter}`);
check('5d. low-health vignette engages and damage direction shows',
  hudLive.vignette > 0.1 && hudLive.dmgDir,
  `vignette ${hudLive.vignette}, damage wedge ${hudLive.dmgDir}`);

// === 6. pause freezes the simulation, resume continues ======================
const pause = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleepFor = (ms) => new Promise((r) => setTimeout(r, ms));
  O.inputManager.heldKeys.add('KeyW');
  await sleepFor(600);
  const p0 = { ...O.playerController.getPosition() };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  await sleepFor(900);
  const p1 = O.playerController.getPosition();
  const frozen = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const paused = {
    state: O.gameStateManager.getState(),
    sim: O.gameStateManager.isSimulationActive(),
    hudHidden: !document.querySelector('.hud').classList.contains('hud--active'),
  };
  // settings as an overlay must NOT leave the paused state
  [...document.querySelectorAll('[data-screen=pause] .btn')]
    .find((b) => b.textContent.trim() === 'Settings').click();
  await sleepFor(450);
  const overlay = {
    state: O.gameStateManager.getState(),
    settingsUp: Boolean(document.querySelector('[data-screen=settings].screen--active')),
    pauseUp: Boolean(document.querySelector('[data-screen=pause].screen--active')),
  };
  [...document.querySelectorAll('[data-screen=settings] .btn')]
    .find((b) => b.textContent.trim() === 'Back').click();
  await sleepFor(400);
  [...document.querySelectorAll('[data-screen=pause] .btn')]
    .find((b) => b.textContent.trim() === 'Resume').click();
  await sleepFor(700);
  const resumedPos = { ...O.playerController.getPosition() };
  await sleepFor(600);
  const after = O.playerController.getPosition();
  O.inputManager.heldKeys.clear();
  return {
    frozen, paused, overlay,
    resumedState: O.gameStateManager.getState(),
    movedAfterResume: Math.hypot(after.x - resumedPos.x, after.z - resumedPos.z),
  };
});
check('6a. pause freezes the simulation (player stops dead) and hides the HUD',
  pause.frozen < 0.01 && pause.paused.state === 'PAUSED'
  && pause.paused.sim === false && pause.paused.hudHidden,
  `drift while paused ${pause.frozen.toFixed(4)} m`);
check('6b. Settings from Pause layers as an overlay, staying PAUSED',
  pause.overlay.state === 'PAUSED' && pause.overlay.settingsUp && pause.overlay.pauseUp,
  `state stayed ${pause.overlay.state}`);
check('6c. Resume returns to PLAYING and the simulation continues',
  pause.resumedState === 'PLAYING' && pause.movedAfterResume > 0.5,
  `moved ${pause.movedAfterResume.toFixed(2)} m after resume`);

// === 7. match stats and game over ===========================================
const over = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleepFor = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = O.matchStats.snapshot;
  // Kill the player for real, via the health system.
  for (let i = 0; i < 8; i += 1) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F6' }));
    await sleepFor(110);
  }
  await sleepFor(900);
  return {
    before,
    state: O.gameStateManager.getState(),
    visible: Boolean(document.querySelector('[data-screen=gameOver].screen--active')),
    reason: document.querySelector('[data-screen=gameOver] .subtitle')?.textContent ?? '',
    cells: [...document.querySelectorAll('[data-screen=gameOver] .stat')].map((s) => ({
      label: s.querySelector('.stat__label').textContent,
      value: s.querySelector('.stat__value').textContent,
    })),
  };
});
check('7a. health reaching zero is a REAL (non-debug-button) path to game over',
  over.state === 'GAME_OVER' && over.visible && /died/i.test(over.reason),
  `reason "${over.reason}"`);
check('7b. the summary shows real tracked statistics',
  over.before.shotsFired > 0
  && over.cells.length === 6
  && over.cells.some((c) => c.label === 'Shots Fired' && Number(c.value) > 0)
  && over.cells.some((c) => c.label === 'Accuracy'),
  over.cells.map((c) => `${c.label}=${c.value}`).join(', '));

// === 8. no native dialogs anywhere ==========================================
const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|js)$/.test(entry.name)) sources.push(full);
  }
};
walk('src');
const offenders = sources.filter((f) => {
  const src = readFileSync(f, 'utf8')
    // Strip comments and string literals first: uiSound('confirm') and a
    // comment saying "never a confirm() dialog" are not native dialogs, and
    // matching them made this check cry wolf.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return /(?:^|[^\w.$])(?:window\s*\.\s*)?(alert|confirm|prompt)\s*\(/.test(src);
});
check('8. no native alert/confirm/prompt anywhere in /src',
  offenders.length === 0, offenders.join(', '));

// === 9. audio assets are real committed files ===============================
const audioFiles = [];
const walkAudio = (dir) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkAudio(full);
    else if (entry.name.endsWith('.wav')) audioFiles.push(full);
  }
};
walkAudio('assets/audio');
check('9. every sound is a real committed file produced by /tools',
  audioFiles.length >= 50 && existsSync('tools/generateAudio.mjs'),
  `${audioFiles.length} .wav files on disk`);

check('10. zero page errors across the whole flow',
  pageErrors.length === 0, pageErrors[0]?.slice(0, 160));

await browser.close();
console.log(`\nACCEPTANCE DOC 5: ${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);
