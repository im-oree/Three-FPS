#!/usr/bin/env node
/**
 * server-core.mjs — headless tests for the authoritative simulation.
 *
 * These run in plain Node with NO browser and NO renderer. That is the point:
 * if the server core can be fully exercised without a DOM, it can run on a
 * hosted backend. The day this file needs puppeteer is the day the server has
 * stopped being portable.
 *
 * TypeScript is compiled on the fly with esbuild (already a Vite dependency),
 * so there is no separate build step to keep in sync.
 */
import { buildServerBundle, makeCheck, settle } from './server-harness.mjs';

const { GameServer, createLocalTransportPair, GameClient, Protocol } =
  await buildServerBundle();
const { check, report } = makeCheck();



// --- 1. handshake -----------------------------------------------------------
{
  const server = new GameServer();
  const { client: clientT, server: serverT } = createLocalTransportPair();
  server.accept(serverT);
  await serverT.connect();

  let welcomed = null;
  const client = new GameClient(clientT, {});
  clientT.onMessage((m) => { if (m.t === 'welcome') welcomed = m; });
  await client.connect();
  await settle();

  check('server completes the handshake', welcomed !== null,
    welcomed ? `playerId=${welcomed.playerId} tickHz=${welcomed.tickHz}` : 'no welcome');
  check('server reports the agreed tick rate',
    welcomed?.tickHz === Protocol.TICK_HZ, `${welcomed?.tickHz}`);
  server.shutdown();
}

// --- 2. protocol version mismatch is rejected -------------------------------
{
  const server = new GameServer();
  const { client: clientT, server: serverT } = createLocalTransportPair();
  server.accept(serverT);
  await serverT.connect();
  await clientT.connect();

  let rejected = null;
  clientT.onMessage((m) => { if (m.t === 'rejected') rejected = m.reason; });
  clientT.send({ t: 'hello', version: Protocol.PROTOCOL_VERSION + 99 });
  await settle();

  check('a protocol mismatch is rejected, not silently accepted',
    rejected !== null, rejected ?? 'accepted a bad version');
  server.shutdown();
}

// --- 3. fixed timestep ------------------------------------------------------
{
  const server = new GameServer();
  const { server: serverT } = createLocalTransportPair();
  server.accept(serverT);
  await serverT.connect();
  server.startMatch('test');

  // One second of real time must always be TICK_HZ ticks, however it is
  // delivered: a 60 Hz client and a 10 Hz client must agree.
  server.update(1.0);
  const bigSteps = server.currentTick;

  const server2 = new GameServer();
  const pair2 = createLocalTransportPair();
  server2.accept(pair2.server);
  await pair2.server.connect();
  server2.startMatch('test');
  for (let i = 0; i < 100; i += 1) server2.update(0.01);
  const smallSteps = server2.currentTick;

  // The 0.25 s catch-up clamp means one big update is capped; that is the
  // designed behaviour, so assert the SMALL-step path is exact and the big
  // one is clamped rather than unbounded.
  check('many small updates produce exactly TICK_HZ ticks per second',
    smallSteps === Protocol.TICK_HZ, `${smallSteps} ticks for 1.00 s`);
  check('a long stall is clamped, not replayed as a burst',
    bigSteps > 0 && bigSteps <= Protocol.TICK_HZ * 0.25 + 1,
    `${bigSteps} ticks from a single 1 s update (clamped to 0.25 s)`);
  server.shutdown();
  server2.shutdown();
}

// --- 4. entity pooling recycles ---------------------------------------------
{
  const server = new GameServer();
  const { server: serverT } = createLocalTransportPair();
  server.accept(serverT);
  await serverT.connect();
  server.startMatch('test');
  const world = server.world;

  const first = world.spawnEntity('bullet', [0, 0, 0]);
  const firstRef = first;
  world.destroyEntity(first.id);
  server.update(Protocol.TICK_SECONDS * 2);

  check('a destroyed entity is released to the pool',
    world.pooledCount > 0, `${world.pooledCount} pooled`);

  const second = world.spawnEntity('bullet', [5, 5, 5]);
  check('the pool is reused rather than allocating', second === firstRef,
    second === firstRef ? 'same object recycled' : 'allocated a new object');
  check('a recycled entity is fully reinitialised',
    second.px === 5 && second.alive === true && second.active === true
      && Object.keys(second.data).length === 0,
    `pos=${second.px} alive=${second.alive} data=${JSON.stringify(second.data)}`);
  server.shutdown();
}

// --- 5. reset leaves no residue ---------------------------------------------
{
  const server = new GameServer();
  const { server: serverT } = createLocalTransportPair();
  const id = server.accept(serverT);
  await serverT.connect();
  server.startMatch('level_a');
  const world = server.world;
  world.addPlayer(id);
  world.spawnEntity('heli', [1, 2, 3]);
  world.spawnEntity('bullet', [4, 5, 6]);
  world.raiseFx({ t: 'explosion', at: [0, 0, 0], radius: 5 });
  server.update(Protocol.TICK_SECONDS);

  server.startMatch('level_b');
  check('a new match starts with no entities from the last one',
    world.entityCount === 0, `${world.entityCount} entities survived`);
  check('a new match starts with no players from the last one',
    world.playerCount === 0, `${world.playerCount} players survived`);
  check('a new match starts with no queued effects',
    world.consumeFxEvents().length === 0);
  check('the tick counter restarts', server.currentTick === 0,
    `tick=${server.currentTick}`);
  server.shutdown();
}

// --- 6. pause is single-player only -----------------------------------------
{
  const server = new GameServer();
  const a = createLocalTransportPair();
  server.accept(a.server);
  await a.server.connect();
  await a.client.connect();
  server.startMatch('test');

  const states = [];
  a.client.onMessage((m) => { if (m.t === 'simulationState') states.push(m); });

  a.client.send({ t: 'requestPause', paused: true });
  await settle();
  const soloPaused = states.at(-1);
  const tickBefore = server.currentTick;
  server.update(0.2);
  const tickAfterPause = server.currentTick;

  check('solo pause actually halts the simulation',
    soloPaused?.running === false && tickAfterPause === tickBefore,
    `running=${soloPaused?.running} ticks ${tickBefore}->${tickAfterPause}`);

  a.client.send({ t: 'requestPause', paused: false });
  await settle();

  // Second player joins; now pause must be refused.
  const b = createLocalTransportPair();
  server.accept(b.server);
  await b.server.connect();
  await b.client.connect();

  a.client.send({ t: 'requestPause', paused: true });
  await settle();
  const multiAnswer = states.at(-1);
  const t0 = server.currentTick;
  server.update(0.2);
  const t1 = server.currentTick;

  check('with two players, pause does NOT stop the world',
    multiAnswer?.running === true && t1 > t0,
    `running=${multiAnswer?.running}, ticks ${t0}->${t1}, reason="${multiAnswer?.reason}"`);
  server.shutdown();
}

// --- 7. inputs are acknowledged and de-duplicated ---------------------------
{
  const server = new GameServer();
  const { client: clientT, server: serverT } = createLocalTransportPair();
  const pid = server.accept(serverT);
  await serverT.connect();
  await clientT.connect();
  clientT.send({ t: 'hello', version: Protocol.PROTOCOL_VERSION });
  clientT.send({ t: 'joinMatch', levelId: 'test' });
  await settle();

  const frame = (seq) => ({
    seq, dt: Protocol.TICK_SECONDS, moveX: 0, moveZ: 1,
    yaw: 0, pitch: 0, buttons: 0,
  });
  clientT.send({ t: 'input', frame: frame(1) });
  clientT.send({ t: 'input', frame: frame(2) });
  clientT.send({ t: 'input', frame: frame(2) });   // duplicate
  clientT.send({ t: 'input', frame: frame(1) });   // out of order
  await settle();

  const player = server.world.getPlayer(pid);
  check('duplicate and out-of-order inputs are discarded',
    player?.pendingInput.length === 2,
    `${player?.pendingInput.length} accepted of 4 sent`);
  server.shutdown();
}

// --- 8. input flooding is bounded -------------------------------------------
{
  const server = new GameServer();
  const { client: clientT, server: serverT } = createLocalTransportPair();
  const pid = server.accept(serverT);
  await serverT.connect();
  await clientT.connect();
  clientT.send({ t: 'hello', version: Protocol.PROTOCOL_VERSION });
  clientT.send({ t: 'joinMatch', levelId: 'test' });
  await settle();

  for (let i = 1; i <= 500; i += 1) {
    clientT.send({
      t: 'input',
      frame: { seq: i, dt: 0.016, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 },
    });
  }
  await settle();
  const queued = server.world.getPlayer(pid)?.pendingInput.length ?? 0;
  check('a flooding client cannot grow server memory without bound',
    queued <= 33, `${queued} frames queued after 500 sent`);
  server.shutdown();
}

// --- 9. messages are immutable across the seam ------------------------------
{
  const server = new GameServer();
  const { client: clientT, server: serverT } = createLocalTransportPair();
  server.accept(serverT);
  await serverT.connect();
  await clientT.connect();

  let threw = false;
  clientT.onMessage((m) => {
    try {
      // Over a real socket this would be a private parsed copy. In-process it
      // must be frozen, or a receiver could corrupt the sender's state -- a
      // bug that would only appear once a real backend was plugged in.
      m.mutated = true;
      if (Object.isFrozen(m)) threw = true;
    } catch {
      threw = true;
    }
  });
  clientT.send({ t: 'hello', version: Protocol.PROTOCOL_VERSION });
  await settle();
  check('messages crossing the seam are frozen', threw,
    'a receiver cannot mutate the sender\'s object');
  server.shutdown();
}

// --- 9b. a dropped link frees the slot --------------------------------------
{
  const server = new GameServer();
  const a = createLocalTransportPair();
  server.accept(a.server);
  await a.server.connect();
  await a.client.connect();
  const b = createLocalTransportPair();
  server.accept(b.server);
  await b.server.connect();
  await b.client.connect();
  server.startMatch('test');
  await settle();

  const before = server.playerCount;
  // Close from the CLIENT side without announcing anything -- a crashed tab,
  // not a polite quit.
  b.client.close();
  await settle();

  check('a client that vanishes is dropped by the server',
    server.playerCount === before - 1, `${before} -> ${server.playerCount}`);
  check('the remaining player keeps their match', server.isMatchActive);
  server.shutdown();
}

// --- 9c. an emptied match ends ----------------------------------------------
{
  const server = new GameServer();
  const { client: clientT, server: serverT } = createLocalTransportPair();
  server.accept(serverT);
  await serverT.connect();
  await clientT.connect();
  clientT.send({ t: 'hello', version: Protocol.PROTOCOL_VERSION });
  clientT.send({ t: 'joinMatch', levelId: 'test' });
  await settle();
  check('joining starts the match', server.isMatchActive);

  clientT.send({ t: 'leaveMatch' });
  await settle();
  check('the match ends when the last player leaves', !server.isMatchActive,
    'no room left running with zero players');
  server.shutdown();
}

// --- 10. shutdown is clean --------------------------------------------------
{
  const server = new GameServer();
  const { client: clientT, server: serverT } = createLocalTransportPair();
  server.accept(serverT);
  await serverT.connect();
  await clientT.connect();
  server.startMatch('test');
  server.update(0.1);

  let endedReason = null;
  clientT.onMessage((m) => { if (m.t === 'matchEnded') endedReason = m.reason; });
  server.shutdown();
  await settle();

  check('shutdown ends the match and tells the client', endedReason !== null,
    endedReason ?? 'client never told');
  check('shutdown drops all connections', server.playerCount === 0);
  check('a shut-down server does not keep ticking', !server.isRunning);
}

report('SERVER CORE');
