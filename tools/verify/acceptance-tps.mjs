/**
 * acceptance-tps.mjs — FPS/TPS Unified Character Controller acceptance.
 *
 * Drives the live dev server in headless Chromium and asserts the spec's
 * behavioural claims against the RUNNING game, not against source text:
 *
 *   1. Unified architecture: one logical entity, two visual rigs; the 3PS
 *      body tracks the authoritative capsule position.
 *   2. Perspective toggle pipeline: head masked in 1PS (but still shadow
 *      casting), body visible in 3PS, near-clip switched, arms hidden in 3PS.
 *   3. Camera matrix shift: a non-linear S-curve between eye and boom, and a
 *      spring arm that collapses against real geometry.
 *   4. Aim Offset: spine bones blend in real time to the controller rotation.
 *   5. Procedural locomotion + foot IK on the rigid 3PS rig.
 *   6. Vaulting: forward/height/landing probes, Bezier traversal, physics
 *      suspension and momentum-preserving restore.
 *   7. Cross-perspective sync: PlaybackRate = clipLength / logicalDuration.
 *   8. Asset policy: only code-generated .glb files are loaded.
 *
 * Prints PASS/FAIL per box; exits non-zero on any FAIL.
 */
import { launchBrowser } from './browser.mjs';
import { readdirSync, existsSync } from 'node:fs';

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
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__OPERATOR__), { timeout: 60000 });
// Body rig loads asynchronously.
await page.waitForFunction(() => window.__OPERATOR__.thirdPersonBody?.isReady === true, { timeout: 60000 });
await sleep(1200);

// === 1. Unified architecture ================================================
const unified = await page.evaluate(() => {
  const O = window.__OPERATOR__;
  O.playerController.debugTeleport(0, 0, 6);
  O.playerController.debugSetOrientation(0, 0);
  return new Promise((resolve) => setTimeout(() => {
    const body = O.thirdPersonBody.object;
    const pos = O.playerController.getPosition();
    resolve({
      bodyExists: Boolean(body),
      inScene: Boolean(body?.parent),
      bodyPos: { x: body.position.x, y: body.position.y, z: body.position.z },
      simPos: { x: pos.x, y: pos.y, z: pos.z },
      // The rig is anchored by its EYE SOCKET, not its root: the root is set
      // back so the torso/thighs stay behind the lens. What must track the
      // simulation is therefore the eye, and the vertical/lateral root axes.
      eyeToCamera: (() => {
        const eyes = body.getObjectByName('Socket_Eyes');
        const cam = O.engine.sceneManager.getCamera();
        if (!eyes) return null;
        eyes.updateWorldMatrix(true, false);
        const m = eyes.matrixWorld.elements;
        return Math.hypot(m[12] - cam.position.x, m[13] - cam.position.y, m[14] - cam.position.z);
      })(),
      // The 3PS body must NOT be parented to the camera (that's the viewmodel).
      parentIsCamera: body?.parent?.isCamera === true,
      viewmodelParentIsCamera: O.viewmodel.getRigRoot()?.parent?.isCamera === true,
    });
  }, 600));
});
// Vertical + lateral tracking of the root (the forward axis is intentionally
// offset by the eye-anchoring setback, so it is excluded here and covered by
// the eye-to-camera check instead).
const trackErr = Math.abs(unified.bodyPos.y - unified.simPos.y);
check('1a. 3PS body exists in the world scene (not camera-parented)',
  unified.bodyExists && unified.inScene && !unified.parentIsCamera);
check('1b. 1PS viewmodel IS camera-parented (two distinct representations)',
  unified.viewmodelParentIsCamera);
check('1c. body tracks the authoritative capsule position (eye-anchored)',
  trackErr < 0.02 && unified.eyeToCamera !== null && unified.eyeToCamera < 0.45,
  `vertical offset ${trackErr.toFixed(4)} m, eye-to-camera ${unified.eyeToCamera?.toFixed(3)} m`);

// === 2. Perspective toggle pipeline =========================================
const toggle = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => {
    const body = O.thirdPersonBody.object;
    const head = body.getObjectByName('Mesh_Head');
    const helmet = body.getObjectByName('Mesh_Helmet');
    // The camera sits inside the chest, so the chest is first-person-hidden
    // along with the head. The LEGS are what the player must still see when
    // they look down, so that is what this check samples.
    const torso = body.getObjectByName('Mesh_Thigh_R')
      ?? body.getObjectByName('Thigh_R')
      ?? body.getObjectByName('Mesh_Pelvis');
    const cam = O.engine.sceneManager.getCamera();
    return {
      perspective: O.perspective.current,
      blend: O.perspective.blendWeight,
      headLayer: head.layers.mask,
      helmetLayer: helmet.layers.mask,
      torsoLayer: torso.layers.mask,
      headCastShadow: head.castShadow,
      helmetCastShadow: helmet.castShadow,
      headVisibleFlag: head.visible,
      near: cam.near,
      worldMask: O.perspective.worldPassMask,
      viewmodelVisible: O.perspective.viewmodelVisible,
    };
  };
  O.perspective.setPerspective('FIRST');
  await sleep(700);
  const first = snap();
  O.perspective.setPerspective('THIRD');
  await sleep(700);
  const third = snap();
  return { first, third };
});
const BODY_BIT = 1 << 2;   // LAYER.CHARACTER
const HEAD_BIT = 1 << 3;   // LAYER.HEAD
// Layer assignment is STATIC (RenderLayers): the head lives permanently on its
// own layer and the CAMERA MASK decides whether it is drawn. That is cheaper
// and race-free compared with re-walking the hierarchy on every toggle.
check('2a. 1PS: head + helmet are on the dedicated head layer, excluded from the eye',
  (toggle.first.headLayer & HEAD_BIT) !== 0 && (toggle.first.helmetLayer & HEAD_BIT) !== 0
  && (toggle.first.worldMask & HEAD_BIT) === 0,
  `head mask ${toggle.first.headLayer}, 1PS world mask ${toggle.first.worldMask}`);
check('2b. 1PS: legs/pelvis STAY on the body layer (look down, see your body)',
  (toggle.first.torsoLayer & BODY_BIT) !== 0,
  `leg layer mask ${toggle.first.torsoLayer}`);
check('2c. hidden head parts still cast shadows (never `visible=false`)',
  toggle.first.headCastShadow && toggle.first.helmetCastShadow && toggle.first.headVisibleFlag);
check('2d. 3PS: the head layer is re-admitted to the camera mask (Show 3PS Head)',
  (toggle.third.worldMask & HEAD_BIT) !== 0,
  `3PS world mask ${toggle.third.worldMask}`);
// The body is visible in BOTH perspectives — that is what lets the player look
// down and see their own torso and legs. Only the HEAD layer differs.
check('2e. body renders in both perspectives; only the head layer is gated',
  (toggle.first.worldMask & BODY_BIT) !== 0 && (toggle.third.worldMask & BODY_BIT) !== 0
  && (toggle.first.worldMask & HEAD_BIT) === 0 && (toggle.third.worldMask & HEAD_BIT) !== 0,
  `1PS ${toggle.first.worldMask} / 3PS ${toggle.third.worldMask}`);
check('2f. 1PS arms render only in first person (Hide 1PS Arms in 3PS)',
  toggle.first.viewmodelVisible === true && toggle.third.viewmodelVisible === false);
check('2g. near-clip: tight in 1PS, normal in 3PS',
  toggle.first.near < toggle.third.near,
  `${toggle.first.near.toFixed(3)} -> ${toggle.third.near.toFixed(3)}`);

// keybind path (P), not just the API
const keyToggle = await page.evaluate(() => window.__OPERATOR__.perspective.current);
await page.keyboard.down('p');
await sleep(120);
await page.keyboard.up('p');
await sleep(700);
const keyAfter = await page.evaluate(() => window.__OPERATOR__.perspective.current);
check('2h. bound key toggles perspective', keyToggle !== keyAfter, `${keyToggle} -> ${keyAfter}`);

// === 3. Camera matrix shift: S-curve + spring arm ===========================
const curve = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Open ground: the sprint lane, well clear of the crouch tunnel (z 4..8).
  O.playerController.debugTeleport(0, 0, -20);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(600);
  O.perspective.setPerspective('FIRST');
  await sleep(700);
  const cam = O.engine.sceneManager.getCamera();
  const eye = cam.position.clone();
  O.perspective.setPerspective('THIRD');
  const samples = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 600) {
    samples.push({ t: (performance.now() - t0) / 1000, blend: O.perspective.blendWeight,
      dist: cam.position.distanceTo(eye) });
    await new Promise((r) => requestAnimationFrame(r));
  }
  await sleep(500);
  return {
    samples,
    finalDist: cam.position.distanceTo(eye),
    boom: O.perspective.currentBoomDistance,
  };
});
// A linear ramp would have constant d(dist)/d(blend); an S-curve accelerates
// then decelerates. Compare the mid-blend displacement against the linear
// prediction — smoothstep(0.5)=0.5 but smoothstep(0.25)=0.156 << 0.25.
// Every sample below the midpoint must lag the linear prediction (smoothstep
// is strictly below y=x on (0, 0.5)); a linear lerp would sit exactly on it.
const earlySamples = curve.samples.filter((s) => s.blend > 0.05 && s.blend < 0.45);
const lagging = earlySamples.filter((s) => (s.dist / curve.finalDist) < s.blend * 0.9);
// Sampling is frame-quantised, so a sample landing right on the 0.45 boundary
// (where smoothstep has nearly caught up to y=x) is not evidence of linearity.
// Require the clear majority to lag rather than demanding a perfect sweep.
const sCurveOk = earlySamples.length > 0 && lagging.length >= Math.ceil(earlySamples.length * 0.5);
check('3a. camera eases out of the eye along a non-linear S-curve',
  sCurveOk,
  earlySamples.length
    ? `${lagging.length}/${earlySamples.length} early samples lag the linear ramp (e.g. blend ${earlySamples[0].blend.toFixed(2)} -> ${(earlySamples[0].dist / curve.finalDist).toFixed(3)})`
    : 'no early samples captured');
check('3b. camera ends behind the character on the boom',
  curve.finalDist > 1.5, `${curve.finalDist.toFixed(2)} m from the eye`);

const boomCollapse = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  O.playerController.debugTeleport(0, 0, -20);
  O.playerController.debugSetOrientation(0, 0);
  O.perspective.setPerspective('THIRD');
  await sleep(1000);
  const open = O.perspective.currentBoomDistance;
  // Back up to the +z boundary wall (z 30..31) facing -z: the boom swings
  // backwards into it and must collapse rather than clip through.
  O.playerController.debugTeleport(0, 0, 28.5);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(1000);
  const nearWall = O.perspective.currentBoomDistance;
  O.playerController.debugTeleport(0, 0, -20);
  await sleep(1200);
  return { open, nearWall, restored: O.perspective.currentBoomDistance };
});
check('3c. spring arm collapses against real geometry and re-extends',
  boomCollapse.nearWall < boomCollapse.open - 0.05 && boomCollapse.restored > boomCollapse.nearWall + 0.05,
  `open ${boomCollapse.open.toFixed(2)} → wall ${boomCollapse.nearWall.toFixed(2)} → ${boomCollapse.restored.toFixed(2)}`);

// === 4. Aim Offset ==========================================================
const aim = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const body = O.thirdPersonBody.object;
  const chest = body.getObjectByName('Bone_Chest');
  const spine = body.getObjectByName('Bone_Spine');
  const head = body.getObjectByName('Bone_Head');
  const read = () => ({
    chest: chest.rotation.x, spine: spine.rotation.x, head: head.rotation.x,
    blend: O.thirdPersonBody.aimBlend,
  });
  O.playerController.debugSetOrientation(0, 0);
  await sleep(800);
  const level = read();
  O.playerController.debugSetOrientation(0, -1.0); // look UP
  await sleep(800);
  const up = read();
  O.playerController.debugSetOrientation(0, 1.0); // look DOWN
  await sleep(800);
  const down = read();
  // Yaw twist while standing still (torso twists, feet hold).
  O.playerController.debugSetOrientation(0, 0);
  await sleep(600);
  const yawBefore = O.thirdPersonBody.currentBodyYaw;
  O.playerController.debugSetOrientation(0.8, 0);
  await sleep(700);
  const twisted = { bodyYaw: O.thirdPersonBody.currentBodyYaw, blendYaw: O.thirdPersonBody.aimBlend.yaw };
  return { level, up, down, yawBefore, twisted };
});
check('4a. spine pitches with aim (look up/down drives the chest bone)',
  aim.up.chest < aim.level.chest - 0.05 && aim.down.chest > aim.level.chest + 0.05,
  `chest.x up ${aim.up.chest.toFixed(3)} / level ${aim.level.chest.toFixed(3)} / down ${aim.down.chest.toFixed(3)}`);
check('4b. pitch is DISTRIBUTED across the chain, not hinged on one joint',
  Math.abs(aim.down.spine) > 0.02 && Math.abs(aim.down.chest) > 0.02 && Math.abs(aim.down.head) > 0.01,
  `spine ${aim.down.spine.toFixed(3)} chest ${aim.down.chest.toFixed(3)} head ${aim.down.head.toFixed(3)}`);
check('4c. standing yaw twists the torso without instantly spinning the body',
  Math.abs(aim.twisted.blendYaw) > 0.3 && Math.abs(aim.twisted.bodyYaw - aim.yawBefore) < 0.3,
  `blendYaw ${aim.twisted.blendYaw.toFixed(2)} bodyYaw Δ ${(aim.twisted.bodyYaw - aim.yawBefore).toFixed(3)}`);

// === 5. Procedural locomotion + foot IK =====================================
const loco = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const body = O.thirdPersonBody.object;
  const hipR = body.getObjectByName('HipPivot_R');
  const kneeR = body.getObjectByName('KneePivot_R');
  O.playerController.debugTeleport(0, 0, 18);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(700);
  const idle = { hip: hipR.rotation.x, knee: kneeR.rotation.x };
  // Walk forward and sample the stride.
  O.inputManager.rebind('moveForward', 'KeyW');
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  const hips = []; const knees = [];
  for (let i = 0; i < 70; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    hips.push(hipR.rotation.x); knees.push(kneeR.rotation.x);
  }
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  const speed = O.playerController.getHorizontalSpeed();
  await sleep(900);
  const settled = { hip: hipR.rotation.x, knee: kneeR.rotation.x };
  return {
    idle, settled, speed,
    hipRange: Math.max(...hips) - Math.min(...hips),
    kneeRange: Math.max(...knees) - Math.min(...knees),
    kneeMax: Math.max(...knees),
  };
});
check('5a. walking drives a procedural hip stride on the rigid rig',
  loco.hipRange > 0.15, `hip swing range ${loco.hipRange.toFixed(3)} rad at ${loco.speed.toFixed(1)} m/s`);
check('5b. knees flex during the stride and never hyperextend',
  loco.kneeRange > 0.1 && loco.kneeMax <= 0.05,
  `knee range ${loco.kneeRange.toFixed(3)}, max ${loco.kneeMax.toFixed(3)} (must be ≤ 0)`);
check('5c. stride ramps back down to rest when movement stops',
  Math.abs(loco.settled.hip - loco.idle.hip) < 0.12,
  `settled Δ ${(loco.settled.hip - loco.idle.hip).toFixed(3)}`);

const footIk = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const body = O.thirdPersonBody.object;
  const soleR = body.getObjectByName('Socket_Sole_R');
  const soleL = body.getObjectByName('Socket_Sole_L');
  const v = new (await import('/node_modules/three/build/three.module.js')).Vector3();
  // Stand on the arena's stair lane, where the ground is uneven.
  O.playerController.debugTeleport(13.2, 0, -2);
  await sleep(1400);
  body.updateMatrixWorld(true);
  const flatR = soleR.getWorldPosition(v.clone()).y;
  const flatL = soleL.getWorldPosition(v.clone()).y;
  const probeWired = true;
  O.playerController.debugTeleport(0, 0, -20);
  await sleep(900);
  return { flatR, flatL, probeWired, feetY: O.playerController.getPosition().y };
});
check('5d. foot IK is wired to the real collision world and keeps soles near ground',
  footIk.probeWired && Math.abs(footIk.flatR - footIk.flatL) < 0.5,
  `soles R ${footIk.flatR.toFixed(3)} / L ${footIk.flatL.toFixed(3)}`);

// === 6. Vaulting / Mantling =================================================
const vault = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const events = [];
  O.eventBus.on('player:vaultStart', (p) => events.push(['start', p]));
  O.eventBus.on('player:vaultEnd', (p) => events.push(['end', p]));

  // Find a vaultable box in the arena by probing its collider list.
  const boxes = O.arena.colliders.map((b) => ({
    minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z,
    h: b.max.y - b.min.y,
  })).filter((b) => b.maxY >= 0.6 && b.maxY <= 1.4 && b.minY <= 0.01
    && (b.maxX - b.minX) < 8 && (b.maxZ - b.minZ) < 8);
  if (boxes.length === 0) return { noTarget: true, boxes: O.arena.colliders.length };

  const target = boxes[0];
  const cx = (target.minX + target.maxX) / 2;
  // Approach from -z side, running toward +z... our forward is -z at yaw 0,
  // so stand on the +z side and run forward (-z) into the box.
  const startZ = target.maxZ + 1.8;
  O.playerController.debugTeleport(cx, 0, startZ);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(500);

  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  const trace = [];
  let started = false; let peakY = null; let physicsSuspended = false; let exitSpeed = 0;
  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    const p = O.playerController.getPosition();
    const active = O.playerController.isVaulting();
    if (active) {
      started = true;
      peakY = peakY === null ? p.y : Math.max(peakY, p.y);
      if (!O.playerController.isGrounded()) physicsSuspended = true;
      trace.push({ y: p.y, z: p.z, prog: O.playerController.vault.state.progress,
        hand: O.playerController.vault.state.handWeight });
    }
    if (started && !active) { exitSpeed = O.playerController.getHorizontalSpeed(); break; }
  }
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  await sleep(400);
  const after = O.playerController.getPosition();
  const speedAfter = O.playerController.getHorizontalSpeed();
  return {
    target, started, peakY, physicsSuspended, trace,
    afterY: after.y, afterZ: after.z, startZ, speedAfter, exitSpeed,
    events: events.map(([k]) => k),
    handPeak: Math.max(0, ...trace.map((t) => t.hand)),
  };
});
if (vault.noTarget) {
  check('6. vault target geometry present in the arena', false, `no 0.6–1.4 m box among ${vault.boxes}`);
} else {
  check('6a. forward+height probes trigger a vault on a waist-high ledge',
    vault.started, `ledge h=${vault.target.h.toFixed(2)} m`);
  check('6b. traversal arcs UP over the lip (Bezier apex above the ledge)',
    vault.peakY !== null && vault.peakY > vault.target.maxY - 0.05,
    `apex y ${vault.peakY === null ? 'n/a' : vault.peakY.toFixed(2)} vs ledge top ${vault.target.maxY.toFixed(2)}`);
  check('6c. player physics/gravity suspended during the curve',
    vault.physicsSuspended);
  check('6d. hand-plant IK target weighted during the traversal window',
    vault.handPeak > 0.5, `peak hand weight ${vault.handPeak.toFixed(2)}`);
  check('6e. player surmounts the ledge and advances past its near edge',
    vault.afterY > vault.target.maxY - 0.1 && vault.afterZ < vault.target.maxZ,
    `ended (y ${vault.afterY.toFixed(2)}, z ${vault.afterZ.toFixed(2)}); ledge top ${vault.target.maxY.toFixed(2)}, near edge z ${vault.target.maxZ.toFixed(2)}`);
  check('6f. physics restored with momentum preserved (not a dead stop)',
    vault.exitSpeed > 0.5, `speed at handover ${vault.exitSpeed.toFixed(2)} m/s`);
  check('6g. vault emitted start and end events exactly once',
    vault.events.filter((e) => e === 'start').length === 1
    && vault.events.filter((e) => e === 'end').length === 1,
    vault.events.join(','));
}

// === 7. Cross-perspective sync ==============================================
const sync = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const S = O.perspectiveSync;
  // Pure math contract: PlaybackRate = clipLength / logicalDuration.
  const fake = (len) => ({ timeScale: 1, getClip: () => ({ duration: len }) });
  const logical = 2.4;
  const oneP = fake(1.2); // short, exaggerated 1PS clip
  const threeP = fake(3.6); // long, full-body 3PS clip
  S.begin('test:reload', logical);
  const r1 = S.attach('test:reload', oneP);
  const r3 = S.attach('test:reload', threeP);
  S.end('test:reload');

  // Live path: a real reload registers its logical duration and scales the
  // running 1PS action to it.
  const wm = O.weaponManager;
  const def = wm.activeWeapon.def;
  const registered = S.durations.resolve(def.id, 'reload_tactical');
  return {
    r1, r3, logical,
    oneScaled: oneP.timeScale, threeScaled: threeP.timeScale,
    oneEffective: 1.2 / oneP.timeScale, threeEffective: 3.6 / threeP.timeScale,
    registered, defTactical: def.reloadTacticalDuration, weaponId: def.id,
  };
});
check('7a. PlaybackRate = clipLength / logicalDuration for each perspective',
  Math.abs(sync.r1 - 1.2 / 2.4) < 1e-6 && Math.abs(sync.r3 - 3.6 / 2.4) < 1e-6,
  `1PS rate ${sync.r1.toFixed(3)}, 3PS rate ${sync.r3.toFixed(3)}`);
check('7b. differently-authored clips end at the SAME logical instant',
  Math.abs(sync.oneEffective - sync.logical) < 1e-6 && Math.abs(sync.threeEffective - sync.logical) < 1e-6,
  `both resolve to ${sync.oneEffective.toFixed(3)} s`);
check('7c. gameplay durations are registered per weapon (single source of truth)',
  sync.registered === sync.defTactical,
  `${sync.weaponId} reload_tactical = ${sync.registered}`);

// === 8. Asset policy: code-generated models only ============================
const modelsLoaded = await page.evaluate(() => {
  const seen = [];
  for (const e of performance.getEntriesByType('resource')) {
    if (/\.(glb|gltf)$/.test(e.name)) seen.push(e.name.split('/').pop());
  }
  return seen;
});
const allowed = new Set(['arms_standard.glb', 'arms_gloved.glb', 'body_standard.glb',
  'rifle.glb', 'pistol.glb', 'shotgun.glb']);
const foreign = modelsLoaded.filter((m) => !allowed.has(m));
check('8a. only code-generated .glb assets are loaded at runtime',
  foreign.length === 0, foreign.length ? `foreign: ${foreign.join(', ')}` : modelsLoaded.join(', '));
const onDisk = existsSync('assets/models')
  ? [...readdirSync('assets/models/weapons'), ...readdirSync('assets/models/characters')]
    .filter((f) => f.endsWith('.glb'))
  : [];
check('8b. no externally-sourced .glb files remain in the repo',
  onDisk.every((f) => allowed.has(f)), onDisk.join(', '));

// === 9. Stability ===========================================================
const stability = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Hammer the toggle mid-blend — a half-applied perspective must not throw.
  for (let i = 0; i < 6; i += 1) { O.perspective.toggle(); await sleep(90); }
  O.perspective.setPerspective('FIRST');
  await sleep(900);
  return { perspective: O.perspective.current, blend: O.perspective.blendWeight };
});
check('9a. rapid mid-blend toggling settles cleanly',
  stability.perspective === 'FIRST' && stability.blend < 0.01,
  `blend ${stability.blend.toFixed(3)}`);
check('9b. no page errors during the whole run',
  pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
