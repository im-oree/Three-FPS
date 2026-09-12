/**
 * acceptance-doc3.mjs — automated acceptance run for Document 3 (§15).
 * Drives the real combat layer in headless Chromium: synthetic pointer-lock
 * mouse events for look/fire/ADS, real key events for reload/slots/movement,
 * in-page EventBus recording with page-clock timestamps for payload/timing
 * assertions, and __OPERATOR__ seams for determinism.
 *
 * usage: node tools/verify/acceptance-doc3.mjs --url http://localhost:5173
 */
import { readFileSync } from 'node:fs';
import { launchBrowser } from './browser.mjs';

const urlArg = process.argv[process.argv.indexOf('--url') + 1];
if (!urlArg) { console.error('usage: acceptance-doc3.mjs --url <url>'); process.exit(2); }

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

// --- helpers ----------------------------------------------------------------
const ev = (name) => page.evaluate((n) => window.__ev.filter((e) => e.name === n), name);
const evCount = (name) => ev(name).then((l) => l.length);
const mark = () => page.evaluate(() => { window.__mark = performance.now(); });
const since = (name) => page.evaluate((n) => window.__ev.filter((e) => e.name === n && e.t >= window.__mark), name);
const aim = (x = 20, z = 25) => page.evaluate(([a, b]) => {
  const O = window.__OPERATOR__;
  O.playerController.debugTeleport(a, 0, b);
  O.playerController.debugSetOrientation(0, 0);
}, [x, z]);
const fireDown = (b = 0) => page.evaluate((btn) => window.dispatchEvent(new MouseEvent('mousedown', { button: btn, bubbles: true })), b);
const fireUp = (b = 0) => page.evaluate((btn) => window.dispatchEvent(new MouseEvent('mouseup', { button: btn, bubbles: true })), b);
const key = (code, down = true) => (down ? page.keyboard.down(code) : page.keyboard.up(code));
const tap = async (code) => { await page.keyboard.down(code); await sleep(45); await page.keyboard.up(code); };
const look = (dx, dy) => page.evaluate(([x, y]) => {
  window.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y, bubbles: true }));
}, [dx, dy]);
const weapon = () => page.evaluate(() => window.__OPERATOR__.weaponManager.activeWeapon.def.id);
const ammo = () => page.evaluate(() => {
  const w = window.__OPERATOR__.weaponManager.activeWeapon;
  return { mag: w.currentMagazineAmmo, reserve: w.currentReserveAmmo };
});
const pitchDeg = () => page.evaluate(() => window.__OPERATOR__.playerController.getPitch() * 57.29578);
const yawDeg = () => page.evaluate(() => window.__OPERATOR__.playerController.movement.state.yaw * 57.29578);
const fov = () => page.evaluate(() => window.__OPERATOR__.engine.sceneManager.getCamera().fov);
const clipName = () => page.evaluate(() => {
  const vm = window.__OPERATOR__.viewmodel;
  return vm.currentAction ? vm.currentAction.getClip().name : null;
});
const additiveWeight = () => page.evaluate(() => {
  const vm = window.__OPERATOR__.viewmodel;
  const action = vm.mixer._actions.find((a) => a.getClip().name === 'ads_additive_layer');
  return action ? action.getEffectiveWeight() : -1;
});
const drawCalls = () => page.evaluate(() => window.__OPERATOR__.drawCalls());
const refill = (slot = -1) => page.evaluate((s) => {
  const O = window.__OPERATOR__;
  const w = s >= 0 ? O.weaponManager.inventory[s] : O.weaponManager.activeWeapon;
  w.currentMagazineAmmo = w.def.magazineSize;
  w.currentReserveAmmo = w.def.maxReserveAmmo;
}, slot);
const record = (ms, interval, expr) => page.evaluate(({ ms, interval, expr }) => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const iv = setInterval(() => {
    // eslint-disable-next-line no-eval
    out.push(eval(expr));
    if (performance.now() - t0 >= ms) { clearInterval(iv); res(out); }
  }, interval);
}), { ms, interval, expr });

await page.goto(urlArg, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#game-canvas', { timeout: 15000 });
await sleep(2500);
// Record every Doc-3 event with page-clock timestamps.
await page.evaluate(() => {
  window.__ev = [];
  const names = ['weapon:fired', 'weapon:ammoChanged', 'weapon:reloadStart', 'weapon:reloadComplete',
    'weapon:adsStart', 'weapon:adsStop', 'weapon:switchStart', 'weapon:switchComplete',
    'weapon:emptyFire', 'weapon:viewmodelEquipped', 'combat:hit', 'combat:shotFired', 'combat:tracer'];
  for (const n of names) window.__OPERATOR__.eventBus.on(n, (p) => window.__ev.push({ t: performance.now(), name: n, p }));
});
// PERF MODE (see acceptance-doc2): lift the sim clock near real time.
await page.evaluate(() => {
  const r = window.__OPERATOR__.engine.renderer.getRenderer();
  r.shadowMap.enabled = false;
  r.setPixelRatio(0.5);
});
await page.mouse.click(400, 225); // pointer lock (phantom look jerk re-aimed away below)
await sleep(400);
check('boots clean, pointer lock acquired', errors.length === 0 && await page.evaluate(() => !!document.pointerLockElement), errors.slice(0, 2).join(' | '));

// --- 1. loadout: three weapons, slots, wheel, switch blocking ---------------
const clipsPerWeapon = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const seen = {};
  for (let i = 0; i < O.weaponManager.inventory.length; i += 1) {
    const def = O.weaponManager.inventory[i].def;
    await O.viewmodel.equip(def);
    seen[def.id] = O.viewmodel.clips.map((c) => c.name);
  }
  await O.viewmodel.equip(O.weaponManager.activeWeapon.def);
  return seen;
});
const CLIPS = ['idle', 'walk', 'walk_back', 'strafe_left', 'strafe_right', 'sprint', 'jump_start', 'jump_loop', 'jump_land', 'slide', 'crouch_idle', 'crouch_walk', 'fire', 'ads_fire', 'reload_tactical', 'reload_empty', 'switch_out', 'switch_in', 'inspect'];
const allClips = Object.values(clipsPerWeapon).every((names) => CLIPS.every((c) => names.includes(c)));
check('all 3 weapons load with the exact 19-clip contract', Object.keys(clipsPerWeapon).length === 3 && allClips, Object.keys(clipsPerWeapon).join(','));
check('weapons are distinct assets (modelPath + muzzle socket)', await page.evaluate(() => {
  const defs = window.__OPERATOR__.weaponManager.inventory.map((w) => w.def);
  return new Set(defs.map((d) => d.modelPath)).size === 3 && defs.every((d) => d.muzzleSocketName === 'muzzle');
}));

await aim(); await sleep(250);
await mark();
await tap('Digit2');
await sleep(1200);
let sw = await since('weapon:switchStart');
let sc = await since('weapon:switchComplete');
check('Digit2 switches to pistol with switchStart/switchComplete payloads', sw.length === 1 && sc.length === 1
  && sw[0].p.fromWeaponId === 'assault_rifle' && sw[0].p.toWeaponId === 'pistol' && sc[0].p.weaponId === 'pistol'
  && Math.abs(sw[0].p.duration - 0.8) < 1e-6, sw[0] && JSON.stringify(sw[0].p));
const switchMs = sc.length && sw.length ? sc[0].t - sw[0].t : 0;
check('switch timeline ≈ out+in durations (0.8s)', switchMs > 600 && switchMs < 1400, `${Math.round(switchMs)}ms`);
check('active weapon is pistol after slot switch', (await weapon()) === 'pistol');

// fire blocked during switch
await mark();
await fireDown(0);
await tap('Digit1');
await sleep(900);
await fireUp(0);
const firedDuringSwitch = await page.evaluate(() => {
  const starts = window.__ev.filter((e) => e.name === 'weapon:switchStart' && e.t >= window.__mark);
  const comps = window.__ev.filter((e) => e.name === 'weapon:switchComplete' && e.t >= window.__mark);
  if (!starts.length || !comps.length) return -1;
  return window.__ev.filter((e) => e.name === 'weapon:fired' && e.t >= starts[0].t && e.t <= comps[0].t).length;
});
check('fire is blocked for the whole switch window', firedDuringSwitch === 0, `fired=${firedDuringSwitch}`);
check('back on assault_rifle via Digit1', (await weapon()) === 'assault_rifle');

await mark();
await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })));
await sleep(1100);
check('mouse wheel cycles inventory (AR→pistol)', (await weapon()) === 'pistol');
await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })));
await sleep(1100);
check('wheel reaches the SMG (third inventory entry)', (await weapon()) === 'smg');
await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })));
await sleep(1100);
check('wheel wraps back to assault_rifle', (await weapon()) === 'assault_rifle');

// --- 2. fire chain: muzzle flash, tracer→hit point, impact variants ---------
await aim(); await sleep(300);
await page.evaluate(() => {
  window.__flashSamples = 0;
  window.__flashIv = setInterval(() => {
    const socket = window.__OPERATOR__.viewmodel.getMuzzleSocket();
    if (socket && socket.children.length > 0) window.__flashSamples += 1;
  }, 16);
});
await mark();
await fireDown(0); await sleep(140); await fireUp(0);
await sleep(500);
const flashSamples = await page.evaluate(() => { clearInterval(window.__flashIv); return window.__flashSamples; });
check('muzzle flash appears at the true muzzle socket, 2-4 frame life', flashSamples >= 1 && flashSamples <= 6, `${flashSamples} samples @16ms`);
const hits = await since('combat:hit');
const tracers = await since('combat:tracer');
const shots = await since('combat:shotFired');
check('combat:shotFired per confirmed shot with {weaponId,hit}', shots.length > 0 && shots.every((s) => typeof s.p.weaponId === 'string' && typeof s.p.hit === 'boolean'), `${shots.length} shots`);
check('tracer endpoint equals hit point (muzzle→impact)', tracers.length > 0 && hits.length > 0
  && Math.abs(tracers[0].p.to[0] - hits[0].p.point.x) < 0.01 && Math.abs(tracers[0].p.to[2] - hits[0].p.point.z) < 0.01);
check('combat:hit payload complete {point,normal,distance,damage,surfaceType,isKill}', hits.length > 0
  && ['x', 'y', 'z'].every((k) => typeof hits[0].p.point[k] === 'number')
  && typeof hits[0].p.distance === 'number' && typeof hits[0].p.damage === 'number'
  && typeof hits[0].p.surfaceType === 'string' && hits[0].p.isKill === false);
let dummySeen = hits.some((h) => h.p.surfaceType === 'dummy');
if (!dummySeen) {
  // deterministic fallback: one ADS single-shot (pistol) at the 5 m dummy
  await page.evaluate(() => window.__OPERATOR__.weaponManager.switchTo(1));
  await sleep(1100);
  await aim(); await sleep(200);
  await fireDown(2); await sleep(400);
  await mark();
  await fireDown(0); await sleep(70); await fireUp(0);
  await sleep(300);
  await fireUp(2);
  dummySeen = (await since('combat:hit')).some((h) => h.p.surfaceType === 'dummy');
  await page.evaluate(() => window.__OPERATOR__.weaponManager.switchTo(0));
  await sleep(1100);
}
check('dummy impacts report surfaceType dummy', dummySeen);
// off-axis burst into a boundary wall for the generic variant
await page.evaluate(() => window.__OPERATOR__.playerController.debugSetOrientation(0.6, 0));
await sleep(200);
await mark();
await fireDown(0); await sleep(200); await fireUp(0);
await sleep(400);
const wallHits = await since('combat:hit');
check('wall impacts report surfaceType generic', wallHits.some((h) => h.p.surfaceType === 'generic'), wallHits[0] && wallHits[0].p.surfaceType);

// --- 3. pooling: draw calls flat under sustained fire -----------------------
await aim(); await sleep(250);
const before = await drawCalls();
await fireDown(0);
const during = await record(2500, 250, 'window.__OPERATOR__.drawCalls()');
await fireUp(0);
await sleep(400);
const after = await drawCalls();
const worldSeries = during.map((d) => d.world);
const vmSeries = during.map((d) => d.viewmodel);
const half = Math.floor(worldSeries.length / 2);
const firstAvg = worldSeries.slice(0, half).reduce((a, b) => a + b, 0) / half;
const secondAvg = worldSeries.slice(half).reduce((a, b) => a + b, 0) / (worldSeries.length - half);
check('sustained fire: pooled effects (bounded steady state, back to baseline)',
  secondAvg - firstAvg <= 3 && after.world <= before.world + 3 && Math.max(...vmSeries) - Math.min(...vmSeries) <= 1,
  `idle ${before.world}, firing ${firstAvg.toFixed(0)}→${secondAvg.toFixed(0)}, after ${after.world}, vm ${vmSeries[0]}`);
check('viewmodel second pass renders every frame (anti-clip pass alive)', before.viewmodel >= 1 && after.viewmodel >= 1);

// --- 4. camera-center rays: hip scatter vs ADS pinpoint; damage falloff -----
const spreadNums = await page.evaluate(() => {
  const w = window.__OPERATOR__.weaponManager.activeWeapon;
  return { hip: w.getCurrentSpreadAngle('WALK', false, false), ads: w.getCurrentSpreadAngle('WALK', true, false) };
});
check('ADS spread numerically tighter than hip spread', spreadNums.ads < spreadNums.hip, `hip ${spreadNums.hip}° ads ${spreadNums.ads}°`);
// ADS pinpoint at a TRUE 25 m: unregister the nearer 5 m dummy so the ray
// cannot hit it first (three's raycaster ignores visible=false). Pistol
// (semi) guarantees exactly one round per press — an auto tap can span two
// sim frames headless, and the second round legitimately carries the first
// round's recoil kick.
await page.evaluate(() => window.__OPERATOR__.weaponManager.switchTo(1));
await sleep(1100);
await refill();
await page.evaluate(() => {
  const O = window.__OPERATOR__;
  const near = O.arena.dummies.find((d) => d.label === 'dummy_5m');
  O.ballistics.unregisterHittable(near);
  window.__nearDummy = near;
});
await aim(); await sleep(200);
await mark();
for (let i = 0; i < 6; i += 1) {
  await aim(); await sleep(150); // isolate the per-shot cone (no climb carry-over)
  await fireDown(2); await sleep(350);
  await fireDown(0); await sleep(70); await fireUp(0);
  await sleep(250);
  await fireUp(2); await sleep(300);
}
const adsHits = await since('combat:hit');
const adsDummy = adsHits.filter((h) => h.p.surfaceType === 'dummy');
const clusterX = adsDummy.map((h) => h.p.point.x);
const spread = clusterX.length > 1 ? Math.max(...clusterX) - Math.min(...clusterX) : 0;
check('ADS fire at 25 m is near-pinpoint (tight cluster on dummy)', adsHits.length >= 4 && adsDummy.length / adsHits.length >= 0.75 && spread < 0.6, `${adsDummy.length}/${adsHits.length} dummy, x-spread ${spread.toFixed(2)}m`);
const dmg25 = adsDummy.length ? adsDummy[0].p.damage : 0;
await page.evaluate(() => {
  const O = window.__OPERATOR__;
  const near = window.__nearDummy;
  O.ballistics.registerHittable(near, { surfaceType: 'dummy', takeDamage: (a) => near.takeDamage(a) });
  O.weaponManager.switchTo(0);
});
await sleep(1100);
// hip scatter while strafing: mix of outcomes + spatial scatter
await refill();
await aim(); await sleep(200);
await key('KeyD');
await mark();
await fireDown(0); await sleep(900); await fireUp(0);
await key('KeyD', false);
const hipHits = await since('combat:hit');
const hipShots = await since('combat:shotFired');
const ys = hipHits.map((h) => h.p.point.y);
const scatter = ys.length > 1 ? Math.max(...ys) - Math.min(...ys) : 0;
check('hip fire while strafing scatters (spread cone from camera center)', hipShots.length >= 4 && (scatter > 0.15 || hipHits.length < hipShots.length), `scatter ${scatter.toFixed(2)}m, ${hipHits.length}/${hipShots.length} hit`);
// damage falloff ladder 5 / 25 / 50 m (ADS taps, other dummies hidden so the
// ray cannot hit a nearer dummy first)
const dmgAt = async (standZ, targetLabel) => {
  await page.evaluate(() => window.__OPERATOR__.weaponManager.switchTo(1));
  await sleep(1100);
  await page.evaluate((label) => {
    const O = window.__OPERATOR__;
    const target = O.arena.dummies.find((d) => d.label === label);
    // Re-register the target FIRST (idempotent): earlier ladder steps may
    // have unregistered it, and unregisterHittable is the only removal path.
    O.ballistics.registerHittable(target, { surfaceType: 'dummy', takeDamage: (a) => target.takeDamage(a) });
    O.arena.dummies.forEach((d) => {
      if (d.label !== label) O.ballistics.unregisterHittable(d);
    });
  }, targetLabel);
  await refill();
  await mark();
  // Probe-proven recipe: re-aim AND re-engage ADS per tap (single pistol
  // round per press), so no recoil carry-over or ADS-state drift can bias
  // the measurement at long range.
  for (let i = 0; i < 8; i += 1) {
    await aim(20, standZ); await sleep(150);
    await fireDown(2); await sleep(350);
    await fireDown(0); await sleep(70); await fireUp(0);
    await sleep(250);
    await fireUp(2); await sleep(300);
  }
  const h = await since('combat:hit');
  const shotsF = await since('combat:shotFired');
  const d = h.filter((x) => x.p.surfaceType === 'dummy');
  const diag = { shots: shotsF.length, hits: h.length, surfaces: h.map((x) => x.p.surfaceType) };
  await page.evaluate(() => window.__OPERATOR__.weaponManager.switchTo(0));
  await sleep(1100);
  return d.length
    ? { dmg: d[0].p.damage, hits: d.length, of: h.length, diag }
    : { dmg: null, hits: 0, of: h.length, diag };
};
const dmg5r = await dmgAt(25, 'dummy_5m');
const dmg50r = await dmgAt(25, 'dummy_50m');
const dmg5 = dmg5r.dmg;
const dmg50 = dmg50r.dmg;
await page.evaluate(() => {
  const O = window.__OPERATOR__;
  O.arena.dummies.forEach((d) => O.ballistics.registerHittable(d, {
    surfaceType: 'dummy',
    takeDamage: (amount) => d.takeDamage(amount),
  }));
});
check('damage falls off with distance (5m > 25m > 50m)', dmg5 !== null && dmg25 > 0 && dmg50 !== null && dmg5 > dmg25 && dmg25 > dmg50, `5m ${dmg5} (${dmg5r.hits}/${dmg5r.of} shots ${dmg5r.diag.shots}) / 25m ${dmg25.toFixed(1)} / 50m ${dmg50} (${dmg50r.hits}/${dmg50r.of} shots ${dmg50r.diag.shots} ${dmg50r.diag.surfaces.join(',')})`);

// --- 5. recoil: distinct patterns, climb, spring-back -----------------------
await page.evaluate(() => window.__OPERATOR__.weaponManager.switchTo(0));
await sleep(1200);
const recoilRun = async (id, holdMs) => {
  await aim(); await sleep(250);
  const p0 = await pitchDeg(); const y0 = await yawDeg();
  const trace = await record(holdMs + 900, 40, `window.__OPERATOR__.playerController.getPitch() * 57.29578`);
  return { p0, y0, trace, holdMs };
};
const fireHold = async (ms) => { await fireDown(0); await sleep(ms); await fireUp(0); };
const climbOf = async (id, holdMs) => {
  await refill();
  await aim(); await sleep(250);
  const p0 = await pitchDeg();
  await fireDown(0);
  const series = await record(holdMs, 40, 'window.__OPERATOR__.playerController.getPitch() * 57.29578');
  await fireUp(0);
  const climb = Math.max(...series) - p0;
  await sleep(1200);
  const pEnd = await pitchDeg();
  return { climb, settle: Math.abs(pEnd - p0) };
};
const ar = await climbOf('assault_rifle', 800);
check('AR recoil climbs during sustained fire and springs back', ar.climb > 2 && ar.settle < 0.8, `climb ${ar.climb.toFixed(1)}°, settle ${ar.settle.toFixed(2)}°`);
await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })));
await sleep(1100);
const pistol = await climbOf('pistol', 800); // semi: one shot per hold
await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })));
await sleep(1100);
const smg = await climbOf('smg', 800);
check('recoil patterns meaningfully distinct per weapon', Math.abs(ar.climb - smg.climb) > 0.8 && pistol.climb < smg.climb, `AR ${ar.climb.toFixed(1)}° / pistol ${pistol.climb.toFixed(1)}° / SMG ${smg.climb.toFixed(1)}°`);
await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })));
await sleep(1100);

// --- 6. ADS: FOV blend, coexistence with sprint, move slow, no pop ----------
await aim(); await sleep(250);
await page.evaluate(() => {
  window.__fovSeries = [];
  const sample = () => {
    window.__fovSeries.push(window.__OPERATOR__.engine.sceneManager.getCamera().fov);
    if (window.__fovSeries.length < 90) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
await sleep(500); // capture a settled baseline before pressing ADS
await fireDown(2);
await sleep(1100);
const fovSeries = await page.evaluate(() => window.__fovSeries);
const fovAds = await fov();
await fireUp(2);
const maxJump = Math.max(...fovSeries.slice(1).map((v, i) => Math.abs(v - fovSeries[i])));
const adsFovTarget = await page.evaluate(() => window.__OPERATOR__.weaponManager.inventory[0].def.adsZoomFOV);
const fovMax = Math.max(...fovSeries);
const fovMin = Math.min(...fovSeries);
const totalDelta = fovMax - fovMin;
const intermediate = fovSeries.filter((v) => v > fovMin + 1 && v < fovMax - 1).length;
// Smooth exponential blend: several intermediate samples, and no single
// sample covering most of the distance (that would be a snap/pop).
check('ADS FOV zooms smoothly to adsZoomFOV (no pop)', Math.abs(fovAds - adsFovTarget) < 1.5 && maxJump < 0.6 * totalDelta && intermediate >= 2, `fov ${fovAds.toFixed(1)}→${adsFovTarget}, max step ${maxJump.toFixed(1)}, mids ${intermediate}`);
await sleep(400);
// coexistence: ADS modifier clears, sprint modifier takes over without snap
await key('ShiftLeft'); await key('KeyW');
await sleep(700);
const fovSprint = await fov();
await fireDown(2); await sleep(150); await fireUp(2); // ADS refused while sprinting
const fovStillSprint = await fov();
await key('KeyW', false); await key('ShiftLeft', false);
await sleep(600);
check('ADS + sprint FOV modifiers coexist (sprint wins while sprinting, ADS refused)', fovSprint > 90 && Math.abs(fovStillSprint - fovSprint) < 3, `sprint fov ${fovSprint.toFixed(1)}`);
// ADS slows movement
await aim(); await sleep(200);
await key('KeyW'); await sleep(600);
const walkSpeed = await page.evaluate(() => window.__OPERATOR__.playerController.getHorizontalSpeed());
await fireDown(2); await sleep(500);
const adsSpeed = await page.evaluate(() => window.__OPERATOR__.playerController.getHorizontalSpeed());
await fireUp(2); await key('KeyW', false);
check('ADS slows movement by def.adsMoveSpeedMultiplier', adsSpeed < walkSpeed * 0.85, `walk ${walkSpeed.toFixed(2)} → ads ${adsSpeed.toFixed(2)}`);

// --- 7. reload: tactical vs empty, mid-reload ammo, cancel ------------------
await page.evaluate(() => window.__OPERATOR__.weaponManager.switchTo(0));
await sleep(1200);
await refill();
await aim(); await sleep(200);
let a = await ammo();
await fireDown(0); await sleep(300); await fireUp(0); await sleep(200);
await mark();
await tap('KeyR');
await sleep(300);
let rs = await since('weapon:reloadStart');
check('tactical reload starts with {weaponId,isTactical:true,duration}', rs.length === 1 && rs[0].p.isTactical === true && Math.abs(rs[0].p.duration - 2.1) < 1e-6, JSON.stringify(rs[0] && rs[0].p));
const midSamples = await record(1800, 150, 'window.__OPERATOR__.weaponManager.activeWeapon.currentMagazineAmmo');
await sleep(700);
let rc = await since('weapon:reloadComplete');
check('reload completes at authored duration and refills', rc.length === 1 && (await ammo()).mag === 30, `complete=${rc.length}`);
const midPoint = midSamples.findIndex((m) => m === 30);
check('ammo inserts mid-reload (~65%), not at press or end', midPoint > 0 && midPoint < midSamples.length - 1, `idx ${midPoint}/${midSamples.length}`);
// empty reload
await page.evaluate(() => { window.__OPERATOR__.weaponManager.activeWeapon.currentMagazineAmmo = 0; });
await mark();
await tap('KeyR');
await sleep(300);
rs = await since('weapon:reloadStart');
check('empty magazine triggers reload_empty variant (isTactical:false, 2.6s)', rs.length === 1 && rs[0].p.isTactical === false && Math.abs(rs[0].p.duration - 2.6) < 1e-6, JSON.stringify(rs[0] && rs[0].p));
await sleep(3000);
check('empty reload completes to full mag', (await ammo()).mag === 30);
// cancel via switch: no ammo granted, no complete event
await refill();
await sleep(400); // let any prior reload finish first
await fireDown(0); await sleep(400); await fireUp(0); await sleep(200);
const magBeforeCancel = (await ammo()).mag;
await mark();
await tap('KeyR');
await sleep(400); // ~19% of 2.1s — before the 65% insert
await tap('Digit2');
await sleep(1100);
rc = await since('weapon:reloadComplete');
const magAfterCancel = await page.evaluate(() => window.__OPERATOR__.weaponManager.inventory[0].currentMagazineAmmo);
check('reload canceled by switch: no ammo grant, no completion event', rc.length === 0 && magAfterCancel === magBeforeCancel, `mag ${magBeforeCancel}→${magAfterCancel}, completes=${rc.length}`);
await tap('Digit1'); await sleep(1100);
// empty fire (dry click hook)
await page.evaluate(() => { window.__OPERATOR__.weaponManager.activeWeapon.currentMagazineAmmo = 0; });
await mark();
await fireDown(0); await sleep(120); await fireUp(0);
await sleep(300);
const ef = await since('weapon:emptyFire');
check('empty magazine fire emits weapon:emptyFire {weaponId}', ef.length >= 1 && ef[0].p.weaponId === 'assault_rifle', JSON.stringify(ef[0] && ef[0].p));
await tap('KeyR'); await sleep(3100);

// --- 8. animation: every Doc-2 state × all weapons, additive ADS ------------
const stateClips = {};
for (const w of [0, 1, 2]) {
  await page.evaluate((slot) => window.__OPERATOR__.weaponManager.switchTo(slot), w);
  await sleep(1100);
  const id = await weapon();
  const got = {};
  await aim(); await sleep(300);
  got.IDLE = await clipName();
  await key('KeyW'); await sleep(500); got.WALK = await clipName();
  await key('ShiftLeft'); await sleep(600); got.SPRINT = await clipName();
  await key('ShiftLeft', false); await key('KeyW', false); await sleep(300);
  await key('ControlLeft'); await sleep(500); got.CROUCH = await clipName();
  await key('ControlLeft', false); await sleep(300);
  await key('KeyW'); await key('ShiftLeft'); await sleep(500);
  await key('ControlLeft'); await sleep(300); got.SLIDE = await clipName();
  await key('ControlLeft', false); await key('ShiftLeft', false); await key('KeyW', false); await sleep(400);
  await tap('Space'); await sleep(180); got.JUMP = await clipName();
  await sleep(900);
  stateClips[id] = got;
}
const expect = { IDLE: ['idle'], WALK: ['walk'], SPRINT: ['sprint'], CROUCH: ['crouch_idle'], SLIDE: ['slide'], JUMP: ['jump_start', 'jump_loop'] };
const animOk = Object.values(stateClips).length === 3 && Object.values(stateClips).every((got) => Object.entries(expect).every(([k, cs]) => cs.includes(got[k])));
check('movement states resolve to correct clips for all 3 weapons', animOk, JSON.stringify(stateClips));
// crossfade overlap: two weighted actions during a transition
await aim(); await sleep(400);
await key('KeyW');
const overlap = await record(700, 30, `(() => { const vm = window.__OPERATOR__.viewmodel; return vm.mixer._actions.filter((a) => a.isRunning() && a.getEffectiveWeight() > 0.05).length; })()`);
await key('KeyW', false);
check('locomotion changes crossfade (two weighted actions mid-blend)', Math.max(...overlap) >= 2, `peak ${Math.max(...overlap)}`);
// additive ADS layer over walk
await key('KeyW'); await sleep(400);
await fireDown(2); await sleep(600);
const addW = await additiveWeight();
const baseClipWhileADS = await clipName();
await fireUp(2); await key('KeyW', false);
check('ADS engages additive layer on top of locomotion base clip', addW > 0.5 && baseClipWhileADS === 'walk', `weight ${addW.toFixed(2)}, base ${baseClipWhileADS}`);
// fire/reload/switch one-shots: record the clip transition sequence in-page
await page.evaluate(() => window.__OPERATOR__.weaponManager.switchTo(0));
await sleep(1200);
await refill();
await sleep(600); // let the empty-reload restore fully complete
await aim(); await sleep(300);
await page.evaluate(() => {
  window.__clips = [];
  window.__clipIv = setInterval(() => {
    const vm = window.__OPERATOR__.viewmodel;
    const n = vm.currentAction ? vm.currentAction.getClip().name : null;
    if (n !== (window.__clips.length ? window.__clips[window.__clips.length - 1].n : undefined)) {
      window.__clips.push({ n, t: performance.now() });
    }
  }, 25);
});
await fireDown(0); await sleep(120); await fireUp(0);
await sleep(500);
await tap('KeyR');
await sleep(2400);
await tap('Digit2');
await sleep(1200);
const clipSeq = await page.evaluate(() => { clearInterval(window.__clipIv); return window.__clips.map((c) => c.n); });
const idx = (name) => clipSeq.indexOf(name);
check('weapon-action one-shots play in order (fire→reload_tactical→switch_out→switch_in)',
  idx('fire') >= 0 && idx('reload_tactical') > idx('fire') && idx('switch_out') > idx('reload_tactical') && idx('switch_in') > idx('switch_out'),
  clipSeq.join('→'));
await tap('Digit1'); await sleep(1100);

// --- 9. sway: present at hip, reduced in ADS --------------------------------
await aim(); await sleep(400);
const flick = async () => { for (let i = 0; i < 6; i += 1) { await look(30, 0); await sleep(16); } };
await flick();
const hipPeak = await page.evaluate(() => new Promise((res) => {
  let peak = 0; let n = 0;
  const iv = setInterval(() => {
    peak = Math.max(peak, Math.abs(window.__OPERATOR__.sway.offsets.rotY));
    if (++n > 25) { clearInterval(iv); res(peak); }
  }, 16);
}));
await fireDown(2); await sleep(500);
await flick();
const adsPeak = await page.evaluate(() => new Promise((res) => {
  let peak = 0; let n = 0;
  const iv = setInterval(() => {
    peak = Math.max(peak, Math.abs(window.__OPERATOR__.sway.offsets.rotY));
    if (++n > 25) { clearInterval(iv); res(peak); }
  }, 16);
}));
await fireUp(2);
check('weapon sway present at hip and reduced under ADS (×0.25)', hipPeak > 0.002 && adsPeak < hipPeak * 0.6, `hip ${hipPeak.toFixed(4)} ads ${adsPeak.toFixed(4)}`);
const breath = await page.evaluate(() => new Promise((res) => {
  const s = []; let n = 0;
  const iv = setInterval(() => { s.push(window.__OPERATOR__.sway.offsets.posY); if (++n > 60) { clearInterval(iv); res(Math.max(...s) - Math.min(...s)); } }, 30);
}));
check('idle breathing drift present while stationary', breath > 0.0004, `pp ${breath.toFixed(4)}`);

// --- 10. event payload contract (TEMP logging verified above + keys) --------
const payloadOk = await page.evaluate(() => {
  const need = {
    'weapon:fired': ['weaponId', 'remainingMagazineAmmo'],
    'weapon:ammoChanged': ['weaponId', 'magazineAmmo', 'reserveAmmo'],
    'weapon:reloadStart': ['weaponId', 'isTactical', 'duration'],
    'weapon:reloadComplete': ['weaponId'],
    'weapon:adsStart': ['weaponId'],
    'weapon:adsStop': ['weaponId'],
    'weapon:switchStart': ['fromWeaponId', 'toWeaponId', 'duration'],
    'weapon:switchComplete': ['weaponId'],
    'weapon:emptyFire': ['weaponId'],
    'combat:shotFired': ['weaponId', 'hit'],
  };
  return Object.entries(need).map(([name, keys]) => {
    const e = window.__ev.find((x) => x.name === name);
    return { name, ok: !!e && keys.every((k) => k in e.p) };
  });
});
check('every §7/§11.3 event fired with its exact payload keys', payloadOk.every((p) => p.ok), payloadOk.filter((p) => !p.ok).map((p) => p.name).join(','));
check('TEMP payload logging present in console for all events', ['weapon:fired', 'combat:hit', 'weapon:switchStart', 'weapon:reloadStart'].every((n) => logs.some((l) => l.includes(`[TEMP-PROOF] ${n}`))));

// --- 11. registerHittable genericity (runtime proof) ------------------------
const generic = await page.evaluate(async () => {
  const O = window.__OPERATOR__;
  const proto = Object.getPrototypeOf(O.arena.scene);
  const box = new proto.constructor();
  box.name = 'probe_ai_box';
  box.position.set(20, 1.5, 22); // 3 m in front of the firing spot
  const geoProto = O.arena.scene.children.find((c) => c.isMesh).geometry;
  const mesh = new (O.arena.scene.children.find((c) => c.isMesh).constructor)(geoProto, new (O.arena.scene.children.find((c) => c.isMesh).material.constructor)());
  mesh.scale.set(0.6, 0.6, 0.02);
  box.add(mesh);
  O.arena.scene.add(box);
  O.ballistics.registerHittable(box, { surfaceType: 'future_ai_hitbox', takeDamage: () => { window.__aiHit = (window.__aiHit || 0) + 1; } });
  return true;
});
await aim(); await sleep(250);
await mark();
await fireDown(0); await sleep(120); await fireUp(0);
await sleep(400);
const genericHit = await since('combat:hit');
check('registerHittable accepts arbitrary Object3D + metadata (zero changes)', generic && genericHit.some((h) => h.p.surfaceType === 'future_ai_hitbox') && await page.evaluate(() => window.__aiHit > 0), genericHit[0] && genericHit[0].p.surfaceType);
await page.evaluate(() => {
  const O = window.__OPERATOR__;
  const box = O.arena.scene.getObjectByName('probe_ai_box');
  if (box) { O.ballistics.unregisterHittable(box); O.arena.scene.remove(box); }
});
await mark();
await fireDown(0); await sleep(120); await fireUp(0);
await sleep(400);
const afterUnreg = (await since('combat:hit')).filter((h) => h.p.surfaceType === 'future_ai_hitbox');
check('unregisterHittable removes the target', afterUnreg.length === 0);

// --- 12. tunables live in Constants / definitions ---------------------------
// RecoilPatterns.ts is deliberately excluded: it IS the pure-data tuning
// table (§10.1), same category as /definitions.
const BEHAVIOR_FILES = ['WeaponManager', 'BallisticsSystem', 'RecoilSystem', 'WeaponSway', 'WeaponViewmodel', 'WeaponBase', 'FireModeSystem', 'ReloadSystem', 'MuzzleFlashEffect', 'ImpactEffect', 'TracerEffect'].map((f) => `src/weapons/${f}.ts`)
  .concat(['src/animation/AnimationStateMachine.ts', 'src/animation/AnimationBlender.ts']);
const FORBIDDEN = /\b(700|950|0\.65|0\.12|2\.1|2\.6|1\.9|2\.4|0\.35|0\.45|55|1\.1|2\.2|0\.9)\b/;
const offenders = [];
for (const f of BEHAVIOR_FILES) {
  const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  const body = src.split('*/').pop(); // ignore header comments
  if (FORBIDDEN.test(body)) offenders.push(f);
}
check('all Doc-3 tunables live in Constants/definitions (static scan)', offenders.length === 0, offenders.join(','));

await page.screenshot({ path: new URL('./out/doc3-combat.png', import.meta.url).pathname });
const failed = results.filter((r) => !r.ok);
console.log(`\nACCEPTANCE DOC3: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('failed:', failed.map((f) => f.name).join(' | '));
await browser.close();
process.exit(failed.length ? 1 : 0);
