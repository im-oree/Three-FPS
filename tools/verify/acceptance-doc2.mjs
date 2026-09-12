/**
 * acceptance-doc2.mjs — automated acceptance run for Document 2 (§14).
 * Drives the real game in headless Chromium: real keyboard events, synthetic
 * pointer-lock mouse events (CDP moves carry no movementX/Y while locked —
 * headless limitation; the game listener is trust-agnostic), an in-page
 * recorder for FPS-independent timing, and TEST-ONLY seams on
 * PlayerController (debugTeleport / debugSetStamina) for determinism.
 *
 * usage: node tools/verify/acceptance-doc2.mjs --url http://localhost:5173
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const urlArg = process.argv[process.argv.indexOf('--url') + 1];
if (!urlArg) { console.error('usage: acceptance-doc2.mjs --url <url>'); process.exit(2); }
const outDir = path.join(here, 'out');
mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ width: 800, height: 450 });
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// --- helpers ------------------------------------------------------------------
const state = () => page.evaluate(() => window.__OPERATOR__.playerController.getState());
const speed = () => page.evaluate(() => window.__OPERATOR__.playerController.getHorizontalSpeed());
const pos = () => page.evaluate(() => { const p = window.__OPERATOR__.playerController.getPosition(); return { x: p.x, y: p.y, z: p.z }; });
const fov = () => page.evaluate(() => window.__OPERATOR__.engine.sceneManager.getCamera().fov);
const height = () => page.evaluate(() => window.__OPERATOR__.playerController.getCapsuleHeight());
const teleport = (x, y, z) => page.evaluate(([a, b, c]) => window.__OPERATOR__.playerController.debugTeleport(a, b, c), [x, y, z]);
const refillStamina = () => page.evaluate(() => window.__OPERATOR__.playerController.debugSetStamina(1));
const resetOrientation = () => page.evaluate(() => window.__OPERATOR__.playerController.debugSetOrientation(0, 0));
// Drop render scale so the sim clock runs near-real-time during timing-critical
// phases (SwiftShader is fill-rate bound; the sim itself is unaffected).
const setRenderScale = (r) => page.evaluate((x) => window.__OPERATOR__.engine.renderer.getRenderer().setPixelRatio(x), r);
const waitSprinting = () => page.waitForFunction(() => {
  const pc = window.__OPERATOR__.playerController;
  return pc.getState() === 'SPRINT' && pc.getHorizontalSpeed() > 7;
}, { timeout: 8000, polling: 50 });
const staminaVal = () => page.evaluate(() => window.__OPERATOR__.playerController.getStaminaValue());
const footstepCount = () => logs.filter((l) => l.includes('[TEMP-PROOF] player:footstep')).length;
const landedEvents = () => logs.filter((l) => l.includes('[TEMP-PROOF] player:landed'))
  .map((l) => Number(JSON.parse(l.slice(l.indexOf('{'))).impactVelocity));
/** Sample an in-page expression on the page's own clock — immune to render FPS. */
const record = (ms, interval, expr) => page.evaluate(({ ms, interval, expr }) => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const iv = setInterval(() => {
    // eslint-disable-next-line no-eval
    out.push(eval(expr));
    if (performance.now() - t0 >= ms) { clearInterval(iv); res(out); }
  }, interval);
}), { ms, interval, expr });
const PC = 'window.__OPERATOR__.playerController';
const look = (dx, dy) => page.evaluate(([x, y]) => {
  document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y, bubbles: true }));
}, [dx, dy]);
const upAll = async () => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ControlLeft', 'Space']) await page.keyboard.up(k); };

await page.goto(urlArg, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#game-canvas', { timeout: 15000 });
await sleep(2000);
check('boots clean (no console/page errors)', errors.length === 0, errors.slice(0, 2).join(' | '));

// PERF MODE for deterministic timing: SwiftShader is fill- and shadow-bound;
// ~10 fps frames (0.1-0.25 s) make sub-second mechanics unresolvable. Shadows
// off + half res lifts the sim clock near real time. Restored before the final
// screenshot (visual quality is Document 1's acceptance concern, not Doc 2's).
await page.evaluate(() => {
  const r = window.__OPERATOR__.engine.renderer.getRenderer();
  r.shadowMap.enabled = false;
  r.setPixelRatio(0.5);
});
await sleep(600);

// --- 1. pointer lock + mouse look + pitch clamp + sensitivity baseline --------
await page.mouse.click(400, 225);
await sleep(600);
const locked = await page.evaluate(() => document.pointerLockElement?.id === 'game-canvas');
check('click acquires pointer lock', locked);

const yaw0 = await page.evaluate(() => window.__OPERATOR__.playerController.getYaw());
for (let i = 0; i < 5; i += 1) { await look(30, 0); await sleep(60); }
await sleep(400);
const lookDeltaDefault = Math.abs((await page.evaluate(() => window.__OPERATOR__.playerController.getYaw())) - yaw0);
check('mouse movement rotates yaw', lookDeltaDefault > 0.01, `dyaw=${lookDeltaDefault.toFixed(3)}`);

for (let i = 0; i < 26; i += 1) { await look(0, -40); await sleep(25); }
await sleep(400);
const pitchInfo = await page.evaluate(() => ({ p: window.__OPERATOR__.playerController.getPitch(), limit: (89 * Math.PI) / 180 }));
check('pitch clamps at ±89° (no flip)', Math.abs(pitchInfo.p) <= pitchInfo.limit + 1e-6 && Math.abs(pitchInfo.p) > pitchInfo.limit - 0.01, `pitch=${pitchInfo.p.toFixed(4)} limit=${pitchInfo.limit.toFixed(4)}`);
await resetOrientation(); // look tests leave yaw/pitch dirty; movement phases need straight -Z

// --- 2. weighted acceleration / friction deceleration --------------------------
// Velocity snapping jumps 0 -> 5.4 within one fixed-step burst and NEVER shows
// an intermediate value; weighted acceleration passes through the middle band.
// A single frame stretched to ~0.25 s (headless rAF hitches) can cross the band
// in one step too, so the accel observation retries up to 3 times.
let ramp = null;
for (let attempt = 0; attempt < 3; attempt += 1) {
  await upAll();
  await teleport(0, 0, 22); await refillStamina(); await sleep(400);
  await page.keyboard.down('KeyW');
  const accelSamples = await record(1200, 20, `({ t: performance.now(), v: ${PC}.getHorizontalSpeed(), z: ${PC}.getPosition().z })`);
  await page.keyboard.up('KeyW');
  const vs = accelSamples.map((x) => x.v);
  ramp = {
    firstMoving: vs.find((v) => v > 0) ?? 99,
    hasIntermediate: vs.some((v) => v > 0.5 && v < 5.2),
    late: vs.slice(-3),
  };
  if ((ramp.hasIntermediate || ramp.firstMoving <= 5.0) && ramp.late.every((v) => v > 4.5 && v < 6.0)) break;
}
check('WASD accelerates smoothly (ramp, not snap)',
  (ramp.hasIntermediate || ramp.firstMoving <= 5.0) && ramp.late.every((v) => v > 4.5 && v < 6.0),
  `firstMovingV=${ramp.firstMoving.toFixed(2)} intermediate=${ramp.hasIntermediate} late=${ramp.late.map((v) => v.toFixed(1))}`);
const decelSamples = await record(1400, 25, `${PC}.getHorizontalSpeed()`);
check('friction decelerates to stop on release', decelSamples[decelSamples.length - 1] < 0.6, `final=${decelSamples[decelSamples.length - 1].toFixed(2)}`);

// --- 3. sprint conditions, FOV modifier, footstep cadence -----------------------
await teleport(6, 0, 26); await refillStamina(); await sleep(300);
// Cadence is measured from event timestamps (continuous) instead of integer
// step counts (quantization noise swamps the ~1.14x stride-ratio signal).
await page.evaluate(() => {
  window.__fsTimes = [];
  window.__OPERATOR__.eventBus.on('player:footstep', () => window.__fsTimes.push(performance.now()));
});
await page.keyboard.down('KeyW');
await sleep(400);
await page.evaluate(() => { window.__fsTimes.length = 0; });
const fsWalk0 = footstepCount();
const walkSamples = await record(3200, 100, `${PC}.getHorizontalSpeed()`);
const walkSteps = footstepCount() - fsWalk0;
const walkTimes = await page.evaluate(() => window.__fsTimes.slice());
await page.evaluate(() => { window.__fsTimes.length = 0; });
await refillStamina();
await page.keyboard.down('ShiftLeft');
await sleep(300);
const sprintSamples = await record(1500, 100, `${PC}.getState() === 'SPRINT' ? ${PC}.getHorizontalSpeed() : -1`);
const fovSamples = await record(800, 100, `window.__OPERATOR__.engine.sceneManager.getCamera().fov`);
const sprintFovNow = Math.max(...fovSamples);
await upAll(); await sleep(200);
await teleport(6, 0, 26); await refillStamina();
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await waitSprinting();
await page.evaluate(() => {
  const pc = window.__OPERATOR__.playerController;
  setTimeout(() => pc.debugSetStamina(1), 1400);
  setTimeout(() => pc.debugSetStamina(1), 2800);
});
await page.evaluate(() => { window.__fsTimes.length = 0; }); // exclude accel/pause gaps
const fsSprint0 = footstepCount();
const sprintSteps = await record(3600, 1000, 'null').then(() => footstepCount() - fsSprint0);
const sprintTimes = await page.evaluate(() => window.__fsTimes.slice());
const walkSpeed = Math.max(...walkSamples);
const sprintSpeed = Math.max(...sprintSamples);
check('sprint engages with Shift+W (grounded, forward, stamina)', sprintSpeed > walkSpeed * 1.25 && sprintSpeed > 7, `walk=${walkSpeed.toFixed(1)} sprint=${sprintSpeed.toFixed(1)}`);
check('sprint applies FOV modifier smoothly', sprintFovNow > 93 && sprintFovNow < 104, `fov=${sprintFovNow.toFixed(1)}`);
const meanGap = (ts) => {
  const d = ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g > 0 && g < 1200);
  return d.reduce((a, b) => a + b, 0) / Math.max(d.length, 1);
};
const walkGap = meanGap(walkTimes);
const sprintGap = meanGap(sprintTimes);
check('footstep cadence scales with speed', walkTimes.length >= 5 && sprintTimes.length >= 5 && walkGap / sprintGap > 1.06,
  `walkGap=${walkGap.toFixed(0)}ms sprintGap=${sprintGap.toFixed(0)}ms ratio=${(walkGap / sprintGap).toFixed(3)} (counts ${walkSteps}/${sprintSteps})`);

// --- 3b. head-bob cadence: gait-locked, no high-frequency view vibration --------
await upAll(); await sleep(200);
await teleport(-4.5, 0, 26); await refillStamina(); await resetOrientation(); // lane clear of slab, pillars, crates AND the step platform
await setRenderScale(0.3); await sleep(400); // raise render fps so the ~5 Hz bob is resolvable
await page.keyboard.down('KeyW');
await sleep(700);
const walkBob = await record(2500, 20, `({ t: performance.now(), y: window.__OPERATOR__.engine.sceneManager.getCamera().position.y })`);
await page.keyboard.down('ShiftLeft');
await sleep(900);
const sprintBob = await record(2500, 20, `({ t: performance.now(), y: window.__OPERATOR__.engine.sceneManager.getCamera().position.y })`);
await upAll();
await setRenderScale(0.5);
const bobStats = (samples) => {
  const ys = samples.map((s2) => s2.y);
  const span = (samples[samples.length - 1].t - samples[0].t) / 1000;
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const d = ys.map((y) => y - mean);
  const pp = Math.max(...ys) - Math.min(...ys);
  // Hysteresis: render-frame stair-stepping makes the sampled sine chatter
  // around the mean line; only count transitions that leave a +-25% band.
  const hyst = pp * 0.25;
  let state = 0;
  let crossings = 0;
  for (const v of d) {
    if (state <= 0 && v > hyst) { state = 1; crossings += 1; }
    else if (state >= 0 && v < -hyst) { state = -1; crossings += 1; }
  }
  return { hz: crossings / 2 / span, pp };
};
const walkBobStats = bobStats(walkBob);
const sprintBobStats = bobStats(sprintBob);
// Gait cadence: vertical bob = 2 bumps/step -> ~4.9 Hz walk / ~5.6 Hz sprint.
// The old rad-per-metre tuning vibrated at 16-32 Hz; anything above ~9 Hz here
// means the bob has decoupled from footfall cadence again.
check('head bob oscillates at gait cadence (no view vibration)',
  walkBobStats.hz > 2.5 && walkBobStats.hz < 9 && sprintBobStats.hz > 2.5 && sprintBobStats.hz < 9
  && walkBobStats.pp < 0.16 && sprintBobStats.pp < 0.2,
  `walk=${walkBobStats.hz.toFixed(1)}Hz pp=${walkBobStats.pp.toFixed(3)}m sprint=${sprintBobStats.hz.toFixed(1)}Hz pp=${sprintBobStats.pp.toFixed(3)}m`);

// --- 3c. render-side interpolation: the camera must never eat raw 60 Hz fixed-step
// snapshots — that staircase is the "fast slight vibration" seen on 120-144 Hz
// displays while a gait is active. Proof: the interpolation alpha sweeps (0,1).
await upAll(); await sleep(200);
await teleport(-4.5, 0, 26); await refillStamina(); await resetOrientation();
await page.keyboard.down('KeyW'); await sleep(500);
const alphas = await record(800, 25, `${PC}.getInterpolationAlpha()`);
await upAll();
const aMin = Math.min(...alphas);
const aMax = Math.max(...alphas);
check('camera render state interpolated between fixed steps (no 60Hz staircase)',
  alphas.length > 8 && aMin < 0.4 && aMax > 0.6,
  `alpha ${aMin.toFixed(2)}..${aMax.toFixed(2)} over ${alphas.length} samples`);

// --- 4. slide: trigger from sprint, boost cap, ease-out decay, expiry -----------
await upAll(); await sleep(200);
await teleport(6, 0, 26); await refillStamina(); await sleep(300);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await waitSprinting();
const sprintSpeedNow = await speed();
const recSlide = record(1800, 25, `({ s: ${PC}.getState(), v: ${PC}.getHorizontalSpeed(), sl: ${PC}.isSliding(), h: ${PC}.getCapsuleHeight() })`);
await page.keyboard.down('ControlLeft'); // record first, then press: captures the boost instant
const slideSamples = await recSlide;
await page.keyboard.up('ControlLeft');
const slid = slideSamples.filter((x) => x.s === 'SLIDE');
const peakSlide = Math.max(...slid.map((x) => x.v));
const tailSlide = slid.length ? slid[slid.length - 1].v : -1;
const afterSlide = slideSamples[slideSamples.length - 1].s;
check('slide triggers from SPRINT with capped boost', slid.length > 3 && peakSlide > sprintSpeedNow * 1.06 && peakSlide <= 11.6, `peak=${peakSlide.toFixed(1)} (sprint was ${sprintSpeedNow.toFixed(1)}, boost cap 11.5)`);
check('slide decays (ease-out) then exits', peakSlide - tailSlide > 3 && afterSlide !== 'SLIDE', `peak=${peakSlide.toFixed(1)} tail=${tailSlide.toFixed(1)} endState=${afterSlide}`);
const minSlideH = Math.min(...slid.map((x) => x.h));
await page.keyboard.up('ControlLeft');
await sleep(600);
const postSlideH = await height();
check('slide lowers capsule to SLIDE_HEIGHT, restores after', minSlideH < 1.05 && postSlideH > 1.7, `minH during slide=${minSlideH.toFixed(2)} (SLIDE_HEIGHT 0.95) after=${postSlideH.toFixed(2)}`);
await upAll(); await sleep(300);

// --- 5. slide from IDLE is a no-op (runtime + pure function) --------------------
await teleport(0, 0, 18); await refillStamina(); await sleep(400);
await page.keyboard.down('ControlLeft'); await sleep(300);
const idleCtrlState = await state();
await page.keyboard.up('ControlLeft');
check('crouch from IDLE never slides', idleCtrlState === 'CROUCH_IDLE', idleCtrlState);
const pureResolve = await page.evaluate(() => {
  const r = window.__OPERATOR__.resolveNextState;
  const input = { hasMoveInput: true, sprintHeld: false, sprintEligible: false, crouchHeld: true, crouchPressedThisFrame: true, jumpPressedThisFrame: false };
  const physics = { isGrounded: true, justLanded: false, horizontalSpeed: 4, verticalVelocity: 0, timeInState: 1, slideActive: false, coyoteActive: false };
  return { fromIdle: r('IDLE', input, physics), fromSprint: r('SPRINT', input, physics) };
});
check('resolveNextState: SLIDE legal only from SPRINT', pureResolve.fromIdle !== 'SLIDE' && pureResolve.fromSprint === 'SLIDE', JSON.stringify(pureResolve));

// --- 6. slide cooldown blocks immediate re-slide --------------------------------
await teleport(0, 0, 24); await refillStamina(); await sleep(300);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await waitSprinting();
await sleep(400);
await page.keyboard.down('ControlLeft');
const firstSlide = await record(900, 25, `${PC}.getState()`);
await page.keyboard.up('ControlLeft');
await sleep(120);
await page.keyboard.down('ControlLeft');
const retry = await record(500, 25, `({ s: ${PC}.getState(), v: ${PC}.getHorizontalSpeed() })`);
await page.keyboard.up('ControlLeft');
check('slide cooldown blocks immediate re-slide (no boost)', firstSlide.includes('SLIDE') && !retry.some((x) => x.v > sprintSpeed * 1.05), `first=${[...new Set(firstSlide)].join(',')} retryMaxV=${Math.max(...retry.map((x) => x.v)).toFixed(1)} sprint=${sprintSpeed.toFixed(1)}`);

// --- 7. slide-hop: jump cancels slide and carries momentum ----------------------
await upAll(); await sleep(200);
await teleport(0, 0, 24); await refillStamina(); await sleep(300); // open lane for the hop
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await waitSprinting();
await sleep(400);
await page.keyboard.down('ControlLeft');
await page.waitForFunction(() => window.__OPERATOR__.playerController.isSliding(), { timeout: 3000, polling: 25 });
const hopPreState = await state();
const recHop = record(1400, 25, `({ s: ${PC}.getState(), v: ${PC}.getHorizontalSpeed(), vy: ${PC}.getVelocityY() })`);
await page.keyboard.press('Space'); // record first, then press: captures the impulse
const hop = await recHop;
await upAll();
const hopAir = hop.filter((x) => x.s === 'JUMP' || x.s === 'AIR');
check('slide-hop: jump cancels slide, carries momentum', hopPreState === 'SLIDE' && hopAir.length > 2 && Math.max(...hopAir.map((x) => x.v)) > 3 && Math.max(...hopAir.map((x) => x.vy)) > 1, `pre=${hopPreState} airV=${Math.max(...hopAir.map((x) => x.v)).toFixed(1)} airVy=${Math.max(...hopAir.map((x) => x.vy)).toFixed(1)}`);
await sleep(1400);

// --- 8. jump height from sqrt(2gh), coyote time, double-jump denial -------------
await teleport(0, 0, 18); await sleep(700);
const y0 = (await pos()).y;
await page.keyboard.press('Space');
const jumpY = await record(900, 20, `${PC}.getPosition().y`);
const measured = Math.max(...jumpY) - y0;
check('jump apex matches DESIRED_JUMP_HEIGHT (1.15 m)', Math.abs(measured - 1.15) < 0.15, `measured=${measured.toFixed(2)}m`);
await sleep(900); // land
const coyoteRun = await page.evaluate(() => new Promise((res) => {
  const pc = window.__OPERATOR__.playerController;
  pc.debugTeleport(4.5, 0.4, -6); // top of the 0.4 m step platform (x 4..8, z -8..-4)
  pc.debugSetOrientation(0, 0);
  let jumped = false;
  const orig = pc.update.bind(pc);
  pc.update = (dt) => {
    orig(dt);
    // Dispatch the jump SYNCHRONOUSLY on the first ungrounded step — the coyote
    // window (0.1 s) is shorter than throttled timer granularity at low fps.
    if (!jumped && !pc.isGrounded()) {
      jumped = true;
      pc.update = orig;
      // Defer past the engine's endFrame() deferred-release latch: a tap
      // dispatched INSIDE update() would be cleared before the next update
      // could observe the pressed edge (real taps arrive between frames).
      setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      }, 0);
    }
  };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' })); // walk off the +x edge
  const samples = []; const t0 = performance.now();
  const iv = setInterval(() => {
    samples.push({ vy: pc.getVelocityY(), g: pc.isGrounded(), s: pc.getState(), t: performance.now() - t0 });
    if (performance.now() - t0 >= 2500) {
      clearInterval(iv);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
      res({ samples, jumped });
    }
  }, 20);
}));
const coyote = coyoteRun.samples;
const airIdx = coyote.findIndex((x) => !x.g);
const afterPress = coyote.slice(airIdx + 1, airIdx + 40);
const coyoteJumped = afterPress.some((x) => x.vy > 2);
check('coyote time allows edge jump', coyoteRun.jumped && airIdx >= 0 && coyoteJumped, `airborne@${airIdx >= 0 ? coyote[airIdx].t.toFixed(0) : '?'}ms vyAfter=${Math.max(...afterPress.map((x) => x.vy)).toFixed(1)}`);
await sleep(1600);
await teleport(0, 0, 18); await sleep(600);
await page.keyboard.press('Space');
await sleep(350); // past apex
await page.keyboard.press('Space'); // second press mid-air must be ignored
const vyAfter = await record(400, 25, `${PC}.getVelocityY()`);
check('no double jump (second press ignored airborne)', Math.max(...vyAfter) < 0.5, `maxVy=${Math.max(...vyAfter).toFixed(2)}`);
await sleep(1000);

// --- 9. crouch tunnel: enter low, headroom refuses stand-up, auto-stand ---------
await teleport(0, 0, 10); await sleep(400);
await page.keyboard.down('ControlLeft');
await sleep(600);
const crouchH = await height();
await page.keyboard.down('KeyW');
// Position gates instead of wall-clock waits: sim speed varies with render fps.
await page.waitForFunction(() => window.__OPERATOR__.playerController.getPosition().z < 6.2, { timeout: 10000, polling: 50 });
const inTunnel = await pos();
const inTunnelH = await height();
await page.keyboard.up('KeyW');
await sleep(800); // friction stops the player still under the slab (z ~5.9)
await page.keyboard.up('ControlLeft'); // attempt to stand with NO headroom
const refused = await record(1200, 50, `${PC}.getCapsuleHeight()`);
const underZ = (await pos()).z;
await page.keyboard.down('KeyW');
await page.waitForFunction(() => window.__OPERATOR__.playerController.getPosition().z < 3.2, { timeout: 10000, polling: 50 });
await sleep(800); // stand-up lerp completes once headroom clears
const outPos = await pos();
const outH = await height();
await upAll();
check('crouch lowers capsule', crouchH < 1.3, `h=${crouchH.toFixed(2)}`);
check('crouch-walk enters low tunnel', inTunnel.z < 8 && inTunnel.z > 3 && inTunnelH < 1.3, `z=${inTunnel.z.toFixed(1)} h=${inTunnelH.toFixed(2)}`);
check('stand-up refused under low obstacle (headroom raycastUp)', underZ > 4 && Math.max(...refused) < 1.35, `z=${underZ.toFixed(1)} maxH under slab=${Math.max(...refused).toFixed(2)}`);
check('auto stand-up once headroom clears', outPos.z < 4 && outH > 1.7, `z=${outPos.z.toFixed(1)} h=${outH.toFixed(2)}`);

// --- 9b. walls: no clipping through, no falling through the floor ----------------
await teleport(0, 0, -20); await sleep(300);
await page.keyboard.down('KeyW');
await page.waitForFunction(() => window.__OPERATOR__.playerController.getPosition().z < -29, { timeout: 8000, polling: 50 });
await sleep(1200); // keep driving into the wall for over a second
const wallPos = await pos();
const wallSamples = await record(800, 50, `({ y: ${PC}.getPosition().y, z: ${PC}.getPosition().z })`);
await upAll();
check('walls block movement (no clip-through, no fall-through floor)',
  wallPos.z >= -29.8 && wallPos.z <= -29.0 && wallSamples.every((x) => x.y >= -0.001 && x.y <= 0.001 && x.z >= -29.8),
  `z=${wallPos.z.toFixed(2)} (inner wall face -30, capsule stop -29.65) y=${wallPos.y.toFixed(3)}`);

// --- 10. stairs: repeated step-up, then hard landing event -----------------------
await teleport(11, 0, -2); await sleep(400);
const landedBefore = landedEvents();
await page.keyboard.down('KeyD');
const climb = await record(5000, 50, `({ x: ${PC}.getPosition().x, y: ${PC}.getPosition().y, g: ${PC}.isGrounded(), s: ${PC}.getState(), d: window.__OPERATOR__.inputManager.isActionDown('moveRight') })`);
await page.keyboard.up('KeyD');
await sleep(800);
const landedAfter = landedEvents();
const newImpacts = landedAfter.slice(landedBefore.length);
const maxY = Math.max(...climb.map((x) => x.y));
const finalY = climb[climb.length - 1].y;
if (maxY <= 1.5) {
  let last = null;
  for (const c of climb) { const k = `${c.y.toFixed(1)}|${c.g}|${c.d}`; if (k !== last) { console.log('  CLIMB', JSON.stringify(c)); last = k; } }
}
check('step-up snaps over each 0.4 m stair step', maxY > 1.5, `maxY=${maxY.toFixed(2)}`);
check('hard fall emits player:landed above threshold', finalY < 0.1 && newImpacts.some((v) => v > 9), `impacts=${newImpacts.map((v) => v.toFixed(1)).join(',')} finalY=${finalY.toFixed(2)}`);

// --- 11. stamina: drains, gates sprint, regen delay -------------------------------
await teleport(0, 0, 22); await refillStamina(); await sleep(300);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
const drain = await record(7500, 100, `({ t: performance.now(), sta: ${PC}.getStaminaValue(), s: ${PC}.getState() })`);
await upAll();
const zeroSamples = drain.filter((x) => x.sta <= 0.0001);
// Boundary tolerance: value hitting 0 exits SPRINT on the NEXT state resolve
// (one fixed step later), and holding Shift through regen can cause a single
// brief re-sprint blip as the value crosses back above 0.
const sprintAtZero = zeroSamples.slice(2).filter((x) => x.s === 'SPRINT').length;
const gated = zeroSamples.length > 2 && sprintAtZero <= 2;
check('stamina drains and gates sprint at zero', gated, `minSta=${Math.min(...drain.map((x) => x.sta)).toFixed(2)} sprintSamplesAt0=${sprintAtZero}/${Math.max(zeroSamples.length - 2, 0)}`);
// Delay proof, cleanly measured: drain a second time, release all keys the
// instant stamina hits zero (no Shift-held re-sprint flapping), then time the
// gap until regen becomes visible. Expect REGEN_DELAY_SECONDS (1.1) + ~0.15 s
// of regen to cross 0.03; wall-clock bounds tolerate the MAX_DELTA clamp.
await refillStamina(); await sleep(300);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await page.waitForFunction(() => window.__OPERATOR__.playerController.getStaminaValue() <= 0.0001, { timeout: 10000, polling: 50 });
await upAll();
const zeroWall = await page.evaluate(() => performance.now());
const regen = await record(3000, 100, `({ t: performance.now(), sta: ${PC}.getStaminaValue() })`);
const firstRegen = regen.find((x) => x.sta > 0.03);
const regenGap = firstRegen ? firstRegen.t - zeroWall : Infinity;
const regenFinal = regen[regen.length - 1].sta;
check('stamina regens after delay (not before)',
  firstRegen !== undefined && regenGap >= 700 && regenGap <= 3000 && regenFinal > 0.25,
  `zero->regen(0.03)=${regenGap === Infinity ? 'never' : `${regenGap.toFixed(0)}ms`} (REGEN_DELAY 1100ms) final=${regenFinal.toFixed(2)}`);

// --- 12. F3 debug overlay live stamina line ----------------------------------------
await page.keyboard.press('F3');
await sleep(400);
const overlay = await page.evaluate(() => document.getElementById('debug-overlay')?.textContent ?? '');
await page.keyboard.press('F3');
check('F3 overlay shows live stamina line', /STA\s+0\.\d\d/.test(overlay), overlay.replace(/\n/g, ' / ').slice(0, 90));

// --- 13. mouse sensitivity from SettingsStore survives reload ------------------------
await page.evaluate(() => localStorage.setItem('operator-fps-settings-v1', JSON.stringify({ mouseSensitivity: 0.006, invertY: true })));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#game-canvas', { timeout: 15000 });
await sleep(1600);
await page.mouse.click(400, 225);
await sleep(500);
const pA = await page.evaluate(() => window.__OPERATOR__.playerController.getPitch());
for (let i = 0; i < 5; i += 1) { await look(0, -40); await sleep(60); } // mouse UP
await sleep(400);
const pB = await page.evaluate(() => window.__OPERATOR__.playerController.getPitch());
check('invert-Y read from SettingsStore across reload', pB - pA < -0.05, `mouse-up pitch delta=${(pB - pA).toFixed(3)} (non-inverted baseline was positive)`);
const yA = await page.evaluate(() => window.__OPERATOR__.playerController.getYaw());
for (let i = 0; i < 5; i += 1) { await look(30, 0); await sleep(60); }
await sleep(400);
const ratio = Math.abs((await page.evaluate(() => window.__OPERATOR__.playerController.getYaw())) - yA) / Math.max(lookDeltaDefault, 1e-6);
check('mouse sensitivity read from SettingsStore across reload', ratio > 2.0 && ratio < 4.0, `ratio=${ratio.toFixed(2)} (expected ~2.86)`);

// Frame a representative arena view for the screenshot (look tests leave the
// camera pitched down; orientation/position are sim state, safe to reset).
await teleport(9, 0.0, 16); await resetOrientation(); await sleep(500);
await page.evaluate(() => {
  const r = window.__OPERATOR__.engine.renderer.getRenderer();
  r.shadowMap.enabled = true;
  r.setPixelRatio(1);
});
await sleep(1200);
await page.screenshot({ path: path.join(outDir, 'doc2-arena.png') });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nACCEPTANCE DOC2: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILURES:', failed.map((f) => f.name).join('; ')); process.exit(1); }
console.log('screenshot:', path.join(outDir, 'doc2-arena.png'));
