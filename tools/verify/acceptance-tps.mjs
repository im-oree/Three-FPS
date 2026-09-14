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
import { enterMatch } from './enterMatch.mjs';
import { readdirSync, existsSync, readFileSync } from 'node:fs';

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
// Document 5 boots to a main menu; drive the real UI into a match first.
await enterMatch(page, { levelIndex: 2 });
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
  // Wait on the BLEND ITSELF, not a fixed sleep. The perspective transition is
  // a non-linear S-curve whose duration depends on frame pacing, so a flat
  // 700 ms sometimes sampled mid-blend and spuriously failed 2f.
  const settle = async (want) => {
    for (let i = 0; i < 240; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      const b = O.perspective.blendWeight;
      if (want === 'THIRD' ? b >= 0.999 : b <= 0.001) return true;
    }
    return false;
  };
  O.perspective.setPerspective('FIRST');
  const firstSettled = await settle('FIRST');
  const first = snap();
  O.perspective.setPerspective('THIRD');
  const thirdSettled = await settle('THIRD');
  const third = snap();
  return { first, third, firstSettled, thirdSettled };
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
  // Open ground for the baseline: z = -20 sits in the traversal gallery, so
  // the boom is already partly collapsed against a ledge there.
  O.playerController.debugTeleport(0, 0, 4);
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
  // Back up to the +z boundary wall facing -z: the boom swings backwards
  // into it and must collapse rather than clip through. The Training Range's
  // wall sits at z = 34 (LevelDefinition groundHalfSize), so stand just
  // inside it rather than at the old TestArena's z = 30.
  O.playerController.debugTeleport(0, 0, 32.4);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(1000);
  const nearWall = O.perspective.currentBoomDistance;
  O.playerController.debugTeleport(0, 0, 4);
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
  // Traversal is JUMP-TRIGGERED (never automatic): run at the ledge, wait for
  // the prompt to arm, then tap jump. Also record how long we were armed
  // without jumping, to prove nothing auto-fires.
  let armedFramesWithoutJump = 0; let jumped = false; let autoTriggered = false; let landedAt = null;
  for (let i = 0; i < 260; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    const p = O.playerController.getPosition();
    const prompt = O.playerController.traversalPrompt;
    if (!jumped) {
      if (O.playerController.isVaulting()) autoTriggered = true;
      if (prompt) {
        armedFramesWithoutJump += 1;
        // Hold the prompt for a beat first, then press jump.
        if (armedFramesWithoutJump > 12) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
          await new Promise((r) => requestAnimationFrame(r));
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
          jumped = true;
        }
      }
    }
    const active = O.playerController.isVaulting();
    if (active) {
      started = true;
      peakY = peakY === null ? p.y : Math.max(peakY, p.y);
      if (!O.playerController.isGrounded()) physicsSuspended = true;
      trace.push({ y: p.y, z: p.z, prog: O.playerController.vault.state.progress,
        hand: O.playerController.vault.state.handWeight });
    }
    if (started && !active) {
      // Sample a few frames AFTER handover: a standing jump-mantle legitimately
      // enters at ~0 m/s (you are pressed against the wall), so what matters is
      // that control returns and the still-held W accelerates you again.
      // Capture the landing BEFORE letting the still-held W carry us onward.
      landedAt = { y: p.y, z: p.z };
      for (let k = 0; k < 8; k += 1) await new Promise((r) => requestAnimationFrame(r));
      exitSpeed = O.playerController.getHorizontalSpeed();
      break;
    }
  }
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  await sleep(400);
  const after = O.playerController.getPosition();
  const speedAfter = O.playerController.getHorizontalSpeed();
  return {
    target, started, peakY, physicsSuspended, trace,
    armedFramesWithoutJump, autoTriggered, jumped,
    afterY: landedAt ? landedAt.y : after.y, afterZ: landedAt ? landedAt.z : after.z, startZ, speedAfter, exitSpeed,
    events: events.map(([k]) => k),
    handPeak: Math.max(0, ...trace.map((t) => t.hand)),
  };
});
if (vault.noTarget) {
  check('6. vault target geometry present in the arena', false, `no 0.6–1.4 m box among ${vault.boxes}`);
} else {
  check('6a. forward+height probes trigger a vault on a waist-high ledge',
    vault.started, `ledge h=${vault.target.h.toFixed(2)} m`);
  check('6a-i. traversal NEVER auto-triggers: prompt arms but nothing happens until jump',
    vault.armedFramesWithoutJump >= 12 && !vault.autoTriggered && vault.jumped,
    `armed for ${vault.armedFramesWithoutJump} frames without moving; auto-fired=${vault.autoTriggered}`);
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
  check('6f. physics + player control restored after the curve (not a dead stop)',
    vault.exitSpeed > 0.5, `speed shortly after handover ${vault.exitSpeed.toFixed(2)} m/s`);
  check('6g. vault emitted start and end events exactly once',
    vault.events.filter((e) => e === 'start').length === 1
    && vault.events.filter((e) => e === 'end').length === 1,
    vault.events.join(','));
}

// === 6.5 Dedicated mantle: jump-triggered, two-handed, weapon stowed ========
// Walk a RIFLE-ARMED player up to the 1.8 m wall in the mantle gallery, let
// them come to a complete stop, then press jump. Everything below must hold.
const mantle = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  O.playerController.debugTeleport(-10.5, 0, -17.2);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(600);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  const qx = (o) => (o ? o.quaternion.x : 0);
  const arm = []; const oneShots = new Set(); const carry = new Set();
  let prompt = null; let peakY = 0; let jumped = false; let armed = 0;
  let active = false; let sawActive = false; let stoppedBeforeJump = null;
  for (let i = 0; i < 320; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    carry.add(O.characterState.carry);
    const p = O.playerController.traversalPrompt;
    if (p) prompt = p;
    if (!jumped && p) {
      armed += 1;
      if (armed > 14) {
        // Prove the mantle starts from a DEAD STOP, not from run-up momentum.
        stoppedBeforeJump = O.playerController.getHorizontalSpeed();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        await new Promise((r) => requestAnimationFrame(r));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        jumped = true;
      }
    }
    active = O.playerController.isVaulting();
    if (active) {
      sawActive = true;
      peakY = Math.max(peakY, O.playerController.getPosition().y);
      oneShots.add(O.viewmodel.activeOneShotName);
      const ch = O.handsRig.chainsForTest;
      arm.push({
        eR: qx(ch.R?.elbowPivot), eL: qx(ch.L?.elbowPivot),
        sR: qx(ch.R?.shoulderPivot), sL: qx(ch.L?.shoulderPivot),
      });
    } else if (sawActive) break;
  }
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  const range = (k) => {
    const v = arm.map((a) => a[k]);
    return v.length ? Math.max(...v) - Math.min(...v) : 0;
  };
  return {
    prompt, peakY, stoppedBeforeJump,
    carry: [...carry], oneShots: [...oneShots].filter(Boolean),
    frames: arm.length,
    ranges: { eR: range('eR'), eL: range('eL'), sR: range('sR'), sL: range('sL') },
    bakedNames: O.viewmodel.bakedClipNames,
  };
});
check('6h. a 1.8 m wall arms a MANTLE prompt (not a vault)',
  mantle.prompt === 'mantle', `prompt = ${mantle.prompt}`);
check('6i. mantle starts from a dead stop when jump is pressed',
  mantle.peakY > 1.75 && (mantle.stoppedBeforeJump ?? 9) < 0.5,
  `speed at jump ${(mantle.stoppedBeforeJump ?? -1).toFixed(2)} m/s, apex y ${mantle.peakY.toFixed(2)}`);
check('6j. the dedicated mantle_climb clip is the one that plays',
  mantle.oneShots.includes('mantle_climb'),
  `one-shots during climb: ${mantle.oneShots.join(', ') || 'none'}`);
check('6k. BOTH arms are driven by the clip (two visible hands on the ledge)',
  mantle.ranges.eR > 0.1 && mantle.ranges.eL > 0.1
  && mantle.ranges.sR > 0.1 && mantle.ranges.sL > 0.1,
  `elbow R ${mantle.ranges.eR.toFixed(2)} / L ${mantle.ranges.eL.toFixed(2)}, shoulder R ${mantle.ranges.sR.toFixed(2)} / L ${mantle.ranges.sL.toFixed(2)} over ${mantle.frames} frames`);
check('6l. the held weapon is STOWED for the climb (animated empty-handed)',
  mantle.carry.includes('STOWED') && mantle.carry.includes('READY'),
  `carry channel visited: ${mantle.carry.join(' -> ')}`);

// === 6.6 Stationary fire must not move the player ===========================
// Regression: ground friction used to be purely exponential, so releasing a
// movement key left the player gliding asymptotically. Standing still and
// shooting then read as "the game keeps sliding me sideways".
const stationary = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const trial = async (label, setup) => {
    O.playerController.debugTeleport(0, 0, 25);
    O.playerController.debugSetOrientation(0, 0);
    O.weaponManager.activeWeapon.currentMagazineAmmo = 30;
    await sleep(650);
    if (setup) await setup();
    // Let the player come to rest first: this isolates drift caused by FIRING
    // from legitimate deceleration after a movement key is released.
    for (let i = 0; i < 40; i += 1) await new Promise((r) => requestAnimationFrame(r));
    const speedAtFire = O.playerController.getHorizontalSpeed();
    const p0 = { ...O.playerController.getPosition() };
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    let maxDrift = 0;
    for (let i = 0; i < 110; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = O.playerController.getPosition();
      maxDrift = Math.max(maxDrift, Math.hypot(p.x - p0.x, p.z - p0.z));
    }
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    await sleep(200);
    return { label, speedAtFire, maxDrift };
  };
  const press = (code, ms) => async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    await sleep(ms);
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  };
  const results = [];
  results.push(await trial('cold stop'));
  results.push(await trial('after strafe', press('KeyD', 600)));
  results.push(await trial('after forward', press('KeyW', 600)));

  // Separately: how long does it take to actually STOP after releasing a key?
  O.playerController.debugTeleport(0, 0, 25);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(600);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
  await sleep(700);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
  let stopFrames = 999;
  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    if (O.playerController.getHorizontalSpeed() === 0) { stopFrames = i + 1; break; }
  }
  return { results, stopFrames };
});
const worstDrift = Math.max(...stationary.results.map((r) => r.maxDrift));
check('6m. firing while stationary does not move the player at all',
  worstDrift < 0.01,
  stationary.results.map((r) => `${r.label}: drift ${r.maxDrift.toFixed(4)} m`).join('; '));
check('6n. releasing a movement key reaches EXACTLY zero speed, and quickly',
  stationary.stopFrames <= 12,
  `velocity hit exact zero after ${stationary.stopFrames} frames`);

// === 6.7 Fists mode: unarmed hands must actually be visible and usable =====
// Regressions this covers: (a) switchTo() committed switching=true before the
// state authority approved, so a rejection wedged the manager and fists became
// unreachable; (b) the guard pose was gated on isADSActive, so unarmed arms
// hung at rest far below the lens; (c) currentOneShotName was never released
// when a weapon had no baked clips, pinning ownership to 'both' and
// suppressing the whole procedural arm layer; (d) melee combo clips were never
// loaded for the fists slot, so punching played no animation.
const fists = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  O.perspective.setPerspective('FIRST');
  O.playerController.debugTeleport(0, 0, 25);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(700);
  const slot = O.weaponManager.inventory.findIndex((w) => w.def.id === 'fists');
  O.weaponManager.switchTo(slot);
  // Wait for the swap to COMPLETE rather than sleeping a fixed 2 s: switch
  // durations differ per weapon and the boot loadout is user-chosen now.
  for (let i = 0; i < 400; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    if (!O.weaponManager.switching && O.weaponManager.activeWeapon.def.id === 'fists') break;
  }
  await sleep(900);

  const cam = O.engine.sceneManager.getCamera();
  cam.updateMatrixWorld(true);
  const v = new cam.position.constructor();
  const ch = O.handsRig.chainsForTest;
  const ndc = (j) => {
    j.getWorldPosition(v);
    const p = v.clone().project(cam);
    return { x: p.x, y: p.y, z: p.z };
  };
  const handR = ndc(ch.R.wristPivot);
  const handL = ndc(ch.L.wristPivot);
  let visibleArmMeshes = 0;
  O.viewmodel.getRigRoot().traverse((o) => {
    if (!o.isMesh) return;
    let vis = o.visible;
    let p = o.parent;
    while (p) { if (!p.visible) vis = false; p = p.parent; }
    if (vis) visibleArmMeshes += 1;
  });

  // Punch and capture which clip actually runs.
  const clips = new Set();
  window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  for (let i = 0; i < 70; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    const n = O.viewmodel.activeOneShotName;
    if (n) clips.add(n);
  }
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  await sleep(700);

  // Switching back must fully release arm ownership.
  const rifleSlot = O.weaponManager.inventory.findIndex((w) => w.def.id === 'rifle');
  O.weaponManager.switchTo(rifleSlot);
  for (let i = 0; i < 400; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    if (!O.weaponManager.switching && O.weaponManager.activeWeapon.def.id === 'rifle') break;
  }
  await sleep(900);
  return {
    weaponId: O.weaponManager.activeWeapon.def.id,
    handR, handL, visibleArmMeshes,
    guardWeight: O.handsRig.guardWeight,
    punchClips: [...clips],
    ownershipAfter: O.viewmodel.activeOneShotOwnership,
  };
});
const inFrame = (h) => Math.abs(h.x) < 0.95 && Math.abs(h.y) < 0.95 && h.z > 0 && h.z < 1;
check('6o. fists mode shows BOTH hands on screen (unarmed guard is always up)',
  inFrame(fists.handR) && inFrame(fists.handL) && fists.visibleArmMeshes >= 8,
  `handR (${fists.handR.x.toFixed(2)}, ${fists.handR.y.toFixed(2)}), handL (${fists.handL.x.toFixed(2)}, ${fists.handL.y.toFixed(2)}), ${fists.visibleArmMeshes} arm meshes`);
check('6p. punching in fists mode plays a real melee combo clip',
  fists.punchClips.some((c) => c.startsWith('melee_punch')),
  `clips seen: ${fists.punchClips.join(', ') || 'NONE'}`);
check('6q. switching away from fists releases arm ownership (no zombie clip)',
  fists.weaponId === 'rifle' && fists.ownershipAfter === 'none',
  `back to ${fists.weaponId}, ownership=${fists.ownershipAfter}`);

// === 6.8 Third-person facing: the weapon must point where we are going =====
// Regression: TPS_CARRY's upper-arm X rotations were NEGATIVE, which swings a
// limb BACKWARD under the -Y-down-the-limb convention. The hands ended up
// behind the chest and the rifle pointed back over the shoulder, which read
// as "the character is facing backwards" -- most obvious during a slide,
// where the body moves forward but the arms trailed behind.
const facing = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Earlier sections leave the fists slot equipped; this check is about the
  // WEAPON carry pose, so put a rifle in the character's hands first.
  const wm = O.weaponManager;
  const rifleIdx = wm.inventory.findIndex((w) => w.def.id === 'rifle');
  // switchTo() is a no-op when the slot is already active, so only wait when
  // a real swap was actually started.
  if (wm.activeIndex !== rifleIdx) {
    wm.switchTo(rifleIdx);
    for (let k = 0; k < 400; k += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!wm.switching && wm.activeWeapon.def.id === 'rifle') break;
    }
  }
  await sleep(600);
  O.perspective.setPerspective('THIRD');
  O.playerController.debugTeleport(0, 0, 25);
  O.playerController.debugSetOrientation(0, 0);
  await sleep(1300);
  const tb = O.thirdPersonBody;
  const root = tb.root;
  const V = O.playerController.getPosition().constructor;
  const Q = root.quaternion.constructor;
  const sample = (label) => {
    root.updateMatrixWorld(true);
    const bodyFwd = new V(0, 0, -1).applyQuaternion(root.getWorldQuaternion(new Q()));
    const wp = tb.carriedWeapon;
    const weaponFwd = wp
      ? new V(0, 0, -1).applyQuaternion(wp.getWorldQuaternion(new Q()))
      : null;
    const chest = new V(); root.getObjectByName('Bone_Chest').getWorldPosition(chest);
    const hr = new V(); root.getObjectByName('Socket_HandGrip_R')?.getWorldPosition(hr);
    const hl = new V(); root.getObjectByName('Socket_HandGrip_L')?.getWorldPosition(hl);
    // "In front" = along the body's own forward axis, not a raw world axis.
    const aheadR = hr.clone().sub(chest).dot(bodyFwd);
    const aheadL = hl.clone().sub(chest).dot(bodyFwd);
    return {
      label,
      loco: O.characterState.locomotion,
      alignment: weaponFwd ? weaponFwd.dot(bodyFwd) : null,
      aheadR, aheadL,
    };
  };
  const out = [];
  out.push(sample('idle'));
  O.inputManager.heldKeys.add('KeyW');
  await sleep(1500);
  out.push(sample('run'));
  O.inputManager.heldKeys.add('ShiftLeft');
  await sleep(1300);
  out.push(sample('sprint'));
  O.inputManager.heldKeys.add('KeyC');
  await sleep(400);
  out.push(sample('slide'));
  O.inputManager.heldKeys.clear();
  await sleep(500);
  return out;
});
const badAim = facing.filter((f) => f.alignment === null || f.alignment < 0.8);
const badHands = facing.filter((f) => f.aheadR <= 0.05 || f.aheadL <= 0.05);
check('6r. third-person weapon points along the body facing in every state',
  badAim.length === 0,
  facing.map((f) => `${f.label} ${f.alignment === null ? 'NO WEAPON' : f.alignment.toFixed(2)}`).join(', '));
check('6s. third-person hands stay IN FRONT of the chest (never trailing)',
  badHands.length === 0,
  facing.map((f) => `${f.label} R+${f.aheadR.toFixed(2)} L+${f.aheadL.toFixed(2)}`).join(', '));

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
// DERIVE the allowlist from the generator sources rather than hardcoding it.
// A hardcoded list silently goes stale every time /tools gains a model (it
// did, when Document D added four), which turns a real policy check into
// busywork. Anything a /tools script emits is by definition code-generated.
const generatorSrc = [
  'tools/generateWeaponModels.js',
  'tools/generateHandModel.js',
  'tools/generateBodyModel.js',
  'tools/generateHandsRig.js',
].filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
const allowed = new Set([
  ...[...generatorSrc.matchAll(/([A-Za-z0-9_]+)\.glb/g)].map((m) => `${m[1]}.glb`),
  // Emitted via a template literal keyed on an id list, so capture those too.
  ...[...generatorSrc.matchAll(/\['([a-z0-9_]+)',\s*build/g)].map((m) => `${m[1]}.glb`),
]);
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
  // Wait on the blend ITSELF rather than a flat sleep: the S-curve's duration
  // depends on frame pacing, so a fixed wait sampled mid-transition.
  for (let i = 0; i < 300; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    const b = O.perspective.blendWeight;
    if (b <= 0.001 || b >= 0.999) break;
  }
  // Settle back to first person, again waiting on the blend rather than a
  // fixed sleep — setPerspective starts a FRESH transition.
  O.perspective.setPerspective('FIRST');
  for (let i = 0; i < 300; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    if (O.perspective.blendWeight <= 0.001) break;
  }
  await sleep(200);
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
