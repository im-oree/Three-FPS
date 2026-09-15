#!/usr/bin/env node
/**
 * server/index.mjs — the dedicated backend.
 *
 * Deployable to Render, Railway, Fly, or any host that runs Node and speaks
 * WebSocket. `npm run backend` locally, `npm start` in production.
 *
 * WHAT MAKES THIS "THE SAME LOGIC"
 * --------------------------------
 * This file contains NO game logic. It is a socket adapter and a clock. Every
 * rule -- movement, bullets, hit registration, killstreaks, pooling, resets --
 * lives in src/server/**, which this imports unchanged and which the browser
 * imports unchanged. There is no server copy of anything to keep in sync,
 * because there is no copy: a feature added to a ServerSystem is live on both
 * sides the moment it is written. That was the requirement, and it is
 * structural here rather than a promise.
 *
 * The TypeScript in src/server is compiled on the fly by esbuild at boot
 * (~50 ms) so there is no build artifact that can go stale against source.
 */
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PORT ?? 8080);
const TICK_HZ = 60;
const TICK_MS = 1000 / TICK_HZ;

// --- load the shared simulation --------------------------------------------
const dir = mkdtempSync(path.join(tmpdir(), 'operator-backend-'));
const entryFile = path.join(dir, 'entry.ts');
writeFileSync(entryFile, `
export { GameServer } from '${path.join(ROOT, 'src/server/GameServer.ts').replace(/\\/g, '/')}';
export { RoomManager } from '${path.join(ROOT, 'src/server/RoomManager.ts').replace(/\\/g, '/')}';
export * as Protocol from '${path.join(ROOT, 'src/net/Protocol.ts').replace(/\\/g, '/')}';
`);
const bundle = path.join(dir, 'sim.mjs');
await build({
  entryPoints: [entryFile],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  absWorkingDir: ROOT,
  logLevel: 'warning',
});
const { RoomManager, Protocol } = await import(`file://${bundle}`);

/**
 * Collision geometry, read from the baked files on disk.
 *
 * This is the backend half of LevelStore's injected fetcher (the browser half
 * is an HTTP fetch). Without it a room has no floor: the terrain-based maps
 * carry their ground in the same file, so a server missing this drops every
 * player through the world.
 */
const collisionDir = path.join(ROOT, 'assets/collision');
const diskLevelFetcher = async (levelId) => {
  // Reject anything that is not a plain level id before it reaches the path:
  // this argument arrives from a client.
  if (!/^[a-z0-9_]+$/i.test(levelId)) throw new Error(`bad level id "${levelId}"`);
  const file = path.join(collisionDir, `${levelId}.json`);
  return JSON.parse(await fsp.readFile(file, 'utf8'));
};

const rooms = new RoomManager(diskLevelFetcher);
const log = (...args) => console.log(`[backend]`, ...args);

/**
 * Adapt a `ws` socket to the Transport interface the simulation expects.
 *
 * The simulation does not know what a WebSocket is -- it was written against
 * the interface, and this is the only place that gap is bridged.
 */
function socketTransport(socket) {
  const handlers = new Set();
  const closeHandlers = new Set();
  let closed = false;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return; // A malformed frame is ignored, never fatal to the session.
    }
    if (msg?.t === '__ping') {
      socket.send(JSON.stringify({ t: '__pong', id: msg.id }));
      return;
    }
    for (const handler of [...handlers]) handler(msg);
  });

  const fireClose = (reason) => {
    if (closed) return;
    closed = true;
    for (const handler of [...closeHandlers]) handler(reason);
    handlers.clear();
    closeHandlers.clear();
  };
  socket.on('close', () => fireClose('socket closed'));
  socket.on('error', () => fireClose('socket error'));

  return {
    get connected() { return !closed && socket.readyState === 1; },
    get rttMs() { return 0; },
    connect: () => Promise.resolve(),
    close: () => { try { socket.close(); } catch { /* already gone */ } fireClose('closed locally'); },
    send: (message) => {
      if (socket.readyState !== 1) return;
      try { socket.send(JSON.stringify(message)); } catch { /* closing */ }
    },
    onMessage: (handler) => { handlers.add(handler); return () => handlers.delete(handler); },
    onClose: (handler) => { closeHandlers.add(handler); return () => closeHandlers.delete(handler); },
  };
}

// --- HTTP: health check + room list ----------------------------------------
// Render and Railway both want a health endpoint, and a plain room list makes
// the backend inspectable with curl instead of a game client.
const http = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') {
    send(200, { ok: true, rooms: rooms.count, protocol: Protocol.PROTOCOL_VERSION, uptime: process.uptime() });
  } else if (req.url === '/rooms') {
    send(200, { rooms: rooms.listable });
  } else {
    send(404, { error: 'not found' });
  }
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (socket) => {
  const transport = socketTransport(socket);
  let room = null;
  let playerId = null;

  // Room selection happens BEFORE the simulation sees the connection: the
  // GameServer is handed an already-placed player, so it never has to know
  // that rooms exist.
  const offMessage = transport.onMessage((msg) => {
    switch (msg?.t) {
      case 'listRooms':
        transport.send({ t: 'roomList', rooms: rooms.listable });
        break;

      case 'createRoom': {
        if (room) break;
        try {
          room = rooms.create({
            name: String(msg.name ?? ''),
            levelId: String(msg.levelId ?? 'prototype'),
            maxPlayers: msg.maxPlayers,
            private: Boolean(msg.private),
          });
        } catch (err) {
          transport.send({ t: 'rejected', reason: err.message });
          break;
        }
        playerId = room.admit(transport);
        log(`room ${room.id} created "${room.name}" (${room.levelId})`);
        transport.send({ t: 'roomJoined', room: room.info, playerId });
        break;
      }

      case 'joinRoom': {
        if (room) break;
        const target = rooms.get(String(msg.roomId ?? ''));
        if (!target) { transport.send({ t: 'rejected', reason: 'no such room' }); break; }
        if (target.isFull) { transport.send({ t: 'rejected', reason: 'room full' }); break; }
        room = target;
        playerId = room.admit(transport);
        log(`room ${room.id} joined (${room.playerCount}/${room.maxPlayers})`);
        transport.send({ t: 'roomJoined', room: room.info, playerId });
        break;
      }

      case 'leaveRoom': {
        if (!room || !playerId) break;
        room.server.disconnect(playerId);
        transport.send({ t: 'roomLeft', reason: 'left' });
        room = null;
        playerId = null;
        break;
      }

      default:
        // Everything else is simulation traffic. Once the player is in a room
        // the GameServer's own handler has it; before that, it is premature.
        if (!room) transport.send({ t: 'rejected', reason: 'join a room first' });
        break;
    }
  });

  transport.onClose(() => {
    offMessage();
    if (room && playerId) room.server.disconnect(playerId);
    room = null;
  });
});

// --- the clock --------------------------------------------------------------
// One timer drives every room. Rooms are cheap (a fixed-timestep loop over a
// small entity set), and a single timer keeps the tick order deterministic.
let last = process.hrtime.bigint();
const timer = setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Number(now - last) / 1e9;
  last = now;
  try {
    rooms.update(dt);
  } catch (err) {
    // One room throwing must not take the process -- and therefore every
    // other match -- down with it.
    console.error('[backend] tick error:', err);
  }
}, TICK_MS);

const shutdown = () => {
  log('shutting down');
  clearInterval(timer);
  rooms.disposeAll();
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

http.listen(PORT, '0.0.0.0', () => {
  log(`listening on :${PORT} (protocol v${Protocol.PROTOCOL_VERSION}, ${TICK_HZ} Hz)`);
});
