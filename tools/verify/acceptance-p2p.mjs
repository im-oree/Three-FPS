/**
 * acceptance-p2p.mjs — two real browsers, one real match.
 *
 * The lobby suite proves the DIRECTORY is correct. This proves the thing the
 * directory exists for: that a second player, in a separate browser, with a
 * separate WebRTC stack, can find a hosted game, connect to it over a real
 * DataChannel, and be simulated by the host's authoritative server.
 *
 * Node has no RTCPeerConnection, so this cannot be faked in-process -- it has
 * to be two Chromium instances. That is also the honest test: it exercises the
 * ICE negotiation, the SDP relay through the backend, and the two data
 * channels exactly as a player would hit them.
 *
 * Requires the dev server on :5174. The signalling backend is spawned here on
 * its own port, so the suite never collides with a developer's running one.
 */
import { spawn } from 'node:child_process';
import { launchBrowser } from './browser.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const LOBBY_PORT = 8162;
// Both browsers are pointed at THIS backend via ?lobby=, which is the
// documented override in src/net/lobbyUrl.ts.
const LOBBY_URL = `ws://127.0.0.1:${LOBBY_PORT}`;
const APP = `${process.env.APP_URL ?? 'http://127.0.0.1:5174/'}?lobby=${encodeURIComponent(LOBBY_URL)}`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Open a page with the app booted and its test hook ready. */
async function openClient(browser, label) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(window.__OPERATOR__?.hostGame),
    { timeout: 60000 },
  );
  console.log(`  ..    ${label} booted`);
  return { page, errors };
}

const host = { browser: null };
const guest = { browser: null };
let child = null;

try {
  child = spawn('node', ['server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(LOBBY_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('backend did not start')), 10000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`backend exited ${code}`)); });
  });
  console.log(`  ..    backend up on :${LOBBY_PORT}`);

  host.browser = await launchBrowser();
  guest.browser = await launchBrowser();

  const A = await openClient(host.browser, 'host');
  const B = await openClient(guest.browser, 'guest');

  // --- [1] the host advertises a real game ---------------------------------
  console.log('\n[1] A host puts a game on the board');

  const hosted = await A.page.evaluate(async () => {
    await window.__OPERATOR__.hostGame('killhouse', {
      modeId: 'ffa', lobbyName: 'ACCEPTANCE GAME',
    });
    const s = window.__OPERATOR__.session;
    return {
      hasServer: Boolean(s.server),
      lobbyConnected: Boolean(s.lobby?.connected),
      hostingId: s.lobby?.hosting ?? null,
    };
  });
  check('host owns an authoritative server', hosted.hasServer === true);
  check('host is connected to the directory', hosted.lobbyConnected === true);
  check('host holds a game id', typeof hosted.hostingId === 'string' && hosted.hostingId.length > 0,
    hosted.hostingId ?? 'none');

  // --- [2] the guest can SEE it --------------------------------------------
  console.log('\n[2] The game is visible from a different browser');

  const listing = await B.page.evaluate(async () => {
    const games = await window.__OPERATOR__.listGames();
    return games.find((g) => g.name === 'ACCEPTANCE GAME') ?? null;
  });
  check('guest sees the hosted game', listing !== null);
  check('listing carries the map', listing?.levelId === 'killhouse', listing?.levelId ?? '-');
  check('listing carries the mode', listing?.modeId === 'ffa', listing?.modeId ?? '-');
  check('listing reports it is joinable', (listing?.playerCount ?? 99) < (listing?.maxPlayers ?? 0),
    `${listing?.playerCount}/${listing?.maxPlayers}`);

  // --- [3] the guest joins over real WebRTC --------------------------------
  console.log('\n[3] The guest connects peer-to-peer');

  const joined = await B.page.evaluate(async (gameId) => {
    await window.__OPERATOR__.joinGame({ id: gameId, levelId: 'killhouse', modeId: 'ffa' });
    const s = window.__OPERATOR__.session;
    s.client.joinMatch('killhouse', undefined, { modeId: 'ffa' });
    return {
      // A guest has NO server of its own -- that is the whole point.
      hasNoServer: s.server === null,
      clientId: s.client.id,
      connected: s.client.connected,
    };
  }, listing.id);
  check('guest runs no server of its own', joined.hasNoServer === true);
  check('guest transport reports connected', joined.connected === true);
  check('guest was assigned a player id by the host', Boolean(joined.clientId), joined.clientId ?? '-');

  // --- [4] the host's server actually admitted them ------------------------
  console.log('\n[4] The host simulates the guest');

  // Give the guest a moment to finish joining the match.
  await new Promise((r) => setTimeout(r, 3000));

  const serverView = await A.page.evaluate(() => {
    const s = window.__OPERATOR__.session;
    return {
      guestCount: s.guestCount ?? 0,
      players: s.server.world.players.size,
      ids: [...s.server.world.players.keys()],
    };
  });
  check('host counts one connected peer', serverView.guestCount === 1, `${serverView.guestCount}`);
  check('host simulates two players', serverView.players === 2,
    `${serverView.players}: ${serverView.ids.join(', ')}`);

  // --- [5] snapshots flow host -> guest -------------------------------------
  console.log('\n[5] The guest is being told about the world');

  const flow = await B.page.evaluate(async () => {
    const before = window.__OPERATOR__.session.client.tick;
    await new Promise((r) => setTimeout(r, 2000));
    const c = window.__OPERATOR__.session.client;
    return {
      gained: c.tick - before,
      rtt: c.rttMs,
      welcomed: c.isConnected,
      others: c.players.length,
    };
  });
  check('the guest completed the handshake', flow.welcomed === true);
  check('snapshots keep arriving over the data channel', flow.gained > 20,
    `${flow.gained} ticks in 2 s`);
  check('the peer link reports a round-trip time', typeof flow.rtt === 'number' && flow.rtt >= 0,
    `${Math.round(flow.rtt)} ms`);

  // --- [6] the guest's input reaches the host's simulation ------------------
  console.log('\n[6] The guest can move, and the host agrees');

  // Read the guest's position from the HOST's world -- the authority -- both
  // before and after, so this measures the simulation rather than the guest's
  // own prediction of it.
  const guestId = await B.page.evaluate(() => window.__OPERATOR__.session.client.id);
  const posOnHost = () => A.page.evaluate((id) => {
    const p = window.__OPERATOR__.session.server.world.players.get(id);
    return p ? [p.px, p.py, p.pz] : null;
  }, guestId);

  // Skip the pre-match countdown: the server correctly refuses input during
  // it, which would read as "the guest cannot move" rather than "the round
  // has not started".
  const phase = await A.page.evaluate(() => {
    const m = window.__OPERATOR__.session.server.match;
    const before = m.phase;
    m.beginLive();
    return { before, after: m.phase };
  });
  check('the host can start the round', phase.after === 'live',
    `${phase.before} -> ${phase.after}`);

  const startPos = await posOnHost();

  await B.page.evaluate(async () => {
    const s = window.__OPERATOR__.session;
    // Press W the way the relay does: an input frame, not a teleport.
    for (let i = 0; i < 90; i += 1) {
      s.client.sendInput({
        dt: 0.016, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0,
      });
      await new Promise((r) => setTimeout(r, 16));
    }
  });
  const endPos = await posOnHost();
  const moved = { startPos, id: guestId };

  check('the host knows the guest by id', endPos !== null, moved.id);
  if (endPos && startPos) {
    const dist = Math.hypot(endPos[0] - startPos[0], endPos[2] - startPos[2]);
    check('guest input moved the guest inside the host simulation', dist > 1.0,
      `${dist.toFixed(2)} m`);
  } else {
    check('guest input moved the guest inside the host simulation', false, 'no position');
  }

  // --- [7] the listing tracks reality ---------------------------------------
  console.log('\n[7] The board reflects the live game');

  const live = await B.page.evaluate(async () => {
    const games = await window.__OPERATOR__.listGames();
    return games.find((g) => g.name === 'ACCEPTANCE GAME') ?? null;
  });
  check('the listing now reports two players', live?.playerCount === 2,
    `${live?.playerCount ?? '-'}/${live?.maxPlayers ?? '-'}`);

  // --- [8] nobody crashed ----------------------------------------------------
  console.log('\n[8] Neither browser logged an error');
  const realErrors = (list) => list.filter((e) => (
    !e.includes('favicon') && !e.includes('AudioContext') && !e.includes('Autoplay')
  ));
  check('host page is error-free', realErrors(A.errors).length === 0,
    realErrors(A.errors)[0] ?? 'clean');
  check('guest page is error-free', realErrors(B.errors).length === 0,
    realErrors(B.errors)[0] ?? 'clean');

  // --- [9] the host leaving takes the game off the board --------------------
  console.log('\n[9] Ending the host match ends the game');

  await A.page.evaluate(() => { window.__OPERATOR__.session.dispose(); });
  await new Promise((r) => setTimeout(r, 1500));
  const after = await B.page.evaluate(async () => {
    const games = await window.__OPERATOR__.listGames();
    return games.filter((g) => g.name === 'ACCEPTANCE GAME').length;
  });
  check('the game is delisted when the host leaves', after === 0, `${after} still listed`);
} catch (error) {
  failed += 1;
  console.log(`  FAIL  harness error — ${error?.stack ?? error}`);
} finally {
  await host.browser?.close();
  await guest.browser?.close();
  // Await the exit: a SIGTERM followed by an immediate process.exit orphans
  // the child, and the next run fails with EADDRINUSE.
  if (child && child.exitCode === null) {
    await new Promise((resolve) => {
      const hard = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.on('exit', () => { clearTimeout(hard); resolve(); });
      child.kill('SIGTERM');
    });
  }
}

console.log(`\nP2P: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
