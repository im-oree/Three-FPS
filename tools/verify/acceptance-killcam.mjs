/**
 * acceptance-killcam.mjs — the killcam in a REAL browser session.
 *
 * acceptance-replay.mjs proves the recording and the planner in isolation.
 * This proves the part that isolation cannot: that a death in an actual match
 * produces an actual replay on screen, driven by the client's own recording,
 * with the camera cutting between shots and handing back cleanly on respawn.
 *
 * The client records what it was SENT, which is what makes killcams work in a
 * real multiplayer match where the server is someone else's machine. Several
 * checks below assert against the client recorder specifically for that
 * reason -- reading the in-process server instead would pass while the online
 * case was broken.
 */
import { launchBrowser } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await launchBrowser({ width: 1280, height: 720 });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

const settle = (ms) => new Promise((r) => { setTimeout(r, ms); });

try {
  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await enterMatch(page, { levelIndex: 0 });

  // Let a live round run so there is history to replay.
  await page.evaluate(async () => {
    window.__OPERATOR__.gameServer.match.beginLive();
    for (let i = 0; i < 300; i += 1) {
      await new Promise((r) => { requestAnimationFrame(r); });
    }
  });

  console.log('\n[1] The client records what it was sent');
  {
    const state = await page.evaluate(() => ({
      frames: window.__OPERATOR__.clientRecorder.frameCount,
      tick: window.__OPERATOR__.gameClient.tick,
    }));
    check('the client built its own recording', state.frames > 30,
      `${state.frames} frames`);
    // Bounded: a 12 s window at the snapshot rate cannot grow without limit.
    check('the recording is bounded', state.frames < 1200, `${state.frames} frames`);
  }

  console.log('\n[2] Dying plays a replay, not a still frame');
  let duringKillcam = null;
  {
    await page.evaluate(() => {
      const server = window.__OPERATOR__.gameServer;
      const me = server.world.getPlayer(window.__OPERATOR__.gameClient.id);
      const killer = server.ai.agentIds[0];
      server.damage.apply(server.world, {
        target: me, targetKind: 'player', amount: 500, type: 'bullet',
        source: killer, ignoreTeams: true, capabilityId: 'Shoot', weaponId: 'rifle',
        at: [me.px, me.py + 1.6, me.pz],
      });
    });
    // Poll for the OPENING shot rather than sleeping a fixed time.
    //
    // Snapshots are sent once per server update, so the clip advances at the
    // host's frame rate -- ~9 Hz in a headless browser against 60 Hz on a
    // real machine. Any fixed sleep therefore lands in a different part of
    // the clip on different hardware, which is a flaky test rather than a
    // real signal. Poll fast and keep the first state that shows a running
    // killcam.
    duringKillcam = null;
    for (let i = 0; i < 60; i += 1) {
      const s2 = await page.evaluate(() => window.__OPERATOR__.killcamState());
      if (s2.running && s2.clipFrames > 0) { duringKillcam = s2; break; }
      await settle(40);
    }
    duringKillcam ??= await page.evaluate(() => window.__OPERATOR__.killcamState());
    check('a killcam is running', duringKillcam.running === true);
    // The bar is "enough frames to be a replay rather than a stutter", not a
    // frame count -- the clip is as many frames as the host's rate produced
    // over the lead-in, which is ~8 headless and ~45 at 60 Hz. The growth
    // check in section 3 is what proves it is really a moving clip.
    check('it loaded recorded frames', duringKillcam.clipFrames >= 5,
      `${duringKillcam.clipFrames} frames over ${duringKillcam.duration.toFixed(2)}s`);
    check('it is playing, not frozen', duringKillcam.playing === true);
    // Caught at the very start, the playhead may legitimately still be at 0.
    check('the clip is positioned within itself',
      duringKillcam.position >= 0 && duringKillcam.position <= duringKillcam.duration,
      `${duringKillcam.position.toFixed(2)}s of ${duringKillcam.duration.toFixed(2)}s`);
    check('it opens on the killer, in first person',
      duringKillcam.shot?.kind === 'follow' && duringKillcam.shot?.firstPerson === true,
      `${duringKillcam.shot?.kind} firstPerson=${duringKillcam.shot?.firstPerson}`);

    // The playhead must actually move between two observations -- a clip that
    // loads and then sits still would satisfy every check above.
    const before = duringKillcam.position;
    let after = before;
    for (let i = 0; i < 30 && after <= before; i += 1) {
      await settle(50);
      after = await page.evaluate(() => window.__OPERATOR__.killcamState().position);
    }
    check('the playhead keeps moving', after > before,
      `${before.toFixed(2)}s -> ${after.toFixed(2)}s`);
  }

  console.log('\n[3] The camera cuts to the victim and slows at the kill');
  {
    // Poll rather than sampling once: slow motion is a window around the
    // impact tick, not a permanent state, so a single late read misses it.
    let sawSlowMo = false;
    let sawReaction = false;
    let grewTo = duringKillcam.clipFrames;
    for (let i = 0; i < 40; i += 1) {
      await settle(60);
      const s2 = await page.evaluate(() => window.__OPERATOR__.killcamState());
      if (!s2.running) break;
      if (s2.speed < 0.98) sawSlowMo = true;
      if (s2.shot?.kind === 'victim-reaction') sawReaction = true;
      grewTo = Math.max(grewTo, s2.clipFrames);
    }
    check('the clip grew as the tail was recorded',
      grewTo > duringKillcam.clipFrames,
      `${duringKillcam.clipFrames} -> ${grewTo} frames`);
    check('it cut to the victim reaction', sawReaction);
    check('playback slowed for the impact', sawSlowMo);
  }

  console.log('\n[4] Respawning hands the camera back');
  {
    await page.waitForFunction(
      () => window.__OPERATOR__.killcamState().running === false,
      { timeout: 15000 },
    );
    // Give the respawn itself time to land.
    await settle(2500);
    const after = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      const me = hook.gameClient.players.find((p) => p.id === hook.gameClient.id);
      return {
        killcam: hook.killcamState(),
        alive: me?.alive ?? false,
        health: me?.health ?? 0,
        state: hook.gameStateManager.getState(),
      };
    });
    check('the killcam stopped', after.killcam.running === false);
    check('the clip was released', after.killcam.clipFrames === 0,
      `${after.killcam.clipFrames} frames held`);
    check('the player is alive again', after.alive === true && after.health > 0,
      `hp ${after.health}`);
    check('and back in normal play', after.state === 'PLAYING', after.state);
    check('the recorder kept running through it all',
      after.killcam.recordedFrames > 30, `${after.killcam.recordedFrames} frames`);
  }

  console.log('\n[5] It survives dying repeatedly');
  {
    // Three deaths back to back. A killcam that leaks state across deaths
    // shows the PREVIOUS death's footage, which is worse than showing none.
    let ok = true;
    let detail = '';
    for (let i = 0; i < 3; i += 1) {
      // `i` must be passed in: the page callback runs in the BROWSER, which
      // has no access to this scope.
      await page.evaluate((index) => {
        const server = window.__OPERATOR__.gameServer;
        const me = server.world.getPlayer(window.__OPERATOR__.gameClient.id);
        if (!me?.alive) return;
        server.damage.apply(server.world, {
          target: me, targetKind: 'player', amount: 500, type: 'bullet',
          source: server.ai.agentIds[index % 4], ignoreTeams: true,
          capabilityId: 'Shoot', weaponId: 'rifle',
          at: [me.px, me.py + 1.6, me.pz],
        });
      }, i);
      await settle(450);
      const s = await page.evaluate(() => window.__OPERATOR__.killcamState());
      if (!s.running || s.position > 1.5) {
        ok = false;
        detail = `death ${i + 1}: running=${s.running} position=${s.position.toFixed(2)}s`;
      }
      await page.waitForFunction(
        () => window.__OPERATOR__.killcamState().running === false,
        { timeout: 15000 },
      );
      await settle(2500);
    }
    check('each death starts a fresh killcam from the beginning', ok,
      detail || 'three deaths, three clean clips');
  }

  console.log('\n[6] The client recording matches the server truth');
  {
    // The client records what it was SENT; the server records what actually
    // happened. In a local session those travel over an in-process transport
    // with no loss, so they must agree almost exactly -- any real gap here
    // means the recorder is dropping or mangling frames rather than that the
    // network is lossy. This is the diff that would GROW on a real network,
    // and it is worth being able to measure rather than assume.
    const diff = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      const server = hook.gameServer;
      const clientRec = hook.clientRecorder.recorder;

      const from = Math.max(clientRec.oldestTick, server.replay.oldestTick);
      const to = Math.min(clientRec.newestTick, server.replay.newestTick);
      if (to <= from) return { overlap: 0 };

      const mine = clientRec.window(from, to);
      const theirs = server.replay.window(from, to);
      const byTick = new Map(theirs.map((f) => [f.tick, f]));

      let compared = 0;
      let worst = 0;
      let total = 0;
      let missing = 0;

      for (const frame of mine) {
        const truth = byTick.get(frame.tick);
        if (!truth) { missing += 1; continue; }
        for (const p of frame.players) {
          const real = truth.players.find((q) => q.id === p.id);
          if (!real) continue;
          const d = Math.hypot(
            p.pos[0] - real.pos[0], p.pos[1] - real.pos[1], p.pos[2] - real.pos[2],
          );
          compared += 1;
          total += d;
          if (d > worst) worst = d;
        }
      }
      return {
        overlap: mine.length,
        missing,
        compared,
        worst,
        mean: compared ? total / compared : 0,
      };
    });

    check('the two recordings overlap', diff.overlap > 20, `${diff.overlap} frames`);
    check('the client is missing no frames the server has',
      diff.missing === 0, `${diff.missing} missing`);
    check('positions were actually compared', diff.compared > 100,
      `${diff.compared} player-frames`);
    check('client and server agree on where everyone was',
      diff.worst < 0.01,
      `worst ${diff.worst.toFixed(4)}m, mean ${diff.mean.toFixed(4)}m`);
  }

  console.log('\n[7] No errors along the way');
  check('the page raised no errors', pageErrors.length === 0,
    pageErrors[0] ?? 'clean');
} finally {
  await browser.close();
}

console.log(`\nKILLCAM (browser): ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
