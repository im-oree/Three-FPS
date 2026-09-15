/**
 * ProjectileSystem.ts — Document D §2.2.
 *
 * A PROJECTILE weapon (unlike hitscan) spawns a real, physically simulated
 * object that travels through space over time, subject to gravity and drag,
 * and resolves its own collision on arrival rather than instantly via raycast.
 *
 * Per Document C §4, the physics backend is Rapier and nothing here hand-rolls
 * integration: the rocket is a genuine dynamic rigid body, so it arcs, slows,
 * and rests against the same colliders as everything else in the world.
 *
 * On impact (or lifetime expiry) it emits `combat:explosion`, which
 * ExplosionDamageResolver consumes to apply radius falloff damage through the
 * EXISTING registerHittable() contract from Document 3 — that contract is
 * unchanged, which is the point.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import eventBus from '../core/EventBus';
import type { WeaponDefinition } from './WeaponBase';

interface LiveProjectile {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Object3D | null;
  lifetime: number;
  blastRadius: number;
  blastDamage: number;
  falloff: 'linear' | 'quadratic';
  weaponId: string;
  /** Previous world position, for swept collision against thin geometry. */
  prev: THREE.Vector3;
}

const _v = new THREE.Vector3();
const _step = new THREE.Vector3();

export class ProjectileSystem {
  private readonly live: LiveProjectile[] = [];
  private world: RAPIER.World | null = null;
  private scene: THREE.Scene | null = null;
  /** Builds the visual rocket; supplied by main so /src stays geometry-free. */
  private meshFactory: (() => THREE.Object3D) | null = null;

  attach(world: RAPIER.World, scene: THREE.Scene): void {
    this.world = world;
    this.scene = scene;
  }

  setMeshFactory(factory: () => THREE.Object3D): void {
    this.meshFactory = factory;
  }

  get activeCount(): number {
    return this.live.length;
  }

  /** Test seam: current world positions of every in-flight projectile. */
  get positions(): { x: number; y: number; z: number }[] {
    return this.live.map((p) => {
      const t = p.body.translation();
      return { x: t.x, y: t.y, z: t.z };
    });
  }

  /**
   * Launch one projectile from `origin` along `direction` (already spread-
   * jittered by the caller, exactly as a hitscan cone would be).
   */
  launch(origin: THREE.Vector3, direction: THREE.Vector3, def: WeaponDefinition): void {
    if (!this.world) return;
    const speed = def.projectileSpeed ?? 45;
    const dir = direction.clone().normalize();

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(dir.x * speed, dir.y * speed, dir.z * speed)
        .setLinearDamping(def.projectileDrag ?? 0)
        .setGravityScale(def.projectileGravityScale ?? 1)
        // A rocket should not tumble; keep it pointed along flight.
        .setAngularDamping(10),
    );
    // Sensor: we want contact reporting, not a bouncing physical response —
    // the rocket detonates on touch rather than ricocheting.
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(0.06).setSensor(true), body,
    );

    let mesh: THREE.Object3D | null = null;
    if (this.meshFactory && this.scene) {
      mesh = this.meshFactory();
      mesh.position.copy(origin);
      this.scene.add(mesh);
    }

    this.live.push({
      body, collider, mesh,
      lifetime: def.projectileMaxLifetime ?? 8,
      blastRadius: def.blastRadius ?? 5,
      blastDamage: def.blastDamage ?? 100,
      falloff: def.blastFalloffCurve ?? 'linear',
      weaponId: def.id,
      prev: origin.clone(),
    });
  }

  update(dt: number): void {
    if (!this.world) return;
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const p = this.live[i];
      p.lifetime -= dt;
      const t = p.body.translation();
      _v.set(t.x, t.y, t.z);

      // SWEPT collision. A rocket at 45 m/s covers ~0.75 m per frame, far more
      // than its 0.06 m radius, so a naive overlap test tunnels straight
      // through walls. Ray-cast the segment actually travelled instead.
      _step.copy(_v).sub(p.prev);
      const travelled = _step.length();
      let hitPoint: THREE.Vector3 | null = null;
      if (travelled > 1e-4) {
        const ray = new RAPIER.Ray(
          { x: p.prev.x, y: p.prev.y, z: p.prev.z },
          { x: _step.x / travelled, y: _step.y / travelled, z: _step.z / travelled },
        );
        const hit = this.world.castRay(
          ray, travelled, true, undefined, undefined, p.collider,
        );
        if (hit) {
          hitPoint = p.prev.clone().addScaledVector(
            _step.clone().divideScalar(travelled), hit.timeOfImpact,
          );
        }
      }

      if (p.mesh) {
        p.mesh.position.copy(_v);
        if (travelled > 1e-4) p.mesh.lookAt(_v.clone().add(_step));
      }
      p.prev.copy(_v);

      if (hitPoint || p.lifetime <= 0) {
        this.detonate(p, hitPoint ?? _v.clone());
        this.live.splice(i, 1);
      }
    }
  }

  private detonate(p: LiveProjectile, at: THREE.Vector3): void {
    eventBus.emit('combat:explosion', {
      point: { x: at.x, y: at.y, z: at.z },
      radius: p.blastRadius,
      maxDamage: p.blastDamage,
      falloffCurve: p.falloff,
      weaponId: p.weaponId,
    });
    if (p.mesh) {
      p.mesh.parent?.remove(p.mesh);
      p.mesh = null;
    }
    this.world?.removeRigidBody(p.body);
  }

  /** Drop everything (level teardown / test reset). */
  clear(): void {
    for (const p of this.live) {
      if (p.mesh) p.mesh.parent?.remove(p.mesh);
      this.world?.removeRigidBody(p.body);
    }
    this.live.length = 0;
  }
}

export const projectileSystem = new ProjectileSystem();
export default projectileSystem;
