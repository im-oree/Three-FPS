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
import { buildServerBundle } from './server-harness.mjs';

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
    seerPlayer.px = -10; seerPlayer.pz = 0;
    hiddenPlayer.px = 10; hiddenPlayer.pz = 0;
    server.update(1 / 60);
  }
  const agent = server.ai.getAgent(seer);
  const sawThroughWall = agent.beliefs.sightings.has(hidden);
  check('a bot cannot see an enemy through a wall',
    !sawThroughWall, sawThroughWall ? 'saw through the divider' : 'blocked');

  // Remove the wall; now it must see.
  server.collision.load(ROOM);
  server.ai.buildNavigation();
  for (let i = 0; i < 60; i += 1) server.update(1 / 60);
  const seesNow = server.ai.getAgent(seer).beliefs.sightings.has(hidden);
  check('a bot does see an enemy in the open', seesNow,
    seesNow ? 'acquired' : 'still blind with clear line of sight');
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
  a.px = 0; a.pz = 0; b.px = 0; b.pz = -8;
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

console.log(`\nAI ACCEPTANCE: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
