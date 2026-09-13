/**
 * BallisticsSystem.ts — hitscan resolution (Document 3 §11).
 *
 * GENERIC HITTABLE REGISTRY (load-bearing): registerHittable(object, meta)
 * accepts ANY Object3D plus metadata {surfaceType, takeDamage?}. Nothing in
 * this file knows what a "training dummy" or "arena wall" is — Document 5's
 * AI enemies will register their hitbox meshes exactly the same way and get
 * damage routing, surface-typed impacts, and hit events for free. Do not
 * narrow this interface to concrete scene classes.
 *
 * The ray ALWAYS originates from the true camera center (not the muzzle —
 * the muzzle is a visual anchor only), so crosshair and hit registration can
 * never disagree. Spread is applied as a uniform-disk jitter of the ray
 * direction within the weapon's current spread cone.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import type { PlayerStateValue } from '../player/PlayerState';
import { BALLISTICS } from '../utils/Constants';
import projectileSystem from './ProjectileSystem';
import type { WeaponBase } from './WeaponBase';

export interface HittableMetadata {
  surfaceType: string;
  /** Optional damage sink (dummies now; AI health components in Document 5). */
  takeDamage?: (amount: number, point: THREE.Vector3) => void;
}

export interface ShotContext {
  movementState: PlayerStateValue;
  isADS: boolean;
  isJumping: boolean;
}

interface HittableEntry {
  object: THREE.Object3D;
  metadata: HittableMetadata;
}

class BallisticsSystem {
  /** Read access for melee sweeps (Document B §2). */
  get hittables(): readonly HittableEntry[] { return this._hittables; }
  private readonly _hittables: HittableEntry[] = [];
  /** Rapier backend (Document C §4.2) — attached by main before play. */
  private physics: { castRayStatic(o: THREE.Vector3, d: THREE.Vector3, m: number): { collider: { handle: number }; toi: number; normal: THREE.Vector3; point: THREE.Vector3 } | null } | null = null;
  private colliderMeta: { hittableOf(handle: number): { object: THREE.Object3D; metadata: HittableMetadata } | null } | null = null;

  /** Wire the Rapier world + collider metadata (ColliderFactory). */
  attachPhysics(
    physics: NonNullable<typeof this.physics>,
    colliderMeta: NonNullable<typeof this.colliderMeta>,
  ): void {
    this.physics = physics;
    this.colliderMeta = colliderMeta;
  }
  private readonly raycaster = new THREE.Raycaster();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchUp = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();
  private muzzleProvider: (() => THREE.Vector3 | null) | null = null;

  /** Main wiring sets this so tracers visually start at the gun's muzzle. */
  setMuzzleProvider(provider: () => THREE.Vector3 | null): void {
    this.muzzleProvider = provider;
  }

  registerHittable(object: THREE.Object3D, metadata: HittableMetadata): void {
    if (this._hittables.some((h) => h.object === object)) return;
    this._hittables.push({ object, metadata });
  }

  unregisterHittable(object: THREE.Object3D): void {
    const index = this._hittables.findIndex((h) => h.object === object);
    if (index >= 0) this._hittables.splice(index, 1);
  }

  /**
   * Resolve one confirmed shot. Emits combat:hit (on impact), then
   * combat:shotFired (always), plus internal combat:tracer for tracer rounds.
   */
  /**
   * Document D §2.2 / §4.5 dispatch. One trigger pull resolves as:
   *   - projectile  -> hand off to ProjectileSystem (no ray at all)
   *   - pelletCount -> N independently-jittered rays (shotgun)
   *   - otherwise   -> exactly one ray, the original behaviour
   * The single-ray path below is UNCHANGED; this is a loop around it.
   */
  resolveShot(camera: THREE.PerspectiveCamera, weapon: WeaponBase, context: ShotContext): boolean {
    const def = weapon.def;

    if (def.fireMode === 'projectile') {
      return this.launchProjectile(camera, weapon, context);
    }

    const pellets = def.pelletCount ?? 1;
    if (pellets > 1) {
      // Each pellet is an independent ray with its own falloff and its own
      // combat:hit, so a single blast can produce multiple hit markers and
      // multiple impact decals — which is what a real shotgun does.
      let anyHit = false;
      for (let i = 0; i < pellets; i += 1) {
        if (this.resolveSingleRay(camera, weapon, context, true)) anyHit = true;
      }
      eventBus.emit('combat:shotFired', { weaponId: def.id, hit: anyHit });
      return anyHit;
    }

    const hit = this.resolveSingleRay(camera, weapon, context, false);
    eventBus.emit('combat:shotFired', { weaponId: def.id, hit });
    return hit;
  }

  /** Spawn a physics rocket instead of a ray (Document D §7.6). */
  private launchProjectile(
    camera: THREE.PerspectiveCamera, weapon: WeaponBase, context: ShotContext,
  ): boolean {
    const spreadRad = THREE.MathUtils.degToRad(
      weapon.getCurrentSpreadAngle(context.movementState, context.isADS, context.isJumping),
    );
    camera.getWorldDirection(this.scratchDir);
    this.jitterWithinCone(this.scratchDir, spreadRad);
    // Spawn CLEAR OF THE SHOOTER. The viewmodel muzzle sits a few centimetres
    // from the lens, which is inside the player's own capsule collider — a
    // rocket born there detonates on frame 1, at the player's feet. Push the
    // spawn point out past the capsule along the launch axis.
    const base = this.muzzleProvider?.() ?? camera.position;
    const origin = base.clone().addScaledVector(
      this.scratchDir, BALLISTICS.PROJECTILE_SPAWN_OFFSET,
    );
    projectileSystem.launch(origin, this.scratchDir.clone(), weapon.def);
    eventBus.emit('combat:shotFired', { weaponId: weapon.def.id, hit: false });
    return false;
  }

  /** Jitter `dir` uniformly inside a cone of half-angle `spreadRad`. */
  private jitterWithinCone(dir: THREE.Vector3, spreadRad: number): void {
    if (spreadRad <= 0) return;
    this.scratchUp.set(0, 1, 0);
    this.scratchRight.crossVectors(dir, this.scratchUp).normalize();
    if (this.scratchRight.lengthSq() < 1e-6) this.scratchRight.set(1, 0, 0);
    this.scratchUp.crossVectors(this.scratchRight, dir).normalize();
    const radius = spreadRad * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    dir.addScaledVector(this.scratchRight, Math.cos(angle) * radius)
      .addScaledVector(this.scratchUp, Math.sin(angle) * radius)
      .normalize();
  }

  private resolveSingleRay(
    camera: THREE.PerspectiveCamera,
    weapon: WeaponBase,
    context: ShotContext,
    isPellet: boolean,
  ): boolean {
    const baseSpread = weapon.getCurrentSpreadAngle(
      context.movementState, context.isADS, context.isJumping,
    );
    // A pellet's own cone dominates the aim cone; they add in quadrature so
    // neither is simply thrown away.
    const coneDeg = isPellet
      ? Math.hypot(baseSpread, weapon.def.pelletSpreadConeDeg ?? 0)
      : baseSpread;
    const spreadRad = THREE.MathUtils.degToRad(coneDeg);

    // Base direction: true camera center, then jitter inside the cone.
    camera.getWorldDirection(this.scratchDir);
    this.jitterWithinCone(this.scratchDir, spreadRad);

    const maxDistance = weapon.def.melee
      ? (weapon.def.meleeRangeMeters ?? BALLISTICS.MAX_RANGE_METERS)
      : BALLISTICS.MAX_RANGE_METERS;

    const start = this.muzzleProvider?.() ?? camera.position;
    let hit = false;
    if (this.physics && this.colliderMeta) {
      // --- Rapier scene query (Document C §4.2): static colliders only ------
      const rh = this.physics.castRayStatic(camera.position, this.scratchDir, maxDistance);
      if (rh) {
        const entry = this.colliderMeta.hittableOf(rh.collider.handle);
        if (entry) {
          hit = true;
          const distance = rh.toi;
          const damage = this.damageFor(weapon, distance, isPellet);
          const point = rh.point;
          entry.metadata.takeDamage?.(damage, point);
          eventBus.emit('combat:hit', {
            point: point.clone(),
            normal: rh.normal.clone(),
            distance,
            damage,
            surfaceType: entry.metadata.surfaceType,
            isKill: false,
          });
          if (weapon.def.hasTracer) {
            this.emitTracer(start, point);
          }
        }
      }
    } else {
      // --- pre-physics fallback (boot frames only): legacy three raycast ----
      this.raycaster.set(camera.position, this.scratchDir);
      this.raycaster.far = maxDistance;
      const intersects = this.raycaster.intersectObjects(this.hittables.map((h) => h.object), true);
      if (intersects.length > 0) {
        const intersection = intersects[0];
        const entry = this.findEntry(intersection.object);
        if (entry) {
          hit = true;
          const distance = intersection.distance;
          const damage = this.damageFor(weapon, distance, isPellet);
          const normal = intersection.face
            ? intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld)
            : this.scratchDir.clone().negate();
          entry.metadata.takeDamage?.(damage, intersection.point);
          eventBus.emit('combat:hit', {
            point: intersection.point.clone(),
            normal,
            distance,
            damage,
            surfaceType: entry.metadata.surfaceType,
            isKill: false,
          });
          if (weapon.def.hasTracer) {
            this.emitTracer(start, intersection.point);
          }
        }
      }
    }
    if (!hit && weapon.def.hasTracer) {
      const end = camera.position.clone().addScaledVector(this.scratchDir, BALLISTICS.MAX_RANGE_METERS);
      this.emitTracer(start, end);
    }
    return hit;
  }

  /**
   * Pellets carry their own near/far damage numbers so a shotgun's total
   * close-range damage is pelletCount x damagePerPellet, not one bullet's.
   */
  private damageFor(weapon: WeaponBase, distance: number, isPellet: boolean): number {
    if (!isPellet) return weapon.getDamageAtDistance(distance);
    const def = weapon.def;
    const near = def.damagePerPelletNear ?? def.damageNear;
    const far = def.damagePerPelletFar ?? def.damageFar;
    const start = def.damageFalloffStartDistance;
    const end = def.damageFalloffEndDistance;
    if (distance <= start) return near;
    if (distance >= end) return far;
    const t = (distance - start) / Math.max(1e-6, end - start);
    return near + (far - near) * t;
  }

  private emitTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    eventBus.emit('combat:tracer', {
      from: [from.x, from.y, from.z] as [number, number, number],
      to: [to.x, to.y, to.z] as [number, number, number],
    });
  }

  /** Intersections may land on children; walk up to the registered ancestor. */
  private findEntry(object: THREE.Object3D): HittableEntry | null {
    let node: THREE.Object3D | null = object;
    while (node) {
      const entry = this.hittables.find((h) => h.object === node);
      if (entry) return entry;
      node = node.parent;
    }
    return null;
  }
}

const ballistics = new BallisticsSystem();
export { BallisticsSystem };
export default ballistics;
