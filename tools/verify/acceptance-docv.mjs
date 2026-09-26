#!/usr/bin/env node
/**
 * acceptance-docv.mjs — Document V (vehicles) acceptance verification.
 *
 *   node tools/verify/acceptance-docv.mjs --url http://localhost:5174
 *
 * Loads the prototype map and drives the vehicle system for real: enters a
 * Humvee, holds the throttle, measures that it accelerates and that the
 * suspension carries it, steers and measures that the heading changes, brakes
 * and measures that it stops, then gets out and checks the player is on solid
 * ground.
 *
 * These are ENGINE-STATE assertions, not screenshot diffs. A screenshot
 * cannot tell you whether the car actually moved 40 m or whether the camera
 * merely drifted, and "the player did not end up inside a wall" is a
 * raycast, not a picture. Screenshots are captured too, but as evidence for a
 * human, not as the pass condition.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, collectDiagnostics } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const args = {
  url: 'http://localhost:5174',
  shots: 'tools/verify/shots/docv',
};
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
  if (process.argv[i] === '--shots') args.shots = process.argv[++i];
}
fs.mkdirSync(args.shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * The prototype level's index in LEVELS. Resolved from the live array rather
 * than hard-coded so appending a level cannot silently break this harness.
 */
async function prototypeIndex(page) {
  // The level cards are rendered from LEVELS in order, so matching the card
  // titles is the most robust way to find the prototype's index without
  // exporting the array just for the harness.
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.level-card')];
    if (cards.length) {
      const i = cards.findIndex((c) => /prototype/i.test(c.textContent ?? ''));
      if (i >= 0) return i;
    }
    return -1;
  });
}

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const diagnostics = collectDiagnostics(page);

try {
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // __OPERATOR__ is published during boot; the level list cannot be read
  // until it exists.
  await page.waitForFunction(() => Boolean(window.__OPERATOR__), { timeout: 180000 });

  // The prototype map is appended last, so its card is the last one. Resolve
  // by id where possible and fall back to the known position.
  let index = await prototypeIndex(page);
  if (index < 0) index = 5;

  await enterMatch(page, { levelIndex: index, timeout: 180000 });
  await sleep(2500);

  const levelId = await page.evaluate(
    () => window.__OPERATOR__.levelLoader.current?.id,
  );
  check('prototype level loaded', levelId === 'prototype', `id=${levelId}`);

  // --- 1. World content ---------------------------------------------------
  const world = await page.evaluate(() => {
    const scene = window.__OPERATOR__.levelLoader.scene;
    let meshes = 0; let tris = 0;
    const named = [];
    scene.traverse((o) => {
      if (o.name && /^(Runway|Terrain|Water_Surface|Apron|ControlTower|Helipad_0|DrivingPad|HubPad)$/.test(o.name)) {
        named.push(o.name);
      }
      if (!o.isMesh) return;
      meshes += 1;
      const g = o.geometry;
      if (g?.attributes?.position) {
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
    });
    return { meshes, tris: Math.round(tris), named };
  });
  check(
    'shell geometry present (runway, terrain, water, tower, pads)',
    world.named.length >= 6,
    `found ${world.named.sort().join(', ')}`,
  );
  check('map is not blank', world.meshes > 80, `${world.meshes} meshes, ${world.tris} tris`);

  // --- 2. Teleport pads ---------------------------------------------------
  const pads = await page.evaluate(() => window.__OPERATOR__.teleportPads.padCount);
  check('teleport pads bound from the shell', pads === 6, `${pads} pads`);

  // --- 3. Vehicles spawned ------------------------------------------------
  const fleet = await page.evaluate(() => {
    const vs = window.__OPERATOR__.vehicleSystem;
    return vs.all.map((v) => ({
      id: v.id,
      type: v.definition.id,
      seats: v.seats.length,
      y: Number(v.root.position.y.toFixed(3)),
      grounded: v.state.grounded,
    }));
  });
  // Assert the fleet's COMPOSITION, not a magic count: adding a vehicle to the
  // prototype map is a normal, expected change and must not fail this suite,
  // whereas a missing type genuinely is a regression.
  const types = fleet.map((f) => f.type);
  const haveCars = types.filter((t) => t.startsWith('military_car')).length;
  check(
    'vehicles spawned',
    fleet.length >= 3 && haveCars >= 3,
    JSON.stringify(types),
  );
  check(
    'four-seat car has four seats',
    fleet.some((f) => f.type === 'military_car' && f.seats === 4),
    `seats=${fleet.find((f) => f.type === 'military_car')?.seats}`,
  );
  check(
    'gunner variant has five seats',
    fleet.some((f) => f.type === 'military_car_gunner' && f.seats === 5),
    `seats=${fleet.find((f) => f.type === 'military_car_gunner')?.seats}`,
  );

  // Suspension must settle the vehicle onto the ground, not leave it hovering
  // at its spawn height or sunk through the floor.
  const settled = await page.evaluate(() => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    return {
      y: Number(v.root.position.y.toFixed(3)),
      grounded: v.state.grounded,
      wheels: v.land.wheels.map((w) => Number(w.length.toFixed(3))),
      contacts: v.land.wheels.filter((w) => w.grounded).length,
    };
  });
  check(
    'suspension settles the vehicle on the ground',
    settled.grounded && settled.contacts === 4 && settled.y > 0.1 && settled.y < 2.0,
    `y=${settled.y} contacts=${settled.contacts}/4 lengths=[${settled.wheels}]`,
  );

  await page.screenshot({ path: path.join(args.shots, '01-hub-vehicles.png') });

  // --- 4. Enter prompt ----------------------------------------------------
  // Walk the player to the driver's door and confirm the prompt appears.
  const promptState = await page.evaluate(async () => {
    const O = window.__OPERATOR__;
    const v = O.vehicleSystem.all[0];
    const door = v.root.getObjectByName('Socket_Door_Driver');
    door.updateWorldMatrix(true, false);
    const m = door.matrixWorld.elements;
    // Stand NEXT to the door at the vehicle's own ground height. An earlier
    // version subtracted 1 m from the door's world Y to "get to foot level"
    // and teleported the player under the map; debugTeleport snaps down to
    // the floor, so passing the vehicle's Y is both correct and simpler.
    O.playerController.debugTeleport(m[12] - 1.2, v.root.position.y, m[14]);
    await new Promise((r) => setTimeout(r, 500));
    const el = document.getElementById('vehicle-prompt');
    return {
      text: el?.textContent ?? '',
      opacity: el?.style.opacity ?? '0',
      playerY: Number(O.playerController.getPosition().y.toFixed(2)),
    };
  });
  check(
    'enter prompt appears at the door',
    promptState.opacity === '1' && /ENTER AS DRIVER/.test(promptState.text),
    `opacity=${promptState.opacity} text="${promptState.text.trim()}" `
      + `playerY=${promptState.playerY}`,
  );
  await page.screenshot({ path: path.join(args.shots, '02-enter-prompt.png') });

  // --- 5. Enter the vehicle ------------------------------------------------
  const entered = await page.evaluate(async () => {
    const O = window.__OPERATOR__;
    const vs = O.vehicleSystem;
    const v = vs.all[0];
    const seat = v.definition.seats[0];
    const ok = vs.enterVehicle(v, seat);
    await new Promise((r) => setTimeout(r, 500));
    return {
      ok,
      riding: vs.isRiding,
      seat: vs.currentSeat?.id,
      suspended: O.playerController.isVehicleSuspended,
      hudVisible: document.querySelector('canvas[style*="right: 24px"], canvas[style*="right:24px"]')?.style.opacity,
    };
  });
  check('player enters the driver seat', entered.ok && entered.riding && entered.seat === 'driver',
    `riding=${entered.riding} seat=${entered.seat}`);
  check('on-foot controller is suspended while riding', entered.suspended === true,
    `suspended=${entered.suspended}`);
  check('vehicle HUD shown on entry', entered.hudVisible === '1', `opacity=${entered.hudVisible}`);

  // --- 12b. Weapon HUD yields to the vehicle HUD ---------------------------
  //
  // The ammo block is drawn in the same corner as the vehicle speed/gear
  // readout, and the crosshair belongs to a gun the driver is not holding.
  const hudSwap = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'missing';
      return getComputedStyle(el).display === 'none' ? 'hidden' : 'shown';
    };
    return {
      riding: window.__OPERATOR__.vehicleSystem.isRiding,
      ammo: vis('.hud__ammo'),
      crosshair: vis('.hud__crosshair'),
      equipment: vis('.hud__equipment'),
    };
  });
  check('weapon HUD hides while driving, vehicle HUD takes over',
    hudSwap.riding === true && hudSwap.ammo === 'hidden'
      && hudSwap.crosshair === 'hidden' && hudSwap.equipment === 'hidden',
    JSON.stringify(hudSwap));


  // --- 6. Camera is third-person exterior ---------------------------------
  // The hard requirement: never an interior camera. Prove the camera is
  // OUTSIDE the vehicle's bounding box and behind it.
  const cam = await page.evaluate(() => {
    const O = window.__OPERATOR__;
    const v = O.vehicleSystem.all[0];
    const camera = O.sceneManager ? O.sceneManager.getCamera() : null;
    const c = camera ?? O.playerController.camera.camera;
    const vp = v.root.position;
    const dx = c.position.x - vp.x;
    const dy = c.position.y - vp.y;
    const dz = c.position.z - vp.z;
    return {
      dist: Math.sqrt(dx * dx + dy * dy + dz * dz),
      above: dy,
      camY: c.position.y,
    };
  });
  check(
    'camera is third-person exterior (outside the hull, not a cockpit view)',
    cam.dist > 4.0 && cam.above > 1.0,
    `distance=${cam.dist.toFixed(2)}m height=+${cam.above.toFixed(2)}m`,
  );
  await page.screenshot({ path: path.join(args.shots, '03-driving-camera.png') });

  // --- 6b. Move the subject to the flat test surface ----------------------
  // The driving course exists precisely so handling can be measured on known
  // ground. Testing on open terrain makes the local slope a hidden variable:
  // an earlier run measured "braking" on a downhill and then "exit" while the
  // car rolled backwards at 8 m/s.
  await page.evaluate(() => {
    const O = window.__OPERATOR__;
    const v = O.vehicleSystem.all[0];
    // Driving pad centre is (95, 62), 130 x 90 m of flat asphalt. Start at
    // the west edge pointing east so there is room to accelerate.
    v.spawn(new v.root.position.constructor(45, 1.2, 62), -Math.PI / 2);
  });
  await sleep(1200);
  const onPad = await page.evaluate(() => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    return {
      y: Number(v.root.position.y.toFixed(2)),
      contacts: v.land.wheels.filter((w) => w.grounded).length,
      speed: Number(Math.abs(v.state.forwardSpeed).toFixed(2)),
    };
  });
  check('vehicle settles on the flat driving course',
    onPad.contacts === 4 && onPad.speed < 0.5,
    `y=${onPad.y} contacts=${onPad.contacts}/4 speed=${onPad.speed}`);

  // --- 7. Drive: acceleration ---------------------------------------------
  // Press the REAL key. An earlier version of this harness called
  // vehicle.setInput() directly and measured zero movement -- because
  // VehicleSystem rewrites the driver's input from the keymap every frame, so
  // the injected throttle was overwritten before the physics ever saw it.
  // That is correct behaviour (the system owns driver input), and it means
  // the only honest way to test driving is through the keyboard.
  const before = await page.evaluate(() => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    return { x: v.root.position.x, y: v.root.position.y, z: v.root.position.z };
  });
  await page.keyboard.down('KeyW');
  await sleep(3000);
  const drive = await page.evaluate((start) => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    const dx = v.root.position.x - start.x;
    const dz = v.root.position.z - start.z;
    return {
      speed: Number(v.state.forwardSpeed.toFixed(2)),
      travelled: Number(Math.sqrt(dx * dx + dz * dz).toFixed(2)),
      grounded: v.state.grounded,
      y: Number(v.root.position.y.toFixed(2)),
      throttle: v.currentInput.throttle,
      load: Number(v.state.throttleLoad.toFixed(2)),
    };
  }, before);
  check(
    'throttle accelerates the vehicle',
    drive.speed > 5 && drive.travelled > 10,
    `speed=${drive.speed} m/s travelled=${drive.travelled} m load=${drive.load}`,
  );
  check(
    'vehicle stays on the ground while driving',
    drive.grounded && drive.y > 0 && drive.y < 3,
    `grounded=${drive.grounded} y=${drive.y}`,
  );

  // --- 8. Steering ---------------------------------------------------------
  const yawBefore = await page.evaluate(
    () => window.__OPERATOR__.vehicleSystem.all[0].yaw,
  );
  await page.keyboard.down('KeyA');
  await sleep(1800);
  const steering = await page.evaluate((y0) => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    let d = v.yaw - y0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return {
      delta: Number(d.toFixed(3)),
      steerAngle: Number(v.state.steerAngle.toFixed(3)),
      wheelSteer: v.land.wheels.map((w) => Number(w.steer.toFixed(3))),
    };
  }, yawBefore);
  await page.keyboard.up('KeyA');
  check(
    'steering turns the vehicle',
    Math.abs(steering.delta) > 0.15,
    `heading changed ${(steering.delta * 180 / Math.PI).toFixed(1)} deg, `
      + `steerAngle=${steering.steerAngle}`,
  );
  check(
    'only the front wheels steer',
    steering.wheelSteer[0] !== 0 && steering.wheelSteer[1] !== 0
      && steering.wheelSteer[2] === 0 && steering.wheelSteer[3] === 0,
    `steer=[${steering.wheelSteer}]`,
  );
  await page.screenshot({ path: path.join(args.shots, '04-cornering.png') });

  // --- 9. Braking ----------------------------------------------------------
  // Reset to the pad so the brake test starts from a known place and a known
  // speed, not from wherever the cornering test finished.
  await page.evaluate(() => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    v.spawn(new v.root.position.constructor(45, 1.2, 62), -Math.PI / 2);
  });
  await sleep(1000);

  await page.keyboard.down('KeyW');
  await sleep(3200);
  const speedBefore = await page.evaluate(
    () => Math.abs(window.__OPERATOR__.vehicleSystem.all[0].state.forwardSpeed),
  );
  await page.keyboard.up('KeyW');

  // Brake with S and poll fast. S is brake-then-reverse, so the instant the
  // car is stopped the key starts driving it backwards -- the check has to
  // catch the stop and release, not hold blindly. (The handbrake is NOT the
  // right control here either: it brakes the rear axle only and cuts its
  // lateral grip, which is a slide, not a stop.)
  // Sample inside the page at frame rate. Polling over CDP at 80 ms cannot
  // reliably catch the instant the car passes below 1 m/s -- it stops and
  // starts reversing within one or two frames of each other -- so the
  // measurement has to happen where the frames are. Deceleration rate is the
  // honest quantity anyway: "it stopped" is a consequence of "it decelerated".
  await page.keyboard.down('KeyS');
  const braking = await page.evaluate(async (v0) => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    let min = v0;
    let stopFrames = null;
    let frames = 0;
    const t0 = performance.now();
    while (frames < 600) {
      await new Promise((r) => requestAnimationFrame(r));
      frames += 1;
      const sp = Math.abs(v.state.forwardSpeed);
      if (sp < min) min = sp;
      if (sp < 0.8) { stopFrames = (performance.now() - t0) / 1000; break; }
    }
    return {
      before: Number(v0.toFixed(2)),
      min: Number(min.toFixed(2)),
      stopTime: stopFrames,
      decel: Number(((v0 - min) / Math.max(stopFrames ?? 1, 0.001)).toFixed(1)),
    };
  }, speedBefore);
  await page.keyboard.up('KeyS');

  check(
    'braking stops the vehicle',
    braking.before > 8 && braking.min < 1.0 && braking.stopTime !== null,
    `${braking.before} m/s -> ${braking.min} m/s`
      + `${braking.stopTime !== null ? ` in ${braking.stopTime.toFixed(2)}s` : ' (never stopped)'}`
      + ` (${braking.decel} m/s^2)`,
  );

  // --- 10. Wheels are driven by the suspension ----------------------------
  const wheelViz = await page.evaluate(() => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    const nodes = ['FL', 'FR', 'RL', 'RR'].map((s2) => v.root.getObjectByName(`Wheel_${s2}`));
    return {
      found: nodes.filter(Boolean).length,
      spun: v.land.wheels.some((w) => Math.abs(w.spin) > 1),
      spins: v.land.wheels.map((w) => Number(w.spin.toFixed(1))),
      ys: nodes.map((n) => (n ? Number(n.position.y.toFixed(4)) : null)),
    };
  });
  check('all four wheel groups present and animated', wheelViz.found === 4 && wheelViz.spun,
    `found=${wheelViz.found} spin=[${wheelViz.spins}] suspensionY=[${wheelViz.ys}]`);

  // --- 11. Exit ------------------------------------------------------------
  // Bring the car to a genuine standstill in-page first. The exit gate
  // refuses above 6 m/s, so testing it while the car still rolls tests the
  // refusal rather than the exit.
  await page.evaluate(async () => {
    const v = window.__OPERATOR__.vehicleSystem.all[0];
    for (let i = 0; i < 300; i += 1) {
      if (Math.abs(v.state.forwardSpeed) < 0.4) break;
      // No driver input is being fed this frame (no keys are down), so the
      // vehicle coasts; nudge the brake directly. VehicleSystem only
      // overwrites throttle/steer/brake when a movement key is held.
      v.setInput({ throttle: 0, steer: 0, brake: 1, handbrake: true });
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await sleep(300);

  const exited = await page.evaluate(async () => {
    const O = window.__OPERATOR__;
    const vs = O.vehicleSystem;
    const v = vs.all[0];
    const speedAtExit = Number(v.state.forwardSpeed.toFixed(2));
    const carY = Number(v.root.position.y.toFixed(2));
    const ok = vs.exitVehicle(false);
    await new Promise((r) => setTimeout(r, 700));
    const p = O.playerController.getPosition();
    return {
      ok,
      speedAtExit,
      carY,
      riding: vs.isRiding,
      suspended: O.playerController.isVehicleSuspended,
      playerY: Number(p.y.toFixed(2)),
      dy: Number((p.y - v.root.position.y).toFixed(2)),
      distToCar: Number(Math.hypot(
        p.x - v.root.position.x, p.z - v.root.position.z,
      ).toFixed(2)),
      seatFree: v.isSeatFree('driver'),
    };
  });
  check('player exits the vehicle', exited.ok && !exited.riding && exited.seatFree,
    `speedAtExit=${exited.speedAtExit} riding=${exited.riding} seatFree=${exited.seatFree}`);
  check('on-foot controller resumes after exit', exited.suspended === false,
    `suspended=${exited.suspended}`);
  check(
    'player is placed on solid ground beside the vehicle',
    Math.abs(exited.dy) < 3 && exited.distToCar > 0.5 && exited.distToCar < 8,
    `playerY=${exited.playerY} carY=${exited.carY} dy=${exited.dy} `
      + `distance=${exited.distToCar}m`,
  );
  await page.screenshot({ path: path.join(args.shots, '05-after-exit.png') });

  // --- 12. Gunner seat -----------------------------------------------------
  const gunner = await page.evaluate(async () => {
    const O = window.__OPERATOR__;
    const vs = O.vehicleSystem;
    const g = vs.all.find((v) => v.definition.id === 'military_car_gunner');
    const seat = g.definition.seats.find((s) => s.role === 'gunner');
    const ok = vs.enterVehicle(g, seat);
    await new Promise((r) => setTimeout(r, 300));
    const before = g.turretAim.yaw;
    for (let i = 0; i < 30; i += 1) {
      g.aimTurret(0.05, 0.02, 1 / 60);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const after = g.turretAim;
    const yawNode = g.root.getObjectByName('Turret_Yaw');
    const result = {
      ok,
      seat: vs.currentSeat?.id,
      turretMoved: Math.abs(after.yaw - before) > 0.05,
      nodeRotated: yawNode ? Math.abs(yawNode.rotation.y) > 0.05 : false,
      pitchClamped: after.pitch <= 0.70001,
      muzzle: Boolean(g.root.getObjectByName('Socket_Muzzle_Turret')),
    };
    vs.exitVehicle(true);
    return result;
  });
  check('gunner seat is enterable', gunner.ok && gunner.seat === 'gunner', `seat=${gunner.seat}`);
  check('turret traverses and drives its node', gunner.turretMoved && gunner.nodeRotated,
    `aimMoved=${gunner.turretMoved} nodeRotated=${gunner.nodeRotated}`);
  check('turret pitch is clamped to its limit', gunner.pitchClamped, 'pitch <= 0.70 rad');
  check('turret muzzle socket exists', gunner.muzzle);

  // --- 13. Teleport pad confirmation --------------------------------------
  const teleport = await page.evaluate(async () => {
    const O = window.__OPERATOR__;
    // Stand in the hub pad.
    O.playerController.debugTeleport(0, 0.5, 26);
    await new Promise((r) => setTimeout(r, 500));
    const el = document.getElementById('teleport-ui');
    const shown = el?.style.opacity === '1';
    const text = el?.textContent ?? '';
    return {
      shown,
      hasConfirm: /CONFIRM/.test(text),
      hasCancel: /CANCEL/.test(text),
      hasDestinations: /AIRFIELD/.test(text) && /HARBOUR/.test(text),
      busy: O.teleportPads.isBusy,
    };
  });
  check('standing in a pad opens the destination chooser',
    teleport.shown && teleport.hasDestinations,
    `shown=${teleport.shown} destinations=${teleport.hasDestinations}`);
  check('chooser offers confirm and cancel',
    teleport.hasConfirm && teleport.hasCancel,
    `confirm=${teleport.hasConfirm} cancel=${teleport.hasCancel}`);
  await page.screenshot({ path: path.join(args.shots, '06-teleport-chooser.png') });

  // --- 13b. Nothing is hidden without a replacement ------------------------
  //
  // The static batcher hides source meshes once a merged batch draws them
  // instead. It used to report EVERY mesh it looked at as consumed, including
  // buckets that bailed out of merging -- so ~1800 triangles, the whole
  // airfield apron among them, were hidden with nothing drawing them. The map
  // looked like grass where there should have been tarmac.
  //
  // Assert the landmarks render, and that "renders" means the whole parent
  // chain is visible, not just the mesh's own flag.
  const landmarkVisibility = await page.evaluate(() => {
    const names = ['Apron', 'Runway', 'Taxiway', 'Terrain', 'DrivingPad',
      'HubPad', 'Helipad_0', 'Water_Surface'];
    const out = {};
    window.__OPERATOR__.levelLoader.scene.traverse((o) => {
      if (!names.includes(o.name)) return;
      let renders = o.visible;
      for (let n = o.parent; n; n = n.parent) if (!n.visible) renders = false;
      out[o.name] = renders;
    });
    return out;
  });
  const hiddenLandmarks = Object.entries(landmarkVisibility)
    .filter(([, renders]) => !renders).map(([name]) => name);
  check('every major landmark actually renders',
    hiddenLandmarks.length === 0 && Object.keys(landmarkVisibility).length >= 7,
    hiddenLandmarks.length
      ? `hidden: ${hiddenLandmarks.join(', ')}`
      : `${Object.keys(landmarkVisibility).length} landmarks visible`);

  // --- 14. Section screenshots (evidence the map is not blank) ------------
  //
  // Drive the REAL teleport destinations rather than a second hard-coded
  // list. A separate list in the harness is a list that silently rots: the
  // first version of this tour still pointed at the old airfield coordinates
  // after those were fixed, so the screenshot kept showing empty grass and
  // "proved" a bug that had already been repaired.
  const destinations = await page.evaluate(() => {
    const pads = window.__OPERATOR__.teleportPads;
    const seen = new Map();
    for (const pad of pads.padsForHarness ?? []) {
      for (const d of pad.destinations) if (!seen.has(d.id)) seen.set(d.id, d);
    }
    return [...seen.values()].map((d) => ({
      id: d.id, position: d.position, yaw: d.yaw,
    }));
  });

  for (const d of destinations) {
    await page.evaluate((dest) => {
      const O = window.__OPERATOR__;
      O.playerController.debugTeleport(
        dest.position[0], dest.position[1], dest.position[2],
      );
      O.playerController.debugLook(dest.yaw, -0.05);
    }, d);
    await sleep(900);
    await page.screenshot({ path: path.join(args.shots, `07-section-${d.id}.png`) });
  }
  check('every teleport destination was toured', destinations.length >= 6,
    `${destinations.length} destinations: ${destinations.map((d) => d.id).join(', ')}`);

  // --- 15. Key bindings ----------------------------------------------------
  const binds = await page.evaluate(() => {
    const b = window.__OPERATOR__.input.getBindings();
    return {
      enter: b.vehicleEnter,
      exit: b.vehicleExit,
      handbrake: b.vehicleHandbrake,
      flip: b.vehicleFlip,
      horn: b.vehicleHorn,
    };
  });
  check('vehicle actions are bound and rebindable',
    binds.enter === 'KeyE' && binds.handbrake === 'Space' && binds.flip === 'KeyR',
    JSON.stringify(binds));

  // --- 16. No runtime errors ----------------------------------------------
  const errors = diagnostics.errors.filter((e) => !/favicon|WebGL|Download the React/i.test(e));
  check('no runtime errors during the run', errors.length === 0,
    errors.length ? errors.slice(0, 3).join(' | ') : 'clean');

} catch (err) {
  check('harness completed', false, String(err?.stack ?? err));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
console.log(`screenshots -> ${args.shots}`);
process.exit(passed === results.length ? 0 : 1);
