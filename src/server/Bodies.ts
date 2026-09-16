/**
 * Bodies.ts — what every physical thing in the world occupies.
 *
 * Before this, "does a bullet hit it" and "can I walk through it" were
 * answered in different places by different code, and only for players. The
 * consequences were all visible in play:
 *
 *   - players walked straight through each other,
 *   - bullets passed through helicopters, vehicles and every killstreak,
 *   - nothing but a player could be damaged, so a chopper was invincible
 *     scenery rather than a target.
 *
 * A body is one description of the space a thing fills, used by everything:
 * the bullet ray test, the movement sweep, blast line-of-sight. Adding a new
 * kind of object means describing its body once; it then becomes solid,
 * shootable and destructible with no further work in any system.
 *
 * Bodies are axis-aligned on purpose. The server has no physics engine (see
 * the architecture notes on CollisionWorld) and an AABB is what the movement
 * sweep already speaks, so this stays consistent with how the world is
 * simulated rather than introducing a second, richer representation that
 * only half the code understands.
 */
import type { EntityId, PlayerId, Vec3 } from '../net/Protocol';
import type { ServerEntity, ServerPlayer } from './ServerWorld';

/** How much space a thing takes up, centred on its position. */
export interface BodyShape {
  /** Full width along X. */
  readonly width: number;
  /** Full height along Y, measured up from the entity's feet. */
  readonly height: number;
  /** Full depth along Z. */
  readonly depth: number;
  /**
   * Whether the body blocks movement. Bullets still hit non-solid bodies --
   * a flying helicopter is shootable but you cannot stand on it.
   */
  readonly solid: boolean;
  /**
   * Vertical offset of the body's base from the entity origin. Aircraft sit
   * above their origin; ground vehicles sit on it.
   */
  readonly baseOffset: number;
}

/**
 * Body shapes by entity kind.
 *
 * This is DATA. A new killstreak, vehicle or destructible prop is registered
 * here and immediately becomes solid and shootable -- no system changes.
 */
export const BODY_SHAPES: Readonly<Record<string, BodyShape>> = {
  // Killstreak aircraft. Large, shootable, and not solid: they fly, and
  // making them solid would let a player stand on a moving helicopter that
  // the movement sweep cannot follow smoothly.
  helicopter: { width: 4.2, height: 2.6, depth: 11.5, solid: false, baseOffset: -1.3 },
  attack_helicopter: { width: 4.6, height: 3.0, depth: 12.5, solid: false, baseOffset: -1.5 },
  uav: { width: 2.4, height: 0.8, depth: 3.2, solid: false, baseOffset: -0.4 },
  counter_uav: { width: 2.4, height: 0.8, depth: 3.2, solid: false, baseOffset: -0.4 },
  // Ground vehicles: solid, so players collide with them and can take cover.
  transport_helicopter: { width: 4.2, height: 2.6, depth: 11.5, solid: false, baseOffset: -1.3 },
  // Deployed equipment sits on the floor and blocks movement.
  sentry_gun: { width: 0.9, height: 1.1, depth: 0.9, solid: true, baseOffset: 0 },
  care_package: { width: 1.1, height: 1.0, depth: 1.1, solid: true, baseOffset: 0 },
  // Training targets: the dummies the range uses. Shootable, not solid.
  target_dummy: { width: 0.6, height: 1.8, depth: 0.4, solid: false, baseOffset: 0 },
};

/** A body in world space, ready to be tested against. */
export interface WorldBody {
  readonly id: EntityId | PlayerId;
  readonly kind: 'player' | 'entity';
  readonly minX: number; readonly minY: number; readonly minZ: number;
  readonly maxX: number; readonly maxY: number; readonly maxZ: number;
  readonly solid: boolean;
}

/** The body an entity currently occupies, or null if its kind has no shape. */
export function bodyOfEntity(entity: ServerEntity): WorldBody | null {
  const shape = BODY_SHAPES[entity.kind];
  if (!shape || !entity.alive || !entity.active) return null;
  const base = entity.py + shape.baseOffset;
  return {
    id: entity.id,
    kind: 'entity',
    minX: entity.px - shape.width * 0.5,
    maxX: entity.px + shape.width * 0.5,
    minY: base,
    maxY: base + shape.height,
    minZ: entity.pz - shape.depth * 0.5,
    maxZ: entity.pz + shape.depth * 0.5,
    solid: shape.solid,
  };
}

/**
 * The body a player occupies.
 *
 * Players are solid to each other: in Call of Duty you cannot walk through a
 * teammate, you push past them. Treating them as a box here matches how the
 * movement sweep resolves every other obstacle.
 */
export function bodyOfPlayer(player: ServerPlayer, radius: number): WorldBody | null {
  if (!player.alive) return null;
  return {
    id: player.id,
    kind: 'player',
    minX: player.px - radius,
    maxX: player.px + radius,
    minY: player.py,
    maxY: player.py + player.height,
    minZ: player.pz - radius,
    maxZ: player.pz + radius,
    solid: true,
  };
}

/**
 * Ray against an axis-aligned body. Returns the entry distance, or null.
 *
 * The standard slab test. Kept here rather than in a system so the bullet
 * path, the blast line-of-sight check and anything added later all agree on
 * what "the ray hit it" means.
 */
export function intersectBody(
  origin: Vec3, dir: Vec3, body: WorldBody, maxDistance: number,
): number | null {
  let near = 0;
  let far = maxDistance;

  const lo = [body.minX, body.minY, body.minZ];
  const hi = [body.maxX, body.maxY, body.maxZ];

  for (let axis = 0; axis < 3; axis += 1) {
    const d = dir[axis];
    const o = origin[axis];
    if (Math.abs(d) < 1e-9) {
      // Parallel to this slab: miss unless the origin is already inside it.
      if (o < lo[axis] || o > hi[axis]) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo[axis] - o) * inv;
    let t2 = (hi[axis] - o) * inv;
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
    if (t1 > near) near = t1;
    if (t2 < far) far = t2;
    if (near > far) return null;
  }
  return near >= 0 && near <= maxDistance ? near : null;
}

/** Does an upright capsule at (x, y, z) overlap this body? */
export function bodyOverlapsCapsule(
  body: WorldBody, x: number, y: number, z: number, radius: number, height: number,
): boolean {
  return x + radius > body.minX && x - radius < body.maxX
    && z + radius > body.minZ && z - radius < body.maxZ
    && y + height > body.minY && y < body.maxY;
}
