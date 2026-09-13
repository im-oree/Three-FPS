/**
 * ColliderFactory.ts — builds Rapier colliders from level collision data
 * (Document C §4.2). Replaces the ad hoc CollisionWorld box arrays: surface
 * tags ride on collider user-data so FootstepSystem/ImpactEffect keep working
 * identically, and hitscan metadata (registerHittable) maps by collider
 * handle.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from './PhysicsWorld';

/** Ballistics metadata contract (unchanged event/payload surface). */
interface HittableMeta {
  surfaceType: string;
  takeDamage?: (amount: number, point: THREE.Vector3) => void;
}

/** Everything a query needs to know about a static collider. */
export interface StaticColliderMeta {
  /** World-space top of the collider (step-exemption checks). */
  topY: number;
  /** Surface tag for footsteps/impacts (Document C §4.2). */
  surfaceType: string;
  /** Hittable-registry payload (BallisticsSystem contract, unchanged). */
  hittable?: { object: THREE.Object3D; metadata: HittableMeta };
}

export class ColliderFactory {
  /** handle → meta (Rapier handles are stable integers). */
  readonly byHandle = new Map<number, StaticColliderMeta>();

  constructor(private readonly physics: PhysicsWorld) {}

  /** Static cuboid from an axis-aligned level box. */
  addStaticBox(box: THREE.Box3, surfaceType = 'generic'): RAPIER.Collider {
    const size = new THREE.Vector3().subVectors(box.max, box.min);
    const center = new THREE.Vector3().addVectors(box.max, box.min).multiplyScalar(0.5);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
    );
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2),
      body,
    );
    this.byHandle.set(collider.handle, { topY: box.max.y, surfaceType });
    return collider;
  }

  /**
   * Hittable registration (BallisticsSystem's contract): the object's world
   * bounding box becomes a static cuboid carrying its metadata payload.
   */
  addHittableObject(object: THREE.Object3D, metadata: HittableMeta): RAPIER.Collider {
    const box = new THREE.Box3().setFromObject(object);
    const collider = this.addStaticBox(box, String(metadata.surfaceType ?? 'generic'));
    const meta = this.byHandle.get(collider.handle);
    if (meta) meta.hittable = { object, metadata };
    return collider;
  }

  removeByHandle(handle: number): void {
    const meta = this.byHandle.get(handle);
    if (!meta) return;
    this.byHandle.delete(handle);
    // The owning fixed body: find via the collider.
    const collider = this.physics.world.getCollider(handle);
    if (collider) this.physics.world.removeRigidBody(collider.parent() as RAPIER.RigidBody);
  }

  topYOf(handle: number): number {
    return this.byHandle.get(handle)?.topY ?? -Infinity;
  }

  hittableOf(handle: number): { object: THREE.Object3D; metadata: HittableMeta } | null {
    return this.byHandle.get(handle)?.hittable ?? null;
  }
}

export default ColliderFactory;
