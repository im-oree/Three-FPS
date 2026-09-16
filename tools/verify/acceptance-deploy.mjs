/**
 * acceptance-deploy.mjs — end-to-end, in a real browser, for the match layer.
 *
 * The server-side suite (`verify:match`) proves the RULES. This proves the
 * GAME: that a real client, driving the real menu, joins a populated match,
 * dies, watches a death camera, counts down and respawns — without the match
 * ending, and without the old game-over screen appearing.
 *
 * Every check here targets something that was broken or missing before this
 * migration, so a regression shows up as a named failure rather than a vague
 * "the game feels wrong".
 *
 * Run:  npm run verify:deploy      (dev server must be up on :5174)
 */
import { launchBrowser, collectDiagnostics } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const URL = process.env.OPERATOR_URL || 'http://127.0.0.1:5174/';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
collectDiagnostics(page);

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await enterMatch(page, { levelIndex: 0 });

  // --- [1] The lobby is populated -----------------------------------------
  console.log('\n[1] A match is a populated lobby, not an empty map');
  {
    const lobby = await page.evaluate(() => {
      const server = window.__OPERATOR__.gameServer;
      const match = window.__OPERATOR__.gameClient?.match;
      return {
        players: match ? match.standings.length : 0,
        names: match ? match.standings.map((r) => r.name) : [],
        ids: match ? match.standings.map((r) => r.id) : [],
        mode: match?.modeName ?? null,
        limit: match?.scoreLimit ?? 0,
        worldPlayers: server ? server.world.playerCount : 0,
      };
    });

    check('the lobby fills to the mode\'s player count',
      lobby.players === 8, `${lobby.players} players in the scoreboard`);
    check('the mode and its score limit reach the client',
      lobby.mode === 'Free-For-All' && lobby.limit === 30,
      `${lobby.mode} to ${lobby.limit}`);

    // The identity requirement: nothing on the wire may mark a bot.
    const marked = lobby.ids.filter((id) => /bot|ai|npc|cpu/i.test(id));
    const namedBots = lobby.names.filter((n) => /bot|ai_|npc|cpu/i.test(n));
    check('no player id identifies itself as a bot',
      marked.length === 0, lobby.ids.join(' '));
    check('no player name identifies itself as a bot',
      namedBots.length === 0, lobby.names.slice(0, 4).join(', ') + ' ...');
    check('every player has a distinct name',
      new Set(lobby.names).size === lobby.names.length,
      `${new Set(lobby.names).size} unique of ${lobby.names.length}`);
  }

  // --- [2] Bots are real players, carrying real kit ------------------------
  console.log('\n[2] The other players carry real, varied loadouts');
  {
    const kit = await page.evaluate(() => {
      const server = window.__OPERATOR__.gameServer;
      const out = [];
      for (const id of server.world.playerIds()) {
        const state = server.world.getPlayerPublicState(id);
        const player = server.world.getPlayer(id);
        out.push({
          id,
          operator: state?.operatorId ?? null,
          primary: player?.loadout?.primaryId ?? null,
          name: state?.name ?? null,
          hasBotFlag: state ? Object.keys(state).some(
            (k) => /bot|ai|npc/i.test(k),
          ) : false,
        });
      }
      return out;
    });

    const operators = new Set(kit.map((k) => k.operator).filter(Boolean));
    const primaries = new Set(kit.map((k) => k.primary).filter(Boolean));
    check('players deploy as different operators',
      operators.size >= 3, [...operators].join(' '));
    check('players carry different primary weapons',
      primaries.size >= 2, [...primaries].join(' '));
    check('the public player state carries a name and an operator',
      kit.every((k) => k.name && k.operator),
      `${kit.length} players, all identified`);
    check('the public player state has no bot field',
      kit.every((k) => !k.hasBotFlag), 'no bot marker on the wire');
  }

  // --- [3] Spawns are spread, not stacked ---------------------------------
  console.log('\n[3] Players spawn spread across the map');
  {
    const spread = await page.evaluate(() => {
      const server = window.__OPERATOR__.gameServer;
      const pts = [];
      for (const id of server.world.playerIds()) {
        const p = server.world.getPlayer(id);
        if (p) pts.push([p.px, p.pz]);
      }
      let min = Infinity;
      let max = 0;
      for (let i = 0; i < pts.length; i += 1) {
        for (let j = i + 1; j < pts.length; j += 1) {
          const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
          min = Math.min(min, d);
          max = Math.max(max, d);
        }
      }
      return { count: pts.length, min, max };
    });

    check('no two players spawn on top of each other',
      spread.min > 1.5, `closest pair ${spread.min.toFixed(1)} m apart`);
    check('spawns are distributed across the map',
      spread.max > 12, `furthest pair ${spread.max.toFixed(1)} m apart`);
  }

  // --- [4] Death: the camera leaves the body, the match does not end -------
  console.log('\n[4] Dying runs a death camera — it does not end the match');
  {
    // A match opens in its 5 s pre-match countdown, exactly as COD does.
    // Wait it out: a death during the countdown is not the case under test.
    await page.waitForFunction(
      () => window.__OPERATOR__.gameClient.match?.phase === 'live',
      { timeout: 30000 },
    ).catch(() => {});

    // Kill the local player through the SERVER, the way a real death happens.
    const killed = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      const server = hook.gameServer;
      const me = hook.gameClient.id;
      const victim = server.world.getPlayer(me);
      if (!victim) return { ok: false };
      // Pick any other player as the killer, so the death is attributed and
      // the death card has a name on it.
      const killerId = server.world.playerIds().find((id) => id !== me);
      victim.health = 0;
      // ShotResult's field is `shooter`, and the weapon comes from the
      // killer's loadout -- the record is built from authoritative state, not
      // from whatever the caller claims.
      server.match.registerDeath(server.world, victim, {
        shooter: killerId, victim: me, zone: 'head', damage: 95,
        distance: 24.5, point: [victim.px, victim.py + 1.6, victim.pz],
        lethal: true,
      });
      return { ok: true, killerId };
    });
    check('the local player can be killed', killed.ok === true);

    await sleep(900);

    const dying = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      return {
        state: hook.gameStateManager.getState(),
        camActive: hook.deathCamera.isActive,
        overlay: hook.deathOverlay.isVisible,
        overlayText: document.querySelector('.death-overlay')?.textContent ?? '',
        countdown: document.querySelector('.death-countdown-number')?.textContent ?? '',
        gameOverVisible: document.querySelector('[data-screen="gameOver"]')
          ?.classList.contains('screen--active') ?? false,
        matchPhase: hook.gameClient.match?.phase ?? null,
        mask: hook.getWorldPassMask(),
      };
    });

    check('the game does NOT go to the game-over screen',
      dying.state === 'PLAYING' && !dying.gameOverVisible,
      `state=${dying.state}`);
    check('the match is still live',
      dying.matchPhase === 'live', `phase=${dying.matchPhase}`);
    check('the death camera detached from the player',
      dying.camActive === true);
    check('the death card names the killer',
      dying.overlay && /KILLED BY/.test(dying.overlayText),
      dying.overlayText.replace(/\s+/g, ' ').slice(0, 64));
    check('a respawn countdown is running',
      /^[0-9]+$/.test(dying.countdown.trim()),
      `showing "${dying.countdown}"`);

    // The killfeed row for THIS death, checked immediately: rows live for 7 s
    // by design, so this has to be asserted now rather than after a long wait.
    const feedNow = await page.evaluate(() => ({
      rows: document.querySelectorAll('.killfeed__row').length,
      text: [...document.querySelectorAll('.killfeed__row')]
        .map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
      // The row you are involved in is highlighted, and your own name is
      // drawn in the "you" colour rather than the ally/enemy colours.
      youHighlighted: !!document.querySelector('.killfeed__row--mine')
        && !!document.querySelector('.killfeed__name--you'),
    }));
    check('the kill appears in the killfeed',
      feedNow.rows >= 1, feedNow.text.join(' | ') || 'no rows');
    check('your own death is highlighted in the feed',
      feedNow.youHighlighted === true);

    // The full-body fix: an external camera must draw head and arms.
    // WORLD(0) + CHARACTER(2) + HEAD(3) + BODY_ARMS(4) = 1+4+8+16 = 29.
    check('the external camera renders the FULL body, not just the torso',
      dying.mask === 29, `layer mask ${dying.mask} (world+character+head+arms)`);
  }

  // --- [5] The death camera actually moves --------------------------------
  console.log('\n[5] The death camera is a shot, not a freeze-frame');
  {
    const a = await page.evaluate(() => {
      const c = window.__OPERATOR__.engine.sceneManager.camera;
      return [c.position.x, c.position.y, c.position.z];
    });
    await sleep(700);
    const b = await page.evaluate(() => {
      const c = window.__OPERATOR__.engine.sceneManager.camera;
      return [c.position.x, c.position.y, c.position.z];
    });
    const moved = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    check('the camera orbits the body while the countdown runs',
      moved > 0.05, `moved ${moved.toFixed(3)} m in 0.7 s`);
  }

  // --- [6] Respawn returns control ----------------------------------------
  console.log('\n[6] The countdown ends in a respawn');
  {
    // FFA respawn is 3 s; wait past it with margin.
    await page.waitForFunction(
      () => window.__OPERATOR__.isAwaitingRespawn() === false,
      { timeout: 20000 },
    ).catch(() => {});
    await sleep(400);

    const after = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      const me = hook.gameClient.id;
      const p = hook.gameServer.world.getPlayer(me);
      return {
        awaiting: hook.isAwaitingRespawn(),
        camActive: hook.deathCamera.isActive,
        overlay: hook.deathOverlay.isVisible,
        alive: p?.alive ?? false,
        health: p?.health ?? 0,
        state: hook.gameStateManager.getState(),
        mask: hook.getWorldPassMask(),
      };
    });

    check('the player is alive again', after.alive === true && after.health > 0,
      `hp ${after.health}`);
    check('the death camera handed control back',
      after.camActive === false && after.awaiting === false);
    check('the death overlay is gone', after.overlay === false);
    check('the camera returned to the first-person mask',
      after.mask === 5, `layer mask ${after.mask} (world+character)`);
    check('the match never left PLAYING', after.state === 'PLAYING');
  }

  // --- [7] The killfeed reports the match ---------------------------------
  console.log('\n[7] The killfeed shows the match happening around you');
  {
    // Watch the match unfold rather than sampling it once at the end: feed
    // rows expire after 7 s, so a single late sample can see an empty feed
    // even though every kill was rendered.
    //
    // Progress is measured in MATCH time, not wall time: this harness runs on
    // software GL, where the render loop is slow enough that the simulation
    // advances at well under real time. Waiting "30 seconds" would mean
    // something different here than in a real browser.
    const observed = await page.evaluate(async () => {
      const hook = window.__OPERATOR__;
      const startClock = hook.gameClient.match?.timeRemaining ?? 0;
      let maxRows = 0;
      const samples = [];
      // Wall-clock ceiling. Generous because this harness runs on software
      // GL, where the simulation advances well under real time.
      const deadline = Date.now() + 150000;
      while (Date.now() < deadline) {
        const rows = document.querySelectorAll('.killfeed__row').length;
        if (rows > maxRows) {
          maxRows = rows;
          samples.push(...[...document.querySelectorAll('.killfeed__row')]
            .map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
        }
        const elapsed = startClock - (hook.gameClient.match?.timeRemaining ?? 0);
        const deaths = hook.gameServer.match.deathLog.length;
        // Budget in MATCH time. Measured directly against the server at the
        // real tick rate, eight bots produce 3-7 deaths per minute depending
        // on the map (killhouse is the slowest: 3 in the first 60 s). So 25 s
        // is not a safe window -- 55 s is, and the loop exits as soon as the
        // kills arrive rather than always waiting that long.
        if (deaths >= 3 || elapsed >= 55) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      return {
        maxRows,
        samples: samples.slice(0, 4),
        deaths: hook.gameServer.match.deathLog.length,
        matchElapsed: startClock - (hook.gameClient.match?.timeRemaining ?? 0),
        unscripted: hook.gameServer.match.deathLog
          .filter((d) => d.victim !== hook.gameClient.id).length,
      };
    });

    check('players kill each other without being scripted to',
      observed.unscripted >= 2,
      `${observed.unscripted} deaths among other players in `
      + `${observed.matchElapsed.toFixed(0)} s of match time`);
    check('the killfeed rendered those kills',
      observed.maxRows > 0,
      observed.samples.join(' | ') || `peak ${observed.maxRows} rows`);
  }

  // --- [8] The match clock and score are on screen -------------------------
  console.log('\n[8] The mode has a visible goal and a clock');
  {
    const bar = await page.evaluate(() => ({
      clock: document.querySelector('.match-bar__clock')?.textContent ?? '',
      mode: document.querySelector('.match-bar__mode')?.textContent ?? '',
      visible: !!document.querySelector('.match-bar'),
    }));
    check('the match clock is displayed and counting',
      /^\d+:\d{2}$/.test(bar.clock.trim()) && bar.clock.trim() !== '10:00',
      `clock reads ${bar.clock}`);
    check('the goal is displayed',
      /TO WIN|\d/.test(bar.mode), bar.mode);
  }

  // --- [9] Scores are accumulating ----------------------------------------
  console.log('\n[9] The scoreboard tracks the match');
  {
    const board = await page.evaluate(() => {
      const m = window.__OPERATOR__.gameClient.match;
      return {
        rows: m.standings.length,
        totalKills: m.standings.reduce((s, r) => s + r.kills, 0),
        sorted: m.standings.every((r, i, a) => i === 0 || a[i - 1].score >= r.score),
        anyDeaths: m.standings.some((r) => r.deaths > 0),
      };
    });
    check('kills are being credited', board.totalKills >= 2,
      `${board.totalKills} kills across the lobby`);
    check('kills are attributed to more than just the test\'s own scripted one',
      board.totalKills >= 2 && board.rows === 8,
      `${board.totalKills} kills over ${board.rows} players`);
    check('deaths are being recorded', board.anyDeaths === true);
    check('the scoreboard is sorted by score', board.sorted === true);
  }

  // --- [10] Operator selection is real ------------------------------------
  console.log('\n[10] The selected operator is the one deployed');
  {
    const operator = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      const me = hook.gameClient.id;
      return {
        chosen: hook.operatorRoster.selectedId_,
        deployed: hook.gameServer.world.getPlayerPublicState(me)?.operatorId,
      };
    });
    check('the server deployed the operator the player selected',
      operator.chosen === operator.deployed,
      `chose "${operator.chosen}", deployed "${operator.deployed}"`);
  }

  // --- [11] Map previews load ---------------------------------------------
  console.log('\n[11] Every map preview actually loads in the browser');
  {
    await page.evaluate(() => window.__OPERATOR__.quitToMenu());
    await sleep(900);
    await page.evaluate(() => {
      [...document.querySelectorAll('.cod__mode')]
        .find((n) => n.textContent.includes('MAPS'))?.click();
    });
    await sleep(700);

    const previews = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll('.mapcard[data-level-id]')];
      const results = [];
      for (const card of cards) {
        const id = card.dataset.levelId;
        const url = getComputedStyle(card.querySelector('.mapcard__shot'))
          .backgroundImage.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
        const ok = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = url;
        });
        results.push({ id, url, ok });
      }
      return results;
    });

    const broken = previews.filter((p) => !p.ok || p.ok.w < 100);
    check('every map card shows a real preview image',
      previews.length > 0 && broken.length === 0,
      broken.length ? `broken: ${broken.map((b) => b.id).join(' ')}`
        : `${previews.length} previews, all loaded`);
    const killhouse = previews.find((p) => p.id === 'killhouse');
    check('Killhouse\'s preview loads specifically',
      !!killhouse?.ok, killhouse ? `${killhouse.ok?.w}x${killhouse.ok?.h}` : 'no card');
    check('preview URLs are cache-busted',
      previews.every((p) => /\?v=\d+/.test(p.url)),
      previews[0]?.url.split('/').pop() ?? '');

    // Close the map window. Leaving it open stacks a SECOND window when the
    // next step clicks MAPS again, and the new window's cards sit under the
    // stale one -- the click lands on a card nobody can see.
    await page.evaluate(() => {
      for (const win of document.querySelectorAll('.mapwin')) win.remove();
    });
    await sleep(300);
  }

  // --- [12] Quitting to the menu resets the server completely -------------
  console.log('\n[12] Ending a match resets the server completely');
  {
    const reset = await page.evaluate(() => {
      const server = window.__OPERATOR__.gameServer;
      return {
        running: server.isRunning,
        level: server.activeLevelId,
        players: server.world.playerCount,
        agents: server.aiAgentCount,
        deaths: server.match.deathLog.length,
        standings: server.match.standings().length,
        phase: server.match.snapshot().phase,
      };
    });

    check('the match stopped', reset.running === false, `running=${reset.running}`);
    check('the level was unloaded', reset.level === null, `level=${reset.level}`);
    check('every player was dropped', reset.players === 0,
      `${reset.players} players remain`);
    check('the bot roster was discarded', reset.agents === 0,
      `${reset.agents} agents remain`);
    check('the scoreboard and death log were wiped',
      reset.standings === 0 && reset.deaths === 0,
      `${reset.standings} rows, ${reset.deaths} deaths`);

    // And the real test: a SECOND match must be a clean one.
    await enterMatch(page, { levelIndex: 1 });
    await sleep(1500);
    const second = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      const m = hook.gameClient.match;
      return {
        players: m?.standings.length ?? 0,
        kills: m ? m.standings.reduce((s, r) => s + r.kills, 0) : -1,
        deaths: m ? m.standings.reduce((s, r) => s + r.deaths, 0) : -1,
        level: hook.gameServer.activeLevelId,
        ids: m ? m.standings.map((r) => r.id) : [],
      };
    });

    check('a new match starts on the newly chosen level',
      second.level !== null, `level=${second.level}`);
    check('the new match is fully populated again',
      second.players === 8, `${second.players} players`);
    check('the new match starts from zero — no scores carried over',
      second.kills === 0 && second.deaths === 0,
      `${second.kills} kills, ${second.deaths} deaths`);
    check('player slots restart at p1 rather than continuing',
      second.ids.includes('p1'), second.ids.join(' '));
  }
  // --- [13] Custom matches actually change the rules ----------------------
  console.log('\n[13] A custom match hosts by the rules the host chose');
  {
    await page.evaluate(() => window.__OPERATOR__.quitToMenu());
    await sleep(800);

    // Open the custom match window through the real UI.
    await page.evaluate(() => {
      [...document.querySelectorAll('.cod__mode')]
        .find((n) => n.textContent.includes('CUSTOM MATCH'))?.click();
    });
    await sleep(500);

    const opened = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.custom__label')].map((n) => n.textContent),
      modes: [...document.querySelectorAll('.custom__row')][0]
        ? [...[...document.querySelectorAll('.custom__row')][0]
          .querySelectorAll('.custom__choice')].map((n) => n.textContent)
        : [],
    }));
    check('the custom match window offers the real tunables',
      opened.rows.includes('MODE') && opened.rows.includes('SCORE LIMIT')
      && opened.rows.includes('TIME LIMIT') && opened.rows.includes('WEATHER'),
      opened.rows.join(' '));
    check('the mode list comes from the server\'s own registry',
      opened.modes.some((m) => /FREE/.test(m))
      && opened.modes.some((m) => /TEAM/.test(m)),
      opened.modes.join(' '));

    // Host a Team Deathmatch, 10 score, 5 minutes, 4 players, foggy.
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.custom__row')];
      const pick = (label, text) => {
        const row = rows.find((r) => r.querySelector('.custom__label')
          ?.textContent === label);
        [...row.querySelectorAll('.custom__choice')]
          .find((c) => c.textContent === text)?.click();
      };
      pick('MODE', 'TEAM DEATHMATCH');
      pick('SCORE LIMIT', '10');
      pick('TIME LIMIT', '5 MIN');
      pick('PLAYERS', '4');
      pick('WEATHER', 'FOG');
      document.querySelector('.custom__foot .btn--primary').click();
    });

    await page.waitForFunction(
      () => window.__OPERATOR__.gameStateManager.getState() === 'PLAYING',
      { timeout: 90000 },
    );
    await sleep(2000);

    const hosted = await page.evaluate(() => {
      const hook = window.__OPERATOR__;
      const m = hook.gameClient.match;
      const mode = hook.gameServer.match.getMode();
      return {
        modeId: mode.id,
        teamBased: m?.teamBased,
        scoreLimit: m?.scoreLimit,
        timeLimit: mode.timeLimitSeconds,
        maxPlayers: mode.maxPlayers,
        players: m?.standings.length ?? 0,
        teams: m ? [...new Set(m.standings.map((r) => r.team))].sort() : [],
        fogDensity: hook.engine.sceneManager.scene.fog?.density ?? 0,
      };
    });

    check('the custom match runs the chosen MODE',
      hosted.modeId === 'tdm' && hosted.teamBased === true,
      `${hosted.modeId}, teamBased=${hosted.teamBased}`);
    check('the custom SCORE LIMIT is applied',
      hosted.scoreLimit === 10, `score limit ${hosted.scoreLimit}`);
    check('the custom TIME LIMIT is applied',
      hosted.timeLimit === 300, `${hosted.timeLimit} s`);
    check('the custom PLAYER COUNT is applied',
      hosted.maxPlayers === 4 && hosted.players === 4,
      `${hosted.players} players, cap ${hosted.maxPlayers}`);
    check('a team mode actually splits players into two teams',
      hosted.teams.length === 2 && hosted.teams.join('') === 'AB',
      `teams: ${hosted.teams.join(' ')}`);
    check('the chosen WEATHER changed the scene',
      hosted.fogDensity > 0.01, `fog density ${hosted.fogDensity.toFixed(4)}`);
  }

  // --- [14] The server refuses absurd custom rules ------------------------
  console.log('\n[13b] The custom match dialog never lies about the rules');
  {
    await page.evaluate(() => window.__OPERATOR__.quitToMenu());
    await sleep(900);
    await page.evaluate(() => {
      [...document.querySelectorAll('.cod__mode')]
        .find((n) => n.textContent.includes('CUSTOM MATCH'))?.click();
    });
    await sleep(600);

    const readRows = () => page.evaluate(() => {
      const rows = [...document.querySelectorAll('.custom__row')];
      const lit = {};
      for (const row of rows) {
        const label = row.querySelector('.custom__label').textContent.trim();
        lit[label] = [...row.querySelectorAll('.custom__choice--on')]
          .map((c) => c.textContent.trim()).join(',');
      }
      return { lit, summary: document.querySelector('.custom__summary').textContent };
    });

    const ffa = await readRows();
    check('every rule row shows a selection on open',
      Object.values(ffa.lit).every((v) => v.length > 0),
      Object.entries(ffa.lit).map(([k, v]) => `${k}=${v || 'NONE'}`).join(' '));

    // Switching mode must re-point every dependent row. The bug this guards:
    // PLAYERS stayed lit on FFA's 8 while the match actually ran TDM's 12.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.custom__row')]
        .find((r) => r.querySelector('.custom__label').textContent.includes('MODE'));
      [...row.querySelectorAll('.custom__choice')]
        .find((c) => c.textContent.includes('TEAM')).click();
    });
    await sleep(500);
    const tdm = await readRows();

    check('changing mode re-points the rule rows to that mode\'s defaults',
      tdm.lit.PLAYERS === '12' && tdm.lit['SCORE LIMIT'] === '75',
      `players=${tdm.lit.PLAYERS} score=${tdm.lit['SCORE LIMIT']}`);
    check('the summary agrees with the lit choices',
      tdm.summary.includes('12 players') && tdm.summary.includes('75 to win'),
      tdm.summary);

    await page.evaluate(() => {
      for (const win of document.querySelectorAll('.mapwin')) win.remove();
    });
    await sleep(250);
  }

  console.log('\n[13c] Quick Play rolls a real mode, and sandboxes are hostable');
  {
    await page.evaluate(() => window.__OPERATOR__.quitToMenu());
    await sleep(900);

    // The mode Quick Play picks must be one the SERVER actually implements.
    // It used to be hardcoded to 'ffa', so "random" only ever meant the map.
    const rolled = await page.evaluate(() => {
      const menu = window.__OPERATOR__.mainMenu;
      const ids = new Set();
      for (let i = 0; i < 200; i += 1) ids.add(menu.pickQuickPlayMode());
      return [...ids];
    });
    const known = await page.evaluate(
      () => window.__OPERATOR__.gameServer.knownModeIds?.()
        ?? ['ffa', 'tdm'],
    );
    check('Quick Play only ever rolls modes the server implements',
      rolled.length > 0 && rolled.every((id) => known.includes(id)),
      `rolled ${rolled.join(',')} / known ${known.join(',')}`);
    check('Quick Play actually varies the mode',
      rolled.length > 1, `${rolled.length} distinct modes in 200 rolls`);

    // A map kept out of the random pool must still be hostable by name.
    const custom = await page.evaluate(() => {
      const menu = window.__OPERATOR__.mainMenu;
      menu.openCustomMatch();
      const row = [...document.querySelectorAll('.custom__row')]
        .find((r) => r.querySelector('.custom__label').textContent.includes('MAP'));
      const labels = [...row.querySelectorAll('.custom__choice')]
        .map((c) => c.textContent.trim());
      return labels;
    });
    check('the custom-match map list includes the sandbox maps',
      custom.some((l) => l.includes('PROTOTYPE')),
      custom.join(', '));

    await page.evaluate(() => {
      for (const win of document.querySelectorAll('.mapwin')) win.remove();
    });
    await sleep(250);
  }

  console.log('\n[14] The server clamps what a client asks for');
  {
    const clamped = await page.evaluate(() => {
      const server = window.__OPERATOR__.gameServer;
      const before = server.match.getMode().id;
      // A hostile client asking for a one-tick win and a bot army.
      window.__OPERATOR__.gameClient.joinMatch('shipment', undefined, {
        modeId: 'ffa',
        rules: {
          scoreLimit: -5, maxPlayers: 10000,
          timeLimitSeconds: Number.NaN, respawnDelaySeconds: -100,
        },
      });
      return { before };
    });
    void clamped;
    await sleep(2500);

    const limits = await page.evaluate(() => {
      const mode = window.__OPERATOR__.gameServer.match.getMode();
      return {
        scoreLimit: mode.scoreLimit,
        maxPlayers: mode.maxPlayers,
        timeLimit: mode.timeLimitSeconds,
        respawn: mode.respawnDelaySeconds,
        agents: window.__OPERATOR__.gameServer.aiAgentCount,
      };
    });

    check('a negative score limit is clamped to something winnable',
      limits.scoreLimit >= 1, `score limit ${limits.scoreLimit}`);
    check('an absurd player count is clamped',
      limits.maxPlayers <= 32 && limits.agents <= 32,
      `cap ${limits.maxPlayers}, ${limits.agents} agents spawned`);
    check('a non-finite time limit is rejected, not stored',
      Number.isFinite(limits.timeLimit) && limits.timeLimit >= 60,
      `${limits.timeLimit} s`);
    check('a negative respawn delay is clamped to zero or more',
      limits.respawn >= 0, `${limits.respawn} s`);
  }
} catch (err) {
  console.error('\nHARNESS ERROR:', err.message);
  console.error(err.stack?.split('\n').slice(0, 6).join('\n'));
  failed += 1;
} finally {
  await browser.close();
}

console.log(`\nDEPLOY ACCEPTANCE: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
