#!/usr/bin/env node
/**
 * server-combat.mjs — 12 end-to-end checks on authoritative hit registration.
 *
 * The client sends only "the trigger is down". Everything here is derived by
 * the server from its own copy of the world, which is what makes a client
 * unable to claim a hit it did not earn.
 */
import { buildServerBundle, makeCheck, settle } from './server-harness.mjs';

const { GameServer, createLocalTransportPair, Protocol } = await buildServerBundle();
const { check, report } = makeCheck();

const FLOOR = [{ minX: -80, minY: -1, minZ: -80, maxX: 80, maxY: 0, maxZ: 80, surface: 'concrete' }];

/** A server with two joined players on a floor. */
async function arena(boxes = FLOOR) {
  // fillLobby off: this suite needs an exactly-known population. A match
  // normally tops itself up to eight players, which would put six extra
  // bodies in the line of fire.
  const server = new GameServer({ fillLobby: false });
  const clients = [];
  for (let i = 0; i < 2; i += 1) {
    const pair = createLocalTransportPair();
    server.accept(pair.server);
    await pair.server.connect();
    await pair.client.connect();
    pair.client.send({ t: 'hello', version: Protocol.PROTOCOL_VERSION });
    pair.client.send({ t: 'joinMatch', levelId: 'test' });
    clients.push(pair.client);
  }
  await settle();
  server.collision.load(boxes);
  // Put the match live: the pre-match countdown freezes input (as COD does),
  // and this suite is testing ballistics, not the countdown.
  server.match.beginLive();
  const [shooter, target] = [...server.world.allPlayers];
  // Both on the floor, shooter at origin, target 10 m along +Z.
  shooter.px = 0; shooter.py = 0; shooter.pz = 0; shooter.yaw = 0; shooter.pitch = 0;
  target.px = 0; target.py = 0; target.pz = 10;
  return { server, clients, shooter, target };
}

let seq = 0;
/**
 * Hold the given buttons for n ticks, collecting every shot resolved.
 *
 * `lastShots` is cleared at the START of each tick, so reading it after a
 * multi-tick loop only ever shows the final tick -- usually empty, because
 * the weapon is on cooldown. Accumulating as we go is the only honest way to
 * see what happened.
 */
async function hold(ctx, client, buttons, ticks) {
  const collected = [];
  for (let i = 0; i < ticks; i += 1) {
    ctx.clients[client].send({
      t: 'input',
      frame: {
        seq: ++seq, dt: Protocol.TICK_SECONDS,
        moveX: 0, moveZ: 0,
        yaw: ctx.shooter.yaw, pitch: ctx.shooter.pitch,
        buttons,
      },
    });
    await settle(0);
    ctx.server.update(Protocol.TICK_SECONDS);
    collected.push(...ctx.server.combat.lastShots);
  }
  return collected;
}

const FIRE = 1;
const RELOAD = 32;

// --- 1. a shot at a target in front of you connects -------------------------
{
  const ctx = await arena();
  const before = ctx.target.health;
  await hold(ctx, 0, FIRE, 2);
  check('a shot at a target in the crosshair damages it',
    ctx.target.health < before,
    `health ${before} -> ${ctx.target.health}`);
  ctx.server.shutdown();
}

// --- 2. facing away hits nothing --------------------------------------------
{
  const ctx = await arena();
  ctx.shooter.yaw = Math.PI;               // turn around
  const before = ctx.target.health;
  await hold(ctx, 0, FIRE, 10);
  check('shooting the opposite way does not damage the target',
    ctx.target.health === before, `health still ${ctx.target.health}`);
  ctx.server.shutdown();
}

// --- 3. a wall between them blocks the shot ---------------------------------
{
  const ctx = await arena([
    ...FLOOR,
    { minX: -5, minY: 0, minZ: 4, maxX: 5, maxY: 4, maxZ: 5, surface: 'concrete' },
  ]);
  const before = ctx.target.health;
  await hold(ctx, 0, FIRE, 10);
  check('a wall between shooter and target blocks the bullet',
    ctx.target.health === before, `health still ${ctx.target.health}`);
  ctx.server.shutdown();
}

// --- 4. headshots do more than torso ----------------------------------------
{
  // Eye height is 1.68 m and the head band starts at 1.55 m, so a FLAT shot
  // at a standing target is a headshot -- as it is in the games this copies.
  const headCtx = await arena();
  headCtx.target.pz = 10;
  const headShots = await hold(headCtx, 0, FIRE, 2);
  const headShot = headShots.find((s) => s.zone === 'head');

  // Aim below the collar for the torso.
  const torsoCtx = await arena();
  torsoCtx.target.pz = 10;
  torsoCtx.shooter.pitch = -0.06;
  const torsoShots = await hold(torsoCtx, 0, FIRE, 2);
  const torso = torsoShots.find((s) => s.zone === 'torso');

  check('a headshot is detected as its own zone', headShot != null,
    headShot ? `zone=${headShot.zone} damage=${headShot.damage}` : 'never resolved a head zone');
  check('a headshot does more damage than a torso hit',
    headShot != null && torso != null && headShot.damage > torso.damage,
    headShot && torso ? `head ${headShot.damage} vs torso ${torso.damage}` : 'missing samples');

  // The head is a NARROW column, not a slab across the shoulders.
  const wideCtx = await arena();
  wideCtx.target.pz = 10;
  wideCtx.target.px = 0.25;              // a quarter metre off the centre line
  const wideShots = await hold(wideCtx, 0, FIRE, 2);
  check('a shot beside the head is not a headshot',
    !wideShots.some((s) => s.zone === 'head'),
    `0.25 m off-centre resolved as ${wideShots[0]?.zone ?? 'miss'}`);

  headCtx.server.shutdown(); torsoCtx.server.shutdown(); wideCtx.server.shutdown();
}

// --- 5. damage falls off with distance --------------------------------------
{
  const nearCtx = await arena();
  nearCtx.target.pz = 5;                   // inside falloffStart (10 m)
  nearCtx.shooter.pitch = -0.06;           // torso, so the zone is constant
  const near = (await hold(nearCtx, 0, FIRE, 2)).find((s) => s.victim);

  const farCtx = await arena();
  farCtx.target.pz = 45;                   // past falloffEnd (40 m)
  farCtx.shooter.pitch = -0.013;           // torso at 45 m
  const far = (await hold(farCtx, 0, FIRE, 2)).find((s) => s.victim);

  check('damage falls off with distance',
    near && far && far.damage < near.damage,
    near && far ? `${near.damage} at 5 m vs ${far.damage} at 45 m` : 'missing samples');
  check('the rifle uses its SHARED definition damage (35 near, 20 far)',
    near?.damage === 35 && far?.damage === 20,
    `near=${near?.damage} far=${far?.damage}`);
  nearCtx.server.shutdown(); farCtx.server.shutdown();
}

// --- 6. an automatic weapon respects its fire rate --------------------------
{
  const ctx = await arena();
  ctx.target.pz = 1000;                    // out of range, so we count shots
  const shots = (await hold(ctx, 0, FIRE, 60)).length;   // one second
  check('an automatic weapon fires at its RPM, not once per tick',
    shots > 5 && shots <= 12, `${shots} shots in 1 s (600 RPM = 10/s)`);
  ctx.server.shutdown();
}

// --- 7. ammo is consumed and the magazine runs dry --------------------------
{
  const ctx = await arena();
  ctx.target.pz = 1000;
  // Weapon state is created lazily on the first tick a player is simulated,
  // so read it after one tick rather than before the player has ever existed.
  await hold(ctx, 0, 0, 1);
  const start = ctx.server.combat.ammoFor(ctx.shooter.id);
  await hold(ctx, 0, FIRE, 300);           // five seconds of holding
  const after = ctx.server.combat.ammoFor(ctx.shooter.id);
  check('ammo is tracked server-side and depletes',
    start.ammo === 30 && after.ammo < 30,
    `${start.ammo} -> ${after.ammo} rounds`);
  ctx.server.shutdown();
}

// --- 8. reloading refills from reserve --------------------------------------
{
  const ctx = await arena();
  ctx.target.pz = 1000;
  await hold(ctx, 0, FIRE, 200);           // burn most of the magazine
  const low = ctx.server.combat.ammoFor(ctx.shooter.id);
  await hold(ctx, 0, RELOAD, 2);
  await hold(ctx, 0, 0, 180);              // wait out the 2.1 s reload
  const full = ctx.server.combat.ammoFor(ctx.shooter.id);
  check('reloading refills the magazine from reserve',
    full.ammo > low.ammo && full.reserve < 90,
    `${low.ammo} -> ${full.ammo} rounds, reserve ${full.reserve}`);
  ctx.server.shutdown();
}

// --- 9. enough hits kill, and the kill is reported --------------------------
{
  const ctx = await arena();
  ctx.target.pz = 8;
  const killShots = await hold(ctx, 0, FIRE, 120);
  const lethal = killShots.find((s) => s.lethal);
  check('enough damage kills the target', lethal != null && !ctx.target.alive,
    `alive=${ctx.target.alive} health=${ctx.target.health}`);
  ctx.server.shutdown();
}

// --- 10. a dead player cannot shoot and cannot be shot ----------------------
{
  const ctx = await arena();
  ctx.target.pz = 8;
  ctx.target.alive = false;
  ctx.target.health = 0;
  const atDead = await hold(ctx, 0, FIRE, 10);
  const hitDead = atDead.some((s) => s.victim === ctx.target.id);

  ctx.shooter.alive = false;
  const whileDead = await hold(ctx, 0, FIRE, 10);
  const firedWhileDead = whileDead.length > 0;

  check('a dead player cannot be hit again', !hitDead);
  check('a dead player cannot shoot', !firedWhileDead);
  ctx.server.shutdown();
}

// --- 11. the client cannot claim a hit --------------------------------------
{
  const ctx = await arena();
  ctx.target.pz = 10;
  ctx.shooter.yaw = Math.PI;               // pointed away; any hit is a lie
  const before = ctx.target.health;

  // Send every message a malicious client might try. None of these are in the
  // protocol as damage-carrying, which is the point: there is no message
  // shaped like "I hit him".
  for (const forged of [
    { t: 'damage', target: ctx.target.id, amount: 100 },
    { t: 'hit', victim: ctx.target.id, damage: 100 },
    { t: 'kill', victim: ctx.target.id },
    { t: 'input', frame: { seq: ++seq, dt: 0.016, moveX: 0, moveZ: 0, yaw: Math.PI, pitch: 0, buttons: FIRE, hit: ctx.target.id, damage: 999 } },
  ]) {
    ctx.clients[0].send(forged);
  }
  await settle();
  ctx.server.update(Protocol.TICK_SECONDS * 4);

  check('a client cannot forge a hit or damage message',
    ctx.target.health === before && ctx.target.alive,
    `health still ${ctx.target.health}`);
  ctx.server.shutdown();
}

// --- 12. hit resolution is deterministic ------------------------------------
{
  const runs = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    seq = 0;
    const ctx = await arena();
    ctx.target.pz = 12;
    const shots = (await hold(ctx, 0, FIRE, 40))
      .map((s) => `${s.zone}:${s.damage}:${s.distance.toFixed(6)}`);
    runs.push(shots.join('|'));
    ctx.server.shutdown();
  }
  check('hit resolution is bit-identical across identical runs',
    runs[0] === runs[1] && runs[0].length > 0,
    `${runs[0].split('|').length} shots, identical=${runs[0] === runs[1]}`);
}

// --- bonus: effects are events, and the client is told ----------------------
{
  const ctx = await arena();
  ctx.target.pz = 10;
  const fx = [];
  ctx.clients[0].onMessage((m) => {
    if (m.t === 'snapshot' && m.snapshot.fx) fx.push(...m.snapshot.fx);
  });
  await hold(ctx, 0, FIRE, 4);
  await settle();
  const kinds = new Set(fx.map((f) => f.t));
  check('the server emits effect EVENTS for the client to render',
    kinds.has('tracer') && kinds.has('damage') && kinds.has('hitMarker'),
    `[${[...kinds].join(', ')}]`);
  ctx.server.shutdown();
}

report('SERVER COMBAT');
