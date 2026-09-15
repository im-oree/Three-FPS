/**
 * PhysicsWorld.ts — the sole physics backend (Document C §4).
 *
 * Owns the Rapier WASM world, steps it on a FIXED timestep from the engine
 * clock, and exposes the query surface every other system uses:
 *   - PlayerCharacterController  (kinematic character controller wrapper)
 *   - ColliderFactory            (level/hittable colliders)
 *   - RigidBodyPool              (casings, dropped magazines)
 *   - BallisticsSystem           (world.castRay — hitscan)
 *
 * Simulation logic that is *feel* (PlayerMovement's acceleration/friction,
 * jump impulse math) stays project-owned per Document C §4.3 — Rapier is the
 * collision/truth layer, not the movement designer.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export interface RapierHit {
  collider: RAPIER.Collider;
  /** Distance along the ray (metres). */
  toi: number;
  normal: THREE.Vector3;
  point: THREE.Vector3;
}

const scratchNormal = new THREE.Vector3();
const scratchPoint = new THREE.Vector3();

export class PhysicsWorld {
  readonly world: RAPIER.World;
  /** Fixed simulation step (Document C §4.2 — reuses the engine-clock dt). */
  static readonly FIXED_DT = 1 / 60;

  private accumulator = 0;
  private frameId = 0;
  private lastStepFrame = -1;

  private constructor(world: RAPIER.World) {
    this.world = world;
    world.timestep = PhysicsWorld.FIXED_DT;
  }

  /** Async WASM boot (Document C §4.2 — `await RAPIER.init()` required). */
  static async create(gravity = { x: 0, y: -9.81, z: 0 }): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld(new RAPIER.World(gravity));
  }

  /** Engine updatable entry — fixed-timestep accumulator. */
  update(dt: number): void {
    this.frameId += 1;
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= this.world.timestep) {
      this.world.step();
      this.accumulator -= this.world.timestep;
      this.lastStepFrame = this.frameId;
    }
  }

  /** True once the current engine frame has stepped the dynamics. */
  get steppedThisFrame(): boolean {
    return this.lastStepFrame === this.frameId;
  }

  /** Guarantees the broadphase is fresh (kinematic teleports + first frame).
   *  Drains the accumulator by one step so the frame's later fixed steps stay
   *  at 60 Hz simulation rate. */
  ensureStepped(): void {
    if (!this.steppedThisFrame) {
      this.world.step();
      this.accumulator = Math.max(0, this.accumulator - PhysicsWorld.FIXED_DT);
      this.lastStepFrame = this.frameId;
    }
  }

  /**
   * Hitscan ray against STATIC level colliders only (kinematic player and
   * dynamic props excluded) — the Document C §4.2 ballistics query.
   */
  castRayStatic(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxToi: number,
  ): RapierHit | null {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, flags);
    if (!hit) return null;
    scratchNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    scratchPoint.copy(dir).multiplyScalar(hit.timeOfImpact).add(origin);
    return {
      collider: hit.collider,
      toi: hit.timeOfImpact,
      normal: scratchNormal.clone(),
      point: scratchPoint.clone(),
    };
  }

  /**
   * Hitscan against static colliders PLUS an explicit set of dynamic
   * collider handles (Document K shootable props). The kinematic player and
   * every dynamic body not in the allow-set (casings, dropped mags, debris)
   * stay excluded — only registered prop hits can be struck.
   */
  castRayWithProps(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxToi: number,
    allowedDynamicHandles: ReadonlySet<number> | null,
  ): RapierHit | null {
    if (!allowedDynamicHandles || allowedDynamicHandles.size === 0) {
      return this.castRayStatic(origin, dir, maxToi);
    }
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;
    const hit = this.world.castRayAndGetNormal(
      ray, maxToi, true, flags,
      undefined, undefined, undefined,
      (collider) => collider.parent()?.isFixed() === true
        || allowedDynamicHandles.has(collider.handle),
    );
    if (!hit) return null;
    scratchNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    scratchPoint.copy(dir).multiplyScalar(hit.timeOfImpact).add(origin);
    return {
      collider: hit.collider,
      toi: hit.timeOfImpact,
      normal: scratchNormal.clone(),
      point: scratchPoint.clone(),
    };
  }

  /** Static-geometry-only ray distance probe (no normal needed). */
  castRayDistance(origin: THREE.Vector3, dir: THREE.Vector3, maxToi: number): number | null {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    const hit = this.world.castRay(ray, maxToi, true, flags);
    return hit ? hit.timeOfImpact : null;
  }
}

export default PhysicsWorld;
