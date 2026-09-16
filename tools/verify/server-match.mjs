/**
 * server-match.mjs — end-to-end tests for spawns, death/respawn and modes.
 *
 * These drive the REAL GameServer against the REAL baked collision, at the
 * real tick rate. Nothing is stubbed: a death here is a bullet resolved by
 * CombatSystem, and a respawn is the spawn selector scoring the actual map.
 */
import { buildServerBundle, diskLevelFetcher, makeCheck } from './server-harness.mjs';

const {
  GameServer, CollisionWorld, ServerWorld, MatchSystem, SpawnSelector,
  FREE_FOR_ALL, TEAM_DEATHMATCH, getGameMode, customise,
  NameAuthority, NameRandom, Protocol, GAME_MODES,
} = await buildServerBundle();

const { check, report } = makeCheck();
const TICK = 1 / 60;

/** Run the server for `seconds` of simulated time. */
function run(server, seconds) {
  const ticks = Math.ceil(seconds / TICK);
  for (let i = 0; i < ticks; i += 1) server.update(TICK);
}

function freshServer(levelId = 'killhouse') {
  const server = new GameServer({ levelFetcher: diskLevelFetcher() });
  server.startMatch(levelId, 'ffa');
  return server;
}

// --- 1. spawn data ----------------------------------------------------------
console.log('\n[1] Spawn points exist and are usable');
{
  const server = freshServer();
  await server.whenLevelReady();

  check('the level ships FFA spawn points',
    server.match.spawns.countFor('ffa') >= 8,
    `${server.match.spawns.countFor('ffa')} FFA points`);

  check('the level ships both team spawn sets',
    server.match.spawns.countFor('teamA') >= 4
    && server.match.spawns.countFor('teamB') >= 4,
    `A=${server.match.spawns.countFor('teamA')} B=${server.match.spawns.countFor('teamB')}`);

  // Every point must be somewhere a body actually fits.
  const ranked = server.match.spawns.rank('ffa', [], [], server.collision, 0);
  const bad = ranked.filter(({ point }) => !server.collision.fits(
    point.pos[0], point.pos[1] + 0.05, point.pos[2], 0.42, 1.8,
  ));
  check('every FFA spawn point is standable',
    bad.length === 0,
    bad.length ? `${bad.length} unstandable` : `${ranked.length} points all clear`);

  // Team spawns must actually be on opposite sides, or "team spawn" is a lie.
  const a = server.match.spawns.rank('teamA', [], [], server.collision, 0);
  const b = server.match.spawns.rank('teamB', [], [], server.collision, 0);
  const meanZ = (list) => list.reduce((s, r) => s + r.point.pos[2], 0) / list.length;
  const separation = Math.abs(meanZ(a) - meanZ(b));
  check('the two team spawn sets are on opposite sides of the map',
    separation > 12, `centres ${separation.toFixed(1)} m apart`);

  server.shutdown();
}

// --- 2. spawn selection avoids danger --------------------------------------
console.log('\n[2] Spawn selection reacts to where the enemies are');
{
  const collision = new CollisionWorld();
  collision.load([
    { minX: -60, minY: -1, minZ: -60, maxX: 60, maxY: 0, maxZ: 60, surface: 'concrete' },
  ]);

  const selector = new SpawnSelector();
  selector.loadSets({
    ffa: [
      { pos: [-40, 0, 0], yaw: 0 },   // far from the enemy
      { pos: [40, 0, 0], yaw: 0 },    // right on top of him
    ],
  });

  const world = new ServerWorld();
  world.addPlayer('enemy');
  const enemy = world.getPlayer('enemy');
  enemy.px = 40; enemy.py = 0; enemy.pz = 0;

  const ranked = selector.rank('ffa', [enemy], [], collision, 0);
  check('a spawn next to an enemy scores below one far away',
    ranked[0].point.pos[0] === -40,
    `best is x=${ranked[0].point.pos[0]} (${ranked[0].score.toFixed(0)} vs `
    + `${ranked[1].score.toFixed(0)})`);

  // Line of sight must dominate raw distance. The enemy has to stand APART
  // from the point being scored, or the sightline is zero length and a wall
  // between them is meaningless -- which is what this test did at first.
  enemy.px = 20; enemy.pz = 0;
  const walled = new CollisionWorld();
  walled.load([
    { minX: -60, minY: -1, minZ: -60, maxX: 60, maxY: 0, maxZ: 60, surface: 'concrete' },
    { minX: 28, minY: 0, minZ: -10, maxX: 29, maxY: 4, maxZ: 10, surface: 'concrete' },
  ]);
  const before = selector.rank('ffa', [enemy], [], collision, 0)
    .find((r) => r.point.pos[0] === 40);
  const after = selector.rank('ffa', [enemy], [], walled, 0)
    .find((r) => r.point.pos[0] === 40);
  check('breaking line of sight improves a spawn score',
    after.score > before.score,
    `${before.score.toFixed(0)} -> ${after.score.toFixed(0)} with cover`);

  check('the selector reports whether a point is visible to an enemy',
    before.visibleToEnemy === true && after.visibleToEnemy === false,
    `exposed=${before.visibleToEnemy} covered=${after.visibleToEnemy}`);
}

// --- 3. spawns rotate rather than repeating --------------------------------
console.log('\n[3] Spawns rotate instead of handing out one point forever');
{
  const collision = new CollisionWorld();
  collision.load([
    { minX: -60, minY: -1, minZ: -60, maxX: 60, maxY: 0, maxZ: 60, surface: 'concrete' },
  ]);
  const selector = new SpawnSelector();
  selector.loadSets({
    ffa: [
      { pos: [-40, 0, 0], yaw: 0 },
      { pos: [0, 0, 40], yaw: 0 },
      { pos: [40, 0, 0], yaw: 0 },
      { pos: [0, 0, -40], yaw: 0 },
    ],
  });
  const picks = new Set();
  for (let i = 0; i < 6; i += 1) {
    const p = selector.select('ffa', [], [], collision, i * 0.5);
    picks.add(`${p.pos[0]},${p.pos[2]}`);
  }
  check('repeated spawns do not all land on the same point',
    picks.size >= 2, `${picks.size} distinct points over 6 spawns`);
}

// --- 4. death no longer ends the match -------------------------------------
console.log('\n[4] Death is a state change, not the end of the match');
{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.beginLive();

  server.world.addPlayer('victim');
  server.match.addPlayer('victim', 'Victim');
  const victim = server.world.getPlayer('victim');
  victim.px = 0; victim.py = 0; victim.pz = 0;

  server.match.registerDeath(server.world, victim);
  run(server, 0.1);

  check('a dead player is marked dead, and the match keeps running',
    victim.alive === false && server.match.currentPhase === 'live',
    `alive=${victim.alive} phase=${server.match.currentPhase}`);

  const events = server.match.consumeEvents();
  const death = events.find((e) => e.kind === 'death');
  check('the death is published as an event with a respawn time',
    death !== undefined && death.respawnAt > 0,
    death ? `respawn at t=${death.respawnAt.toFixed(2)}` : 'no death event');

  check('the death record carries what a killcam needs',
    death?.record.victim === 'victim'
    && Array.isArray(death.record.victimPos)
    && typeof death.record.at === 'number',
    death ? `victim=${death.record.victim} at t=${death.record.at.toFixed(2)}` : '-');

  server.shutdown();
}

// --- 5. respawn actually happens -------------------------------------------
console.log('\n[5] A dead player comes back');
{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.beginLive();

  server.world.addPlayer('victim');
  server.match.addPlayer('victim', 'Victim');
  const victim = server.world.getPlayer('victim');
  victim.px = 0; victim.py = 0; victim.pz = 0;
  server.match.registerDeath(server.world, victim);

  // Still dead before the delay is up.
  run(server, FREE_FOR_ALL.respawnDelaySeconds - 1);
  const deadMidway = victim.alive === false;

  run(server, 2);
  check('the player is still dead during the respawn delay, alive after it',
    deadMidway && victim.alive === true,
    `mid=${deadMidway ? 'dead' : 'ALIVE'} after=${victim.alive ? 'alive' : 'DEAD'}`);

  check('respawning restores full health',
    victim.health === victim.maxHealth,
    `${victim.health}/${victim.maxHealth}`);

  check('respawning puts the player on a real spawn point, not where they died',
    Math.hypot(victim.px, victim.pz) > 1,
    `respawned at [${victim.px.toFixed(1)}, ${victim.pz.toFixed(1)}]`);

  check('the respawned player is standing on solid ground',
    server.collision.fits(victim.px, victim.py + 0.05, victim.pz, 0.42, 1.8),
    `fits at y=${victim.py.toFixed(2)}`);

  server.shutdown();
}

// --- 6. scoring -------------------------------------------------------------
console.log('\n[6] Kills score, and the scoreboard ranks');
{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.beginLive();

  for (const id of ['alpha', 'bravo']) {
    server.world.addPlayer(id);
    server.match.addPlayer(id, id.toUpperCase());
  }
  const bravo = server.world.getPlayer('bravo');

  // Three kills for alpha, via the same path a bullet takes.
  for (let i = 0; i < 3; i += 1) {
    bravo.alive = true; bravo.health = 100;
    server.match.registerDeath(server.world, bravo, {
      shooter: 'alpha', victim: 'bravo', zone: 'torso',
      damage: 100, distance: 12, point: [0, 0, 0], lethal: true,
    });
    // Clear the respawn timer so the next death registers.
    run(server, FREE_FOR_ALL.respawnDelaySeconds + 0.2);
  }

  const alphaScore = server.match.scoreOf('alpha');
  const bravoScore = server.match.scoreOf('bravo');
  check('kills are credited to the shooter',
    alphaScore.kills === 3 && alphaScore.score === 3,
    `alpha ${alphaScore.kills} kills, score ${alphaScore.score}`);

  check('deaths are credited to the victim',
    bravoScore.deaths === 3, `bravo ${bravoScore.deaths} deaths`);

  check('the killstreak counter tracks consecutive kills',
    alphaScore.streak === 3 && alphaScore.bestStreak === 3,
    `streak ${alphaScore.streak}, best ${alphaScore.bestStreak}`);

  const standings = server.match.standings();
  check('the scoreboard is sorted by score',
    standings[0].id === 'alpha' && standings[1].id === 'bravo',
    standings.map((s) => `${s.name}:${s.score}`).join(' '));

  server.shutdown();
}

// --- 7. FFA rules match Call of Duty ---------------------------------------
console.log('\n[7] Free-For-All uses the real Call of Duty rules');
{
  check('FFA is 30 kills',
    FREE_FOR_ALL.scoreLimit === 30, `${FREE_FOR_ALL.scoreLimit} kills`);
  check('FFA is a 10 minute match',
    FREE_FOR_ALL.timeLimitSeconds === 600, `${FREE_FOR_ALL.timeLimitSeconds}s`);
  check('FFA caps at 8 players',
    FREE_FOR_ALL.maxPlayers === 8, `${FREE_FOR_ALL.maxPlayers} players`);
  check('FFA awards the top three places',
    FREE_FOR_ALL.winningPlaces === 3, `top ${FREE_FOR_ALL.winningPlaces}`);
  check('Team Deathmatch is team based and scores higher',
    TEAM_DEATHMATCH.teamBased === true && TEAM_DEATHMATCH.scoreLimit === 75,
    `${TEAM_DEATHMATCH.scoreLimit} kills, teams=${TEAM_DEATHMATCH.teamBased}`);
}

// --- 8. the match ends on the score limit ----------------------------------
console.log('\n[8] The match ends by score and by clock');
{
  const server = freshServer();
  await server.whenLevelReady();
  // A 3-kill match, so the limit is reachable in a test.
  server.match.setMode(customise(FREE_FOR_ALL, { scoreLimit: 3, respawnDelaySeconds: 0.2 }));
  server.match.beginLive();

  for (const id of ['alpha', 'bravo']) {
    server.world.addPlayer(id);
    server.match.addPlayer(id, id.toUpperCase());
  }
  const bravo = server.world.getPlayer('bravo');

  for (let i = 0; i < 3; i += 1) {
    bravo.alive = true; bravo.health = 100;
    server.match.registerDeath(server.world, bravo, {
      shooter: 'alpha', victim: 'bravo', zone: 'torso',
      damage: 100, distance: 5, point: [0, 0, 0], lethal: true,
    });
    run(server, 0.5);
  }
  run(server, 0.2);

  check('reaching the score limit ends the match',
    server.match.currentPhase === 'ended', `phase=${server.match.currentPhase}`);

  const ended = server.match.consumeEvents().find((e) => e.kind === 'ended');
  check('the end event carries the final standings',
    ended !== undefined && ended.standings[0].id === 'alpha',
    ended ? `winner ${ended.standings[0].name} (${ended.reason})` : 'no end event');

  server.shutdown();
}

{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.setMode(customise(FREE_FOR_ALL, { timeLimitSeconds: 1 }));
  server.match.beginLive();
  run(server, 1.5);
  check('running out of time ends the match',
    server.match.currentPhase === 'ended',
    `phase=${server.match.currentPhase}, ${server.match.timeRemaining.toFixed(1)}s left`);
  server.shutdown();
}

// --- 9. the pre-match countdown --------------------------------------------
console.log('\n[9] Matches start with a countdown, then go live');
{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.setMode(customise(FREE_FOR_ALL, { startCountdownSeconds: 3 }));
  server.match.beginCountdown();

  check('the match begins in countdown, not live',
    server.match.currentPhase === 'countdown', server.match.currentPhase);

  run(server, 1.1);
  const ticks = server.match.consumeEvents().filter((e) => e.kind === 'countdown');
  check('the countdown publishes a tick per second',
    ticks.length >= 1, `${ticks.length} countdown events`);

  run(server, 2.5);
  const started = server.match.consumeEvents().some((e) => e.kind === 'started');
  check('the match goes live when the countdown finishes',
    server.match.currentPhase === 'live' && started,
    `phase=${server.match.currentPhase}`);

  server.shutdown();
}

// --- 10. custom matches -----------------------------------------------------
console.log('\n[10] A custom match is the same mode with different numbers');
{
  const custom = customise(FREE_FOR_ALL, {
    scoreLimit: 10, timeLimitSeconds: 120, respawnDelaySeconds: 1,
  });
  check('overrides apply and the rest of the mode is untouched',
    custom.scoreLimit === 10 && custom.timeLimitSeconds === 120
    && custom.id === 'ffa' && custom.maxPlayers === FREE_FOR_ALL.maxPlayers,
    `${custom.scoreLimit} kills / ${custom.timeLimitSeconds}s, still ${custom.id}`);

  const server = freshServer();
  await server.whenLevelReady();
  server.match.setMode(custom);
  server.match.beginLive();
  check('the server runs the customised clock',
    Math.abs(server.match.timeRemaining - 120) < 0.1,
    `${server.match.timeRemaining.toFixed(0)}s on the clock`);
  server.shutdown();
}

// --- 11. teams --------------------------------------------------------------
console.log('\n[11] Team Deathmatch splits players and pools their score');
{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.setMode(TEAM_DEATHMATCH);
  server.match.beginLive();

  for (let i = 0; i < 6; i += 1) {
    const id = `tp${i}`;
    server.world.addPlayer(id);
    server.match.addPlayer(id, `TP${i}`);
  }
  const teamA = [...Array(6).keys()].filter((i) => server.match.teamOf(`tp${i}`) === 'A');
  const teamB = [...Array(6).keys()].filter((i) => server.match.teamOf(`tp${i}`) === 'B');
  check('players are split evenly between the two teams',
    teamA.length === 3 && teamB.length === 3, `A=${teamA.length} B=${teamB.length}`);

  // A kill across teams scores; a kill on your own team does not.
  const victimB = server.world.getPlayer(`tp${teamB[0]}`);
  server.match.registerDeath(server.world, victimB, {
    shooter: `tp${teamA[0]}`, victim: victimB.id, zone: 'torso',
    damage: 100, distance: 8, point: [0, 0, 0], lethal: true,
  });
  const snap = server.match.snapshot();
  check('a cross-team kill scores for the killer\'s team',
    snap.teamScores.A === 1 && snap.teamScores.B === 0,
    `A=${snap.teamScores.A} B=${snap.teamScores.B}`);

  const friendly = server.world.getPlayer(`tp${teamA[1]}`);
  server.match.registerDeath(server.world, friendly, {
    shooter: `tp${teamA[0]}`, victim: friendly.id, zone: 'torso',
    damage: 100, distance: 3, point: [0, 0, 0], lethal: true,
  });
  const after = server.match.snapshot();
  check('a team kill costs the killer instead of scoring',
    after.teamScores.A === 0,
    `team A went ${snap.teamScores.A} -> ${after.teamScores.A}`);

  server.shutdown();
}

// --- 12. bots are indistinguishable from humans -----------------------------
console.log('\n[12] Bots are players, not "bots"');
{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.beginLive();

  const ids = [];
  for (let i = 0; i < 6; i += 1) ids.push(server.addBot());

  check('no bot id announces that it is a bot',
    ids.every((id) => !/bot/i.test(id)), ids.slice(0, 3).join(', '));

  const names = ids.map((id) => server.match.identities.nameOf(id));
  check('every bot has a human-looking display name',
    names.every((n) => n.length >= 2 && !/bot/i.test(n)),
    names.slice(0, 4).join(', '));

  check('bot names are unique',
    new Set(names).size === names.length, `${new Set(names).size}/${names.length} unique`);

  // The snapshot the client receives must not carry the bot flag.
  const publicState = JSON.stringify(server.world.getPlayerPublicState(ids[0]));
  check('the public player state contains no bot marker',
    !/bot|isBot|ai/i.test(publicState), publicState.slice(0, 90));

  check('bots appear on the scoreboard like anyone else',
    server.match.standings().length >= 6,
    `${server.match.standings().length} players on the board`);

  server.shutdown();
}

// --- 13. name authority -----------------------------------------------------
console.log('\n[13] Names are unique, sanitised and renameable');
{
  const authority = new NameAuthority();
  const rng = new NameRandom(12345);
  const generated = new Set();
  for (let i = 0; i < 200; i += 1) generated.add(authority.generateUnique(rng));
  check('200 generated names are all distinct',
    generated.size === 200, `${generated.size}/200`);

  const taken = authority.claim('Ghost_01', rng);
  const second = authority.claim('Ghost_01', rng);
  check('a name already taken is replaced rather than duplicated',
    taken === 'Ghost_01' && second !== 'Ghost_01',
    `first "${taken}", second "${second}"`);

  check('an illegal name is rejected',
    authority.rename('Ghost_01', '<script>').ok === false,
    authority.rename('Ghost_01', '<script>').reason);

  check('a legal rename is accepted',
    authority.rename('Ghost_01', 'Reaper9').ok === true, 'renamed');
}

// --- 14. a full live match with bots ----------------------------------------
console.log('\n[14] A live match with bots runs, scores and respawns');
{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.setMode(customise(FREE_FOR_ALL, { respawnDelaySeconds: 1 }));
  server.match.beginLive();

  const bots = [];
  for (let i = 0; i < 6; i += 1) bots.push(server.addBot());
  run(server, 3);

  const positions = bots.map((id) => {
    const p = server.world.getPlayer(id);
    return `${p.px.toFixed(0)},${p.pz.toFixed(0)}`;
  });
  check('bots spawn spread out, not stacked on one point',
    new Set(positions).size >= 4,
    `${new Set(positions).size}/${bots.length} distinct positions`);

  // Kill one and confirm the whole cycle works inside a running match.
  //
  // Pick a bot that is actually alive with no respawn already pending: after
  // three seconds of real fighting some of them are mid-respawn, and
  // registerDeath correctly refuses to kill a corpse twice.
  const victimId = bots.find((id) => {
    const p = server.world.getPlayer(id);
    return p.alive && server.match.respawnIn(id, server.world.time) === 0;
  }) ?? bots[0];
  const victim = server.world.getPlayer(victimId);
  const killer = bots.find((id) => id !== victimId);
  const before = { x: victim.px, z: victim.pz };
  const killsBefore = server.match.scoreOf(killer).kills;
  server.match.registerDeath(server.world, victim, {
    shooter: killer, victim: victim.id, zone: 'head',
    damage: 120, distance: 20, point: [victim.px, victim.py, victim.pz], lethal: true,
  });
  check('a bot death is registered like any other',
    victim.alive === false, 'bot is dead');

  run(server, 2);
  // Health is NOT asserted at exactly 100 here: this is a live firefight and
  // a respawned bot can legitimately be shot again within the two seconds
  // this waits. That it is alive at all is the property under test; the
  // "respawn restores full health" guarantee is asserted in [5], in
  // isolation, where nothing can interfere.
  check('the bot respawns and is alive again',
    victim.alive === true && victim.health > 0,
    `alive=${victim.alive} hp=${victim.health}`);

  check('the bot respawned somewhere else',
    Math.hypot(victim.px - before.x, victim.pz - before.z) > 1,
    `moved ${Math.hypot(victim.px - before.x, victim.pz - before.z).toFixed(1)} m`);

  check('the killer was credited',
    server.match.scoreOf(killer).kills === killsBefore + 1,
    `${server.match.identities.nameOf(killer)}: `
    + `${killsBefore} -> ${server.match.scoreOf(killer).kills} kills`);

  // The bots were fighting on their own for three seconds before any of this.
  // That is the real proof the loop works: kills nobody scripted.
  const organic = server.match.standings().reduce((n, s2) => n + s2.kills, 0);
  check('bots fight and kill each other without being told to',
    organic > 0, `${organic} kills scored by the bots themselves`);

  // And the bots kept simulating through all of it. Not every bot is alive
  // at any given instant -- they are shooting each other -- so the assertion
  // is that the population is intact and nobody has leaked out of the world.
  const present = [...server.world.allPlayers].length;
  const alive = [...server.world.allPlayers].filter((p) => p.alive).length;
  check('every bot is still in the match, alive or respawning',
    present === bots.length && alive > 0,
    `${alive}/${present} alive right now`);

  server.shutdown();
}

// --- 15. a fresh match inherits nothing -------------------------------------
console.log('\n[15] Starting a new match leaves nothing behind');
{
  const server = freshServer();
  await server.whenLevelReady();
  server.match.beginLive();
  for (let i = 0; i < 4; i += 1) server.addBot();
  server.world.addPlayer('human');
  server.match.addPlayer('human', 'Human');
  const human = server.world.getPlayer('human');
  server.match.registerDeath(server.world, human);
  run(server, 1);

  const before = {
    players: server.world.playerCount,
    scores: server.match.standings().length,
    deaths: server.match.deathLog.length,
  };

  server.stopMatch('test');
  server.startMatch('shipment', 'ffa');
  await server.whenLevelReady();

  check('the previous match left players behind before the reset',
    before.players > 0 && before.scores > 0, `${before.players} players scored`);

  check('a new match starts with an empty scoreboard',
    server.match.standings().length === 0,
    `${server.match.standings().length} entries`);

  check('a new match starts with no death log',
    server.match.deathLog.length === 0, `${server.match.deathLog.length} deaths`);

  // A new match opens in its pre-match COUNTDOWN, not in warmup. 'warmup' is
  // the state of a MatchSystem nobody has started yet, not a phase a real
  // match passes through -- and leaving a started match there was a genuine
  // bug, because tick() returns early for any non-live phase, so the clock
  // never ran and no kill was ever credited. The browser suite caught it.
  check('a new match starts in its countdown, with a full clock',
    server.match.currentPhase === 'countdown'
    && server.match.timeRemaining === FREE_FOR_ALL.timeLimitSeconds,
    `phase=${server.match.currentPhase} clock=${server.match.timeRemaining}`);

  check('the new level\'s own spawn points are loaded',
    server.match.spawns.countFor('ffa') > 0,
    `${server.match.spawns.countFor('ffa')} points on shipment`);

  server.shutdown();
}

// --- every registered mode, on every hostable map --------------------------
// Quick Play picks a random mode AND a random map, and custom matches can
// pair any mode with any map. That is a matrix, not a single path, so it is
// tested as one: a mode that only works on the map it was written against is
// a mode Quick Play can still deploy someone into.
{
  const LEVELS = [
    'shipment', 'killhouse', 'facility',
    'training_range', 'firingrange', 'prototype',
  ];

  const fakeTransport = () => {
    let onMsg = () => {};
    return {
      transport: {
        onMessage: (f) => { onMsg = f; return () => {}; },
        onClose: () => () => {},
        send: () => {},
        close: () => {},
      },
      fire: (m) => onMsg(m),
    };
  };

  for (const mode of GAME_MODES) {
    for (const levelId of LEVELS) {
      const server = new GameServer({ levelFetcher: diskLevelFetcher() });
      const link = fakeTransport();
      server.accept(link.transport);
      link.fire({ t: 'joinMatch', levelId, modeId: mode.id });
      await server.whenLevelReady();
      for (let i = 0; i < 60 * 90; i += 1) server.update(1 / 60);

      const log = server.match.deathLog;
      const byPlayer = log.filter((d) => d.killer !== null).length;
      const fell = log.filter((d) => d.killer === null).length;
      const label = `${mode.id}/${levelId}`;

      // Nobody may leave the world. A fall is either a hole in the map or a
      // missing fence, and both used to go unnoticed because the victim just
      // dropped forever instead of dying.
      check(`${label}: nobody falls out of the world`,
        fell === 0, `${fell} of ${log.length} deaths were falls`);

      // The point of a match is that people fight in it. A map where the AI
      // cannot find anyone is a map Quick Play must not be able to roll.
      check(`${label}: players actually fight`,
        byPlayer >= 2, `${byPlayer} kills by a player in 90 s`);

      if (mode.teamBased) {
        const teams = new Set(server.world.playerIds().map((id) => server.match.teamOf(id)));
        check(`${label}: splits into two teams`,
          teams.has('A') && teams.has('B'), [...teams].join('/'));
      }
      server.shutdown();
    }
  }
}

// --- the map's scale decides the lobby, unless the host said otherwise -----
{
  const fakeTransport = () => {
    let onMsg = () => {};
    return {
      transport: {
        onMessage: (f) => { onMsg = f; return () => {}; },
        onClose: () => () => {},
        send: () => {},
        close: () => {},
      },
      fire: (m) => onMsg(m),
    };
  };
  const populate = async (levelId, rules) => {
    const server = new GameServer({ levelFetcher: diskLevelFetcher() });
    const link = fakeTransport();
    server.accept(link.transport);
    link.fire({ t: 'joinMatch', levelId, modeId: 'ffa', ...(rules ? { rules } : {}) });
    await server.whenLevelReady();
    for (let i = 0; i < 60; i += 1) server.update(1 / 60);
    const n = server.world.playerIds().length;
    server.shutdown();
    return n;
  };

  check('a normal-sized map uses the mode\'s player count',
    await populate('shipment') === FREE_FOR_ALL.maxPlayers,
    `${await populate('shipment')} players`);

  // 520 m across: eight players here average 258 m apart and manage one kill
  // a minute, which is not a match.
  check('a large map raises the lobby to fit its scale',
    await populate('prototype') > FREE_FOR_ALL.maxPlayers,
    `${await populate('prototype')} players on prototype`);

  check('a host\'s explicit player count beats the map\'s preference',
    await populate('prototype', { maxPlayers: 4 }) === 4,
    `${await populate('prototype', { maxPlayers: 4 })} players`);
}

// --- the kill plane is the SERVER's rule ------------------------------------
{
  const server = new GameServer({ levelFetcher: diskLevelFetcher(), fillLobby: false });
  server.startMatch('shipment', 'ffa');
  await server.whenLevelReady();
  const id = server.addBot();
  const victim = server.world.getPlayer(id);
  const before = server.match.deathLog.length;
  // Drop them through the floor the way a collision gap would.
  victim.py = -400;
  server.update(1 / 60);

  check('a player below the kill plane dies instead of falling forever',
    server.match.deathLog.length === before + 1 && !victim.alive,
    `alive=${victim.alive}, deaths ${before} -> ${server.match.deathLog.length}`);

  const record = server.match.deathLog[server.match.deathLog.length - 1];
  check('falling out of the world is nobody\'s kill',
    record.killer === null, `killer=${record.killer}`);
  server.shutdown();
}

report('MATCH');
