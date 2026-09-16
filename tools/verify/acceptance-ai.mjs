/**
 * acceptance-ai.mjs — the AI agent contract, proven headlessly.
 *
 * Twelve checks, each aimed at a claim the architecture makes rather than at
 * an implementation detail. The important ones are the fairness checks: a bot
 * must not act on an enemy it cannot see, must not out-turn a human, and must
 * go through the same input pipeline a client does. Those are the properties
 * that would silently rot, and the ones worth a test.
 *
 * Runs against the real compiled server — no mocks, no stubs.
 */
import { buildServerBundle, diskLevelFetcher } from './server-harness.mjs';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); } else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const bundle = await buildServerBundle();
const {
  GameServer, CollisionWorld, ServerWorld,
  AISystem, SquadBlackboard, NavGrid, findPath, CapabilityRegistry,
  registerBuiltinCapabilities, approachAngle, SeededRandom, perceive, Beliefs,
  getDifficulty, plan,
} = bundle;

registerBuiltinCapabilities();

/** A simple walled room with a dividing wall, for line-of-sight tests. */
const ROOM = [
  { minX: -30, minY: -1, minZ: -30, maxX: 30, maxY: 0, maxZ: 30, surface: 'concrete' },
  { minX: -30, minY: 0, minZ: -30, maxX: -29, maxY: 4, maxZ: 30, surface: 'concrete' },
  { minX: 29, minY: 0, minZ: -30, maxX: 30, maxY: 4, maxZ: 30, surface: 'concrete' },
  { minX: -30, minY: 0, minZ: -30, maxX: 30, maxY: 4, maxZ: -29, surface: 'concrete' },
  { minX: -30, minY: 0, minZ: 29, maxX: 30, maxY: 4, maxZ: 30, surface: 'concrete' },
];
/** A solid divider across the middle of the room. */
const DIVIDER = { minX: -2, minY: 0, minZ: -20, maxX: 2, maxY: 4, maxZ: 20, surface: 'concrete' };

/**
 * A running server with hand-supplied geometry.
 *
 * Order matters: startMatch() calls resetAll() and then loads the level's own
 * collision, so boxes loaded before it are discarded and the AI never runs
 * (the earlier version of this helper left the server at tick 0 with an empty
 * world, which made the perception tests pass and fail for the wrong
 * reasons). Start first, then install the test geometry, then build nav.
 */
function makeServer(boxes = ROOM) {
  const server = new GameServer();
  server.startMatch('testroom');
  server.collision.load(boxes);
  server.ai.buildNavigation();
  // Live, not counting down: a real match freezes every player until the
  // round starts, and these checks are about how bots move once it has.
  server.match.beginLive();
  return server;
}

console.log('\n[1] A bot is a player, driven only by input');

{
  const server = makeServer();
  const id = server.addBot('alpha');
  const player = server.world?.getPlayer?.(id) ?? null;
  check('a bot is a real player record in the world',
    player !== null && player.id === id && player.maxHealth > 0,
    player ? `health ${player.health}/${player.maxHealth}` : 'missing');

  // Nothing but queueInput may move it. Run ticks and confirm the position
  // only ever changes through the movement system consuming input.
  // An idle bot must actually patrol. "It produced a frame" is not enough:
  // the first version of this check only asserted the coordinates were
  // finite, and it happily passed while two real bugs held the bot still
  // (Reload out-scoring Patrol forever, and a yaw-convention sign error that
  // made it turn a few degrees every tick and walk in circles).
  const before = { x: player.px, z: player.pz };
  for (let i = 0; i < 180; i += 1) server.update(1 / 60);
  const after = { x: player.px, z: player.pz };
  const travelled = Math.hypot(after.x - before.x, after.z - before.z);
  check('an idle bot patrols instead of standing still',
    travelled > 3, `travelled ${travelled.toFixed(2)} m in 3 s`);

  // And it must do so at a human pace — the same MOVEMENT constants a player
  // obeys, since it is moved by the same system.
  const speed = Math.hypot(player.vx, player.vz);
  check('the bot moves at human speed, not a scripted rate',
    speed > 0.5 && speed <= 8.2, `${speed.toFixed(2)} m/s`);
  check('the bot appears in the same snapshot stream as humans',
    [...server.world.allPlayers].some((p) => p.id === id));
}

console.log('\n[2] Fair perception');

{
  // Two bots either side of a solid divider: neither may see the other.
  const server = makeServer([...ROOM, DIVIDER]);
  const seer = server.addBot('seer', { difficulty: 'veteran' });
  const hidden = server.addBot('hidden');

  const seerPlayer = server.world.getPlayer(seer);
  const hiddenPlayer = server.world.getPlayer(hidden);
  seerPlayer.px = -10; seerPlayer.py = 0; seerPlayer.pz = 0;
  hiddenPlayer.px = 10; hiddenPlayer.py = 0; hiddenPlayer.pz = 0;
  // Face the seer directly at the hidden bot.
  seerPlayer.yaw = Math.atan2(-(hiddenPlayer.px - seerPlayer.px), hiddenPlayer.pz - seerPlayer.pz);

  // Both bots spawned on the same point before being moved, so they saw each
  // other on tick 1. Clear that memory: the question is whether they can
  // acquire each other THROUGH the wall, not whether they remember a real
  // sighting from before it was between them.
  server.ai.getAgent(seer).reset();
  server.ai.getAgent(hidden).reset();

  // Re-pin each tick: MovementSystem is free to move them, and a bot that
  // wanders out from behind the divider would pass this test for the wrong
  // reason.
  for (let i = 0; i < 30; i += 1) {
    seerPlayer.px = -10; seerPlayer.py = 0; seerPlayer.pz = 0;
    hiddenPlayer.px = 10; hiddenPlayer.py = 0; hiddenPlayer.pz = 0;
    server.update(1 / 60);
  }
  const agent = server.ai.getAgent(seer);
  const sawThroughWall = agent.beliefs.sightings.has(hidden);
  check('a bot cannot see an enemy through a wall',
    !sawThroughWall, sawThroughWall ? 'saw through the divider' : 'blocked');

  // Remove the wall; now it must see. Keep pinning them and keep the seer
  // facing the target: with the divider gone both bots are free to run off,
  // and a bot that has wandered out of its own field of view would fail this
  // for a reason that has nothing to do with perception.
  server.collision.load(ROOM);
  server.ai.buildNavigation();
  // With the wall gone the bot must acquire the target. Driving this through
  // the full server loop is unreliable for a reason that is not about
  // perception: AISystem runs last and re-queues the bot's OWN look input
  // every tick, so any yaw the test pins is overwritten before perceive()
  // next runs -- the bot is busy patrolling and is entitled to look where it
  // likes. Call perceive() directly instead: it is the unit under test, and
  // this is exactly the same function the running bot calls.
  server.collision.load(ROOM);
  server.ai.buildNavigation();

  const agentNow = server.ai.getAgent(seer);
  seerPlayer.px = -10; seerPlayer.py = 0; seerPlayer.pz = 0;
  hiddenPlayer.px = 10; hiddenPlayer.py = 0; hiddenPlayer.pz = 0;
  seerPlayer.yaw = Math.atan2(-(hiddenPlayer.px - seerPlayer.px), hiddenPlayer.pz - seerPlayer.pz);
  const fresh = new Beliefs();
  perceive(seerPlayer, server.world, server.collision, fresh, getDifficulty('veteran'), 16);
  const seesNow = fresh.sightings.has(hidden);
  check('a bot does see an enemy in the open', seesNow,
    seesNow ? 'acquired' : 'still blind with clear line of sight');

  // And the FOV cone points FORWARD: facing directly away must not see them.
  seerPlayer.yaw += Math.PI;
  const behind = new Beliefs();
  perceive(seerPlayer, server.world, server.collision, behind, getDifficulty('veteran'), 16);
  check('a bot does not see an enemy standing behind it',
    !behind.sightings.has(hidden),
    behind.sightings.has(hidden) ? 'saw through the back of its head' : 'blind behind');
}

console.log('\n[3] Reaction time gates engagement');

{
  const profile = getDifficulty('recruit');
  const veteran = getDifficulty('veteran');
  check('difficulty changes reaction time, not knowledge',
    profile.reactionMs > veteran.reactionMs
    && profile.viewRangeMeters < veteran.viewRangeMeters
    && !('omniscient' in profile) && !('seeThroughWalls' in profile),
    `recruit ${profile.reactionMs}ms vs veteran ${veteran.reactionMs}ms`);

  // A freshly acquired target must not be immediately engageable.
  const collision = new CollisionWorld();
  collision.load(ROOM);
  const world = new ServerWorld();
  world.addPlayer('a'); world.addPlayer('b');
  const a = world.getPlayer('a'); const b = world.getPlayer('b');
  // yaw 0 faces +Z (forward is (-sin, cos), matching MovementSystem), so the
  // target goes in FRONT at +Z. This previously read -8 and passed only
  // because Perception's FOV cone was inverted.
  a.px = 0; a.pz = 0; b.px = 0; b.pz = 8;
  a.yaw = 0;
  world.beginTick(1, 0);
  const beliefs = new Beliefs();
  perceive(a, world, collision, beliefs, profile, 16);
  const immediatelyReady = beliefs.focusReady;

  world.beginTick(2, profile.reactionMs / 1000 + 0.05);
  perceive(a, world, collision, beliefs, profile, 16);
  check('a bot may not shoot the instant a target appears',
    immediatelyReady === false && beliefs.focusReady === true,
    `ready after ${profile.reactionMs}ms, not before`);
}

console.log('\n[4] Human-bounded aiming');

{
  const profile = getDifficulty('veteran');
  // Ask for a 180 degree turn in one 60 Hz tick.
  const after = approachAngle(0, Math.PI, profile.maxTurnDegPerSecond, 1 / 60);
  const degrees = (after * 180) / Math.PI;
  const maxStep = profile.maxTurnDegPerSecond / 60;
  check('a bot cannot snap-turn faster than a human',
    degrees <= maxStep + 1e-6,
    `turned ${degrees.toFixed(1)}° in one tick, cap ${maxStep.toFixed(1)}°`);

  const rng = new SeededRandom(1234);
  const a = new SeededRandom(99); const b = new SeededRandom(99);
  const sameSeed = a.next() === b.next() && a.next() === b.next();
  check('agent randomness is seeded and reproducible', sameSeed && rng.next() !== rng.next());
}

console.log('\n[5] Capabilities are data');

{
  const ids = CapabilityRegistry.registered;
  check('capabilities register by id',
    ids.includes('Engage') && ids.includes('Patrol') && ids.includes('EnterVehicle'),
    ids.join(', '));

  // A bot given a restricted list must not have the others at all.
  const server = makeServer();
  const limited = server.addBot('limited', { capabilities: ['Patrol'] });
  const agent = server.ai.getAgent(limited);
  check('a bot only has the capabilities its loadout names',
    agent.capabilityIds.length === 1 && agent.capabilityIds[0] === 'Patrol',
    agent.capabilityIds.join(', '));

  // Adding one later must require no brain changes: register and use.
  class ParachuteCapability {
    id = 'Parachute'; tags = ['Movement'];
    traversableTags = ['air'];
    isAvailable() { return true; }
    scoreUtility() { return 0.01; }
    preconditions() { return { airborne: true }; }
    effects() { return { atLandingZone: true }; }
    cost() { return 1; }
    begin() { return { tick: () => ({}), isDone: () => true }; }
  }
  CapabilityRegistry.register('Parachute', () => new ParachuteCapability());
  const para = server.addBot('para', { capabilities: ['Patrol', 'Parachute'] });
  check('a new capability needs no change to any AI brain file',
    server.ai.getAgent(para).capabilityIds.includes('Parachute'));
}

console.log('\n[6] Planning chains capabilities it was never told about');

{
  // Two synthetic capabilities that only connect through their fact keys.
  const A = {
    id: 'GetKey', tags: [], isAvailable: () => true, scoreUtility: () => 0,
    preconditions: () => ({}), effects: () => ({ hasKey: true }), cost: () => 1,
    begin: () => ({ tick: () => ({}), isDone: () => true }),
  };
  const B = {
    id: 'OpenDoor', tags: [], isAvailable: () => true, scoreUtility: () => 0,
    preconditions: () => ({ hasKey: true }), effects: () => ({ doorOpen: true }), cost: () => 1,
    begin: () => ({ tick: () => ({}), isDone: () => true }),
  };
  const found = plan({}, { doorOpen: true }, [B, A], {});
  check('the planner discovers a multi-step sequence',
    Array.isArray(found) && found.length === 2
    && found[0].id === 'GetKey' && found[1].id === 'OpenDoor',
    found ? found.map((c) => c.id).join(' -> ') : 'no plan');

  const impossible = plan({}, { unreachableFact: true }, [A, B], {});
  check('an impossible goal returns no plan rather than hanging',
    impossible === null);
}

console.log('\n[7] Navigation is derived from real collision');

{
  const collision = new CollisionWorld();
  collision.load([...ROOM, DIVIDER]);
  const grid = NavGrid.build(collision, { minX: -30, maxX: 30, minZ: -30, maxZ: 30 });
  check('the nav grid finds standable ground', grid.walkableCount > 50,
    `${grid.walkableCount} walkable cells`);

  // (0,0) is the divider's ROOF at y=4, which is genuinely standable -- the
  // grid is right to include it. The property that actually matters is that
  // it is not CONNECTED to the floor 4 m below, or bots would path straight
  // through the wall by walking over its top.
  const roof = grid.cellAt(0, 0);
  const floorCell = grid.cellAt(-10, 0);
  check('the nav grid separates a wall top from the floor beside it',
    roof !== null && floorCell !== null
    && Math.abs(roof.y - floorCell.y) > 1
    && !grid.neighboursOf(roof.index).includes(floorCell.index),
    roof && floorCell ? `roof y=${roof.y}, floor y=${floorCell.y}, unlinked` : 'missing cells');

  // And a route from one side to the other must go AROUND, not through.
  const around = findPath(grid, [-10, 0, 0], [10, 0, 0], { tags: new Set(['ground']) });
  const crossesWall = around
    ? around.some((p) => Math.abs(p[0]) < 2.5 && Math.abs(p[2]) < 19 && p[1] < 1)
    : false;
  check('a route around a wall never passes through it',
    around !== null && !crossesWall,
    around ? `${around.length} waypoints, detours` : 'no route found');
}

console.log('\n[8] Squad coordination');

{
  const squad = new SquadBlackboard();
  const first = squad.claimRole('flank-left', 'bot:1', 0);
  const second = squad.claimRole('flank-left', 'bot:2', 0);
  check('two bots cannot hold the same role', first === true && second === false);

  const spotA = squad.claimPosition([0, 0, 0], 'bot:1', 0, 5);
  const spotB = squad.claimPosition([1, 0, 1], 'bot:2', 0, 5);
  const spotC = squad.claimPosition([20, 0, 20], 'bot:3', 0, 5);
  check('bots do not stack on the same position',
    spotA === true && spotB === false && spotC === true);
}

console.log('\n[9] Performance under a full lobby');

{
  const server = makeServer();
  for (let i = 0; i < 30; i += 1) server.addBot(`perf${i}`);

  // Warm up, then measure.
  for (let i = 0; i < 30; i += 1) server.update(1 / 60);
  const started = performance.now();
  const TICKS = 180;
  for (let i = 0; i < TICKS; i += 1) server.update(1 / 60);
  const perTick = (performance.now() - started) / TICKS;

  check('30 bots stay inside the frame budget', perTick < 4,
    `${perTick.toFixed(2)} ms/tick for 30 agents (budget 4 ms)`);
  check('every bot is still alive and thinking after the run',
    server.ai.agentCount === 30,
    `${server.ai.agentCount} agents`);
}

console.log('\n[10] Determinism');

{
  const run = () => {
    const server = makeServer();
    for (let i = 0; i < 4; i += 1) server.addBot(`det${i}`);
    for (let i = 0; i < 120; i += 1) server.update(1 / 60);
    return [...server.world.allPlayers]
      .map((p) => `${p.id}:${p.px.toFixed(4)},${p.pz.toFixed(4)}`).sort().join('|');
  };
  const a = run();
  const b = run();
  check('identical runs produce identical results', a === b,
    a === b ? 'bit-identical' : 'diverged');
}

// --- [11] Per-bot tuning: thirty veterans are thirty different players -------
console.log('\n[11] Bot profiles make individuals, not clones');
{
  const {
    createBotProfile, createSkillProfile, createPersonality, pickTier, maybeMistake,
  } = bundle;

  // Two bots on the SAME tier must not be the same player.
  const a = createBotProfile('bot-a', 'veteran');
  const b = createBotProfile('bot-b', 'veteran');
  const differs = a.skill.reactionMs !== b.skill.reactionMs
    || a.skill.aimConeDegrees !== b.skill.aimConeDegrees
    || a.skill.recoilControl !== b.skill.recoilControl;
  check('two bots of the same tier roll different stats',
    differs,
    `A ${a.skill.reactionMs.toFixed(0)}ms/${a.skill.aimConeDegrees.toFixed(2)}deg vs `
    + `B ${b.skill.reactionMs.toFixed(0)}ms/${b.skill.aimConeDegrees.toFixed(2)}deg`);

  // But the same bot is the same player every time — reproducible tests.
  const again = createBotProfile('bot-a', 'veteran');
  check('the same bot id always rolls the same profile',
    again.skill.reactionMs === a.skill.reactionMs
    && again.personality.aggression === a.personality.aggression,
    'identical on re-roll');

  // Tiers must actually order: a pro reacts faster and aims tighter.
  const recruit = createBotProfile('r', 'recruit');
  const pro = createBotProfile('p', 'pro');
  check('a pro reacts faster and shoots tighter than a recruit',
    pro.skill.reactionMs < recruit.skill.reactionMs
    && pro.skill.aimConeDegrees < recruit.skill.aimConeDegrees,
    `pro ${pro.skill.reactionMs.toFixed(0)}ms/${pro.skill.aimConeDegrees.toFixed(2)}deg vs `
    + `recruit ${recruit.skill.reactionMs.toFixed(0)}ms/`
    + `${recruit.skill.aimConeDegrees.toFixed(2)}deg`);

  // The humanity floor: no roll may produce superhuman reaction.
  const rng2 = new SeededRandom(99);
  let fastest = Infinity;
  for (let i = 0; i < 500; i += 1) {
    fastest = Math.min(fastest, createSkillProfile('pro', rng2).reactionMs);
  }
  check('no roll ever produces a superhuman reaction time',
    fastest >= 100, `fastest of 500 rolls was ${fastest.toFixed(0)}ms`);

  // Perception is NOT widened by the individual roll. This is the fairness
  // guarantee: skill changes execution, never what a bot can know.
  check('the top tier does not see further than a veteran',
    pro.difficulty.viewRangeMeters === createBotProfile('v', 'veteran')
      .difficulty.viewRangeMeters
    && pro.difficulty.fovDegrees === createBotProfile('v2', 'veteran')
      .difficulty.fovDegrees,
    `pro sees ${pro.difficulty.viewRangeMeters}m / ${pro.difficulty.fovDegrees}deg`);

  // No profile field may leak world knowledge.
  const fields = Object.keys(a.skill).concat(Object.keys(a.personality)).join(' ');
  check('no skill or personality field grants information',
    !/omniscien|wallhack|seeThrough|knowsEnemy|trueposition/i.test(fields),
    `${Object.keys(a.skill).length} skill + `
    + `${Object.keys(a.personality).length} personality fields, none informational`);

  // Personalities spread out rather than clustering on one archetype.
  const rng3 = new SeededRandom(7);
  const aggressions = [];
  for (let i = 0; i < 60; i += 1) aggressions.push(createPersonality(rng3).aggression);
  const spread = Math.max(...aggressions) - Math.min(...aggressions);
  check('personalities span a real range of aggression',
    spread > 0.6, `aggression spans ${spread.toFixed(2)}`);

  // Tier distribution fills a lobby with a believable mix.
  const rng4 = new SeededRandom(2024);
  const tiers = {};
  for (let i = 0; i < 400; i += 1) {
    const t = pickTier(rng4);
    tiers[t] = (tiers[t] ?? 0) + 1;
  }
  check('a filled lobby draws a mix of skill tiers',
    Object.keys(tiers).length >= 4,
    Object.entries(tiers).map(([k, v]) => `${k}:${v}`).join(' '));

  // Mistakes are bounded by the bot's own mistake rate.
  const rngM = new SeededRandom(5);
  const flawless = { ...a.skill, mistakeRate: 0 };
  const sloppy = { ...a.skill, mistakeRate: 1 };
  const options = ['best', 'worse', 'worst'];
  let flawlessKept = 0;
  let sloppyKept = 0;
  for (let i = 0; i < 100; i += 1) {
    if (maybeMistake('best', options, flawless, rngM) === 'best') flawlessKept += 1;
    if (maybeMistake('best', options, sloppy, rngM) === 'best') sloppyKept += 1;
  }
  check('mistake rate governs how often a bot picks a worse option',
    flawlessKept === 100 && sloppyKept === 0,
    `flawless kept ${flawlessKept}/100, sloppy kept ${sloppyKept}/100`);
}

console.log('\n[12] Navigation maps the floor, not the roof');

{
  // The bug this guards: NavGrid probed each column with a single downward
  // ray and kept the FIRST hit. On a roofed map that is the roof -- Killhouse
  // ended up with its roof (y=10.75) as the largest "walkable" region while
  // the actual floor was cut into 22 disconnected pockets. Bots spawned in
  // pockets they could not path out of, and the map produced 2 kills/minute
  // against Shipment's 12.
  const { getNavGrid } = bundle;

  const islandsOf = (grid) => {
    const comp = new Array(grid.cells.length).fill(-1);
    const sizes = [];
    let next = 0;
    for (let i = 0; i < grid.cells.length; i += 1) {
      if (!grid.cells[i] || comp[i] >= 0) continue;
      let n = 0;
      const stack = [i];
      comp[i] = next;
      while (stack.length) {
        const k = stack.pop();
        n += 1;
        for (const nb of grid.neighbours[k]) {
          if (comp[nb] < 0) { comp[nb] = next; stack.push(nb); }
        }
      }
      sizes.push(n);
      next += 1;
    }
    return { comp, sizes };
  };

  for (const levelId of ['killhouse', 'facility', 'shipment']) {
    const server = new GameServer({ levelFetcher: diskLevelFetcher() });
    let fire = () => {};
    server.accept({
      onMessage: (f) => { fire = f; return () => {}; },
      onClose: () => () => {},
      send: () => {},
      close: () => {},
    });
    fire({ t: 'joinMatch', levelId, modeId: 'ffa' });
    await server.whenLevelReady();
    server.ai.buildNavigation();

    const grid = getNavGrid();
    const { comp, sizes } = islandsOf(grid);
    const main = sizes.indexOf(Math.max(...sizes));

    const ids = server.world.playerIds();
    const stranded = ids.filter((id) => {
      const p = server.world.getPlayer(id);
      const idx = grid.indexAt(p.px, p.pz);
      return idx < 0 || comp[idx] !== main;
    });
    check(`${levelId}: every player spawns on the main walkable region`,
      stranded.length === 0, `${stranded.length} of ${ids.length} stranded`);

    const mainYs = grid.cells
      .filter((c, i) => c && comp[i] === main)
      .map((c) => c.y)
      .sort((a, b) => a - b);
    const spawnY = server.world.getPlayer(ids[0]).py;
    const medianY = mainYs[Math.floor(mainYs.length / 2)];
    check(`${levelId}: the main region is the floor, not the roof`,
      Math.abs(medianY - spawnY) < 2.5,
      `main region y=${medianY.toFixed(2)} vs spawn y=${spawnY.toFixed(2)}`);

    server.shutdown();
  }
}

console.log('\n[13] Bots actually fight on every map');

{
  // A map where bots cannot reach each other looks fine in a screenshot and
  // is dead to play. Measured against the real server at the real tick rate.
  for (const [levelId, floor] of [['killhouse', 8], ['shipment', 8], ['facility', 4]]) {
    const server = new GameServer({ levelFetcher: diskLevelFetcher() });
    let fire = () => {};
    server.accept({
      onMessage: (f) => { fire = f; return () => {}; },
      onClose: () => () => {},
      send: () => {},
      close: () => {},
    });
    fire({ t: 'joinMatch', levelId, modeId: 'ffa' });
    await server.whenLevelReady();

    const ids = server.world.playerIds();
    const before = ids.map((id) => {
      const p = server.world.getPlayer(id);
      return [p.px, p.pz];
    });
    for (let i = 0; i < 60 * 60; i += 1) server.update(1 / 60);
    const moved = ids.filter((id, k) => {
      const p = server.world.getPlayer(id);
      return Math.hypot(p.px - before[k][0], p.pz - before[k][1]) > 1;
    }).length;

    check(`${levelId}: a minute of play produces real fighting`,
      server.match.deathLog.length >= floor,
      `${server.match.deathLog.length} deaths in 60 s (floor ${floor})`);
    check(`${levelId}: bots leave their spawn`,
      moved >= Math.ceil(ids.length * 0.75),
      `${moved} of ${ids.length} moved`);
    server.shutdown();
  }
}

// --- [14] Motion quality: bots move like players, not like turrets --------
// These are the numbers that separate "a thing walking around" from "a
// player". Each one is a bug we actually shipped and fixed.
console.log('\n[14] Bots move like players');
for (const levelId of ['shipment', 'killhouse', 'facility']) {
  const server = new GameServer({ levelFetcher: diskLevelFetcher() });
  let fire = () => {};
  server.accept({
    onMessage: (f) => { fire = f; return () => {}; },
    onClose: () => () => {}, send: () => {}, close: () => {},
  });
  fire({ t: 'joinMatch', levelId, modeId: 'ffa' });
  await server.whenLevelReady();
  server.match.beginLive?.();
  for (let i = 0; i < 60 * 8; i += 1) server.update(1 / 60);

  const ids = server.ai.agentIds;
  const cap = Math.max(...ids.map((id) => server.ai.getAgent(id)?.profile?.maxTurnDegPerSecond ?? 0));
  const track = new Map(ids.map((id) => {
    const p = server.world.getPlayer(id);
    return [id, { yaw: p.yaw, x: p.px, z: p.pz, alive: p.alive, dist: 0, worst: 0 }];
  }));

  for (let t = 0; t < 60 * 30; t += 1) {
    server.update(1 / 60);
    for (const id of ids) {
      const p = server.world.getPlayer(id);
      const r = track.get(id);
      // A respawn is a teleport by design: it is not a turn and not travel.
      if (p.alive && r.alive) {
        const dy = Math.abs(((p.yaw - r.yaw + Math.PI) % (2 * Math.PI)) - Math.PI);
        r.worst = Math.max(r.worst, dy * 60 * 180 / Math.PI);
        r.dist += Math.hypot(p.px - r.x, p.pz - r.z);
      }
      r.yaw = p.yaw; r.x = p.px; r.z = p.pz; r.alive = p.alive;
    }
  }

  const rows = [...track.values()];
  const worst = Math.max(...rows.map((r) => r.worst));
  // Fairness by construction: a bot may never out-turn the shared clamp.
  // Before this was fixed a throttled bot spent its whole think interval's
  // turn budget in one tick and hit 2240 deg/s -- a 37x human snap.
  check(`${levelId}: no bot out-turns the human turn-rate clamp`,
    worst <= cap + 1,
    `worst ${worst.toFixed(0)} deg/s, clamp ${cap} deg/s`);

  const stuck = rows.filter((r) => r.dist < 20).length;
  // Bots used to jam against a wall and press forward forever, because the
  // unstick check measured distance-to-goal, which keeps shrinking while a
  // body slides along a wall.
  check(`${levelId}: no bot is stuck against the level`,
    stuck === 0,
    `${stuck} of ${rows.length} travelled under 20 m in 30 s`);

  server.shutdown();
}

// --- [15] Bots commit to a decision instead of dithering ------------------
console.log('\n[15] Decisions last long enough to mean something');
{
  const server = new GameServer({ levelFetcher: diskLevelFetcher() });
  let fire = () => {};
  server.accept({
    onMessage: (f) => { fire = f; return () => {}; },
    onClose: () => () => {}, send: () => {}, close: () => {},
  });
  fire({ t: 'joinMatch', levelId: 'facility', modeId: 'ffa' });
  await server.whenLevelReady();
  server.match.beginLive?.();
  for (let i = 0; i < 60 * 8; i += 1) server.update(1 / 60);

  const ids = server.ai.agentIds;
  const last = new Map();
  const lives = [];
  for (let t = 0; t < 60 * 30; t += 1) {
    server.update(1 / 60);
    for (const id of ids) {
      const cur = server.ai.getAgent(id)?.currentCapabilityId ?? null;
      const prev = last.get(id);
      if (prev && prev.id !== cur) {
        if (prev.id) lives.push(t - prev.start);
        last.set(id, { id: cur, start: t });
      } else if (!prev) last.set(id, { id: cur, start: t });
    }
  }
  lives.sort((a, b) => a - b);
  const median = (lives[lives.length >> 1] ?? 0) / 60;
  // Measured at 0.02-0.08 s before the fix: decisionJitter (0.18) outweighed
  // the incumbency bonus (0.08), so near-tied capabilities swapped every
  // tick and MoveTo was rebuilt -- losing its path -- several times a second.
  check('a capability survives longer than a couple of ticks',
    median >= 0.25,
    `median capability lifetime ${median.toFixed(2)} s over ${lives.length} decisions`);
  server.shutdown();
}

console.log(`\nAI ACCEPTANCE: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
