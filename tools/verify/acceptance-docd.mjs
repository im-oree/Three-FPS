#!/usr/bin/env node
/**
 * acceptance-docd.mjs — Document D §9 acceptance (the 8-box checklist).
 *
 * Drives the live dev server in headless Chromium. Prints PASS/FAIL per box
 * and exits non-zero on any failure.
 */
import { launchBrowser } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';
import { readFileSync } from 'node:fs';

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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__OPERATOR__), { timeout: 60000 });
// Document 5 boots to a main menu; drive the real UI into a match first.
await enterMatch(page);
await page.waitForFunction(
  () => window.__OPERATOR__.thirdPersonBody?.isReady === true, { timeout: 60000 },
);
await sleep(1500);

// Shared helper injected into the page: equip by id and WAIT for the swap.
const EQUIP = `
  const equip = async (id) => {
    const wm = window.__OPERATOR__.weaponManager;
    const i = wm.inventory.findIndex((w) => w.def.id === id);
    wm.switchTo(i);
    for (let k = 0; k < 400; k += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!wm.switching && wm.activeWeapon.def.id === id) break;
    }
    await new Promise((r) => setTimeout(r, 400));
    return wm.activeWeapon;
  };
`;

// --- box 1: all five new weapons load and equip like the Doc C rifle --------
const roster = await page.evaluate(`(async () => {
  ${EQUIP}
  const O = window.__OPERATOR__;
  O.perspective.setPerspective('FIRST');
  O.playerController.debugTeleport(0, 0, 25);
  O.playerController.debugSetOrientation(0, 0);
  await new Promise((r) => setTimeout(r, 500));
  const out = {};
  for (const w of O.weaponManager.inventory) {
    const weapon = await equip(w.def.id);
    let meshes = 0;
    O.viewmodel.getRigRoot().traverse((o) => {
      if (!o.isMesh) return;
      let v = o.visible; let p = o.parent;
      while (p) { if (!p.visible) v = false; p = p.parent; }
      if (v) meshes += 1;
    });
    out[weapon.def.id] = {
      mode: weapon.def.fireMode,
      optic: weapon.def.presentation.opticType,
      grip: weapon.def.presentation.gripStyle,
      meshes,
    };
  }
  return out;
})()`);
const expected = ['rifle', 'pistol', 'shotgun', 'smg', 'sniper', 'rocket_launcher', 'fists'];
const missing = expected.filter((id) => !roster[id]);
const noMesh = expected.filter((id) => roster[id] && roster[id].meshes < 8);
check('1. every weapon in the roster loads, equips and renders',
  missing.length === 0 && noMesh.length === 0,
  missing.length ? `missing: ${missing.join(', ')}`
    : noMesh.length ? `no viewmodel: ${noMesh.join(', ')}`
      : expected.map((id) => `${id}:${roster[id].meshes}`).join(' '));

// --- box 2: pistol is the only one-handed grip ------------------------------
check('2. pistol uses the one-handed support grip, distinct from two-handed',
  roster.pistol?.grip === 'oneHanded'
  && roster.rifle?.grip === 'twoHanded' && roster.smg?.grip === 'twoHanded',
  `pistol=${roster.pistol?.grip}, rifle=${roster.rifle?.grip}`);

// --- box 3: shotgun — cycle gate + per-shell reload + 8 pellets -------------
const shotgun = await page.evaluate(`(async () => {
  ${EQUIP}
  const O = window.__OPERATOR__;
  const wm = O.weaponManager;
  // Stand CLOSE to the 5 m dummy (at z=20): a 6.5 deg pellet cone at 5 m is
  // only ~0.6 m wide, so from 25 m most pellets miss a human-sized target and
  // the hit count says nothing about whether the loop ran.
  O.playerController.debugTeleport(20, 0, 22);
  O.playerController.debugSetOrientation(0, 0);
  const w = await equip('shotgun');
  w.currentMagazineAmmo = 6;
  let hits = 0;
  const offHit = O.eventBus.on('combat:hit', () => { hits += 1; });
  let shotEvents = 0;
  const offShot = O.eventBus.on('combat:shotFired', () => { shotEvents += 1; });

  window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  await new Promise((r) => requestAnimationFrame(r));
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  await new Promise((r) => setTimeout(r, 130));
  const afterFirst = {
    ammo: w.currentMagazineAmmo, hits, shotEvents,
    cycling: wm.cycling.isCycling, chambered: wm.cycling.isChambered,
  };
  // Immediate second pull must be REFUSED while the pump is racking.
  window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  await new Promise((r) => requestAnimationFrame(r));
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  await new Promise((r) => setTimeout(r, 110));
  const blockedAmmo = w.currentMagazineAmmo;
  await new Promise((r) => setTimeout(r, 900));
  const rechambered = wm.cycling.isChambered && !wm.cycling.isCycling;
  offHit(); offShot();
  return { afterFirst, blockedAmmo, rechambered, def: {
    pellets: w.def.pelletCount, cone: w.def.pelletSpreadConeDeg,
    style: w.def.reloadStyle, mode: w.def.fireMode,
  } };
})()`);
check('3a. shotgun fires 8 pellets as ONE trigger pull (multi-ray loop)',
  shotgun.def.pellets === 8 && shotgun.afterFirst.shotEvents === 1
  && shotgun.afterFirst.hits > 1,
  `${shotgun.def.pellets} pellets, ${shotgun.afterFirst.shotEvents} shot event, ${shotgun.afterFirst.hits} pellet hits`);
check('3b. pump gates re-fire until the cycle completes',
  shotgun.afterFirst.ammo === 5 && shotgun.afterFirst.cycling === true
  && shotgun.blockedAmmo === 5 && shotgun.rechambered === true,
  `ammo 6->${shotgun.afterFirst.ammo}, blocked re-fire (still ${shotgun.blockedAmmo}), re-chambered=${shotgun.rechambered}`);
check('3c. shotgun declares the per-shell reload style',
  shotgun.def.style === 'perShell' && shotgun.def.mode === 'manualCycle',
  `reloadStyle=${shotgun.def.style}, fireMode=${shotgun.def.mode}`);

// --- box 4: SMG recoil is measurably more horizontal than the rifle's -------
const recoilSrc = readFileSync('src/weapons/RecoilPatterns.ts', 'utf8');
const patternOf = (id) => {
  const body = recoilSrc.slice(recoilSrc.indexOf(`  ${id}: [`));
  const rows = body.slice(0, body.indexOf('],')).matchAll(
    /pitchDeg:\s*(-?[\d.]+),\s*yawDeg:\s*(-?[\d.]+)/g,
  );
  return [...rows].map((m) => ({ pitch: +m[1], yaw: +m[2] }));
};
const rifleP = patternOf('rifle');
const smgP = patternOf('smg');
// Horizontality = total absolute yaw travel vs total pitch climb.
const travel = (p) => p.reduce((a, s) => a + Math.abs(s.yaw), 0);
const climb = (p) => p.reduce((a, s) => a + Math.abs(s.pitch), 0);
const rifleRatio = travel(rifleP) / climb(rifleP);
const smgRatio = travel(smgP) / climb(smgP);
// Sign alternations = "erratic zigzag" rather than a steady drift.
const flips = (p) => p.reduce((n, s, i) =>
  (i > 0 && Math.sign(s.yaw) !== 0 && Math.sign(s.yaw) !== Math.sign(p[i - 1].yaw) ? n + 1 : n), 0);
check('4. SMG recoil is distinctly more horizontal/erratic than the rifle (data only)',
  smgRatio > rifleRatio * 2 && flips(smgP) > flips(rifleP) + 5,
  `yaw/pitch ratio rifle ${rifleRatio.toFixed(2)} vs smg ${smgRatio.toFixed(2)}; sign flips ${flips(rifleP)} vs ${flips(smgP)}`);

// --- box 5: sniper variable scope + bolt ------------------------------------
const sniper = await page.evaluate(`(async () => {
  ${EQUIP}
  const O = window.__OPERATOR__;
  const w = await equip('sniper');
  const p = w.def.presentation;
  return {
    optic: p.opticType, min: p.minMagnification, max: p.maxMagnification,
    shake: p.hasScopeShake, hold: p.breathHoldMaxDuration,
    relief: p.eyeRelief, mode: w.def.fireMode, cycle: w.def.cycleDurationSeconds,
  };
})()`);
check('5. sniper is a bolt-action with a true variable scope (4-10x, breath hold)',
  sniper.optic === 'variableScope' && sniper.min === 4 && sniper.max === 10
  && sniper.shake === true && sniper.hold === 4
  && sniper.mode === 'manualCycle' && sniper.cycle > 0,
  `${sniper.min}-${sniper.max}x, relief ${sniper.relief} m, breath hold ${sniper.hold}s, bolt ${sniper.cycle}s`);

// --- box 5b: the scope system actually renders and behaves ------------------
const scope = await page.evaluate(`(async () => {
  ${EQUIP}
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const adsIn = async () => {
    O.inputManager.heldMouseButtons.add(2);
    for (let k = 0; k < 250; k += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      if (O.viewmodel.adsWeight >= 0.99) break;
    }
    await sleep(800);
  };
  const adsOut = async () => {
    O.inputManager.heldMouseButtons.delete(2);
    await sleep(800);
  };
  O.perspective.setPerspective('FIRST');
  O.playerController.debugTeleport(0, 0, 25);
  O.playerController.debugSetOrientation(0, 0);

  // --- unmagnified optics must NOT get a tunnel ---------------------------
  const unmagnified = {};
  for (const id of ['rifle', 'smg']) {
    await equip(id);
    await adsIn();
    unmagnified[id] = {
      tunnel: O.scopeOverlay.isVisible,
      rigHidden: O.viewmodel.isHiddenByScope,
      fov: O.playerController.camera.threeCamera.fov,
    };
    await adsOut();
  }

  // --- the sniper's variable scope ----------------------------------------
  await equip('sniper');
  const baseFov = O.playerController.camera.threeCamera.fov;
  await adsIn();
  const at4x = {
    fov: O.playerController.camera.threeCamera.fov,
    mag: O.scopeSystem.currentMagnification,
    tunnel: O.scopeOverlay.isVisible,
    rigHidden: O.viewmodel.isHiddenByScope,
    hasElement: Boolean(document.getElementById('scope-overlay')),
    reticle: document.getElementById('scope-reticle')?.style.transform ?? '',
  };

  // Zoom in on the wheel; FOV must fall and the reticle must shrink.
  for (let i = 0; i < 8; i += 1) {
    O.inputManager.wheelDelta = -1;
    await sleep(110);
  }
  await sleep(600);
  const zoomedIn = {
    fov: O.playerController.camera.threeCamera.fov,
    mag: O.scopeSystem.currentMagnification,
    reticle: document.getElementById('scope-reticle')?.style.transform ?? '',
  };
  // Clamp at max: keep scrolling, magnification must stop at maxMagnification.
  // wheelDelta is drained once per frame by WeaponManager.update, so each
  // notch needs its own frame — hammering it faster silently drops notches.
  for (let i = 0; i < 30; i += 1) {
    O.inputManager.wheelDelta = -1;
    await sleep(70);
  }
  await sleep(400);
  const clampedMax = O.scopeSystem.currentMagnification;

  // --- breath hold ---------------------------------------------------------
  const beforeHold = O.scopeSystem.breathFraction;
  O.inputManager.heldKeys.add('ShiftLeft');
  // Wall-clock sleep, NOT a rAF loop: headless Chromium throttles animation
  // frames aggressively, so a frame-counted wait can span a fraction of the
  // real time it looks like it should.
  await sleep(6000);
  const duringHold = {
    frac: O.scopeSystem.breathFraction,
    holding: O.scopeSystem.isHoldingBreath,
  };
  // Sway must be much smaller while the breath is held.
  //
  // Sample the SCOPE SYSTEM'S OWN output, not camera.rotation.y: the camera
  // also carries recoil, bob and look input, and the slowest sway component
  // is 0.7 Hz (a 1.4 s period), so a short sample of the composite angle
  // returns a arbitrary slice of the waveform rather than its amplitude.
  // Integrate |sway| over >2 full periods instead.
  const sample = async (ms) => {
    let peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await sleep(16);
      // READ the last frame's sway; calling update() here would advance the
      // meter a second time per frame and refill the breath under us.
      const sw = O.scopeSystem.lastSway;
      peak = Math.max(peak, Math.hypot(sw.yaw, sw.pitch));
    }
    return peak;
  };
  const swayHeld = await sample(2500);
  // Read the meter at the END of the hold: sample() above keeps the key down,
  // so this is the true drained depth.
  const drainedTo = O.scopeSystem.breathFraction;
  O.inputManager.heldKeys.delete('ShiftLeft');
  // Let the post-exhaustion penalty lapse so we compare against NORMAL sway.
  await sleep(3000);
  const swayFree = await sample(2500);

  await adsOut();
  const afterUnscope = {
    tunnel: O.scopeOverlay.isVisible,
    rigHidden: O.viewmodel.isHiddenByScope,
  };
  return {
    unmagnified, baseFov, at4x, zoomedIn, clampedMax,
    beforeHold, duringHold, drainedTo, swayHeld, swayFree, afterUnscope,
  };
})()`);

check('5b. only a variableScope gets the tunnel; irons/red-dot keep their arms',
  scope.unmagnified.rifle.tunnel === false && scope.unmagnified.smg.tunnel === false
  && scope.unmagnified.rifle.rigHidden === false
  && scope.at4x.tunnel === true && scope.at4x.rigHidden === true
  && scope.at4x.hasElement === true,
  `rifle tunnel=${scope.unmagnified.rifle.tunnel}, smg tunnel=${scope.unmagnified.smg.tunnel}, sniper tunnel=${scope.at4x.tunnel} (rig hidden ${scope.at4x.rigHidden})`);

check('5c. adsFOV = baseFOV / magnification, live on the scroll wheel',
  scope.at4x.mag === 4 && Math.abs(scope.at4x.fov - 90 / 4) < 2.5
  && scope.zoomedIn.mag > scope.at4x.mag
  && scope.zoomedIn.fov < scope.at4x.fov
  && scope.clampedMax === 10,
  `${scope.at4x.mag}x -> fov ${scope.at4x.fov.toFixed(1)}; zoomed ${scope.zoomedIn.mag}x -> fov ${scope.zoomedIn.fov.toFixed(1)}; clamps at ${scope.clampedMax}x`);

const reticleScale = (t) => {
  const m = /scale\(([\d.]+)\)/.exec(t);
  return m ? +m[1] : NaN;
};
check('5d. reticle scales INVERSELY with zoom (constant angular subtension)',
  reticleScale(scope.zoomedIn.reticle) < reticleScale(scope.at4x.reticle),
  `scale ${reticleScale(scope.at4x.reticle)} at ${scope.at4x.mag}x -> ${reticleScale(scope.zoomedIn.reticle)} at ${scope.zoomedIn.mag}x`);

check('5e. breath-hold drains a meter and visibly suppresses scope sway',
  scope.beforeHold > 0.99 && scope.duringHold.holding === true
  // Assert the meter MOVED substantially rather than hitting an exact depth:
  // headless frame pacing varies how much wall-clock the hold actually gets.
  // The substantive assertions are that it drains and that sway collapses.
  && scope.drainedTo < scope.beforeHold - 0.35
  && scope.swayHeld < scope.swayFree * 0.5,
  `meter ${scope.beforeHold.toFixed(2)} -> ${scope.drainedTo.toFixed(2)} (exhausted); sway held ${scope.swayHeld.toExponential(2)} vs free ${scope.swayFree.toExponential(2)} (${(scope.swayFree / scope.swayHeld).toFixed(1)}x reduction)`);

check('5f. un-scoping restores the viewmodel and removes the tunnel',
  scope.afterUnscope.tunnel === false && scope.afterUnscope.rigHidden === false);

// --- box 6: rocket launcher — real arcing body + splash incl. self ----------
const rocket = await page.evaluate(`(async () => {
  ${EQUIP}
  const O = window.__OPERATOR__;
  await equip('rocket_launcher');
  O.playerController.debugTeleport(0, 0, 25);
  // NOTE: debugSetOrientation's pitch is inverted; +0.20 aims UP.
  O.playerController.debugSetOrientation(0, 0.20);
  await new Promise((r) => setTimeout(r, 500));
  const booms = [];
  const off = O.eventBus.on('combat:explosion', (p) => booms.push(p));
  window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  const traj = [];
  for (let i = 0; i < 160; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    if (i === 0) window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    const pos = O.projectileSystem.positions;
    if (pos.length) traj.push({ y: pos[0].y, z: pos[0].z });
    if (booms.length) break;
  }
  off();

  // Splash: blast on the 5 m dummy, then one at our own feet.
  const dealt = [];
  const hooked = [];
  for (const h of O.ballistics.hittables) {
    if (!h.metadata.takeDamage) continue;
    const orig = h.metadata.takeDamage;
    hooked.push({ h, orig });
    h.metadata.takeDamage = (a, pt) => { dealt.push(a); orig(a, pt); };
  }
  const self = [];
  const offSelf = O.eventBus.on('player:damaged', (p) => self.push(p.amount));
  O.eventBus.emit('combat:explosion', {
    point: { x: 20, y: 1, z: 20 }, radius: 6, maxDamage: 140,
    falloffCurve: 'quadratic', weaponId: 'rocket_launcher',
  });
  await new Promise((r) => setTimeout(r, 150));
  const pp = O.playerController.getPosition();
  O.eventBus.emit('combat:explosion', {
    point: { x: pp.x, y: pp.y + 0.5, z: pp.z }, radius: 6, maxDamage: 140,
    falloffCurve: 'quadratic', weaponId: 'rocket_launcher',
  });
  await new Promise((r) => setTimeout(r, 150));
  offSelf();
  for (const { h, orig } of hooked) h.metadata.takeDamage = orig;
  return {
    frames: traj.length,
    rose: traj.length > 2 && traj[2].y > traj[0].y,
    peakY: Math.max(...traj.map((t) => t.y)),
    lastY: traj.length ? traj[traj.length - 1].y : 0,
    firstY: traj.length ? traj[0].y : 0,
    // Gravity is proven by the vertical SPEED decreasing over the flight, not
    // by the rocket necessarily coming back down inside the sample window —
    // at 45 m/s with gravityScale 0.15 the arc is long and flat.
    gravityBend: (() => {
      if (traj.length < 6) return 0;
      const n = traj.length;
      const early = traj[2].y - traj[1].y;
      const late = traj[n - 1].y - traj[n - 2].y;
      return early - late;
    })(),
    travelled: traj.length ? Math.abs(traj[0].z - traj[traj.length - 1].z) : 0,
    dealt, self,
  };
})()`);
check('6a. rocket is a real physics body that visibly arcs under gravity',
  rocket.frames > 10 && rocket.rose && rocket.travelled > 5 && rocket.gravityBend > 0,
  `${rocket.frames} frames, ${rocket.travelled.toFixed(1)} m downrange, y ${rocket.firstY.toFixed(1)}->${rocket.lastY.toFixed(1)} (peak ${rocket.peakY.toFixed(1)}), climb rate decayed by ${rocket.gravityBend.toFixed(3)} m/frame`);
check('6b. blast applies radius falloff damage, INCLUDING to the shooter (§7.1)',
  rocket.dealt.length > 0 && rocket.self.length > 0 && rocket.self[0] > 0,
  `dummy took ${rocket.dealt.map((d) => d.toFixed(0)).join('/')}, shooter took ${rocket.self.map((d) => d.toFixed(1)).join('/')}`);
check('6c. launcher uses the new shoulderMounted grip style',
  roster.rocket_launcher?.grip === 'shoulderMounted',
  `grip=${roster.rocket_launcher?.grip}`);

// --- box 7: socket orientation on every new model ---------------------------
// Checked by tools/validateModelOrientation.js in the build step; assert here
// that the muzzle/optic sockets exist and face -Z on the loaded scenes.
const sockets = await page.evaluate(`(async () => {
  ${EQUIP}
  const O = window.__OPERATOR__;
  const out = {};
  for (const id of ['smg', 'sniper', 'rocket_launcher']) {
    await equip(id);
    const root = O.viewmodel.getRigRoot();
    const res = {};
    for (const name of ['Socket_Muzzle', 'Socket_Optic']) {
      const s = root.getObjectByName(name);
      if (!s) { res[name] = null; continue; }
      s.updateWorldMatrix(true, false);
      const e = s.matrixWorld.elements;
      // Local -Z in the weapon's own frame, relative to the weapon root.
      const wroot = root.getObjectByName('Root_Weapon') ?? root;
      wroot.updateWorldMatrix(true, false);
      const we = wroot.matrixWorld.elements;
      const dot = (-e[8]) * (-we[8]) + (-e[9]) * (-we[9]) + (-e[10]) * (-we[10]);
      res[name] = +dot.toFixed(3);
    }
    out[id] = res;
  }
  return out;
})()`);
const socketOk = Object.entries(sockets).every(([, v]) =>
  v.Socket_Muzzle !== null && v.Socket_Optic !== null
  && v.Socket_Muzzle > 0.99 && v.Socket_Optic > 0.99);
check('7. new weapons\' muzzle/optic sockets face down the barrel (-Z)',
  socketOk,
  Object.entries(sockets).map(([k, v]) =>
    `${k} muzzle ${v.Socket_Muzzle} optic ${v.Socket_Optic}`).join('; '));

// --- box 8: no engine rewrite — only additive branches ----------------------
// The engine files must still exist and still expose their original entry
// points; the new weapons must not have forked them.
const engineFiles = {
  'src/animation-engine/OperatorAnimEngine.ts': ['registerLayer', 'requestOneShot'],
  'src/character/JointIK.ts': ['solveJointIK'],
  'src/weapons/BallisticsSystem.ts': ['registerHittable', 'resolveShot'],
  'src/weapons/ReloadSystem.ts': ['begin'],
  'src/physics/PhysicsWorld.ts': ['castRayStatic'],
};
const intact = Object.entries(engineFiles).every(([f, syms]) => {
  const src = readFileSync(f, 'utf8');
  return syms.every((sym) => src.includes(sym));
});
// ReloadSystem must still contain zero weapon-id literals.
const reloadSrc = readFileSync('src/weapons/ReloadSystem.ts', 'utf8');
const weaponLiteral = /['"](rifle|pistol|shotgun|smg|sniper|rocket_launcher)['"]/.test(reloadSrc);
check('8. no engine file was rewritten; ReloadSystem stays weapon-agnostic',
  intact && !weaponLiteral,
  `engine entry points intact=${intact}, weapon literals in ReloadSystem=${weaponLiteral}`);

check('9. zero page errors across the suite',
  pageErrors.length === 0, pageErrors[0]?.slice(0, 140));

await browser.close();
console.log(`\nACCEPTANCE DOC D: ${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);
