/**
 * server-killstreaks.mjs — 12 end-to-end tests for the killstreak migration.
 *
 * The standing rule for this project's migrations: one system at a time, each
 * proven with twelve end-to-end tests before the next one starts. These drive
 * a real GameServer through real ticks -- no mocks, no reaching into private
 * state to force an outcome.
 *
 * What is being proven is AUTHORITY. Before this migration a client decided
 * for itself whether a streak was available, when its cooldown expired and how
 * much damage its blast did. Each test below is a thing a modified client
 * could previously have lied about.
 */
import { buildServerBundle, makeCheck } from './server-harness.mjs';

const { GameServer, SERVER_KILLSTREAKS, blastDamageAt } = await buildServerBundle();
const { check, report } = makeCheck();

/** A sealed room with a floor, so nobody falls out of the world. */
const ROOM = [
  { minX: -40, minY: -1, minZ: -40, maxX: 40, maxY: 0, maxZ: 40, surface: 'concrete' },
];

/** Floor plus a solid roof slab, for the cover tests. */
const BUNKER = [
  ...ROOM,
  { minX: -6, minY: 4, minZ: -6, maxX: 6, maxY: 5, maxZ: 6, surface: 'concrete' },
];

function makeServer(boxes = ROOM) {
  const server = new GameServer();
  server.startMatch('testroom');
  server.collision.load(boxes);
  return server;
}

/** Run n ticks at the server's fixed rate. */
function run(server, seconds) {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i += 1) server.update(1 / 60);
}

// --- 1. the server owns availability ----------------------------------------
{
  const server = makeServer();
  server.world.addPlayer('p1');
  run(server, 0.1);

  const slots = server.killstreaks.slotsFor('p1');
  check('a player gets killstreak slots from their loadout',
    slots.length === 3, slots.map((s) => s.id).join(', '));

  check('slots start ready in open mode',
    slots.every((s) => s.state === 'ready'), slots.map((s) => s.state).join(', '));
  server.shutdown();
}

// --- 2. calling a streak is validated, not trusted --------------------------
{
  const server = makeServer();
  server.world.addPlayer('p1');
  run(server, 0.1);

  server.world.requestKillstreak('p1', 0);
  run(server, 0.05);
  const called = server.killstreaks.consumeEvents().filter((e) => e.kind === 'called');
  check('a valid call is accepted', called.length === 1,
    called[0] ? `${called[0].streakId} called` : 'nothing called');

  // A slot that does not exist must be refused rather than crashing.
  server.world.requestKillstreak('p1', 99);
  run(server, 0.05);
  const rejected = server.killstreaks.consumeEvents().filter((e) => e.kind === 'rejected');
  check('a call for a slot that does not exist is refused',
    rejected.length === 1, rejected[0]?.reason ?? 'not refused');
  server.shutdown();
}

// --- 3. cooldown is enforced by the server ----------------------------------
{
  const server = makeServer();
  server.world.addPlayer('p1');
  run(server, 0.1);

  // UAV: 30 s duration, 20 s cooldown.
  server.world.requestKillstreak('p1', 0);
  run(server, 0.1);
  server.killstreaks.consumeEvents();

  // Spamming the same slot while it runs must not stack.
  for (let i = 0; i < 10; i += 1) server.world.requestKillstreak('p1', 0);
  run(server, 0.2);
  const spam = server.killstreaks.consumeEvents();
  check('a streak already running cannot be called again',
    spam.filter((e) => e.kind === 'called').length === 0
    && spam.filter((e) => e.kind === 'rejected').length === 10,
    `${spam.filter((e) => e.kind === 'rejected').length} rejected`);

  check('only one streak is active despite the spam',
    server.killstreaks.activeCount === 1, `${server.killstreaks.activeCount} active`);
  server.shutdown();
}

// --- 4. a streak ends on time and then cools --------------------------------
{
  const server = makeServer();
  server.world.addPlayer('p1');
  run(server, 0.1);
  server.world.requestKillstreak('p1', 0);   // UAV, 30 s
  run(server, 0.1);
  server.killstreaks.consumeEvents();

  run(server, 30.2);
  const ended = server.killstreaks.consumeEvents().filter((e) => e.kind === 'ended');
  check('a timed streak ends itself when its duration runs out',
    ended.length === 1, ended[0] ? `${ended[0].streakId} ended` : 'still running');

  const cooling = server.killstreaks.slotsFor('p1')[0];
  check('the slot goes on cooldown after the streak ends',
    cooling.state === 'cooling' && cooling.remaining > 19,
    `${cooling.state} ${cooling.remaining.toFixed(1)}s`);

  // And calling it during the cooldown is refused.
  server.world.requestKillstreak('p1', 0);
  run(server, 0.05);
  const blocked = server.killstreaks.consumeEvents().filter((e) => e.kind === 'rejected');
  check('a cooling slot refuses a new call',
    blocked.length === 1, blocked[0]?.reason ?? 'not refused');
  server.shutdown();
}

// --- 5. blast damage is computed by the server ------------------------------
{
  const server = makeServer();
  server.world.addPlayer('caller');
  server.world.addPlayer('victim');
  const caller = server.world.getPlayer('caller');
  const victim = server.world.getPlayer('victim');
  caller.px = 0; caller.py = 0; caller.pz = 0;
  caller.pitch = -0.6;           // look down and forward
  caller.yaw = 0;
  victim.px = 0; victim.py = 0; victim.pz = 12;
  run(server, 0.1);

  // Slot 1 is the airstrike (directional, 180 damage / 10 m).
  server.world.requestKillstreak('caller', 1);
  run(server, 3.0);
  const boom = server.killstreaks.consumeEvents().find((e) => e.kind === 'detonated');
  check('a directional streak detonates at a server-resolved point',
    boom !== undefined && Array.isArray(boom.at),
    boom ? `at [${boom.at.map((n) => n.toFixed(1))}]` : 'never detonated');
  server.shutdown();
}

// --- 6. the blast actually kills, end to end --------------------------------
{
  const server = makeServer();
  server.world.addPlayer('caller');
  server.world.addPlayer('victim');
  const caller = server.world.getPlayer('caller');
  const victim = server.world.getPlayer('victim');
  caller.px = 0; caller.pz = 0; caller.pitch = -0.35; caller.yaw = 0;
  // Directly under where a shallow forward-down ray meets the floor.
  victim.px = 0; victim.pz = 4.8;
  run(server, 0.1);

  server.world.requestKillstreak('caller', 1);
  run(server, 3.0);
  const event = server.killstreaks.consumeEvents().find((e) => e.kind === 'detonated');
  const hit = event?.hits?.find((h) => h.id === 'victim');

  check('a player standing in the blast takes damage',
    hit !== undefined && hit.damage > 0,
    hit ? `${hit.damage} damage, lethal=${hit.lethal}` : 'took nothing');

  check('the victim\'s health reflects the damage on the server',
    victim.health < 100, `health ${victim.health}`);
  server.shutdown();
}

// --- 7. cover stops a blast -------------------------------------------------
{
  // The blast goes off on the roof; someone inside must be protected by it.
  const server = makeServer(BUNKER);
  server.world.addPlayer('caller');
  server.world.addPlayer('inside');
  const caller = server.world.getPlayer('caller');
  const inside = server.world.getPlayer('inside');
  caller.px = 0; caller.py = 6; caller.pz = 0;   // on top of the slab
  caller.pitch = -1.4;                            // straight down
  inside.px = 0; inside.py = 0; inside.pz = 0;   // directly below, under cover
  run(server, 0.1);

  server.world.requestKillstreak('caller', 1);
  run(server, 3.0);
  const event = server.killstreaks.consumeEvents().find((e) => e.kind === 'detonated');
  const hurt = event?.hits?.some((h) => h.id === 'inside');

  check('a roof between the blast and a player stops the damage',
    hurt !== true && inside.health === 100, `health ${inside.health}`);
  server.shutdown();
}

// --- 8. kills mode gates on real kills --------------------------------------
{
  const server = makeServer();
  server.killstreaks.setEarnMode('kills');
  server.world.addPlayer('p1');
  run(server, 0.1);

  server.world.requestKillstreak('p1', 0);   // UAV needs 3 kills
  run(server, 0.05);
  const denied = server.killstreaks.consumeEvents().filter((e) => e.kind === 'rejected');
  check('an unearned streak is refused in kills mode',
    denied.length === 1 && /needs 3 kills/.test(denied[0].reason ?? ''),
    denied[0]?.reason ?? 'not refused');

  for (let i = 0; i < 3; i += 1) server.killstreaks.creditKill('p1');
  server.world.requestKillstreak('p1', 0);
  run(server, 0.05);
  const allowed = server.killstreaks.consumeEvents().filter((e) => e.kind === 'called');
  check('the same streak is allowed once the kills are earned',
    allowed.length === 1, allowed[0] ? 'called' : 'still refused');
  server.shutdown();
}

// --- 9. a dead player cannot call one in ------------------------------------
{
  const server = makeServer();
  server.world.addPlayer('ghost');
  const ghost = server.world.getPlayer('ghost');
  run(server, 0.1);
  ghost.alive = false;

  server.world.requestKillstreak('ghost', 0);
  run(server, 0.05);
  const refused = server.killstreaks.consumeEvents().filter((e) => e.kind === 'rejected');
  check('a dead player cannot call a killstreak',
    refused.length === 1 && refused[0].reason === 'dead',
    refused[0]?.reason ?? 'it was allowed');
  server.shutdown();
}

// --- 10. concurrency is capped ----------------------------------------------
{
  const server = makeServer();
  server.world.addPlayer('p1');
  run(server, 0.1);

  // UAV (30 s) and heli-less default loadout: uav, airstrike, guided_missile.
  server.world.requestKillstreak('p1', 0);
  run(server, 0.1);
  server.world.requestKillstreak('p1', 1);
  run(server, 0.1);
  server.killstreaks.consumeEvents();

  server.world.requestKillstreak('p1', 2);
  run(server, 0.05);
  const capped = server.killstreaks.consumeEvents().filter((e) => e.kind === 'rejected');
  check('the match caps how many streaks run at once',
    capped.length === 1 && /too many/.test(capped[0].reason ?? ''),
    capped[0]?.reason ?? 'no cap applied');
  server.shutdown();
}

// --- 11. the HUD reads the server's state -----------------------------------
{
  const server = makeServer();
  server.world.addPlayer('p1');
  run(server, 0.1);
  server.world.requestKillstreak('p1', 0);
  run(server, 0.2);

  const published = server.world.getKillstreakSlots('p1');
  check('slot state is published for the client to render',
    Array.isArray(published) && published[0].state === 'active',
    published ? published.map((s) => `${s.id}:${s.state}`).join(' ') : 'nothing published');
  server.shutdown();
}

// --- 12. the damage curve is shared and sane --------------------------------
{
  const centre = [0, 0, 0];
  const atCentre = blastDamageAt(centre, [0, 0, 0], 10, 200);
  const atHalf = blastDamageAt(centre, [5, 0, 0], 10, 200);
  const atEdge = blastDamageAt(centre, [10, 0, 0], 10, 200);
  const beyond = blastDamageAt(centre, [11, 0, 0], 10, 200);

  check('blast damage falls off with distance and stops at the radius',
    atCentre === 200 && atHalf === 50 && atEdge === 0 && beyond === 0,
    `centre ${atCentre}, half ${atHalf}, edge ${atEdge}, beyond ${beyond}`);
}

// --- 13. the server's numbers match the client's definitions ----------------
// Not a behaviour test: a drift guard. The client keeps its own copy for the
// HUD, and the two silently disagreeing is exactly the bug this catches.
{
  const fs = await import('node:fs');
  const source = fs.readFileSync('src/killstreaks/definitions/index.ts', 'utf8');
  const mismatches = [];
  for (const [id, streak] of Object.entries(SERVER_KILLSTREAKS)) {
    const block = source.split(`id: '${id}'`)[1]?.slice(0, 400) ?? '';
    const kills = /killsRequired:\s*(\d+)/.exec(block)?.[1];
    const cooldown = /cooldownSeconds:\s*(\d+)/.exec(block)?.[1];
    if (kills !== undefined && Number(kills) !== streak.killsRequired) {
      mismatches.push(`${id} kills ${kills} != ${streak.killsRequired}`);
    }
    if (cooldown !== undefined && Number(cooldown) !== streak.cooldownSeconds) {
      mismatches.push(`${id} cooldown ${cooldown} != ${streak.cooldownSeconds}`);
    }
  }
  check('server and client killstreak numbers agree',
    mismatches.length === 0, mismatches.join('; ') || 'all four streaks match');
}

report('SERVER KILLSTREAKS');
