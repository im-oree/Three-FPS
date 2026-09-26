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

  console.log('\n[7] Saving a clip happens off the main thread');
  {
    const result = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      const frames = hook.clientRecorder.recorder.window(
        hook.clientRecorder.recorder.oldestTick,
        hook.clientRecorder.recorder.newestTick,
      );

      // Watch for a main-thread stall WHILE the encode runs. rAF deltas are
      // the honest measure: if the codec were running inline, the gap between
      // frames would balloon for as long as the encode took.
      const gaps = [];
      let previous = performance.now();
      let watching = true;
      const watch = () => {
        const now = performance.now();
        gaps.push(now - previous);
        previous = now;
        if (watching) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);

      const started = performance.now();
      const encoded = await hook.replayCodec.encode(frames, true);
      const elapsed = performance.now() - started;
      watching = false;

      // Round-trip it to prove the bytes are real, not merely produced.
      const back = await hook.replayCodec.decode(encoded.bytes, encoded.compressed);

      return {
        frames: frames.length,
        bytes: encoded.bytes.byteLength,
        rawBytes: encoded.rawBytes,
        compressed: encoded.compressed,
        inline: encoded.inline,
        elapsed,
        worstGap: gaps.length ? Math.max(...gaps) : 0,
        decodedFrames: back.length,
        firstMatches: back.length > 0 && frames.length > 0
          && back[0].players.length === frames[0].players.length,
      };
    });

    check('the clip encoded', result.bytes > 0,
      `${result.frames} frames -> ${(result.bytes / 1024).toFixed(1)} KB`);
    check('it ran in a worker, not inline', result.inline === false);
    check('it was compressed', result.compressed === true,
      `${(result.rawBytes / 1024).toFixed(1)} KB -> ${(result.bytes / 1024).toFixed(1)} KB`);
    check('the main thread kept rendering throughout', result.worstGap < 150,
      `worst frame gap ${result.worstGap.toFixed(0)}ms during a ${result.elapsed.toFixed(0)}ms encode`);
    check('it decodes back to the same frames',
      result.decodedFrames === result.frames && result.firstMatches,
      `${result.decodedFrames} frames back`);
  }

  // --- [8] the theatre ------------------------------------------------------
  // The viewer is a THIN SHELL: it reads playback state and writes intent.
  // These checks drive it the way a director would -- open it, scrub it,
  // click a marker, follow someone, fly -- and assert on the camera and the
  // playhead rather than on the DOM alone, because a timeline that moves a
  // div without moving the camera is not a replay viewer.
  console.log('\n[8] The theatre');
  {
    const opened = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      hook.theatre.open();
      // The roster is populated from the first rendered frame, not from
      // open(): the cast is whatever the clip shows at the playhead, so
      // there is nothing to list until a frame has been sampled.
      for (let i = 0; i < 10; i += 1) await new Promise((r) => requestAnimationFrame(r));
      return hook.theatre.state();
    });
    check('the theatre opens with a loaded clip', opened.open === true
      && opened.frames > 2 && opened.duration > 1,
      `${opened.frames} frames, ${opened.duration.toFixed(1)}s`);
    check('it lists the cast from the recorded frame', opened.rosterRows > 1,
      `${opened.rosterRows} rows`);
    check('it starts on the free camera', opened.freeCamera === true
      && opened.followId === null);

    // The live HUD reports the present; the theatre shows the past. Both on
    // screen at once would caption a replay with the wrong numbers.
    const hudHidden = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.hud--offmatch'));
      const killfeed = document.querySelector('.killfeed');
      return {
        suppressed: nodes.length,
        killfeedHidden: !killfeed
          || killfeed.classList.contains('hud--offmatch')
          || getComputedStyle(killfeed).display === 'none',
      };
    });
    check('the live match HUD is suppressed behind it', hudHidden.suppressed > 0
      && hudHidden.killfeedHidden, `${hudHidden.suppressed} elements hidden`);

    // Scrub stress: the spec asks for this explicitly. Jumping the playhead
    // hundreds of times must not throw, must not leave the cursor out of
    // range, and must not strand the camera at a stale position.
    const scrub = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      const player = hook.theatre.player;
      const seen = [];
      let threw = null;
      try {
        for (let i = 0; i < 400; i += 1) {
          player.seekFraction((i * 0.017) % 1);
          const frame = player.sample();
          if (!frame) { threw = 'null frame'; break; }
          seen.push(player.position);
        }
      } catch (error) { threw = String(error); }
      return {
        threw,
        min: Math.min(...seen),
        max: Math.max(...seen),
        duration: player.duration,
        distinct: new Set(seen.map((v) => v.toFixed(3))).size,
      };
    });
    check('400 random seeks never throw', scrub.threw === null, scrub.threw ?? 'clean');
    check('...and the playhead stays inside the clip',
      scrub.min >= 0 && scrub.max <= scrub.duration + 1e-6,
      `${scrub.min.toFixed(2)}..${scrub.max.toFixed(2)} of ${scrub.duration.toFixed(2)}s`);
    check('...and actually moved', scrub.distinct > 50,
      `${scrub.distinct} distinct positions`);

    // Speed control across the spec's full 0.25x-4x range.
    const speeds = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      const out = [];
      for (const s of [0.25, 0.5, 1, 2, 4]) {
        hook.theatre.player.speed = s;
        out.push(hook.theatre.player.speed);
      }
      return out;
    });
    check('every offered speed from 0.25x to 4x is accepted',
      speeds.join(',') === '0.25,0.5,1,2,4', speeds.join(', '));

    // A marker is a seek. Markers come from the EVENT LOG, so this also
    // proves the timeline is driven by recorded events rather than a
    // hand-maintained list.
    const marker = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      const markers = Array.from(document.querySelectorAll('.theatre__marker'));
      if (!markers.length) return { markers: 0 };
      hook.theatre.player.seekFraction(0.999);
      const before = hook.theatre.player.position;
      markers[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
      return { markers: markers.length, before, after: hook.theatre.player.position };
    });
    check('the timeline carries markers built from the event log',
      marker.markers > 0, `${marker.markers} markers`);
    if (marker.markers > 0) {
      check('...and clicking one seeks the playhead to it',
        Math.abs(marker.after - marker.before) > 0.05,
        `${marker.before.toFixed(2)}s -> ${marker.after.toFixed(2)}s`);
    }

    // Following an entity. The camera must end up BEHIND and ABOVE the
    // subject -- the framing solver's job -- not inside its head.
    const follow = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      const frame = hook.theatre.player.sample();
      const subject = frame.players.find((p) => p.alive) ?? frame.players[0];
      const rows = Array.from(document.querySelectorAll('.theatre__roster-row'));
      const row = rows.find((r) => r.textContent.trim() === subject.name);
      if (row) row.click();
      hook.theatre.player.pause();
      // Let the shot glide in; the follow camera eases rather than snapping.
      for (let i = 0; i < 150; i += 1) await new Promise((r) => requestAnimationFrame(r));
      const now = hook.theatre.player.sample().players.find((p) => p.id === subject.id)
        ?? subject;
      const camera = hook.engine.sceneManager.getCamera();
      return {
        state: hook.theatre.state(),
        height: camera.position.y - now.pos[1],
        planar: Math.hypot(camera.position.x - now.pos[0], camera.position.z - now.pos[2]),
      };
    });
    check('clicking a player follows them', follow.state.followId !== null
      && follow.state.freeCamera === false, `following ${follow.state.followId}`);
    check('...from behind and above, not inside their head',
      follow.planar > 1.5 && follow.height > 0.8,
      `${follow.planar.toFixed(2)} m back, ${follow.height.toFixed(2)} m up`);
    check('...and the anti-clip solver vetted the position',
      follow.state.solve !== null
      && ['clear', 'pulled-back', 'reangled', 'fallback'].includes(follow.state.solve.method),
      follow.state.solve ? follow.state.solve.method : 'never ran');

    // The camera follows an ENTITY ID and knows nothing about what it is
    // following, so cycling to the next subject is a pure id swap.
    const cycled = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      const before = hook.theatre.state().followId;
      hook.theatre.freeCamera.onCycleTarget();
      await new Promise((r) => requestAnimationFrame(r));
      return { before, after: hook.theatre.state().followId };
    });
    check('cycling moves to a different subject',
      cycled.after !== null && cycled.after !== cycled.before,
      `${cycled.before} -> ${cycled.after}`);

    // Free flight. Driven through the rig's own key handling, so this tests
    // the real input path rather than a private setter.
    const flew = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      const rig = hook.theatre.freeCamera;
      const rows = Array.from(document.querySelectorAll('.theatre__roster-row'));
      rows[0].click(); // "Free camera"
      const camera = hook.engine.sceneManager.getCamera();
      const from = camera.position.clone();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      for (let i = 0; i < 60; i += 1) await new Promise((r) => requestAnimationFrame(r));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      await new Promise((r) => requestAnimationFrame(r));
      return {
        moved: camera.position.distanceTo(from),
        enabled: rig.isEnabled,
        freeCamera: hook.theatre.state().freeCamera,
      };
    });
    check('selecting Free camera hands control back to the rig',
      flew.enabled === true && flew.freeCamera === true);
    check('...and W flies it through the scene', flew.moved > 0.5,
      `${flew.moved.toFixed(2)} m travelled`);

    // Playback does ZERO physics and ZERO AI -- it is decode plus
    // interpolate. If the theatre were stepping the simulation, pausing it
    // would still leave bodies drifting.
    const frozen = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      hook.theatre.player.pause();
      const at = () => hook.theatre.player.sample().players
        .map((p) => p.pos.join(',')).join('|');
      const before = at();
      for (let i = 0; i < 40; i += 1) await new Promise((r) => requestAnimationFrame(r));
      return { same: before === at(), playing: hook.theatre.player.isPlaying };
    });
    check('paused playback advances nothing -- no physics, no AI',
      frozen.same === true && frozen.playing === false);

    // Save Clip must produce real, decodable bytes.
    const saved = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      const recorder = hook.clientRecorder.recorder;
      const frames = recorder.window(recorder.oldestTick, recorder.newestTick);
      const encoded = await hook.replayCodec.encode(frames, true);
      const back = await hook.replayCodec.decode(encoded.bytes, encoded.compressed);
      return { bytes: encoded.bytes.byteLength, frames: frames.length, back: back.length };
    });
    check('Save Clip produces bytes that decode back to the same frames',
      saved.bytes > 0 && saved.back === saved.frames,
      `${(saved.bytes / 1024).toFixed(1)} KB, ${saved.back} frames`);

    // Closing must hand everything back: HUD, camera, input context.
    const closed = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      hook.theatre.close();
      for (let i = 0; i < 30; i += 1) await new Promise((r) => requestAnimationFrame(r));
      return {
        open: hook.theatre.state().open,
        context: hook.inputContexts.current(),
        hidden: document.querySelectorAll('.hud--offmatch').length,
        screenVisible: getComputedStyle(hook.theatre.screen.element).display !== 'none',
      };
    });
    check('closing releases the camera and the input context',
      closed.open === false && closed.context === 'gameplay', closed.context);
    check('...and gives the match HUD back', closed.hidden === 0
      && closed.screenVisible === false, `${closed.hidden} still hidden`);
  }

  console.log('\n[9] No errors along the way');
  check('the page raised no errors', pageErrors.length === 0,
    pageErrors[0] ?? 'clean');
} finally {
  await browser.close();
}

console.log(`\nKILLCAM (browser): ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
