#!/usr/bin/env node
/**
 * backend-smoke.mjs — the dedicated backend, over real sockets.
 *
 * server-core.mjs tests the simulation in-process. This tests the SAME
 * simulation reached across an actual WebSocket, through the room layer, with
 * two independent clients. If this passes, "hostable on Render/Railway" is a
 * tested claim rather than an intention.
 *
 * Boots its own backend on a spare port unless given one:
 *   node tools/verify/backend-smoke.mjs [ws://host:port]
 */
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const explicit = process.argv[2] ?? null;
const PORT = 8137;
const base = explicit ?? `ws://127.0.0.1:${PORT}`;
const httpBase = base.replace(/^ws/, 'http');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

let child = null;
if (!explicit) {
  child = spawn('node', ['server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('backend did not start')), 30000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`backend exited ${c}`)); });
  });
}

/** A test client that records everything the server sent it. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const received = [];
    const waiters = [];
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      received.push(msg);
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].match(msg)) { waiters[i].resolve(msg); waiters.splice(i, 1); }
      }
    });
    socket.on('error', reject);
    socket.on('open', () => resolve({
      socket,
      received,
      send: (m) => socket.send(JSON.stringify(m)),
      /** Resolve when a matching message arrives (or has already arrived). */
      await: (match, timeout = 5000) => {
        const already = received.find(match);
        if (already) return Promise.resolve(already);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout waiting for message')), timeout);
          waiters.push({ match, resolve: (m) => { clearTimeout(t); res(m); } });
        });
      },
      close: () => socket.close(),
    }));
  });
}

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

try {
  // --- health ---------------------------------------------------------------
  const health = await fetch(`${httpBase}/health`).then((r) => r.json());
  check('the backend answers a health check', health.ok === true,
    `protocol v${health.protocol}, ${health.rooms} rooms`);

  // --- create a room --------------------------------------------------------
  const host = await connect(base);
  host.send({ t: 'createRoom', name: 'Smoke Test', levelId: 'prototype', maxPlayers: 4 });
  const joined = await host.await((m) => m.t === 'roomJoined');
  check('a client can create a room', !!joined.room?.id,
    `room=${joined.room?.id} "${joined.room?.name}"`);
  check('the room creator is assigned a player id',
    typeof joined.playerId === 'string', `${joined.playerId}`);

  // --- the room is discoverable --------------------------------------------
  const listed = await fetch(`${httpBase}/rooms`).then((r) => r.json());
  check('the room appears in the public list',
    listed.rooms.some((r) => r.id === joined.room.id),
    `${listed.rooms.length} room(s) listed`);

  // --- the shared simulation is reachable over the wire ---------------------
  host.send({ t: 'hello', version: 1 });
  const welcome = await host.await((m) => m.t === 'welcome');
  check('the shared GameServer handshakes over a real socket',
    welcome.tickHz === 60, `tickHz=${welcome.tickHz}`);

  host.send({ t: 'joinMatch', levelId: 'prototype' });
  const ready = await host.await((m) => m.t === 'matchReady');
  check('a match starts on the backend', ready.levelId === 'prototype',
    `spawn=[${ready.spawn}]`);

  const snapshot = await host.await((m) => m.t === 'snapshot', 3000);
  check('the backend streams snapshots', snapshot.snapshot.tick > 0,
    `tick=${snapshot.snapshot.tick}`);

  // --- the backend has a FLOOR ----------------------------------------------
  // Regression: rooms used to be built with `new GameServer()` and no level
  // fetcher, so a dedicated backend loaded no collision at all. Combined with
  // terrain living only on the client, every player on a sculpted map fell
  // out of the world. Prototype is one of those maps, so a player who is
  // still near spawn height after a second of real gravity proves both
  // halves are wired.
  // Players ride in `playerState`, not the entity list (entities are props,
  // vehicles and killstreaks).
  await new Promise((r) => setTimeout(r, 1200));
  const me = host.received.filter((m) => m.t === 'playerState').at(-1)?.state;
  const lastTick = host.received.filter((m) => m.t === 'snapshot').at(-1).snapshot.tick;
  check('a player on the backend stands on the ground instead of falling',
    me !== undefined && me.pos[1] > -5,
    me ? `y=${me.pos[1].toFixed(2)} after ${lastTick} ticks` : 'no playerState received');

  // --- a second player joins the SAME room ----------------------------------
  const guest = await connect(base);
  guest.send({ t: 'joinRoom', roomId: joined.room.id });
  const guestJoined = await guest.await((m) => m.t === 'roomJoined');
  check('a second client joins the same room',
    guestJoined.room.playerCount === 2,
    `${guestJoined.room.playerCount}/${guestJoined.room.maxPlayers} players`);
  check('the two players have distinct identities',
    guestJoined.playerId !== joined.playerId,
    `${joined.playerId} vs ${guestJoined.playerId}`);

  // --- pause does not stop a populated match --------------------------------
  guest.send({ t: 'hello', version: 1 });
  guest.send({ t: 'joinMatch', levelId: 'prototype' });
  await settle(200);

  host.send({ t: 'requestPause', paused: true });
  const answer = await host.await((m) => m.t === 'simulationState');
  const tickBefore = host.received.filter((m) => m.t === 'snapshot').at(-1).snapshot.tick;
  await settle(500);
  const tickAfter = host.received.filter((m) => m.t === 'snapshot').at(-1).snapshot.tick;

  check('over the wire, pause does NOT stop a populated match',
    answer.running === true && tickAfter > tickBefore,
    `running=${answer.running}, tick ${tickBefore}->${tickAfter}`);

  // --- an unknown room is refused -------------------------------------------
  const stranger = await connect(base);
  stranger.send({ t: 'joinRoom', roomId: 'r9999' });
  const refused = await stranger.await((m) => m.t === 'rejected');
  check('joining a nonexistent room is refused', refused.reason === 'no such room',
    refused.reason);

  // --- simulation traffic before joining a room is refused ------------------
  const early = await connect(base);
  early.send({ t: 'input', frame: { seq: 1, dt: 0.016, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 } });
  const tooEarly = await early.await((m) => m.t === 'rejected');
  check('simulation traffic outside a room is refused',
    tooEarly.reason === 'join a room first', tooEarly.reason);

  // --- a dropped socket frees the slot --------------------------------------
  guest.close();
  await settle(400);
  const afterLeave = await fetch(`${httpBase}/rooms`).then((r) => r.json());
  const room = afterLeave.rooms.find((r) => r.id === joined.room.id);
  check('a dropped socket frees its player slot', room?.playerCount === 1,
    `${room?.playerCount} player(s) remain`);

  host.close();
  stranger.close();
  early.close();
} catch (err) {
  failed += 1;
  console.log(`  FAIL  harness error — ${err.message}`);
} finally {
  if (child) child.kill('SIGTERM');
}

console.log(`\nBACKEND SMOKE: ${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
