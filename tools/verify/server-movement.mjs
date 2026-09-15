#!/usr/bin/env node
/**
 * server-movement.mjs — 12 end-to-end checks on authoritative movement.
 *
 * Headless, like the rest of the server suite. These exercise the real
 * GameServer through the real protocol: inputs go in as C2S messages, and
 * positions are read from the world the server actually simulates.
 */
import { buildServerBundle, makeCheck, settle } from './server-harness.mjs';

const { GameServer, createLocalTransportPair, Protocol, CollisionWorld } =
  await buildServerBundle();
const { check, report } = makeCheck();

const FLOOR = [{ minX: -50, minY: -1, minZ: -50, maxX: 50, maxY: 0, maxZ: 50, surface: 'concrete' }];

/** A server with a floor and one joined player, ready to receive input. */
async function makeServer(boxes = FLOOR) {
  const server = new GameServer();
  const pair = createLocalTransportPair();
  server.accept(pair.server);
  await pair.server.connect();
  await pair.client.connect();
  pair.client.send({ t: 'hello', version: Protocol.PROTOCOL_VERSION });
  pair.client.send({ t: 'joinMatch', levelId: 'test' });
  await settle();
  server.collision.load(boxes);
  const id = [...server.world.allPlayers][0].id;
  return { server, client: pair.client, player: server.world.getPlayer(id), id };
}

let seq = 0;
const input = (over = {}) => ({
  seq: ++seq, dt: Protocol.TICK_SECONDS,
  moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over,
});

/** Send one input and advance exactly one tick. */
function press(ctx, over = {}) {
  ctx.client.send({ t: 'input', frame: input(over) });
}

/** Run n ticks, feeding the same input each tick. */
async function run(ctx, ticks, over = {}) {
  for (let i = 0; i < ticks; i += 1) {
    press(ctx, over);
    await settle(0);
    ctx.server.update(Protocol.TICK_SECONDS);
  }
}

// --- 1. gravity pulls a spawned player down to the floor --------------------
{
  const ctx = await makeServer();
  ctx.player.py = 6;
  ctx.player.vy = 0;
  await run(ctx, 120);
  check('gravity settles a player onto the floor',
    Math.abs(ctx.player.py) < 0.05 && ctx.player.grounded,
    `y=${ctx.player.py.toFixed(3)} grounded=${ctx.player.grounded}`);
  ctx.server.shutdown();
}

// --- 2. forward input moves forward at the tuned speed ----------------------
{
  const ctx = await makeServer();
  ctx.player.py = 0;
  await run(ctx, 60, { moveZ: 1 });
  const speed = Math.hypot(ctx.player.vx, ctx.player.vz);
  check('walking reaches the shared WALK_SPEED',
    Math.abs(speed - 5.4) < 0.3, `${speed.toFixed(2)} m/s (expected 5.4)`);
  ctx.server.shutdown();
}

// --- 3. sprint is faster than walk, and forward-only ------------------------
{
  const walkCtx = await makeServer();
  walkCtx.player.py = 0;
  await run(walkCtx, 60, { moveZ: 1 });
  const walk = Math.hypot(walkCtx.player.vx, walkCtx.player.vz);

  const sprintCtx = await makeServer();
  sprintCtx.player.py = 0;
  await run(sprintCtx, 60, { moveZ: 1, buttons: 16 });
  const sprint = Math.hypot(sprintCtx.player.vx, sprintCtx.player.vz);

  const backCtx = await makeServer();
  backCtx.player.py = 0;
  await run(backCtx, 60, { moveZ: -1, buttons: 16 });
  const backward = Math.hypot(backCtx.player.vx, backCtx.player.vz);

  check('sprinting is faster than walking',
    sprint > walk * 1.4, `walk ${walk.toFixed(2)} vs sprint ${sprint.toFixed(2)}`);
  check('sprint does not apply while moving backwards',
    backward < walk * 1.1, `backward ${backward.toFixed(2)} m/s`);
  walkCtx.server.shutdown(); sprintCtx.server.shutdown(); backCtx.server.shutdown();
}

// --- 4. diagonal input is not faster than straight --------------------------
{
  const ctx = await makeServer();
  ctx.player.py = 0;
  await run(ctx, 60, { moveX: 1, moveZ: 1 });
  const speed = Math.hypot(ctx.player.vx, ctx.player.vz);
  check('diagonal movement is normalised, not 1.41x',
    speed < 5.4 * 1.05, `${speed.toFixed(2)} m/s`);
  ctx.server.shutdown();
}

// --- 5. a wall stops horizontal motion --------------------------------------
{
  const ctx = await makeServer([
    ...FLOOR,
    { minX: -10, minY: 0, minZ: 3, maxX: 10, maxY: 4, maxZ: 4, surface: 'concrete' },
  ]);
  ctx.player.px = 0; ctx.player.py = 0; ctx.player.pz = 0;
  await run(ctx, 120, { moveZ: 1 });
  check('a wall stops the player instead of letting them through',
    ctx.player.pz < 3 && ctx.player.pz > 2, `stopped at z=${ctx.player.pz.toFixed(3)}`);
  ctx.server.shutdown();
}

// --- 6. a low step is climbed, a high wall is not ---------------------------
{
  const stepCtx = await makeServer([
    ...FLOOR,
    { minX: -10, minY: 0, minZ: 2, maxX: 10, maxY: 0.3, maxZ: 6, surface: 'concrete' },
  ]);
  stepCtx.player.px = 0; stepCtx.player.py = 0; stepCtx.player.pz = 0;
  // Stop while still ON the step: the ledge ends at z=6, and walking past it
  // drops back to the floor, which would read as "never climbed".
  await run(stepCtx, 45, { moveZ: 1 });
  check('a low step is walked up, not blocked',
    stepCtx.player.pz > 3 && stepCtx.player.py > 0.25,
    `z=${stepCtx.player.pz.toFixed(2)} y=${stepCtx.player.py.toFixed(2)} (step top y=0.3)`);

  const wallCtx = await makeServer([
    ...FLOOR,
    { minX: -10, minY: 0, minZ: 2, maxX: 10, maxY: 1.2, maxZ: 6, surface: 'concrete' },
  ]);
  wallCtx.player.px = 0; wallCtx.player.py = 0; wallCtx.player.pz = 0;
  await run(wallCtx, 120, { moveZ: 1 });
  check('a waist-high wall is NOT auto-climbed',
    wallCtx.player.pz < 2, `z=${wallCtx.player.pz.toFixed(2)}`);
  stepCtx.server.shutdown(); wallCtx.server.shutdown();
}

// --- 7. jumping reaches roughly the designed height -------------------------
{
  const ctx = await makeServer();
  ctx.player.py = 0;
  await run(ctx, 5);                      // settle on the floor
  let peak = 0;
  for (let i = 0; i < 90; i += 1) {
    press(ctx, { buttons: 4 });
    await settle(0);
    ctx.server.update(Protocol.TICK_SECONDS);
    peak = Math.max(peak, ctx.player.py);
  }
  check('a jump reaches the designed height',
    peak > 0.9 && peak < 1.45, `peak y=${peak.toFixed(3)} (target 1.15)`);
  ctx.server.shutdown();
}

// --- 8. no double jump from a held button -----------------------------------
{
  const ctx = await makeServer();
  ctx.player.py = 0;
  await run(ctx, 5);
  let apexCount = 0;
  let wasRising = false;
  for (let i = 0; i < 180; i += 1) {
    press(ctx, { buttons: 4 });           // held the whole time
    await settle(0);
    ctx.server.update(Protocol.TICK_SECONDS);
    const rising = ctx.player.vy > 0.5;
    if (rising && !wasRising) apexCount += 1;
    wasRising = rising;
  }
  // Holding jump on the ground legitimately re-jumps on landing in most
  // shooters; what must NOT happen is a second jump mid-air.
  check('holding jump never produces a mid-air second jump',
    apexCount <= 3, `${apexCount} launches in 3 s of holding`);
  ctx.server.shutdown();
}

// --- 9. crouching lowers the capsule and slows movement ---------------------
{
  const ctx = await makeServer();
  ctx.player.py = 0;
  await run(ctx, 60, { moveZ: 1, buttons: 8 });
  const speed = Math.hypot(ctx.player.vx, ctx.player.vz);
  check('crouching lowers the capsule',
    ctx.player.height < 1.25 && ctx.player.crouching,
    `height=${ctx.player.height.toFixed(2)}`);
  check('crouching slows the player',
    speed < 5.4 * 0.6, `${speed.toFixed(2)} m/s crouched`);
  ctx.server.shutdown();
}

// --- 10. cannot stand up under a ceiling ------------------------------------
{
  const ctx = await makeServer([
    ...FLOOR,
    { minX: -5, minY: 1.3, minZ: -5, maxX: 5, maxY: 2, maxZ: 5, surface: 'concrete' },
  ]);
  ctx.player.py = 0;
  await run(ctx, 40, { buttons: 8 });     // crouch under it
  const crouched = ctx.player.height;
  await run(ctx, 60, { buttons: 0 });     // release crouch
  check('a player cannot stand up into a ceiling',
    ctx.player.height < 1.35,
    `crouched ${crouched.toFixed(2)} -> released ${ctx.player.height.toFixed(2)}`);
  ctx.server.shutdown();
}

// --- 11. a speed-hacked dt cannot buy extra distance ------------------------
{
  const honest = await makeServer();
  honest.player.py = 0;
  await run(honest, 60, { moveZ: 1 });
  const honestZ = honest.player.pz;

  const cheat = await makeServer();
  cheat.player.py = 0;
  for (let i = 0; i < 60; i += 1) {
    // Claim a 10x longer frame than really elapsed.
    cheat.client.send({ t: 'input', frame: input({ moveZ: 1, dt: 0.16 }) });
    await settle(0);
    cheat.server.update(Protocol.TICK_SECONDS);
  }
  check('an inflated dt does not grant extra distance',
    cheat.player.pz <= honestZ * 1.05,
    `honest ${honestZ.toFixed(2)} m vs cheating ${cheat.player.pz.toFixed(2)} m`);
  honest.server.shutdown(); cheat.server.shutdown();
}

// --- 12. movement is deterministic ------------------------------------------
{
  const positions = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    seq = 0;
    const ctx = await makeServer([
      ...FLOOR,
      { minX: -2, minY: 0, minZ: 4, maxX: 2, maxY: 0.4, maxZ: 8, surface: 'concrete' },
    ]);
    ctx.player.px = 0; ctx.player.py = 0; ctx.player.pz = 0;
    await run(ctx, 40, { moveZ: 1 });
    await run(ctx, 20, { moveZ: 1, buttons: 4 });
    await run(ctx, 40, { moveX: 1, moveZ: 1 });
    positions.push([ctx.player.px, ctx.player.py, ctx.player.pz]);
    ctx.server.shutdown();
  }
  const [a, b] = positions;
  const identical = a.every((v, i) => v === b[i]);
  check('identical inputs produce bit-identical results', identical,
    identical ? `both runs: [${a.map((v) => v.toFixed(4))}]`
      : `[${a.map((v) => v.toFixed(4))}] vs [${b.map((v) => v.toFixed(4))}]`);
}

// --- bonus: raycasts agree with the geometry --------------------------------
{
  const world = new CollisionWorld();
  world.load([{ minX: -1, minY: 0, minZ: 5, maxX: 1, maxY: 2, maxZ: 6, surface: 'metal' }]);
  const hit = world.raycast([0, 1, 0], [0, 0, 1], 100);
  const miss = world.raycast([0, 1, 0], [0, 0, -1], 100);
  check('a raycast reports the nearest surface at the right distance',
    hit !== null && Math.abs(hit.distance - 5) < 0.01 && hit.surface === 'metal' && miss === null,
    hit ? `d=${hit.distance.toFixed(2)} surface=${hit.surface}` : 'no hit');
}

// --- bonus: the real baked levels load and are stood on --------------------
{
  const { LevelStore } = await buildServerBundle();
  const { diskLevelFetcher } = await import('./server-harness.mjs');
  const store = new LevelStore(diskLevelFetcher());
  const level = await store.load('prototype');
  const world = new CollisionWorld();
  world.load(level.boxes);

  // Drop a capsule from high above the spawn and see where it settles.
  const server = new GameServer({ levelFetcher: diskLevelFetcher() });
  const pair = createLocalTransportPair();
  server.accept(pair.server);
  await pair.server.connect();
  await pair.client.connect();
  pair.client.send({ t: 'hello', version: Protocol.PROTOCOL_VERSION });
  pair.client.send({ t: 'joinMatch', levelId: 'prototype' });
  await settle();
  await server.whenLevelReady();

  const player = [...server.world.allPlayers][0];
  player.py = 20;
  for (let i = 0; i < 180; i += 1) server.update(Protocol.TICK_SECONDS);

  check('a real baked level loads with geometry',
    level.boxes.length > 20, `${level.boxes.length} boxes in "prototype"`);
  check('the server stands a player on real level geometry',
    player.grounded && player.py > -1 && player.py < 5,
    `settled at y=${player.py.toFixed(2)}, grounded=${player.grounded}`);
  server.shutdown();
}

report('SERVER MOVEMENT');
