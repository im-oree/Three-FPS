/**
 * CollisionWorld.ts — the authoritative collision geometry.
 *
 * WHY NOT RAPIER HERE
 * -------------------
 * Rapier does run headless (verified), and the client already uses it for
 * rigid bodies. But the server needs exactly two questions answered — "can a
 * capsule stand here" and "what does this ray hit" — against level geometry
 * that is already described as axis-aligned boxes in LevelDefinition. Running
 * a full physics pipeline per room to answer those would cost a WASM instance
 * and a step budget per match, on a free-tier host, for queries an AABB sweep
 * answers exactly.
 *
 * The client keeps Rapier for what Rapier is good at: tumbling casings,
 * dropped magazines, ragdolls — presentation the server does not arbitrate.
 *
 * The important property is that this is DETERMINISTIC. Identical inputs
 * produce bit-identical results on every machine, which a broadphase with
 * floating-point island sorting does not guarantee.
 */
import type { Vec3 } from '../net/Protocol';

export interface Box {
  readonly minX: number; readonly minY: number; readonly minZ: number;
  readonly maxX: number; readonly maxY: number; readonly maxZ: number;
  readonly surface: string;
}

export interface RayHit {
  readonly distance: number;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly surface: string;
  /** Index of the box struck, for debugging. */
  readonly boxIndex: number;
}

/**
 * A terrain heightfield, in the same format the client feeds to Rapier.
 *
 * Levels built on sculpted ground (Firing Range, Prototype) have no ground
 * slab at all — their floor IS this field. It used to be loaded only by the
 * client's LevelLoader, which meant the SERVER had no ground on those maps
 * and every player, human or bot, fell through the world the moment physics
 * moved server-side. Same data, same convention, both sides.
 */
export interface Heightfield {
  readonly nrows: number;
  readonly ncols: number;
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
  /** Column-major: index = col * (nrows + 1) + row. See TerrainHeightfieldBuilder. */
  readonly heights: readonly number[];
  readonly surface: string;
}

/** A tiny gap kept between the capsule and geometry so contact is stable. */
const SKIN = 0.001;

/**
 * One slab-intersection parameter, without the 0/0 trap.
 *
 * `offset * inverseDirection` is the plain form. When the direction component
 * is zero the inverse is +/-Infinity, and `0 * Infinity` is NaN -- exactly the
 * case of a ray travelling parallel to a face while lying in its plane. The
 * limit there is "never enters along this axis", so the sign of the offset is
 * the right answer.
 */
function slab(offset: number, inverseDir: number): number {
  const t = offset * inverseDir;
  if (Number.isNaN(t)) return offset >= 0 ? Infinity : -Infinity;
  return t;
}

export class CollisionWorld {
  private boxes: Box[] = [];
  private terrain: Heightfield | null = null;

  /**
   * The height below which a body has left the world.
   *
   * Part of the collision description because it IS one: it answers "is this
   * position still inside the level", which is the same question the boxes
   * answer. Levels that never set one keep the default, so a map with a gap
   * in its floor cannot produce a player who falls for the rest of the match.
   */
  private killPlane = -25;

  get killPlaneY(): number { return this.killPlane; }

  get boxCount(): number { return this.boxes.length; }

  /** True when this level's floor is sculpted terrain rather than a slab. */
  get hasTerrain(): boolean { return this.terrain !== null; }

  /** Read-only view of the geometry, for systems that need the map's bounds
   *  (AI navigation builds its grid from exactly this). */
  get allBoxes(): readonly Box[] { return this.boxes; }

  load(
    boxes: readonly Box[],
    terrain: Heightfield | null = null,
    killPlaneY = -25,
  ): void {
    this.boxes = [...boxes];
    this.terrain = terrain;
    this.killPlane = Number.isFinite(killPlaneY) ? killPlaneY : -25;
  }

  clear(): void {
    this.boxes.length = 0;
    this.terrain = null;
  }

  /**
   * Ground height at a world point, or null when outside the field.
   *
   * Bilinear across the same quad the renderer draws, so the server agrees
   * with what the player sees to well under a centimetre.
   */
  terrainHeightAt(x: number, z: number): number | null {
    const field = this.terrain;
    if (!field) return null;
    const { nrows, ncols, scale, heights } = field;
    // Field is centred on the origin and spans `scale` metres.
    const u = (x / scale.x + 0.5) * ncols;
    const v = (z / scale.z + 0.5) * nrows;
    if (!(u >= 0 && u <= ncols && v >= 0 && v <= nrows)) return null;

    const c0 = Math.min(ncols - 1, Math.floor(u));
    const r0 = Math.min(nrows - 1, Math.floor(v));
    const fu = u - c0;
    const fv = v - r0;
    const stride = nrows + 1;
    const h00 = heights[c0 * stride + r0];
    const h10 = heights[(c0 + 1) * stride + r0];
    const h01 = heights[c0 * stride + r0 + 1];
    const h11 = heights[(c0 + 1) * stride + r0 + 1];
    const top = h00 + (h10 - h00) * fu;
    const bottom = h01 + (h11 - h01) * fu;
    return (top + (bottom - top) * fv) * scale.y;
  }

  /** Surface name of the terrain, for footstep and hit audio. */
  get terrainSurface(): string { return this.terrain?.surface ?? 'dirt'; }

  /**
   * Sweep an axis-aligned capsule (approximated by its bounding box) along one
   * axis and return the allowed displacement.
   *
   * Axis-by-axis resolution is deliberate: it is what produces the familiar
   * FPS behaviour of sliding along a wall instead of stopping dead when you
   * walk into it at an angle.
   */
  private sweepAxis(
    px: number, py: number, pz: number,
    radius: number, height: number,
    axis: 0 | 1 | 2, delta: number,
  ): number {
    if (delta === 0) return 0;

    // Capsule bounds. py is the FEET position, so the body spans [py, py+height].
    const minX = px - radius, maxX = px + radius;
    const minY = py, maxY = py + height;
    const minZ = pz - radius, maxZ = pz + radius;

    let allowed = delta;
    for (const box of this.boxes) {
      // Overlap on the two axes we are NOT moving along; without this a box
      // far to the side would still clamp forward motion.
      if (axis !== 0 && !(minX < box.maxX && maxX > box.minX)) continue;
      if (axis !== 1 && !(minY < box.maxY && maxY > box.minY)) continue;
      if (axis !== 2 && !(minZ < box.maxZ && maxZ > box.minZ)) continue;

      if (axis === 0) {
        if (delta > 0 && minX < box.minX) allowed = Math.min(allowed, box.minX - maxX - SKIN);
        else if (delta < 0 && maxX > box.maxX) allowed = Math.max(allowed, box.maxX - minX + SKIN);
      } else if (axis === 1) {
        if (delta > 0 && minY < box.minY) allowed = Math.min(allowed, box.minY - maxY - SKIN);
        else if (delta < 0 && maxY > box.maxY) allowed = Math.max(allowed, box.maxY - minY + SKIN);
      } else {
        if (delta > 0 && minZ < box.minZ) allowed = Math.min(allowed, box.minZ - maxZ - SKIN);
        else if (delta < 0 && maxZ > box.maxZ) allowed = Math.max(allowed, box.maxZ - minZ + SKIN);
      }
    }
    // Terrain is the floor on sculpted levels. Only downward motion is
    // clamped by it: it is a surface to stand on, not a ceiling. Sampling
    // the capsule's centre and its four extremes keeps a body from sinking
    // a corner into a slope it is walking across.
    if (this.terrain && axis === 1 && delta < 0) {
      const ground = this.highestTerrainUnder(px, pz, radius);
      if (ground !== null && py + delta < ground) {
        allowed = Math.max(allowed, ground - py);
      }
    }

    // A sweep must never push the body the way it was not going.
    return delta > 0 ? Math.max(0, allowed) : Math.min(0, allowed);
  }

  /**
   * Highest terrain height under a capsule's footprint.
   *
   * Five samples rather than one: a single centre sample lets the downhill
   * edge of the body clip into a slope, which reads as the feet sinking into
   * the hill on anything steeper than a gentle rise.
   */
  private highestTerrainUnder(px: number, pz: number, radius: number): number | null {
    if (!this.terrain) return null;
    let best: number | null = null;
    const offsets: readonly [number, number][] = [
      [0, 0], [-radius, 0], [radius, 0], [0, -radius], [0, radius],
    ];
    for (const [ox, oz] of offsets) {
      const h = this.terrainHeightAt(px + ox, pz + oz);
      if (h !== null && (best === null || h > best)) best = h;
    }
    return best;
  }

  /**
   * Move a capsule by (dx, dy, dz), resolving collisions.
   *
   * Horizontal motion is attempted twice: once flat, and if that is blocked,
   * again lifted by MAX_STEP_HEIGHT. That second attempt is what lets players
   * walk up kerbs and stairs instead of catching on every 10 cm lip.
   */
  moveCapsule(
    px: number, py: number, pz: number,
    radius: number, height: number,
    dx: number, dy: number, dz: number,
    stepHeight: number,
  ): { x: number; y: number; z: number; hitX: boolean; hitY: boolean; hitZ: boolean; grounded: boolean } {
    let x = px, y = py, z = pz;

    // Vertical first, so a falling body lands before it tries to move along.
    const ady = this.sweepAxis(x, y, z, radius, height, 1, dy);
    const hitY = Math.abs(ady - dy) > SKIN * 2;
    y += ady;
    const grounded = dy <= 0 && hitY;

    // Horizontal, axis by axis, so blocked-on-one-axis still slides.
    const adx = this.sweepAxis(x, y, z, radius, height, 0, dx);
    const adz = this.sweepAxis(x + adx, y, z, radius, height, 2, dz);
    let hitX = Math.abs(adx - dx) > SKIN * 2;
    let hitZ = Math.abs(adz - dz) > SKIN * 2;

    if ((hitX || hitZ) && grounded && stepHeight > 0) {
      // Retry the blocked motion from a stepped-up position.
      const lift = this.sweepAxis(x, y, z, radius, height, 1, stepHeight);
      if (lift > SKIN) {
        const sx = this.sweepAxis(x, y + lift, z, radius, height, 0, dx);
        const sz = this.sweepAxis(x + sx, y + lift, z, radius, height, 2, dz);
        // Only accept the step if it genuinely gained ground.
        if (Math.abs(sx) + Math.abs(sz) > Math.abs(adx) + Math.abs(adz) + SKIN) {
          x += sx; z += sz;
          // Drop back down onto whatever we stepped onto.
          const drop = this.sweepAxis(x, y + lift, z, radius, height, 1, -lift);
          y += lift + drop;
          hitX = Math.abs(sx - dx) > SKIN * 2;
          hitZ = Math.abs(sz - dz) > SKIN * 2;
          return { x, y, z, hitX, hitZ, hitY, grounded: true };
        }
      }
    }

    x += adx;
    z += adz;
    return { x, y, z, hitX, hitY, hitZ, grounded };
  }

  /** Is there room for a capsule of this size at this position? */
  fits(px: number, py: number, pz: number, radius: number, height: number): boolean {
    const minX = px - radius, maxX = px + radius;
    const minY = py, maxY = py + height;
    const minZ = pz - radius, maxZ = pz + radius;
    for (const box of this.boxes) {
      if (minX < box.maxX && maxX > box.minX
        && minY < box.maxY && maxY > box.minY
        && minZ < box.maxZ && maxZ > box.minZ) return false;
    }
    // Buried in the hillside is not a valid pose. A small tolerance keeps a
    // body resting exactly on a slope from reporting itself stuck.
    if (this.terrain) {
      const ground = this.highestTerrainUnder(px, pz, radius);
      if (ground !== null && py < ground - 0.05) return false;
    }
    return true;
  }

  /**
   * Cast a ray and return the nearest hit. This is the ONLY hit-registration
   * primitive: bullets, line of sight and AI perception all resolve through
   * it, so they cannot disagree about what is solid.
   */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null {
    let best: RayHit | null = null;
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = dir;

    // Reciprocals once, not per box. `dir` is expected to be normalised; a
    // zero component yields +/-Infinity, which the slab test handles.
    const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;

    for (let i = 0; i < this.boxes.length; i += 1) {
      const box = this.boxes[i];
      // Slab method.
      //
      // The subtlety is the DEGENERATE case: when the ray has a zero
      // component AND starts exactly on that face's plane, the division is
      // 0/0, which is NaN rather than an infinity. Every comparison against
      // NaN is false, so the guards below silently accept the box and return
      // a hit with a NaN distance -- an axis-aligned ray (straight down at a
      // roof, dead along a corridor) would report hitting a box nowhere near
      // it. slab() substitutes the sign of the offset for the degenerate
      // case, which is what the limit actually is.
      const tx1 = slab(box.minX - ox, idx), tx2 = slab(box.maxX - ox, idx);
      const ty1 = slab(box.minY - oy, idy), ty2 = slab(box.maxY - oy, idy);
      const tz1 = slab(box.minZ - oz, idz), tz2 = slab(box.maxZ - oz, idz);

      const tmin = Math.max(
        Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2),
      );
      const tmax = Math.min(
        Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2),
      );
      if (tmax < 0 || tmin > tmax || tmin > maxDistance) continue;

      const t = tmin >= 0 ? tmin : tmax;
      if (t < 0 || t > maxDistance) continue;
      if (best && t >= best.distance) continue;

      // Face normal: whichever slab entry produced tmin.
      let normal: Vec3 = [0, 1, 0];
      const ex = Math.min(tx1, tx2), ey = Math.min(ty1, ty2), ez = Math.min(tz1, tz2);
      if (ex >= ey && ex >= ez) normal = [dx > 0 ? -1 : 1, 0, 0];
      else if (ey >= ez) normal = [0, dy > 0 ? -1 : 1, 0];
      else normal = [0, 0, dz > 0 ? -1 : 1];

      best = {
        distance: t,
        point: [ox + dx * t, oy + dy * t, oz + dz * t],
        normal,
        surface: box.surface,
        boxIndex: i,
      };
    }

    // Terrain, if this level has any. Bullets must stop in the dirt and line
    // of sight must be blocked by a ridge, or a bot could shoot through a
    // hill that a player cannot.
    const ground = this.raycastTerrain(origin, dir, best ? best.distance : maxDistance);
    if (ground && (!best || ground.distance < best.distance)) best = ground;

    return best;
  }

  /**
   * March a ray against the heightfield.
   *
   * Fixed-step sampling with a bisection refinement: the field is smooth and
   * the step is well under a cell, so this cannot tunnel through a ridge, and
   * refining only after a crossing keeps it cheap enough for the AI's
   * per-tick raycast budget.
   */
  private raycastTerrain(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null {
    if (!this.terrain) return null;
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = dir;

    const STEP = 0.5;
    const cellX = this.terrain.scale.x / this.terrain.ncols;
    const cellZ = this.terrain.scale.z / this.terrain.nrows;
    const step = Math.min(STEP, Math.max(0.25, Math.min(cellX, cellZ) * 0.5));

    let previous = 0;
    let previousAbove = true;
    const startGround = this.terrainHeightAt(ox, oz);
    if (startGround !== null) previousAbove = oy >= startGround;

    for (let t = step; t <= maxDistance; t += step) {
      const h = this.terrainHeightAt(ox + dx * t, oz + dz * t);
      if (h === null) { previous = t; continue; }
      const above = oy + dy * t >= h;
      if (above !== previousAbove) {
        // Crossed the surface between `previous` and `t`: bisect to refine.
        let lo = previous, hi = t;
        for (let i = 0; i < 12; i += 1) {
          const mid = (lo + hi) * 0.5;
          const hm = this.terrainHeightAt(ox + dx * mid, oz + dz * mid);
          if (hm === null) break;
          if ((oy + dy * mid >= hm) === previousAbove) lo = mid; else hi = mid;
        }
        const hit = (lo + hi) * 0.5;
        if (hit < 0 || hit > maxDistance) return null;
        return {
          distance: hit,
          point: [ox + dx * hit, oy + dy * hit, oz + dz * hit],
          normal: this.terrainNormalAt(ox + dx * hit, oz + dz * hit),
          surface: this.terrain.surface,
          boxIndex: -1,
        };
      }
      previous = t;
      previousAbove = above;
    }
    return null;
  }

  /** Terrain normal by central difference, for ricochets and decals. */
  private terrainNormalAt(x: number, z: number): Vec3 {
    const e = 0.5;
    const hL = this.terrainHeightAt(x - e, z) ?? 0;
    const hR = this.terrainHeightAt(x + e, z) ?? 0;
    const hD = this.terrainHeightAt(x, z - e) ?? 0;
    const hU = this.terrainHeightAt(x, z + e) ?? 0;
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * e;
    const length = Math.hypot(nx, ny, nz) || 1;
    return [nx / length, ny / length, nz / length];
  }

  /** Is there clear line of sight between two points? */
  hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-6) return true;
    const hit = this.raycast(from, [dx / distance, dy / distance, dz / distance], distance);
    return hit === null;
  }
}
