/**
 * CasingPhysics.ts — shell casings as REAL Rapier rigid bodies
 * (Document C §4.2, superseding Document A §8.6's manual bounce integration).
 *
 * Public contract unchanged: spawn(Socket_Ejection origin, +X eject dir),
 * per-frame update, debugState() test seam. Gravity/restitution/friction now
 * come from the engine's native solver — casings settle correctly on slopes
 * and against real level geometry (the ColliderFactory static set).
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CASING } from '../utils/Constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { RigidBodyPool, type PoolEntry } from '../physics/RigidBodyPool';

export class CasingPhysics {
  private readonly pool: RigidBodyPool;
  private readonly group: THREE.Group;

  constructor(physics: PhysicsWorld, scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pool = new RigidBodyPool(
      physics,
      CASING.POOL_SIZE,
      () =>
        RAPIER.ColliderDesc.capsule(CASING.LENGTH / 2, CASING.RADIUS)
          .setRestitution(CASING.RESTITUTION)
          .setFriction(CASING.FRICTION)
          .setDensity(4000),
      () => {
        // pooled visual: tiny brass cylinder, viewmodel layer (§3.2 two-pass)
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(CASING.RADIUS, CASING.RADIUS, CASING.LENGTH, 6),
          new THREE.MeshStandardMaterial({ color: CASING.COLOR, roughness: 0.4, metalness: 0.8 }),
        );
        mesh.traverse((o) => { o.layers.set(1); });
        mesh.layers.set(1);
        this.group.add(mesh);
        return mesh;
      },
    );
  }

  /** §8.6 eject: origin = Socket_Ejection world pos, dir = its local +X. */
  spawn(origin: THREE.Vector3, ejectDirWorld: THREE.Vector3): void {
    const entry = this.pool.acquire();
    if (!entry) return;
    const speed = CASING.EJECT_SPEED_MIN + Math.random() * (CASING.EJECT_SPEED_MAX - CASING.EJECT_SPEED_MIN);
    const linear = ejectDirWorld.clone().multiplyScalar(speed);
    linear.y += CASING.EJECT_UP_KICK + Math.random() * CASING.EJECT_UP_VARIANCE;
    const angular = new THREE.Vector3(
      (Math.random() - 0.5) * CASING.SPIN_RANGE,
      (Math.random() - 0.5) * CASING.SPIN_RANGE,
      (Math.random() - 0.5) * CASING.SPIN_RANGE,
    );
    entry.data.age = 0;
    entry.data.settled = 0;
    this.pool.activate(entry, origin, linear, angular);
    entry.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  }

  update(dt: number): void {
    for (const entry of this.pool.entries) {
      if (!entry.active) continue;
      entry.data.age = (entry.data.age ?? 0) + dt;
      const lv = entry.body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      if (speed < CASING.SETTLE_SPEED) {
        entry.data.settled = (entry.data.settled ?? 0) + dt;
        if (entry.data.settled >= CASING.SETTLE_FADE_SECONDS) this.pool.park(entry);
      } else {
        entry.data.settled = 0;
      }
      if (entry.data.age >= CASING.LIFETIME_SECONDS) this.pool.park(entry);
    }
    this.pool.syncMeshes();
  }

  /** TEST seam: pool status (acceptance harness). */
  debugState(): { active: number; poolSize: number; settled: number } {
    let active = 0;
    let settled = 0;
    for (const entry of this.pool.entries) {
      if (!entry.active) continue;
      active += 1;
      if ((entry.data.settled ?? 0) > 0) settled += 1;
    }
    return { active, poolSize: this.pool.entries.length, settled };
  }
}

export type { PoolEntry };
