/**
 * RigidBodyPool.ts — pooled dynamic Rapier rigid bodies (Document C §4.2):
 * shell casings, dropped magazines, debris. Each entry parks its body via
 * setEnabled(false) instead of destroying it — allocation-free sustained fire.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from './PhysicsWorld';

export interface PoolEntry {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  active: boolean;
  /** Per-props bookkeeping (age, bounce count) owned by the consumer. */
  data: Record<string, number>;
}

export class RigidBodyPool {
  readonly entries: PoolEntry[] = [];

  constructor(physics: PhysicsWorld, size: number, makeCollider: () => RAPIER.ColliderDesc, makeMesh: () => THREE.Object3D) {
    for (let i = 0; i < size; i += 1) {
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setEnabled(false));
      physics.world.createCollider(makeCollider(), body);
      const mesh = makeMesh();
      mesh.visible = false;
      this.entries.push({ body, mesh, active: false, data: {} });
    }
  }

  /** Acquire the oldest inactive entry (round-robin fallback when full). */
  acquire(): PoolEntry | null {
    let entry = this.entries.find((e) => !e.active) ?? null;
    if (!entry) entry = this.entries[0];
    return entry;
  }

  activate(entry: PoolEntry, position: THREE.Vector3, linear: THREE.Vector3, angular: THREE.Vector3): void {
    entry.active = true;
    entry.body.setEnabled(true);
    entry.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    entry.body.setLinvel({ x: linear.x, y: linear.y, z: linear.z }, true);
    entry.body.setAngvel({ x: angular.x, y: angular.y, z: angular.z }, true);
    entry.mesh.visible = true;
    entry.mesh.position.copy(position);
  }

  park(entry: PoolEntry): void {
    entry.active = false;
    entry.body.setEnabled(false);
    entry.mesh.visible = false;
    entry.data = {};
  }

  /** Post-step sync: mesh follows body. Run after PhysicsWorld.update. */
  syncMeshes(): void {
    for (const entry of this.entries) {
      if (!entry.active) continue;
      const t = entry.body.translation();
      const r = entry.body.rotation();
      entry.mesh.position.set(t.x, t.y, t.z);
      entry.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}

export default RigidBodyPool;
