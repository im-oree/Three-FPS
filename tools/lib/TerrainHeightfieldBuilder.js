/**
 * TerrainHeightfieldBuilder.js — Document N §2: Firing Range's non-flat dirt
 * terrain. Same file family / same conventions as MapShellBuilder.js; it does
 * not replace anything there, it adds the one thing a jungle-village map needs
 * that a flat dockyard did not.
 *
 * SOURCE OF TRUTH IS AN IMAGE. The gross landform comes from a real committed
 * greyscale heightmap (assets/textures/environment/firingrange_heightmap.png),
 * bilinearly sampled — authored elevation, not a noise function that happens
 * to look okay. Noise is layered on top only as fine break-up so the flat
 * shading doesn't read as a smooth blurry blob.
 *
 * Four modifiers then run, in this order, and the order matters:
 *
 *   1. COMPOUND FLATTENING — inside the playable boundary polygon the
 *      heightmap's amplitude is crushed toward a near-flat yard, and OUTSIDE
 *      it the full amplitude is allowed, so jungle hillocks and berms rise
 *      around the map and visually seal it. A shooter's playspace has to be
 *      flat enough to strafe across; the drama belongs at the edges.
 *   2. PATH FLATTENING — worn dirt routes between structures keep 10% of the
 *      local undulation (wheel-rut variation, not billiard-flat) and darken.
 *   3. BUILDING PADS — hard-flattened to an exact height. This is a
 *      CORRECTNESS requirement, not polish: a building's collision is authored
 *      assuming a flat local base, so a structure on lumpy ground either
 *      floats or buries its doorway.
 *   4. RIM BERM — beyond the boundary the ground lifts, so a player looking
 *      out of the map sees terrain, not a horizon cut.
 *
 * COLLISION IS SEPARATE AND COARSER (Document 4's visual-vs-collision policy):
 * the visual mesh is a dense grid, the collider is a decimated Rapier
 * heightfield baked to JSON at build time and constructed at load time, like
 * every other collider in this project (data -> Rapier desc), never
 * mesh-derived.
 */
import * as THREE from 'three';
import { readHeightmapGrid } from './PngIO.js';

// --------------------------------------------------------------- helpers ---

/** Deterministic LCG — the project's standard seeded RNG shape. */
export function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Value noise with a seeded hash — used ONLY as fine break-up over the
 * authored heightmap.
 *
 * (Deliberately not simplex-noise's createNoise2D here: the obvious
 * `createNoise2D(() => 0.42)` "fixed seed" idiom is a trap — a
 * constant-returning RNG makes Fisher-Yates produce a degenerate permutation
 * table, so the field collapses into visible axis-aligned banding. A hash
 * noise is seedable by construction and has no such failure mode.)
 */
export function makeValueNoise2D(seed) {
  const s = (seed >>> 0) || 1;
  const hash = (xi, yi) => {
    let h = (xi * 374761393 + yi * 668265263 + s * 2246822519) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const xf = x - xi; const yf = y - yi;
    const u = fade(xf); const v = fade(yf);
    const a = hash(xi, yi); const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1); const d = hash(xi + 1, yi + 1);
    return ((a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v) * 2 - 1;
  };
}

/** Bilinear sampler over a normalised [0..1] heightmap grid, world XZ in. */
export function makeHeightmapSampler({ grid, width: gw, height: gh }, worldWidth, worldDepth) {
  return (x, z) => {
    const u = THREE.MathUtils.clamp((x / worldWidth) + 0.5, 0, 1) * (gw - 1);
    const v = THREE.MathUtils.clamp((z / worldDepth) + 0.5, 0, 1) * (gh - 1);
    const x0 = Math.floor(u); const y0 = Math.floor(v);
    const x1 = Math.min(x0 + 1, gw - 1); const y1 = Math.min(y0 + 1, gh - 1);
    const fx = u - x0; const fy = v - y0;
    const g00 = grid[y0 * gw + x0]; const g10 = grid[y0 * gw + x1];
    const g01 = grid[y1 * gw + x0]; const g11 = grid[y1 * gw + x1];
    return (g00 * (1 - fx) + g10 * fx) * (1 - fy) + (g01 * (1 - fx) + g11 * fx) * fy;
  };
}

export function distanceToSegment(px, pz, a, b) {
  const abx = b[0] - a[0]; const abz = b[1] - a[1];
  const denom = abx * abx + abz * abz || 1;
  const t = THREE.MathUtils.clamp(((px - a[0]) * abx + (pz - a[1]) * abz) / denom, 0, 1);
  return Math.hypot(px - (a[0] + abx * t), pz - (a[1] + abz * t));
}

export function distanceToPolyline(x, z, points) {
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = distanceToSegment(x, z, points[i], points[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, zi] = poly[i]; const [xj, zj] = poly[j];
    if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

/** Distance to a closed polygon's boundary — SIGNED (+ inside, - outside). */
export function signedDistanceToPolygon(x, z, poly) {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const d = distanceToSegment(x, z, poly[j], poly[i]);
    if (d < min) min = d;
  }
  return pointInPolygon(x, z, poly) ? min : -min;
}

// --------------------------------------------------------- the build pass ---

/**
 * The single height function. Exported separately from the mesh build so the
 * VISUAL mesh, the COLLISION heightfield and the FOLIAGE placement sampler are
 * provably the same surface — three consumers, one formula, no drift.
 */
export function makeTerrainHeightFunction({
  heightmapSampler, noise,
  reference = 0.54, amplitude = 16,
  boundaryPolygon = [], interiorFlatten = 0.12, interiorFalloff = 12,
  rimBerm = 2.6, rimFalloff = 16,
  pathSplines = [], flatZones = [],
}) {
  return (x, z) => {
    // 1. Authored LANDFORM from the heightmap image, re-zeroed on the
    //    compound's plateau value so the yard sits at world y = 0.
    let height = (heightmapSampler(x, z) - reference) * amplitude;

    // MICRO-RELIEF is kept separate from the landform on purpose. The
    // interior flatten in step 2 scales the landform down by 10x so the map
    // is playable — and if the detail octaves were folded in here they would
    // be scaled by that same 10x, leaving the compound a mirror-flat plane.
    // Three octaves: broad swells, cart ruts, then a fine chatter that gives
    // flat shading facets to catch the light. Amplitudes are large enough to
    // be felt underfoot (~1.6 m peak-to-trough inside the compound) but the
    // wavelengths are long enough that the steepest gradient stays well under
    // the character controller's step offset — undulating, never a staircase.
    const detail = noise(x * 0.038, z * 0.038) * 0.72
      + noise(x * 0.110, z * 0.110) * 0.30
      + noise(x * 0.300, z * 0.300) * 0.10;

    // 2. Compound flattening + rim berm, both from one signed distance.
    //
    // The ramp is deliberately biased OUTWARD: full landform amplitude is
    // only reached well beyond the wall, and the compound interior is nearly
    // flat from a couple of metres inside the boundary onward. Ramping on the
    // inside instead (the obvious reading of "flatten the interior") puts a
    // 17 m-amplitude hillside inside the fence, which measured out at slopes
    // of 2.1 — unwalkable ground in the playable area.
    let pathInfluence = 0;
    if (boundaryPolygon.length) {
      const sd = signedDistanceToPolygon(x, z, boundaryPolygon);
      const t = THREE.MathUtils.clamp(
        (sd + interiorFalloff) / (interiorFalloff + 4), 0, 1,
      );
      const smooth = t * t * (3 - 2 * t);
      height *= THREE.MathUtils.lerp(1, interiorFlatten, smooth);
      if (sd < 0) {
        const b = THREE.MathUtils.clamp(-sd / rimFalloff, 0, 1);
        height += rimBerm * b * b * (3 - 2 * b);
      }
      // Micro-relief survives the flatten at ~65% inside the compound: the
      // yard is graded dirt, not poured concrete, and it still has to read as
      // uneven ground underfoot.
      height += detail * THREE.MathUtils.lerp(1, 0.65, smooth);
    } else {
      height += detail;
    }

    // 3. Worn path routes: flatten to 10% and mark for the colour blend.
    for (const path of pathSplines) {
      const d = distanceToPolyline(x, z, path.points);
      const t = 1 - THREE.MathUtils.clamp(d / path.flattenRadius, 0, 1);
      if (t > pathInfluence) pathInfluence = t;
    }
    height *= 1 - pathInfluence * 0.9;

    // 4. Building pads — HARD flatten (correctness, see header).
    for (const zone of flatZones) {
      let dx = Math.abs(x - zone.centerXZ[0]);
      let dz = Math.abs(z - zone.centerXZ[1]);
      let d;
      if (zone.shape === 'circle') {
        d = Math.hypot(dx, dz) - zone.radius;
      } else {
        // Rotated footprints: bring the sample into the pad's own frame
        // before the box test, or a building at 30 degrees gets an
        // axis-aligned pad that leaves two of its corners on lumpy ground.
        if (zone.yaw) {
          const rx = x - zone.centerXZ[0];
          const rz = z - zone.centerXZ[1];
          const c = Math.cos(-zone.yaw);
          const s = Math.sin(-zone.yaw);
          dx = Math.abs(rx * c - rz * s);
          dz = Math.abs(rx * s + rz * c);
        }
        // Chebyshev-ish distance outside the box, so pads feather rather than
        // cliff-edge into the surrounding dirt.
        d = Math.max(dx - zone.halfExtents[0], dz - zone.halfExtents[1]);
      }
      const feather = zone.feather ?? 2.0;
      if (d < feather) {
        const blend = 1 - THREE.MathUtils.clamp(d / feather, 0, 1);
        const smooth = blend * blend * (3 - 2 * blend);
        height = THREE.MathUtils.lerp(height, zone.padHeight ?? 0, smooth);
        pathInfluence = Math.max(pathInfluence, smooth * 0.45);
      }
    }
    return { height, pathInfluence };
  };
}

/**
 * Build the VISUAL terrain mesh: vertex-coloured, flat-shaded dirt.
 * Returns the mesh plus the shared height function so callers can place props,
 * foliage and collision against the exact same surface.
 */
export function buildTerrainHeightfield({
  width, depth, segments = 220,
  heightmapPath,
  reference = 0.54, amplitude = 16, noiseSeed = 91731,
  boundaryPolygon = [], interiorFlatten = 0.12, interiorFalloff = 12,
  rimBerm = 2.6, rimFalloff = 16,
  pathSplines = [], flatZones = [],
  baseColor = 0x8a6f45, pathColor = 0x6d573a, grassColor = 0x5c6b38,
  grassStartHeight = 1.2, grassFullHeight = 3.4,
}) {
  const image = readHeightmapGrid(heightmapPath);
  const heightmapSampler = makeHeightmapSampler(image, width, depth);
  const noise = makeValueNoise2D(noiseSeed);
  const heightFn = makeTerrainHeightFunction({
    heightmapSampler, noise, reference, amplitude,
    boundaryPolygon, interiorFlatten, interiorFalloff, rimBerm, rimFalloff,
    pathSplines, flatZones,
  });

  const geo = new THREE.PlaneGeometry(width, depth, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const baseC = new THREE.Color(baseColor);
  const pathC = new THREE.Color(pathColor);
  const grassC = new THREE.Color(grassColor);
  const scratch = new THREE.Color();
  const tintNoise = makeValueNoise2D(noiseSeed ^ 0x5bd1);

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i); const z = pos.getZ(i);
    const { height, pathInfluence } = heightFn(x, z);
    pos.setY(i, height);

    // Dirt -> worn path -> grass, plus a low-frequency dirt tint variation so
    // the yard isn't one flat brown sheet under flat shading.
    const grassT = THREE.MathUtils.smoothstep(height, grassStartHeight, grassFullHeight)
      * (1 - pathInfluence);
    scratch.copy(baseC);
    const tint = tintNoise(x * 0.04, z * 0.04) * 0.055;
    scratch.offsetHSL(tint * 0.12, tint * 0.25, tint);
    scratch.lerp(pathC, pathInfluence);
    scratch.lerp(grassC, grassT);
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.97, metalness: 0.0, flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'Terrain_Visual';
  mesh.receiveShadow = true;
  mesh.castShadow = false; // a ground plane casting onto itself only self-shadow-acnes

  return {
    mesh,
    heightFn,
    heightAt: (x, z) => heightFn(x, z).height,
  };
}

/**
 * Bake the decimated Rapier heightfield collider payload.
 *
 * RAPIER CONVENTION (verified empirically against @dimforge/rapier3d-compat,
 * not assumed): heights are COLUMN-MAJOR with index = col * (nrows + 1) + row,
 * `row` runs along +Z, `col` runs along +X, the field is centred on its body,
 * and `scale` gives the full span on each axis. Getting this transposed is the
 * classic heightfield bug — it produces terrain that silently disagrees with
 * the visual mesh along the diagonal.
 */
export function buildTerrainCollisionData({
  width, depth, heightFn, ncols = 96, nrows = 88,
}) {
  const heights = new Float32Array((nrows + 1) * (ncols + 1));
  for (let row = 0; row <= nrows; row += 1) {
    const z = (row / nrows - 0.5) * depth;
    for (let col = 0; col <= ncols; col += 1) {
      const x = (col / ncols - 0.5) * width;
      heights[col * (nrows + 1) + row] = heightFn(x, z).height;
    }
  }
  return {
    nrows,
    ncols,
    // y scale of 1: heights are already world metres.
    scale: { x: width, y: 1, z: depth },
    heights: Array.from(heights, (h) => Math.round(h * 1000) / 1000),
  };
}

export default {
  buildTerrainHeightfield, buildTerrainCollisionData, makeTerrainHeightFunction,
  makeHeightmapSampler, makeValueNoise2D, seededRandom,
  pointInPolygon, signedDistanceToPolygon, distanceToPolyline,
};
