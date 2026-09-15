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

/** A tiny gap kept between the capsule and geometry so contact is stable. */
const SKIN = 0.001;

export class CollisionWorld {
  private boxes: Box[] = [];

  get boxCount(): number { return this.boxes.length; }

  load(boxes: readonly Box[]): void {
    this.boxes = [...boxes];
  }

  clear(): void {
    this.boxes.length = 0;
  }

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
    // A sweep must never push the body the way it was not going.
    return delta > 0 ? Math.max(0, allowed) : Math.min(0, allowed);
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

    for (let i = 0; i < this.boxes.length; i += 1) {
      const box = this.boxes[i];
      // Slab method. A zero component is handled by the infinities that
      // division by zero produces, which is correct here rather than a bug.
      const tx1 = (box.minX - ox) / dx, tx2 = (box.maxX - ox) / dx;
      const ty1 = (box.minY - oy) / dy, ty2 = (box.maxY - oy) / dy;
      const tz1 = (box.minZ - oz) / dz, tz2 = (box.maxZ - oz) / dz;

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
    return best;
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
