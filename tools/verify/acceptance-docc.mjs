/**
 * acceptance-docc.mjs — Document C §10 acceptance (the 8-box checklist +
 * §5.6 dropped mags). Drives the live dev server in headless Chromium.
 * Prints PASS/FAIL per box; exits non-zero on any FAIL.
 */
import { launchBrowser } from './browser.mjs';
import { readFileSync, existsSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5173';
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ url: undefined });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__OPERATOR__), { timeout: 60000 });
await sleep(2500);

// --- box 1: F4 in-game AxesHelper gizmo on sockets + joints ------------------
const gizmoPre = await page.evaluate(() => ({ hadModule: Boolean(window.__OPERATOR__.orientationGizmos) }));
await page.keyboard.down('F4');
await sleep(350);
await page.keyboard.up('F4');
await sleep(600);
const gizmoDuring = await page.evaluate(() => {
  let n = 0;
  window.__OPERATOR__.viewmodel.getRigRoot().traverse((o) => { if (o.type === 'AxesHelper') n += 1; });
  return n;
});
await page.keyboard.down('F4');
await sleep(350);
await page.keyboard.up('F4');
await sleep(400);
const gizmoAfter = await page.evaluate(() => {
  let n = 0;
  window.__OPERATOR__.viewmodel.getRigRoot().traverse((o) => { if (o.type === 'AxesHelper') n += 1; });
  return n;
});
const gizmo = { hadModule: gizmoPre.hadModule, during: gizmoDuring, after: gizmoAfter };
check('F4 socket/joint AxesHelper gizmo implemented and toggles',
  gizmo.hadModule && gizmo.during >= 10 && gizmo.after === 0,
  `helpers during=${gizmo.during}, after=${gizmo.after}`);

// --- box 2: Rapier sole backend (no hand-rolled collision/bounce) ------------
const noPlayerCollider = !existsSync('src/player/PlayerCollider.ts');
const casingSrc = readFileSync('src/weapons/CasingPhysics.ts', 'utf8');
const movementSrc = readFileSync('src/player/PlayerMovement.ts', 'utf8');
check('Rapier sole backend (PlayerCollider deleted; no hand-rolled reflection)',
  noPlayerCollider && !casingSrc.includes('reflect') && movementSrc.includes('resolveHorizontalCollision'),
  `playerColliderDeleted=${noPlayerCollider}`);

// --- box 3: KCC feel ≥ Doc 2 (movement parity spot-checks) --------------------
const move = await page.evaluate(async () => {
  const op = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pc = op.playerController;
  op.playerController.debugTeleport(0, 0, 10);
  // Walk BACKWARD (+Z, open floor): forward leads into the crouch-tunnel
  // face at z≈8 (correctly blocked for a standing capsule — speed 0 there
  // is the RIGHT answer, not a movement bug).
  op.inputManager.heldKeys.add('KeyS');
  await sleep(2200);
  const speed = pc.getHorizontalSpeed(); // sample DURING the hold
  op.inputManager.heldKeys.delete('KeyS');
  return { speed };
});
check('movement parity: exact walk speed through the KCC seam',
  Math.abs(move.speed - 5.4) < 0.15,
  `speed=${move.speed.toFixed(2)} m/s (target 5.4)`);

// --- box 4: OperatorAnimEngine single owner -----------------------------------
const engine = await page.evaluate(() => {
  const op = window.__OPERATOR__;
  return {
    hasEngine: Boolean(op.animationEngine),
    oneShot: op.animationEngine?.currentOneShotName ?? null,
    layersKnown: typeof op.animationEngine?.syncOneShot === 'function',
  };
});
const mainSrc = readFileSync('src/main.ts', 'utf8');
const vmSrc = readFileSync('src/weapons/WeaponViewmodel.ts', 'utf8');
const blenderSrc = readFileSync('src/animation/AnimationBlender.ts', 'utf8');
const playCallers = [mainSrc, vmSrc, blenderSrc].filter((s) => /\.play\(/.test(s)).length;
check('OperatorAnimEngine is the single animation owner',
  engine.hasEngine && playCallers === 0 && vmSrc.includes('animationEngine.playAction'),
  `direct .play() call sites outside the engine: ${playCallers}`);

// --- box 5: iron ADS per §8.2 (eye relief, on-axis, magnification FOV) --------
const ads = await page.evaluate(async () => {
  const op = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (op.weaponManager.activeWeapon.def.id !== 'rifle') op.weaponManager.switchTo(0);
  // Position gate: ADS is guarded while switching — wait out the swap.
  const t0 = performance.now();
  while (performance.now() - t0 < 12000
    && (op.weaponManager.switching || op.weaponManager.activeWeapon.def.id !== 'rifle')) {
    await sleep(150);
  }
  op.inputManager.heldMouseButtons.add(2);
  // Measure only at the SETTLED pose (adsWeight ≥ 0.95 + spring settle).
  const t1 = performance.now();
  while (performance.now() - t1 < 8000 && op.viewmodel.adsWeight < 0.95) await sleep(120);
  await sleep(1600);
  const cam = op.playerController.camera.threeCamera;
  cam.updateWorldMatrix(true, false);
  const root = op.viewmodel.getRigRoot();
  const optic = root.getObjectByName('Socket_Optic');
  optic.updateWorldMatrix(true, false);
  const e = cam.matrixWorld.elements;
  const fwd = new optic.position.constructor(-e[8], -e[9], -e[10]).normalize();
  const right = new optic.position.constructor(e[0], e[1], e[2]);
  const up = new optic.position.constructor(e[4], e[5], e[6]);
  const co = cam.getWorldPosition(new optic.position.constructor());
  const d = optic.getWorldPosition(new optic.position.constructor()).sub(co);
  const out = {
    ads: op.viewmodel.adsWeight,
    fov: +cam.fov.toFixed(1),
    along: +d.dot(fwd).toFixed(3),
    lateral: +Math.hypot(d.dot(right), d.dot(up)).toFixed(4),
  };
  op.inputManager.heldMouseButtons.delete(2);
  out.eyeRelief = op.getProfile ? op.getProfile('rifle').eyeRelief : 0.1;
  return out;
});
// along = (optic−eye)·cameraForward: POSITIVE = in front of the eye.
check('iron ADS eye relief: optic on axis at the profile relief, FOV = base×0.92',
  ads.ads > 0.95 && Math.abs(ads.along - ads.eyeRelief) < 0.02 && ads.lateral < 0.01 && Math.abs(ads.fov - 82.8) < 1.5,
  `along=${ads.along}m (profile ${ads.eyeRelief}) lateral=${ads.lateral}m fov=${ads.fov}`);

// --- box 6: camera table independent of arm recoil (§6 additive) --------------
const recoilBase = await page.evaluate(() => ({
  simPitch0: window.__OPERATOR__.playerController.getPitch(),
  camPitch0: window.__OPERATOR__.playerController.camera.threeCamera.rotation.x,
}));
await page.mouse.down({ button: 'left' });
await sleep(2200);
await page.mouse.up({ button: 'left' });
const recoilOut = await page.evaluate(({ simPitch0, camPitch0 }) => {
  const op = window.__OPERATOR__;
  const simDuring = op.playerController.getPitch();
  const camDuring = op.playerController.camera.threeCamera.rotation.x;
  return {
    simDelta: Math.abs(simDuring - simPitch0),
    camDelta: Math.abs(camDuring - camPitch0),
  };
}, recoilBase);
check('camera recoil additive-only (camera climbs, sim aim pristine)',
  recoilOut.camDelta > 0.002 && recoilOut.simDelta < 1e-8,
  `camDelta=${(recoilOut.camDelta * 57.3).toFixed(2)}° simDelta=${recoilOut.simDelta.toExponential(1)}`);

// --- box 7: ReloadSystem has zero weapon-specific code ------------------------
const reloadSrc = readFileSync('src/weapons/ReloadSystem.ts', 'utf8');
const weaponNamed = /\b(rifle|pistol|shotgun|smg|sniper|rocket)\b/i.test(reloadSrc.replace(/reloadTactical|reloadEmpty|weaponId|weapon\.def/g, ''));
check('ReloadSystem is weapon-agnostic (no per-weapon branches)',
  !weaponNamed && reloadSrc.includes('animationEngine.scheduler'),
  `weapon-literal found=${weaponNamed}, scheduler-driven=${reloadSrc.includes('animationEngine.scheduler')}`);

// --- box 8: COORDINATE_CONVENTIONS.md + offline validator ---------------------
check('COORDINATE_CONVENTIONS.md + validateModelOrientation.js exist',
  existsSync('COORDINATE_CONVENTIONS.md') && existsSync('tools/validateModelOrientation.js'));

// --- §5.6: dropped magazine is a real Rapier body on real geometry ------------
const mag = await page.evaluate(async () => {
  const op = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const weapon = op.weaponManager.activeWeapon;
  for (let i = 0; i < 3; i += 1) weapon.consumeRound();
  op.weaponManager['reload'].begin(weapon);
  const t0 = performance.now();
  while (performance.now() - t0 < 14000 && op.weaponManager['reload'].isReloading) await sleep(150);
  await sleep(1500);
  const dm = op.droppedMags;
  const active = dm ? dm.pool.entries.filter((e) => e.active) : [];
  return {
    any: active.length > 0,
    settled: active.some((e) => {
      const t = e.body.translation();
      const v = e.body.linvel();
      return t.y < 0.4 && Math.hypot(v.x, v.y, v.z) < 0.25;
    }),
    isMagMesh: active.some((e) => e.mesh.name === 'Bone_Magazine'),
  };
});
check('dropped mag: Rapier body settles on real geometry (§5.6)',
  mag.any && mag.settled && mag.isMagMesh,
  JSON.stringify(mag));

check('zero page errors across the suite', pageErrors.length === 0, pageErrors[0]?.slice(0, 120));

console.log(`\nACCEPTANCE DOC C: ${9 - failed}/9 boxes passed`);
if (failed > 0) process.exit(1);
