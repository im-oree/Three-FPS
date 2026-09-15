/**
 * FoliageScatter.js — Document N §5.2: deterministic vegetation placement.
 *
 * Rejection-sampled minimum-spacing scatter (a cheap Poisson-disc stand-in —
 * at these instance counts a real Bridson implementation buys nothing) inside
 * an authored polygon zone, with per-instance yaw and scale jitter.
 *
 * Runs at BUILD TIME, not runtime: the tool bakes the resulting transforms
 * straight into the prop manifest, so foliage is architecturally just more
 * manifest-driven instanced props and needs zero new placement code in
 * MapBuilder or PropPool. It is also therefore identical on every machine and
 * every reload — a forest that reshuffles itself between sessions would make
 * the baked minimap and the callout zones lie.
 *
 * Placements are filtered against buildings, paths and the compound floor so
 * nothing grows through a wall or across a walkway.
 */
import {
  pointInPolygon, distanceToPolyline, signedDistanceToPolygon, seededRandom,
} from './TerrainHeightfieldBuilder.js';

function polygonBounds(points) {
  return points.reduce((b, p) => ({
    minX: Math.min(b.minX, p[0]), maxX: Math.max(b.maxX, p[0]),
    minZ: Math.min(b.minZ, p[1]), maxZ: Math.max(b.maxZ, p[1]),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

/**
 * @param {object} opts
 * @param {number[][]} opts.polygon      zone outline, world XZ
 * @param {number} opts.count            target instance count
 * @param {number} opts.minSpacing       metres between instances
 * @param {function} opts.heightAt       (x,z) => terrain y
 * @param {object[]} opts.exclusions     [{ centerXZ, halfExtents, yaw, margin }]
 * @param {object[]} opts.paths          path splines to keep clear of
 * @param {number} opts.avoidPaths       clearance from paths (0 = ignore)
 * @param {number[][]} opts.boundary     compound boundary polygon
 * @param {boolean} opts.outside         only place OUTSIDE the boundary
 * @param {boolean} opts.ring            only place in the band around it
 * @param {number} opts.maxSlope         reject spots steeper than this
 */
export function scatterFoliage({
  polygon, count, minSpacing, heightAt, seed = 1,
  exclusions = [], paths = [], avoidPaths = 0,
  boundary = null, outside = false, ring = false,
  scaleRange = [0.82, 1.28], maxSlope = 0.75,
}) {
  const rng = seededRandom(seed);
  const bounds = polygonBounds(polygon);
  const placed = [];
  // Spatial hash so the spacing test stays O(1) per candidate rather than
  // O(n) — at 260 grass tufts x 20 attempts the naive version is noticeable.
  const cell = Math.max(minSpacing, 0.001);
  const grid = new Map();
  const keyOf = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const tooClose = (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        const bucket = grid.get(`${cx + i},${cz + j}`);
        if (!bucket) continue;
        for (const p of bucket) {
          if (Math.hypot(p[0] - x, p[1] - z) < minSpacing) return true;
        }
      }
    }
    return false;
  };

  const maxAttempts = count * 40;
  for (let attempt = 0; attempt < maxAttempts && placed.length < count; attempt += 1) {
    const x = bounds.minX + (bounds.maxX - bounds.minX) * rng();
    const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * rng();
    if (!pointInPolygon(x, z, polygon)) continue;

    if (boundary) {
      const sd = signedDistanceToPolygon(x, z, boundary);
      // `outside`: keep clear of the wall line so trees don't grow through it.
      if (outside && sd > -2.5) continue;
      // `ring`: hug the inside of the boundary — the scrub against the fence.
      if (ring && (sd < 0 || sd > 6)) continue;
      if (!outside && !ring && sd < 0.5) continue;
    }
    if (tooClose(x, z)) continue;

    let blocked = false;
    for (const ex of exclusions) {
      let dx = x - ex.centerXZ[0];
      let dz = z - ex.centerXZ[1];
      if (ex.yaw) {
        const c = Math.cos(-ex.yaw);
        const s = Math.sin(-ex.yaw);
        const rx = dx * c - dz * s;
        const rz = dx * s + dz * c;
        dx = rx; dz = rz;
      }
      const m = ex.margin ?? 0;
      if (Math.abs(dx) < ex.halfExtents[0] + m && Math.abs(dz) < ex.halfExtents[1] + m) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    if (avoidPaths > 0) {
      let onPath = false;
      for (const path of paths) {
        if (distanceToPolyline(x, z, path.points) < (path.flattenRadius ?? 3) * 0.8 + avoidPaths) {
          onPath = true;
          break;
        }
      }
      if (onPath) continue;
    }

    const y = heightAt(x, z);
    // Slope rejection: nothing grows convincingly on a cliff face, and a tree
    // half-buried in a bank looks worse than no tree.
    if (maxSlope > 0) {
      const e = 1.2;
      const slope = Math.max(
        Math.abs(heightAt(x + e, z) - y), Math.abs(heightAt(x - e, z) - y),
        Math.abs(heightAt(x, z + e) - y), Math.abs(heightAt(x, z - e) - y),
      ) / e;
      if (slope > maxSlope) continue;
    }

    placed.push({
      position: [
        Math.round(x * 100) / 100,
        Math.round(y * 100) / 100,
        Math.round(z * 100) / 100,
      ],
      rotation: [0, Math.round(rng() * Math.PI * 2 * 1000) / 1000, 0],
      scale: Math.round((scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0])) * 100) / 100,
    });
    const k = keyOf(x, z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([x, z]);
  }
  return placed;
}

export default { scatterFoliage };
