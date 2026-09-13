/**
 * DroppedMagSystem.ts — Document C §5.6: dropped magazines are REAL dynamic
 * bodies. On the reload beat table's `magazine_detach` (generic event, no
 * weapon-specific code) the rifle's Bone_Magazine mesh is cloned, a pooled
 * Rapier body is spawned at Socket_Magazine's world pose with a small toss,
 * and it settles on the actual level geometry. Bodies park after
 * MAG.LIFETIME_SECONDS (allocation-free sustained reloads, same pattern as
 * CasingPhysics).
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { RigidBodyPool, type PoolEntry } from '../physics/RigidBodyPool';
import eventBus from '../core/EventBus';
import { MAG } from '../utils/Constants';

const DOWN = new THREE.Vector3(0, -1, 0);

export class DroppedMagSystem {
  private readonly pool: RigidBodyPool;
  private readonly unsubscribe: () => void;
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchFwd = new THREE.Vector3();

  constructor(
    physics: PhysicsWorld,
    private readonly scene: THREE.Scene,
    makeMagMesh: () => THREE.Object3D,
  ) {
    this.pool = new RigidBodyPool(
      physics,
      MAG.POOL_SIZE,
      () => RAPIER.ColliderDesc.cuboid(MAG.HALF_EXTENTS.x, MAG.HALF_EXTENTS.y, MAG.HALF_EXTENTS.z)
        .setRestitution(MAG.RESTITUTION)
        .setFriction(MAG.FRICTION),
      makeMagMesh,
    );
    // Generic beat name (Doc C §5.5): any weapon's detach drops its mag.
    this.unsubscribe = eventBus.on('weapon:reloadEvent', (payload) => {
      const { event } = payload as { event?: string };
      if (event === 'magazine_detach') this.drop();
    });
  }

  /** The mag mesh factory closes over the viewmodel (clones Bone_Magazine). */
  drop(): void {
    const meshFactory = this.magMeshFactory;
    if (!meshFactory) return;
    const pose = this.magWorldPose();
    if (!pose) return;
    const entry: PoolEntry | null = this.pool.acquire();
    if (!entry) return;
    // Swap in a FRESH clone of the current weapon's magazine (pooled meshes
    // belong to the weapon that parked them).
    const old = entry.mesh;
    this.scene.remove(old);
    const mesh = meshFactory();
    mesh.traverse((o) => { o.layers.set(1); });
    mesh.layers.set(1);
    this.scene.add(mesh);
    entry.mesh = mesh;
    // Toss: down + slightly out from the bore, with tumble.
    this.scratchFwd.set(0, 0, -1).applyQuaternion(this.scratchQuat);
    const linear = this.scratchFwd.multiplyScalar(MAG.TOSS_FORWARD).addScaledVector(DOWN, MAG.TOSS_DOWN);
    const angular = new THREE.Vector3(
      (Math.random() * 2 - 1) * MAG.TUMBLE,
      (Math.random() * 2 - 1) * MAG.TUMBLE,
      (Math.random() * 2 - 1) * MAG.TUMBLE,
    );
    this.pool.activate(entry, this.scratchPos, linear, angular);
    entry.data.age = 0;
  }

  /** [position, quaternion] of the live weapon's Socket_Magazine. */
  private magWorldPose(): boolean {
    const socket = this.magSocket?.();
    if (!socket) return false;
    socket.updateWorldMatrix(true, false);
    socket.getWorldPosition(this.scratchPos);
    socket.getWorldQuaternion(this.scratchQuat);
    return true;
  }

  /** Wired by main.ts: reads the equipped weapon's magazine socket. */
  magSocket: (() => THREE.Object3D | null) | null = null;
  /** Wired by main.ts: builds a fresh clone of the equipped weapon's mag. */
  magMeshFactory: (() => THREE.Object3D) | null = null;

  update(dt: number): void {
    for (const entry of this.pool.entries) {
      if (!entry.active) continue;
      entry.data.age += dt;
      if (entry.data.age >= MAG.LIFETIME_SECONDS) this.pool.park(entry);
    }
    this.pool.syncMeshes();
  }

  dispose(): void {
    this.unsubscribe();
    for (const entry of this.pool.entries) this.scene.remove(entry.mesh);
  }
}

export default DroppedMagSystem;
