/**
 * acceptance-lobby.mjs — the peer-to-peer server browser, end to end.
 *
 * Two halves:
 *   [1-6] the signalling directory in-process, driven with fake peers, so the
 *         real logic is asserted rather than a mock of it.
 *   [7-9] the same logic over a real WebSocket against the real backend.
 *
 * The directory is the one piece of shared infrastructure in a P2P game, so
 * every failure mode that would leave a player staring at an unjoinable row
 * is covered here: hosts that vanish, full games, wrong passwords, and stale
 * listings.
 */
import { spawn } from 'node:child_process';
import { SignalDirectory } from '../../server/SignalDirectory.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const PORT = 8161;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** A peer that records what the directory sent it. */
function fakePeer(directory) {
  const received = [];
  const id = directory.addPeer((m) => received.push(m));
  return {
    id,
    received,
    last: (type) => [...received].reverse().find((m) => m.t === type),
    send: (msg) => directory.handle(id, msg),
  };
}

// --- [1] hosting and listing ------------------------------------------------
console.log('\n[1] A host advertises a game');
{
  const directory = new SignalDirectory();
  const host = fakePeer(directory);
  check('a connecting peer is given an id', typeof host.id === 'string' && host.id.length > 0,
    host.id);

  host.send({
    t: 'hostGame', name: 'MY LOBBY', levelId: 'shipment',
    modeId: 'ffa', maxPlayers: 8,
  });
  const hosting = host.last('hosting');
  check('hosting a game returns a game id', typeof hosting?.gameId === 'string', hosting?.gameId);

  const guest = fakePeer(directory);
  guest.send({ t: 'listGames' });
  const list = guest.last('gameList');
  check('the game appears in the browser', list?.games.length === 1,
    `${list?.games.length} game(s) listed`);

  const row = list.games[0];
  check('the row carries everything the browser must show',
    row.name === 'MY LOBBY' && row.levelId === 'shipment'
    && row.modeId === 'ffa' && row.maxPlayers === 8
    && typeof row.pingMs === 'number' && typeof row.playerCount === 'number',
    `${row.name} · ${row.levelId} · ${row.modeId} · ${row.playerCount}/${row.maxPlayers} · ${row.pingMs} ms`);
}

// --- [2] the listing tells the truth ----------------------------------------
console.log('\n[2] A listing reflects the real game');
{
  const directory = new SignalDirectory();
  const host = fakePeer(directory);
  host.send({ t: 'hostGame', name: 'X', levelId: 'killhouse', modeId: 'tdm', maxPlayers: 12 });
  host.send({ t: 'heartbeat', playerCount: 5, inProgress: true });

  const guest = fakePeer(directory);
  guest.send({ t: 'listGames' });
  const row = guest.last('gameList').games[0];
  check('a heartbeat updates the player count', row.playerCount === 5, `${row.playerCount}/12`);
  check('a live match is marked in progress', row.inProgress === true);

  // A name is rendered into other players' DOM, so it is sanitised server-side.
  const nasty = fakePeer(directory);
  nasty.send({
    t: 'hostGame', name: '<img src=x onerror=alert(1)>', levelId: 'shipment',
    modeId: 'ffa', maxPlayers: 8,
  });
  guest.send({ t: 'listGames' });
  const names = guest.last('gameList').games.map((g) => g.name);
  check('a hostile lobby name is sanitised',
    names.every((n) => !n.includes('<') && !n.includes('>')),
    names.join(' | '));
}

// --- [3] joining introduces the two peers -----------------------------------
console.log('\n[3] Joining introduces guest and host');
{
  const directory = new SignalDirectory();
  const host = fakePeer(directory);
  host.send({ t: 'hostGame', name: 'G', levelId: 'shipment', modeId: 'ffa', maxPlayers: 8 });
  const gameId = host.last('hosting').gameId;

  const guest = fakePeer(directory);
  guest.send({ t: 'joinGame', gameId });

  const accepted = guest.last('joinAccepted');
  const arrived = host.last('guestArrived');
  check('the guest is told which peer hosts the game',
    accepted?.hostPeerId === host.id, `${accepted?.hostPeerId}`);
  check('the host is told a guest arrived',
    arrived?.peerId === guest.id, `${arrived?.peerId}`);

  // Signalling is relayed verbatim: the directory does not parse SDP.
  guest.send({ t: 'signal', to: host.id, payload: { kind: 'answer', sdp: 'v=0 fake' } });
  const relayed = host.last('signal');
  check('SDP is relayed to the other peer untouched',
    relayed?.from === guest.id && relayed?.payload?.sdp === 'v=0 fake',
    JSON.stringify(relayed?.payload));
}

// --- [4] joins that must be refused -----------------------------------------
console.log('\n[4] Bad joins are refused with a reason');
{
  const directory = new SignalDirectory();
  const host = fakePeer(directory);
  host.send({
    t: 'hostGame', name: 'P', levelId: 'shipment', modeId: 'ffa',
    maxPlayers: 2, password: 'secret',
  });
  const gameId = host.last('hosting').gameId;

  const guest = fakePeer(directory);
  guest.send({ t: 'joinGame', gameId });
  check('a passworded game refuses a guest with no password',
    guest.last('joinRejected')?.reason.includes('password'),
    guest.last('joinRejected')?.reason);

  guest.send({ t: 'joinGame', gameId, password: 'secret' });
  check('the right password gets in', guest.last('joinAccepted')?.gameId === gameId);

  host.send({ t: 'heartbeat', playerCount: 2, inProgress: false });
  const late = fakePeer(directory);
  late.send({ t: 'joinGame', gameId, password: 'secret' });
  check('a full game is refused', late.last('joinRejected')?.reason.includes('full'),
    late.last('joinRejected')?.reason);

  const ghost = fakePeer(directory);
  ghost.send({ t: 'joinGame', gameId: 'game_nope' });
  check('a game that is not listed is refused',
    ghost.last('joinRejected')?.reason.length > 0,
    ghost.last('joinRejected')?.reason);
}

// --- [5] a host that leaves takes its row with it ---------------------------
console.log('\n[5] Dead listings disappear');
{
  const directory = new SignalDirectory();
  const host = fakePeer(directory);
  host.send({ t: 'hostGame', name: 'Z', levelId: 'shipment', modeId: 'ffa', maxPlayers: 8 });
  const gameId = host.last('hosting').gameId;

  const guest = fakePeer(directory);
  guest.send({ t: 'joinGame', gameId });

  directory.removePeer(host.id);
  check('a host disconnecting delists its game', directory.gameCount === 0,
    `${directory.gameCount} game(s) remain`);
  check('a guest mid-handshake is told the host went away',
    guest.last('peerGone')?.peerId === host.id);

  // Stale pruning: a host whose tab froze stops heartbeating.
  let clock = 1000;
  const timed = new SignalDirectory(() => clock);
  const stale = fakePeer(timed);
  stale.send({ t: 'hostGame', name: 'S', levelId: 'shipment', modeId: 'ffa', maxPlayers: 8 });
  check('a fresh listing is visible', timed.listings().length === 1);
  clock += 20;
  check('a listing with no heartbeat for 20 s is pruned', timed.listings().length === 0);
}

// --- [6] hosting is exclusive and replaceable -------------------------------
console.log('\n[6] One listing per host');
{
  const directory = new SignalDirectory();
  const host = fakePeer(directory);
  host.send({ t: 'hostGame', name: 'FIRST', levelId: 'shipment', modeId: 'ffa', maxPlayers: 8 });
  host.send({ t: 'hostGame', name: 'SECOND', levelId: 'killhouse', modeId: 'tdm', maxPlayers: 12 });
  check('re-hosting replaces the old listing rather than duplicating it',
    directory.gameCount === 1 && directory.listings()[0].name === 'SECOND',
    `${directory.gameCount} listing(s), named ${directory.listings()[0]?.name}`);

  host.send({ t: 'stopHosting' });
  check('a host can delist on purpose', directory.gameCount === 0);
}

// --- [7] the real backend over a real socket --------------------------------
console.log('\n[7] The backend serves the browser over a socket');
let child = null;
try {
  child = spawn('node', ['server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('backend did not start')), 30000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('exit', (c) => {
      clearTimeout(timer);
      reject(new Error(`backend exited ${c}${stderr ? `\n${stderr}` : ''}`));
    });
  });

  const connect = () => new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const received = [];
    socket.addEventListener('message', (e) => received.push(JSON.parse(e.data)));
    socket.addEventListener('error', () => reject(new Error('socket error')));
    socket.addEventListener('open', () => resolve({
      socket,
      received,
      send: (m) => socket.send(JSON.stringify(m)),
      last: (t) => [...received].reverse().find((m) => m.t === t),
      await: (pred, ms = 5000) => new Promise((res, rej) => {
        const found = received.find(pred);
        if (found) { res(found); return; }
        const timer = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
        socket.addEventListener('message', function onMsg(e) {
          const msg = JSON.parse(e.data);
          if (pred(msg)) {
            clearTimeout(timer);
            socket.removeEventListener('message', onMsg);
            res(msg);
          }
        });
      }),
    }));
  });

  const hostSocket = await connect();
  const welcome = await hostSocket.await((m) => m.t === 'lobbyWelcome');
  check('a real socket is issued a lobby peer id',
    typeof welcome.peerId === 'string', welcome.peerId);

  hostSocket.send({
    t: 'hostGame', name: 'REAL LOBBY', levelId: 'shipment',
    modeId: 'ffa', maxPlayers: 8,
  });
  const hosting = await hostSocket.await((m) => m.t === 'hosting');

  const guestSocket = await connect();
  await guestSocket.await((m) => m.t === 'lobbyWelcome');
  guestSocket.send({ t: 'listGames' });
  const list = await guestSocket.await((m) => m.t === 'gameList');
  check('a second client sees the hosted game over the wire',
    list.games.some((g) => g.id === hosting.gameId && g.name === 'REAL LOBBY'),
    `${list.games.length} game(s)`);

  // --- [8] the HTTP view agrees with the socket view ------------------------
  console.log('\n[8] The browser is inspectable over HTTP');
  const games = await (await fetch(`http://127.0.0.1:${PORT}/games`)).json();
  check('GET /games lists the same game',
    games.games.some((g) => g.id === hosting.gameId),
    `${games.games.length} game(s)`);
  const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  check('the health check reports the directory',
    health.ok === true && health.games === 1 && health.peers >= 2,
    `${health.games} game(s), ${health.peers} peer(s)`);

  // --- [9] signalling survives the round trip -------------------------------
  console.log('\n[9] Signalling is relayed between real sockets');
  guestSocket.send({ t: 'joinGame', gameId: hosting.gameId });
  const accepted = await guestSocket.await((m) => m.t === 'joinAccepted');
  const arrived = await hostSocket.await((m) => m.t === 'guestArrived');
  check('the host is notified over the wire', arrived.peerId === welcome.peerId
    ? false : typeof arrived.peerId === 'string', arrived.peerId);

  guestSocket.send({
    t: 'signal',
    to: accepted.hostPeerId,
    payload: { kind: 'offer', sdp: 'v=0 round-trip' },
  });
  const relayed = await hostSocket.await((m) => m.t === 'signal');
  check('an SDP payload survives the round trip',
    relayed.payload.sdp === 'v=0 round-trip', JSON.stringify(relayed.payload));

  // A host closing its tab must clear the row for everyone else.
  hostSocket.socket.close();
  await new Promise((r) => setTimeout(r, 300));
  const after = await (await fetch(`http://127.0.0.1:${PORT}/games`)).json();
  check('closing the host socket delists the game',
    !after.games.some((g) => g.id === hosting.gameId),
    `${after.games.length} game(s) remain`);

  guestSocket.socket.close();
} catch (err) {
  failed += 1;
  console.log(`  FAIL  harness error — ${err.message}`);
} finally {
  if (child && child.exitCode === null) {
    await new Promise((resolve) => {
      const hard = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.on('exit', () => { clearTimeout(hard); resolve(); });
      child.kill('SIGTERM');
    });
  }
}

console.log(`\nLOBBY / SERVER BROWSER: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
