#!/usr/bin/env node
/**
 * acceptance-session.mjs — the authoritative session, inside the real game.
 *
 * server-core.mjs proves the simulation is correct in isolation. This proves
 * it is actually WIRED: running in the page, ticking off the engine loop,
 * surviving a pause, and shutting down when the player quits.
 */
import { launchBrowser } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const url = process.argv[2] ?? 'http://localhost:5174';
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await enterMatch(page, { levelIndex: 5 });

  // --- the session exists and is authoritative ------------------------------
  const boot = await page.evaluate(() => {
    const op = window.__OPERATOR__;
    return {
      hasSession: !!op.session,
      hasServer: !!op.gameServer,
      hasClient: !!op.gameClient,
      connected: op.gameClient?.isConnected ?? false,
      playerId: op.gameClient?.id ?? null,
    };
  });
  check('a session boots with the game', boot.hasSession);
  check('an authoritative server is running in-process', boot.hasServer);
  check('the client is connected to it', boot.connected, `playerId=${boot.playerId}`);
  check('the client was assigned an identity by the server',
    typeof boot.playerId === 'string' && boot.playerId.length > 0, `${boot.playerId}`);

  // --- the server is driven by the engine loop ------------------------------
  const ticking = await page.evaluate(async () => {
    const op = window.__OPERATOR__;
    const before = op.gameServer.currentTick;
    await new Promise((r) => setTimeout(r, 500));
    const after = op.gameServer.currentTick;
    return { before, after, delta: after - before };
  });
  check('the server advances off the engine loop', ticking.delta > 0,
    `tick ${ticking.before} -> ${ticking.after} (+${ticking.delta})`);

  // --- joining a match registered the player server-side --------------------
  const joined = await page.evaluate(() => {
    const op = window.__OPERATOR__;
    return {
      players: op.gameServer.playerCount,
      matchActive: op.gameServer.isMatchActive,
      levelId: op.gameServer.activeLevelId,
    };
  });
  check('entering a match starts it on the server', joined.matchActive,
    `level="${joined.levelId}"`);
  check('the player is registered server-side', joined.players === 1,
    `${joined.players} player(s)`);

  // --- solo pause DOES stop the world ---------------------------------------
  const solo = await page.evaluate(async () => {
    const op = window.__OPERATOR__;
    op.gameClient.requestPause(true);
    await new Promise((r) => setTimeout(r, 60));
    const running = op.isSimulationRunning();
    const t0 = op.gameServer.currentTick;
    await new Promise((r) => setTimeout(r, 300));
    const t1 = op.gameServer.currentTick;
    op.gameClient.requestPause(false);
    await new Promise((r) => setTimeout(r, 60));
    return { running, t0, t1, resumed: op.isSimulationRunning() };
  });
  check('solo: pause stops the simulation', solo.running === false && solo.t1 === solo.t0,
    `running=${solo.running}, ticks ${solo.t0}->${solo.t1}`);
  check('solo: resume restarts it', solo.resumed === true);

  // --- with a second player, pause must NOT stop the world ------------------
  const multi = await page.evaluate(async () => {
    const op = window.__OPERATOR__;
    // Attach a second connection to the SAME server, exactly as a remote
    // player's would arrive. Nothing about the first client changes.
    const second = await op.session.addLocalTestClient();
    await new Promise((r) => setTimeout(r, 60));

    op.gameClient.requestPause(true);
    await new Promise((r) => setTimeout(r, 60));
    const running = op.isSimulationRunning();
    const t0 = op.gameServer.currentTick;
    await new Promise((r) => setTimeout(r, 400));
    const t1 = op.gameServer.currentTick;
    const players = op.gameServer.playerCount;
    second.disconnect();
    return { running, t0, t1, players, delta: t1 - t0 };
  });
  check('a second player can join the running server', multi.players === 2,
    `${multi.players} players`);
  check('multiplayer: pause does NOT stop the simulation',
    multi.running === true && multi.delta > 0,
    `running=${multi.running}, ticks ${multi.t0}->${multi.t1} (+${multi.delta})`);

  // --- quitting ends the match server-side ----------------------------------
  const quit = await page.evaluate(async () => {
    const op = window.__OPERATOR__;
    op.gameStateManager.setState('PLAYING');
    op.gameClient.leaveMatch();
    await new Promise((r) => setTimeout(r, 100));
    return {
      matchActive: op.gameServer.isMatchActive,
      entities: op.gameServer.world.entityCount,
      players: op.gameServer.playerCount,
    };
  });
  check('leaving the match ends it server-side', quit.matchActive === false);
  check('leaving the match clears server entities', quit.entities === 0,
    `${quit.entities} left`);

  check('no page errors during the session', errors.length === 0,
    errors.slice(0, 2).join(' | ') || 'clean');
} catch (err) {
  failed += 1;
  console.log(`  FAIL  harness error — ${err.message}`);
} finally {
  await browser.close();
}

console.log(`\nSESSION ACCEPTANCE: ${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
