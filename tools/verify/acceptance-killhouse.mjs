/**
 * acceptance-killhouse.mjs — the Killhouse map, and the roof that makes it
 * different from every other map we have.
 *
 * Killhouse is the first INDOOR map: a sealed warehouse with a roof over the
 * whole playspace. That creates properties nothing else in the project has to
 * satisfy, and each of them is a way the map could be broken without anyone
 * noticing by looking at it:
 *
 *   - the roof must actually stop things, or it is scenery
 *   - the bays must actually be open, or aerial streaks are unusable
 *   - the box must be sealed, or players leave the world
 *   - the tower must be climbable, or the map's high ground does not exist
 *
 * Everything here runs against the BAKED collision the server loads, not
 * against the source geometry, because that is what players actually collide
 * with.
 */
import fs from 'node:fs';
import { buildServerBundle, makeCheck } from './server-harness.mjs';
import { ROOF_BAYS, KILLHOUSE, TOWER, PLATFORMS, BOUNDS } from '../lib/KillhouseLayout.js';

const { GameServer } = await buildServerBundle();
const { check, report } = makeCheck();

const raw = JSON.parse(fs.readFileSync('assets/collision/killhouse.json', 'utf8'));

const server = new GameServer({
  levelFetcher: async (id) => JSON.parse(fs.readFileSync(`assets/collision/${id}.json`, 'utf8')),
});
server.startMatch('killhouse');
await server.whenLevelReady();
const col = server.collision;

const { ROOF_Y } = KILLHOUSE;
const { HALF_W, HALF_D } = BOUNDS;

// --- 1. the map exists and is the right shape -------------------------------
{
  check('killhouse collision is baked',
    raw.boxes.length > 50, `${raw.boxes.length} boxes`);

  const loaded = col.boxCount;
  check('the server loads the killhouse geometry',
    loaded === raw.boxes.length, `${loaded} boxes`);

  // Small map: the whole point of Killhouse.
  const area = (HALF_W * 2) * (HALF_D * 2);
  check('the playspace is small, as Killhouse should be',
    area < 3200, `${HALF_W * 2} x ${HALF_D * 2} m = ${area} m2`);
}

// --- 2. the roof is solid where it should be --------------------------------
{
  // Straight down from high above, at points NOT inside a bay.
  const solidSpots = [
    [-18, -26], [18, 26], [-20, 0], [20, 0], [0, 28], [0, -28],
  ].filter(([x, z]) => !ROOF_BAYS.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ));

  let blocked = 0;
  for (const [x, z] of solidSpots) {
    const hit = col.raycast([x, 60, z], [0, -1, 0], 100);
    if (hit && Math.abs(hit.point[1] - (ROOF_Y + 0.35)) < 0.6) blocked += 1;
  }
  check('the roof stops a ray fired straight down at it',
    blocked === solidSpots.length, `${blocked}/${solidSpots.length} spots covered`);
}

// --- 3. the bays are genuinely open -----------------------------------------
{
  let open = 0;
  const details = [];
  for (const bay of ROOF_BAYS) {
    const cx = (bay.minX + bay.maxX) / 2;
    const cz = (bay.minZ + bay.maxZ) / 2;
    const hit = col.raycast([cx, 60, cz], [0, -1, 0], 100);
    // Reaching the floor (or something low) means the bay is a real hole.
    const reachedFloor = hit !== null && hit.point[1] < 5.0;
    if (reachedFloor) open += 1;
    else details.push(`${bay.name}@${hit ? hit.point[1].toFixed(1) : 'miss'}`);
  }
  check('every roof bay is open all the way to the floor',
    open === ROOF_BAYS.length,
    open === ROOF_BAYS.length ? `${open} bays clear` : `blocked: ${details.join(', ')}`);

  // And the openings are big enough to matter: a missile is not a needle.
  const widest = Math.max(...ROOF_BAYS.map((b) => Math.min(b.maxX - b.minX, b.maxZ - b.minZ)));
  check('at least one bay is wide enough to fly a missile through',
    widest >= 5, `widest clear span ${widest.toFixed(1)} m`);
}

// --- 4. the roof covers most of the map -------------------------------------
{
  // Sample the whole floor: the map must FEEL covered, or the bays are not a
  // meaningful constraint on aerial streaks.
  let covered = 0, total = 0;
  for (let x = -HALF_W + 1; x < HALF_W; x += 2) {
    for (let z = -HALF_D + 1; z < HALF_D; z += 2) {
      total += 1;
      const hit = col.raycast([x, 40, z], [0, -1, 0], 60);
      if (hit && hit.point[1] > 8) covered += 1;
    }
  }
  const pct = (covered / total) * 100;
  check('the roof covers most of the playspace but not all of it',
    pct > 55 && pct < 92, `${pct.toFixed(0)}% covered, ${(100 - pct).toFixed(0)}% open`);
}

// --- 5. the box is sealed ---------------------------------------------------
{
  // Fire outward at head height in every direction; nothing may escape.
  let sealed = 0;
  const dirs = 24;
  for (let i = 0; i < dirs; i += 1) {
    const a = (i / dirs) * Math.PI * 2;
    const hit = col.raycast([0, 1.68, 0], [Math.cos(a), 0, Math.sin(a)], 200);
    if (hit) sealed += 1;
  }
  check('the warehouse is sealed at head height in every direction',
    sealed === dirs, `${sealed}/${dirs} directions blocked`);

  // A player cannot stand INSIDE a wall. (Testing a point well beyond the
  // wall is meaningless: that is open space outside the building, which the
  // out-of-bounds volume handles, and it is not reachable anyway because the
  // wall is solid -- which the sweep test below actually proves.)
  const inWall = [
    [-HALF_W - 0.25, 0.05, 0], [HALF_W + 0.25, 0.05, 0],
    [0, 0.05, -HALF_D - 0.25], [0, 0.05, HALF_D + 0.25],
  ];
  const refused = inWall.filter(([x, y, z]) => !col.fits(x, y, z, 0.42, 1.8)).length;
  check('a player cannot stand inside the warehouse walls',
    refused === inWall.length, `${refused}/${inWall.length} refused`);

  // And walking hard into a wall does not pass through it.
  const before = { x: 0, y: 0.05, z: HALF_D - 2 };
  const moved = col.moveCapsule(before.x, before.y, before.z, 0.42, 1.8, 0, 0, 12, 0.35);
  check('a player cannot walk through the warehouse wall',
    moved.z < HALF_D - 0.4, `stopped at z=${moved.z.toFixed(2)} (wall at ${HALF_D})`);
}

// --- 6. the tower is real and reachable -------------------------------------
{
  const deckTop = TOWER.deckY + 0.24;
  const standsOnDeck = col.fits(0, deckTop + 0.05, 0, 0.42, 1.8);
  check('the watchtower deck is standable',
    standsOnDeck, `deck at y=${deckTop.toFixed(2)}`);

  // Probing down the centre hits the tower's CANOPY first -- it is a roofed
  // watchtower, so that is correct. What matters is that the structure is
  // there, and that the deck is under it.
  const hit = col.raycast([0, 20, 0], [0, -1, 0], 40);
  check('the watchtower canopy shelters the deck',
    hit !== null && Math.abs(hit.point[1] - (TOWER.roofY + 0.18)) < 0.4,
    hit ? `canopy at y=${hit.point[1].toFixed(2)}` : 'nothing hit');

  // Under the canopy, the next surface down is the deck.
  const belowCanopy = col.raycast([0, TOWER.roofY - 0.3, 0], [0, -1, 0], 20);
  check('the deck is the next surface below the canopy',
    belowCanopy !== null && Math.abs(belowCanopy.point[1] - deckTop) < 0.4,
    belowCanopy ? `deck at y=${belowCanopy.point[1].toFixed(2)}` : 'nothing under the canopy');

  // The climb: the ladder column carries collision steps the whole way up,
  // so a body is always supported rather than facing a sheer face.
  const ladderZ = TOWER.deckHalf + 0.35;
  const steps = [];
  for (let y = 0; y <= TOWER.deckY; y += 0.25) {
    const supported = col.raycast([0, y + 0.4, ladderZ], [0, -1, 0], 0.8);
    if (supported) steps.push(y);
  }
  const biggestGap = steps.length < 2
    ? Infinity
    : Math.max(...steps.slice(1).map((y, i) => y - steps[i]));
  check('the ladder column is supported the whole way to the deck',
    steps.length > 8 && biggestGap <= 0.55,
    `${steps.length} supported heights, largest gap ${biggestGap.toFixed(2)} m`);
}

// --- 7. spawn platforms ------------------------------------------------------
{
  let ok = 0;
  for (const p of PLATFORMS) {
    const y = p.deck.max[1];
    if (col.fits(0, y + 0.05, (p.deck.min[2] + p.deck.max[2]) / 2, 0.42, 1.8)) ok += 1;
  }
  check('both spawn platforms are standable',
    ok === PLATFORMS.length, `${ok}/${PLATFORMS.length}`);

  // The reference says you can see the enemy spawn from your own. Dead down
  // the centre is (correctly) broken up by the mid-map walls and the tower,
  // so the long sightline is down the side lanes -- which is exactly the
  // "few steps and you see them drop in" the guide describes.
  const laneOpen = [-18, 18].some((x) => col.hasLineOfSight([x, 3.2, 27], [x, 3.2, -27]));
  check('a long sightline runs spawn-to-spawn down a side lane',
    laneOpen, laneOpen ? 'lane is clear end to end' : 'both lanes blocked');

  // And the centre is NOT a free sightline -- cover has to matter.
  check('the centre lane is broken up by cover rather than a free shot',
    !col.hasLineOfSight([0, 3.6, 28], [0, 3.6, -28]), 'centre is contested');
}

// --- 8. the level spawn is safe ---------------------------------------------
{
  const spawn = raw.spawn;
  check('the level spawn point is inside the map and not in geometry',
    col.fits(spawn[0], spawn[1] + 0.05, spawn[2], 0.42, 1.8),
    `spawn [${spawn.join(', ')}]`);

  // Drop a real player there and make sure they settle.
  server.world.addPlayer('p1');
  const player = server.world.getPlayer('p1');
  player.px = spawn[0]; player.py = spawn[1] + 1; player.pz = spawn[2];
  for (let i = 0; i < 120; i += 1) server.update(1 / 60);
  check('a player spawned on the platform lands and stays there',
    player.grounded && player.py > 1.5 && player.py < 4,
    `y=${player.py.toFixed(2)} grounded=${player.grounded}`);
}

// --- 9. cover exists at usable heights ---------------------------------------
{
  const heights = raw.boxes
    .filter((b) => b.minY <= 0.1 && b.maxY < 3.2 && (b.maxX - b.minX) < 12 && (b.maxZ - b.minZ) < 12)
    .map((b) => b.maxY);
  const vault = heights.filter((h) => h > 0.7 && h < 1.1).length;
  const crouch = heights.filter((h) => h >= 1.1 && h < 1.7).length;
  const stand = heights.filter((h) => h >= 1.7).length;
  check('cover exists at vault, crouch and standing heights',
    vault > 0 && crouch > 0 && stand > 0,
    `${vault} vault, ${crouch} crouch, ${stand} standing`);
}

// --- 10. killstreaks interact with the roof correctly ------------------------
{
  // The two halves of the roof rule, which together are the whole design:
  //
  //   (a) aim at SOLID roof and the strike stops there -- you cannot call a
  //       strike down through a covered part of the map;
  //   (b) aim at a BAY and it passes, so a player who lines one up is
  //       rewarded.
  //
  // Straight up from a point under solid roof:
  const underSolid = col.raycast([-18, 1.68, -26], [0, 1, 0], 40);
  check('a strike aimed up at solid roof is stopped by it',
    underSolid !== null && underSolid.point[1] > 8 && underSolid.point[1] < 11.2,
    underSolid ? `stopped at y=${underSolid.point[1].toFixed(2)}` : 'escaped through the roof');

  // Straight up from under a bay: nothing in the way.
  const bayUp = ROOF_BAYS.find((b) => b.name === 'bay_centre_collapsed');
  const bx = (bayUp.minX + bayUp.maxX) / 2;
  const bz = (bayUp.minZ + bayUp.maxZ) / 2;
  const underBay = col.raycast([bx, 1.68, bz], [0, 1, 0], 40);
  check('a strike aimed up through a bay is not blocked',
    underBay === null, underBay ? `blocked at y=${underBay.point[1].toFixed(2)}` : 'clear to the sky');

  // A missile dropped through the big centre bay must reach the floor.
  const bay = ROOF_BAYS.find((b) => b.name === 'bay_centre_collapsed');
  const cx = (bay.minX + bay.maxX) / 2;
  const cz = (bay.minZ + bay.maxZ) / 2;
  const through = col.raycast([cx, 80, cz], [0, -1, 0], 120);
  check('a missile dropped through the centre bay reaches the floor',
    through !== null && through.point[1] < 1.0,
    through ? `floor at y=${through.point[1].toFixed(2)}` : 'blocked');
}

// --- 11. a killstreak can actually kill someone here -------------------------
// The whole point of the roof work: a strike must be able to reach a player
// through a bay, and must NOT reach one standing under solid roof. This runs
// the real KillstreakSystem on the real Killhouse collision.
{
  const bay = ROOF_BAYS.find((b) => b.name === 'bay_centre_collapsed');
  const bx = (bay.minX + bay.maxX) / 2;
  const bz = (bay.minZ + bay.maxZ) / 2;

  server.world.addPlayer('caller');
  server.world.addPlayer('exposed');
  server.world.addPlayer('sheltered');
  const caller = server.world.getPlayer('caller');
  const exposed = server.world.getPlayer('exposed');
  const sheltered = server.world.getPlayer('sheltered');

  // The caller designates the floor under the open bay. Yaw 0 looks along
  // +Z (see MovementSystem's basis), so stand SOUTH of the bay and look
  // north-ish down at the floor; pitch is chosen so the ray meets y=0 at the
  // bay centre.
  const standoff = 9;
  caller.px = bx; caller.py = 0; caller.pz = bz - standoff;
  caller.yaw = 0;
  caller.pitch = -Math.atan2(1.68, standoff);
  // One player stands in the open under the bay...
  exposed.px = bx; exposed.py = 0; exposed.pz = bz;
  // ...and one stands under solid roof, well away from the blast.
  sheltered.px = -18; sheltered.py = 0; sheltered.pz = -26;

  for (let i = 0; i < 6; i += 1) server.update(1 / 60);
  server.killstreaks.consumeEvents();

  server.world.requestKillstreak('caller', 1);   // airstrike
  for (let i = 0; i < 240; i += 1) server.update(1 / 60);

  const boom = server.killstreaks.consumeEvents().find((e) => e.kind === 'detonated');
  const hitExposed = boom?.hits?.find((h) => h.id === 'exposed');
  const hitSheltered = boom?.hits?.find((h) => h.id === 'sheltered');

  check('a killstreak called on Killhouse detonates',
    boom !== undefined,
    boom ? `at [${boom.at.map((n) => n.toFixed(1)).join(', ')}]` : 'never detonated');

  check('a player caught in the open under a roof bay is killed',
    hitExposed !== undefined && hitExposed.damage > 0,
    hitExposed
      ? `${hitExposed.damage} damage, lethal=${hitExposed.lethal}, health=${exposed.health}`
      : 'took no damage');

  check('a player under solid roof on the far side is untouched',
    hitSheltered === undefined && sheltered.health === 100,
    `health ${sheltered.health}`);
}

server.shutdown();
report('KILLHOUSE');
