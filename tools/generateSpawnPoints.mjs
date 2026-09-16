/**
 * generateSpawnPoints.mjs — derive real spawn points for every map.
 *
 * Spawn points are NOT hand-placed. They are found by probing the baked
 * collision for this map, exactly the geometry the server simulates against,
 * so a generated point is standable by construction rather than by someone
 * eyeballing a coordinate and hoping.
 *
 * Three sets are produced per map:
 *
 *   ffa   — scattered over the whole playable area, as far apart as possible.
 *   teamA — clustered on one side of the map's long axis.
 *   teamB — clustered on the other.
 *
 * Team sets are split along the LONG axis, which is what Call of Duty does on
 * a rectangular map: the two teams start at opposite ends and fight through
 * the middle. Splitting the short axis instead would put both teams in the
 * same lane looking straight down it.
 *
 * Usage: node tools/generateSpawnPoints.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServerBundle } from './verify/server-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLLISION_DIR = path.join(ROOT, 'assets/collision');
const OUT_DIR = path.join(ROOT, 'assets/spawns');

/** A body must fit here, with headroom, or it is not a spawn point. */
const RADIUS = 0.42;
const HEIGHT = 1.8;
/** Spawns closer together than this are redundant. */
const MIN_SEPARATION = 6.0;
/** How many to keep per set. 8 is the FFA player cap; teams get 8 each. */
const FFA_COUNT = 12;
const TEAM_COUNT = 8;

/**
 * Probe a grid over the map and keep every cell a player can stand in.
 *
 * The probe drops a ray from high above each cell to find the floor, then asks
 * the collision world whether a capsule fits there. That second test is the
 * important one: a ray can land on top of a wall or a container, which is a
 * surface but not somewhere to start a life.
 */
function findStandableCells(col, bounds, step) {
  const cells = [];
  for (let x = bounds.minX; x <= bounds.maxX; x += step) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += step) {
      const hit = col.raycast([x, bounds.maxY + 5, z], [0, -1, 0], bounds.maxY + 40);
      if (!hit) continue;
      const y = hit.point[1];
      // Reject anything suspiciously high: the intent is the floor a match is
      // played on, not a roof or the top of a shipping container.
      if (y > bounds.minY + 3.2) continue;
      if (!col.fits(x, y + 0.05, z, RADIUS, HEIGHT)) continue;
      cells.push({ x, y, z });
    }
  }
  return cells;
}

/** Greedy farthest-point selection: spreads picks out instead of clumping. */
function spreadPick(cells, count, minSeparation) {
  if (!cells.length) return [];
  const chosen = [];
  // Start from the cell furthest from the map centre so the set reaches the
  // edges; starting at the centre tends to leave the corners empty.
  const cx = cells.reduce((s, c) => s + c.x, 0) / cells.length;
  const cz = cells.reduce((s, c) => s + c.z, 0) / cells.length;
  let seed = cells[0];
  let seedD = -1;
  for (const c of cells) {
    const d = (c.x - cx) ** 2 + (c.z - cz) ** 2;
    if (d > seedD) { seedD = d; seed = c; }
  }
  chosen.push(seed);

  while (chosen.length < count) {
    let best = null;
    let bestD = -1;
    for (const c of cells) {
      let nearest = Infinity;
      for (const s of chosen) {
        const d = (c.x - s.x) ** 2 + (c.z - s.z) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestD) { bestD = nearest; best = c; }
    }
    if (!best || Math.sqrt(bestD) < minSeparation) break;
    chosen.push(best);
  }
  return chosen;
}

/** Face roughly towards the map centre: spawning looking at a wall is hostile. */
function yawTowards(from, tx, tz) {
  // Forward is (-sin yaw, cos yaw), matching MovementSystem.
  return Math.atan2(-(tx - from.x), tz - from.z);
}

function buildForLevel(col, levelId, boxes) {
  let minX = Infinity; let maxX = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  for (const b of boxes) {
    // Skip the out-of-bounds shells, which are enormous and would blow the
    // probe area up to nothing useful.
    if (b.maxX - b.minX > 500 || b.maxZ - b.minZ > 500) continue;
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
  }
  // Inset so probes do not sit inside the perimeter wall.
  const inset = 2.5;
  const bounds = {
    minX: minX + inset, maxX: maxX - inset,
    minZ: minZ + inset, maxZ: maxZ - inset,
    minY, maxY,
  };

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const step = Math.max(1.5, span / 60);
  const cells = findStandableCells(col, bounds, step);
  if (!cells.length) return null;

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;

  // Long axis decides how the two teams are split.
  const longAxisIsZ = (bounds.maxZ - bounds.minZ) >= (bounds.maxX - bounds.minX);
  const sideA = cells.filter((c) => (longAxisIsZ ? c.z > centreZ : c.x > centreX));
  const sideB = cells.filter((c) => (longAxisIsZ ? c.z <= centreZ : c.x <= centreX));

  const mk = (list) => list.map((c) => ({
    pos: [round(c.x), round(c.y), round(c.z)],
    yaw: round(yawTowards(c, centreX, centreZ)),
  }));

  // Team spawns sit deliberately deeper in their own half, so the two sets do
  // not meet in the middle: pick from the cells furthest from the centre line.
  const depthSort = (list) => [...list].sort((p, q) => {
    const dp = longAxisIsZ ? Math.abs(p.z - centreZ) : Math.abs(p.x - centreX);
    const dq = longAxisIsZ ? Math.abs(q.z - centreZ) : Math.abs(q.x - centreX);
    return dq - dp;
  });

  return {
    levelId,
    generatedBy: 'tools/generateSpawnPoints.mjs',
    ffa: mk(spreadPick(cells, FFA_COUNT, MIN_SEPARATION)),
    teamA: mk(spreadPick(depthSort(sideA).slice(0, Math.ceil(sideA.length * 0.55)),
      TEAM_COUNT, MIN_SEPARATION * 0.6)),
    teamB: mk(spreadPick(depthSort(sideB).slice(0, Math.ceil(sideB.length * 0.55)),
      TEAM_COUNT, MIN_SEPARATION * 0.6)),
  };
}

function round(n) { return Math.round(n * 100) / 100; }

async function main() {
  const { CollisionWorld } = await buildServerBundle();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(COLLISION_DIR).filter((f) => f.endsWith('.json'));
  console.log(`[spawns] probing ${files.length} maps`);

  for (const file of files) {
    const levelId = file.replace(/\.json$/, '');
    const data = JSON.parse(fs.readFileSync(path.join(COLLISION_DIR, file), 'utf8'));
    const col = new CollisionWorld();
    col.load(data.boxes, data.terrain ?? undefined);

    const result = buildForLevel(col, levelId, data.boxes);
    if (!result) { console.log(`  ${levelId.padEnd(15)} SKIPPED (no standable ground)`); continue; }

    fs.writeFileSync(
      path.join(OUT_DIR, `${levelId}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    console.log(
      `  ${levelId.padEnd(15)} ffa=${String(result.ffa.length).padStart(2)}`
      + ` teamA=${String(result.teamA.length).padStart(2)}`
      + ` teamB=${String(result.teamB.length).padStart(2)}`,
    );
  }
  console.log(`[spawns] written to assets/spawns/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
