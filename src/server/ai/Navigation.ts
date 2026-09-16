/**
 * Navigation.ts — getting somewhere, using only the collision the game has.
 *
 * WHY A GRID AND NOT A NAVMESH
 * ----------------------------
 * The maps are already baked to axis-aligned collision boxes, and the mover
 * is a capsule with a known radius. A uniform grid sampled against
 * `CollisionWorld.canStandAt` is therefore derived from the same geometry the
 * player collides with, cannot drift from it, and needs no authoring step or
 * new asset per map. A navmesh would be faster per query and would be the
 * right answer at a much larger map scale, but it would introduce a second
 * source of truth about where the world is walkable — and the failure mode of
 * that disagreeing with collision is a bot walking into a wall forever.
 *
 * The grid is built once per level and shared by every agent, so its cost is
 * paid at match start rather than per bot.
 *
 * CAPABILITY-GATED EDGES
 * ----------------------
 * Every edge carries a terrain tag. An agent prices an edge through its own
 * capability list: no `Swim` capability means water costs Infinity and the
 * route goes around, with no special case in the search. That is the property
 * that lets swimming or parachuting be added later without touching this file.
 */
import type { Vec3 } from '../../net/Protocol';
import type { CollisionWorld } from '../CollisionWorld';
import { PLAYER } from '../../utils/Constants';

export const CELL_SIZE = 2;
/** Capsule radius used when testing whether a cell is standable. */
const AGENT_RADIUS = 0.42;
const AGENT_HEIGHT = 1.8;
/**
 * Largest step the mover can climb.
 *
 * Read from the SAME constant MovementSystem uses rather than copied. When
 * these drifted apart (nav 0.35 vs mover 0.45) the graph refused edges the
 * body could actually walk, which chopped Killhouse into 22 disconnected
 * islands -- bots spawned in pockets they could not path out of and the map
 * produced 2 kills a minute against Shipment's 12.
 */
const STEP_HEIGHT = PLAYER.MAX_STEP_HEIGHT;

/**
 * Where inside a cell to look for standable ground, centre first.
 *
 * The offsets stay inside the cell (0.45 m of a 1 m half-extent) so a cell
 * never represents ground that belongs to its neighbour.
 */
/** Where a column scan starts, and how far down it reaches. */
const COLUMN_TOP = 60;
const COLUMN_DEPTH = 200;
/** Safety bound on how many stacked surfaces one column may report. */
const COLUMN_MAX_SURFACES = 24;

const CELL_PROBES: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0.45, 0], [0.45, 0], [0, -0.45], [0, 0.45],
  [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45],
];

/**
 * The lowest surface in a column that a capsule can stand on.
 *
 * Walks downward hit by hit rather than trusting the first one, because the
 * first hit from above is the roof on any enclosed map.
 */
function lowestStandable(
  collision: CollisionWorld,
  x: number,
  z: number,
): { x: number; z: number; y: number; surface: string } | null {
  let best: { x: number; z: number; y: number; surface: string } | null = null;
  let from = COLUMN_TOP;
  // Bounded: a pathological column of thin shelves cannot spin forever.
  for (let step = 0; step < COLUMN_MAX_SURFACES; step += 1) {
    const hit = collision.raycast([x, from, z], [0, -1, 0], COLUMN_DEPTH);
    if (!hit) break;
    const y = hit.point[1];
    if (collision.fits(x, y + 0.05, z, AGENT_RADIUS, AGENT_HEIGHT)) {
      best = { x, z, y, surface: hit.surface };
    }
    // Drop just past this surface and keep looking for something lower.
    const next = y - 0.05;
    if (next >= from) break;
    from = next;
  }
  return best;
}

export interface NavCell {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  /** Floor height found by probing downward. */
  readonly y: number;
  /** Terrain class, for capability gating. */
  readonly tag: string;
}

export class NavGrid {
  readonly cells: (NavCell | null)[] = [];
  private readonly neighbours: number[][] = [];

  constructor(
    readonly minX: number, readonly minZ: number,
    readonly cols: number, readonly rows: number,
  ) {}

  indexAt(x: number, z: number): number {
    const col = Math.floor((x - this.minX) / CELL_SIZE);
    const row = Math.floor((z - this.minZ) / CELL_SIZE);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  cellAt(x: number, z: number): NavCell | null {
    const index = this.indexAt(x, z);
    return index < 0 ? null : this.cells[index] ?? null;
  }

  neighboursOf(index: number): number[] { return this.neighbours[index] ?? []; }

  /**
   * Build the grid by probing the collision world.
   *
   * A cell exists when a capsule can stand in it. Neighbours are linked only
   * when the height difference is climbable, so a ledge is not treated as a
   * doorway; that single check is what stops routes that walk off cliffs or
   * through raised platform edges.
   */
  static build(collision: CollisionWorld, bounds: {
    minX: number; maxX: number; minZ: number; maxZ: number;
  }): NavGrid {
    const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / CELL_SIZE));
    const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / CELL_SIZE));
    const grid = new NavGrid(bounds.minX, bounds.minZ, cols, rows);

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const x = bounds.minX + col * CELL_SIZE + CELL_SIZE * 0.5;
        const z = bounds.minZ + row * CELL_SIZE + CELL_SIZE * 0.5;

        // Find the FLOOR of this column.
        //
        // Two failures used to happen here, and together they made indoor
        // maps nearly unplayable for bots.
        //
        // 1. A cell is 2 m across but the capsule is only 0.84 m wide, so a
        //    cell whose exact centre clips a crate corner or a pillar can
        //    still be walkable slightly off-centre. Sampling the centre alone
        //    punched holes through doorways.
        // 2. The probe took the FIRST thing a downward ray hit. Killhouse is
        //    a roofed warehouse, so that was the roof at y=10.75 -- the roof
        //    became the map's largest walkable region while the real floor
        //    beneath it was cut into disconnected pockets. Bots spawned in
        //    those pockets, could not path out, and the map produced 2 kills
        //    a minute against Shipment's 12.
        //
        // So: sample several points across the cell, walk each column all the
        // way down collecting every standable surface, and keep the lowest.
        // The lowest standable surface is the floor a player actually walks
        // on; roofs, catwalk lids and crate tops sit above it and are skipped.
        let placed: { x: number; z: number; y: number; surface: string } | null = null;
        for (const [ox, oz] of CELL_PROBES) {
          const found = lowestStandable(collision, x + ox, z + oz);
          if (!found) continue;
          if (!placed || found.y < placed.y) placed = found;
        }
        if (!placed) { grid.cells[index] = null; continue; }
        grid.cells[index] = {
          index, x: placed.x, z: placed.z, y: placed.y,
          tag: placed.surface === 'water' ? 'water' : 'ground',
        };
      }
    }

    // Link four-connected neighbours. Diagonals are omitted deliberately: with
    // axis-aligned boxes they allow corner-cutting through a wall seam, and
    // the path smoother below recovers the diagonal look anyway.
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const cell = grid.cells[index];
        if (!cell) { grid.neighbours[index] = []; continue; }
        const list: number[] = [];
        const candidates = [
          row > 0 ? index - cols : -1,
          row < rows - 1 ? index + cols : -1,
          col > 0 ? index - 1 : -1,
          col < cols - 1 ? index + 1 : -1,
        ];
        for (const other of candidates) {
          if (other < 0) continue;
          const neighbour = grid.cells[other];
          if (!neighbour) continue;
          if (Math.abs(neighbour.y - cell.y) > STEP_HEIGHT) continue;
          list.push(other);
        }
        grid.neighbours[index] = list;
      }
    }

    return grid;
  }

  get walkableCount(): number {
    let n = 0;
    for (const cell of this.cells) if (cell) n += 1;
    return n;
  }
}

/** Terrain tags an agent can cross, derived from its capabilities. */
export interface TraversalCaps {
  readonly tags: ReadonlySet<string>;
}

/**
 * A* over the grid.
 *
 * Returns world-space waypoints, already smoothed. Null when no route exists
 * — the caller must handle that rather than assuming a path always comes
 * back, because on a real map some places genuinely cannot be reached.
 */
export function findPath(
  grid: NavGrid, from: Vec3, to: Vec3, caps: TraversalCaps, maxNodes = 4000,
): Vec3[] | null {
  const startIndex = nearestWalkable(grid, from, caps);
  const goalIndex = nearestWalkable(grid, to, caps);
  if (startIndex < 0 || goalIndex < 0) return null;
  if (startIndex === goalIndex) {
    const cell = grid.cells[goalIndex]!;
    return [[cell.x, cell.y, cell.z]];
  }

  const goal = grid.cells[goalIndex]!;
  const open: number[] = [startIndex];
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[startIndex, 0]]);
  const fScore = new Map<number, number>([[startIndex, heuristic(grid.cells[startIndex]!, goal)]]);
  const closed = new Set<number>();
  let expanded = 0;

  while (open.length > 0 && expanded < maxNodes) {
    let bestAt = 0;
    for (let i = 1; i < open.length; i += 1) {
      if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[bestAt]) ?? Infinity)) bestAt = i;
    }
    const current = open.splice(bestAt, 1)[0];
    if (current === goalIndex) return smooth(grid, reconstruct(cameFrom, current));
    closed.add(current);
    expanded += 1;

    const cell = grid.cells[current]!;
    for (const next of grid.neighboursOf(current)) {
      if (closed.has(next)) continue;
      const neighbour = grid.cells[next]!;
      // Capability gate: an agent that cannot cross this terrain never
      // considers the edge at all.
      if (!caps.tags.has(neighbour.tag)) continue;

      const step = Math.hypot(neighbour.x - cell.x, neighbour.z - cell.z)
        + Math.abs(neighbour.y - cell.y) * 2;
      const tentative = (gScore.get(current) ?? Infinity) + step;
      if (tentative >= (gScore.get(next) ?? Infinity)) continue;

      cameFrom.set(next, current);
      gScore.set(next, tentative);
      fScore.set(next, tentative + heuristic(neighbour, goal));
      if (!open.includes(next)) open.push(next);
    }
  }

  return null;
}

function heuristic(a: NavCell, b: NavCell): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function reconstruct(cameFrom: Map<number, number>, end: number): number[] {
  const out = [end];
  let current = end;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    out.unshift(current);
  }
  return out;
}

/**
 * Drop waypoints that add nothing.
 *
 * A raw grid path is a staircase of 2 m steps; walking it literally produces
 * the robotic zig-zag that gives grid-based bots away. Keeping only the
 * corners restores a natural line.
 */
function smooth(grid: NavGrid, indices: number[]): Vec3[] {
  const points: Vec3[] = indices.map((i) => {
    const cell = grid.cells[i]!;
    return [cell.x, cell.y, cell.z] as Vec3;
  });
  if (points.length <= 2) return points;

  const out: Vec3[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const next = points[i + 1];
    const dx1 = points[i][0] - prev[0], dz1 = points[i][2] - prev[2];
    const dx2 = next[0] - points[i][0], dz2 = next[2] - points[i][2];
    // Keep the point only where the direction actually changes.
    if (Math.abs(dx1 * dz2 - dz1 * dx2) > 1e-6 || Math.abs(points[i][1] - prev[1]) > 0.1) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function nearestWalkable(grid: NavGrid, at: Vec3, caps: TraversalCaps): number {
  const direct = grid.indexAt(at[0], at[2]);
  if (direct >= 0) {
    const cell = grid.cells[direct];
    if (cell && caps.tags.has(cell.tag)) return direct;
  }
  // Spiral outward. A bot standing just inside a wall (or on a ledge the grid
  // rejected) must still be able to start a path, or it freezes permanently.
  for (let radius = 1; radius <= 4; radius += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const index = grid.indexAt(at[0] + dx * CELL_SIZE, at[2] + dz * CELL_SIZE);
        if (index < 0) continue;
        const cell = grid.cells[index];
        if (cell && caps.tags.has(cell.tag)) return index;
      }
    }
  }
  return -1;
}
