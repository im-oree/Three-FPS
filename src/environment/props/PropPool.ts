/**
 * PropPool.ts — Document K §2.2: generic pooling for any catalog prop type.
 *
 *   - static + instancingEligible → ONE THREE.InstancedMesh per prop TYPE
 *     (geometry baked/merged per material group) + one FIXED Rapier collider
 *     per placed instance. Instancing is a rendering optimisation ONLY;
 *     every instance still carries real, exact collision.
 *   - static + not eligible (crane, forklift, light towers) → cloned scene
 *     graph + compound collider(s).
 *   - dynamic (barrels) → pooled Rapier bodies parked via setEnabled(false)
 *     (RigidBodyPool's disable-not-destroy pattern), shootable through the
 *     ColliderFactory hittable registry and knockable from explosions.
 *
 * Every collider handle registered here is tracked so a level teardown
 * releases everything (bodies removed, handles unregistered).
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import eventBus from '../../core/EventBus';
import ballistics from '../../weapons/BallisticsSystem';
import type { AssetLoader } from '../../core/AssetLoader';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type ColliderFactory from '../../physics/ColliderFactory';
import {
  resolvePropDefinition, type PropDefinition,
} from './PropCatalog';
import { buildColliderDescs, colliderTopY } from './ColliderShapeBuilder';
import MaterialVariantLibrary from './MaterialVariantLibrary';
import CraneSwayAnimator from './CraneSwayAnimator';
import type { CullingHandle, FrustumCullingManager } from '../../core/FrustumCullingManager';

interface InstancedGroup {
  mesh: THREE.InstancedMesh;
  def: PropDefinition;
  nextIndex: number;
}

interface DynamicSlot {
  def: PropDefinition;
  propTypeId: string;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  mesh: THREE.Object3D;
  inUse: boolean;
  health: number;
}

interface Pool {
  def: PropDefinition;
  slots: DynamicSlot[];
}

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _dir = new THREE.Vector3();

export class PropPool {
  /** Dynamic collider handles any system may ray-hit (ballistics predicate). */
  readonly dynamicHitHandles = new Set<number>();

  private readonly instancedGroups = new Map<string, InstancedGroup>();
  private readonly sources = new Map<string, THREE.Object3D>();
  private readonly dynamicPools = new Map<string, Pool>();
  private readonly placedLights: THREE.PointLight[] = [];
  private readonly swayAnimators: CraneSwayAnimator[] = [];
  private readonly placedBodies: RAPIER.RigidBody[] = [];
  /** Culling registrations, released on disposeAll (level unload). */
  private readonly cullingHandles: CullingHandle[] = [];
  /** Per instanced group: world positions accumulate as instances are
   *  placed; finalizeCulling() derives one union sphere per group (the
   *  InstancedMesh's own geometry bounds know nothing about instances). */
  private readonly pendingInstancedBounds = new Map<string, {
    def: PropDefinition;
    mesh: THREE.InstancedMesh;
    positions: THREE.Vector3[];
  }>();
  /** Crane animator ↔ its culling entry: hidden cranes skip their sway. */
  private readonly animatorCulling = new Map<CraneSwayAnimator, CullingHandle>();
  private readonly root = new THREE.Group();
  /** 0..1 explosion knockback scaling, tuned for readable barrel rolls. */
  private static readonly EXPLOSION_IMPULSE = 26;

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly colliderFactory: ColliderFactory,
    private readonly assetLoader: AssetLoader,
    private readonly culling: FrustumCullingManager | null = null,
  ) {
    this.root.name = 'PropPool';
    scene.add(this.root);
    eventBus.on('combat:explosion', (p) => this.onExplosion(p as {
      point: { x: number; y: number; z: number };
      radius: number; maxDamage: number;
    }));
  }

  // -------------------------------------------------------------------------
  // Preparation
  // -------------------------------------------------------------------------

  async preparePropType(propTypeId: string, maxCount: number): Promise<void> {
    const def = resolvePropDefinition(propTypeId);
    const source = await this.assetLoader.loadModel(def.modelPath);
    this.sources.set(propTypeId, source);
    if (def.physicsBehavior === 'dynamic') {
      this.prepareDynamicPool(propTypeId, def, source, maxCount);
    } else if (def.instancingEligible) {
      this.prepareInstancedStatic(propTypeId, def, source, maxCount);
    }
    // cloned-static source is cached; placed clones attach per instance.
  }

  /** Bake the whole source scene into (keratinici => geometry) merged batches. */
  private prepareInstancedStatic(
    propTypeId: string, def: PropDefinition,
    source: THREE.Object3D, maxCount: number,
  ): void {
    const merged = mergeForInstancing(source);
    if (!merged) {
      console.warn(`PropPool: ${propTypeId} produced no geometry — skipped`);
      return;
    }
    // Batch material rule: the 'Paint' bucket is retinted per variant;
    // everything else keeps a CLONE of its own authored material (so a wood
    // pallet stays wood and a metal frame stays metal).
    const paint = MaterialVariantLibrary.resolveMaterial(def.materialVariant);
    const otherBase = merged.otherMaterial?.clone()
      ?? new THREE.MeshStandardMaterial({
        color: 0x2e3134, roughness: 0.55, metalness: 0.6, flatShading: true,
      });
    let materials: THREE.Material | THREE.Material[];
    if (merged.paintGeometry && merged.otherGeometry) materials = [paint, otherBase];
    else if (merged.paintGeometry) materials = paint;
    else materials = otherBase;
    const mesh = new THREE.InstancedMesh(merged.geometry, materials, maxCount);
    mesh.count = 0;
    mesh.castShadow = def.castShadow;
    mesh.receiveShadow = def.receiveShadow;
    mesh.name = `Instanced_${propTypeId}`;
    this.root.add(mesh);
    this.instancedGroups.set(propTypeId, { mesh, def, nextIndex: 0 });
    this.pendingInstancedBounds.set(propTypeId, { def, mesh, positions: [] });
  }

  private prepareDynamicPool(
    propTypeId: string, def: PropDefinition,
    source: THREE.Object3D, maxCount: number,
  ): void {
    const slots: DynamicSlot[] = [];
    for (let i = 0; i < maxCount; i += 1) {
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setEnabled(false)
          .setLinearDamping(2.2)
          .setAngularDamping(3.5),
      );
      const colliders = buildColliderDescs(def.collider).map(({ desc, offset }) => {
        const d = desc
          .setTranslation(offset.x, offset.y, offset.z)
          .setRestitution(def.restitution ?? 0.2)
          .setFriction(def.friction ?? 0.7);
        if (def.mass) d.setMass(def.mass);
        return this.physics.world.createCollider(d, body);
      });
      const mesh = source.clone(true);
      MaterialVariantLibrary.retintInPlace(mesh, def.materialVariant);
      mesh.visible = false;
      mesh.castShadow = def.castShadow;
      mesh.receiveShadow = def.receiveShadow;
      this.root.add(mesh);
      slots.push({
        def, propTypeId, body, colliders, mesh,
        inUse: false, health: def.health ?? Infinity,
      });
    }
    this.dynamicPools.set(propTypeId, { def, slots });
    this.placedBodies.push(...slots.map((s) => s.body));
  }

  // -------------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------------

  placeInstance(
    propTypeId: string,
    position: THREE.Vector3,
    rotationYawOrEuler: number | readonly [number, number, number],
    scale = 1,
  ): THREE.Object3D | null {
    const def = resolvePropDefinition(propTypeId);
    const rot = typeof rotationYawOrEuler === 'number'
      ? [0, rotationYawOrEuler, 0] as const
      : rotationYawOrEuler;

    if (def.physicsBehavior === 'dynamic') return this.placeDynamic(propTypeId, position, rot);
    if (def.instancingEligible) {
      return this.placeInstanced(propTypeId, def, position, rot, scale);
    }
    return this.placeClonedStatic(propTypeId, def, position, rot, scale);
  }

  private placeInstanced(
    propTypeId: string, def: PropDefinition,
    position: THREE.Vector3, rot: readonly [number, number, number], scale: number,
  ): THREE.Object3D | null {
    const group = this.instancedGroups.get(propTypeId);
    const capacity = group?.mesh
      ? (group.mesh.instanceMatrix.count)
      : 0;
    if (!group || group.nextIndex >= capacity) {
      console.warn(`PropPool: instanced pool exhausted for ${propTypeId}`);
      return null;
    }
    const index = group.nextIndex;
    group.nextIndex += 1;
    _quat.setFromEuler(_euler.set(rot[0], rot[1], rot[2]));
    _scale.setScalar(scale);
    _matrix.compose(position, _quat, _scale);
    group.mesh.setMatrixAt(index, _matrix);
    group.mesh.count = group.nextIndex;
    group.mesh.instanceMatrix.needsUpdate = true;
    group.mesh.computeBoundingSphere();
    this.pendingInstancedBounds.get(propTypeId)?.positions.push(position.clone());

    // Real collision per instance — one FIXED body with the catalog shape.
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }),
    );
    for (const { desc, offset } of buildColliderDescs(def.collider, scale)) {
      const collider = this.physics.world.createCollider(
        desc.setTranslation(offset.x, offset.y, offset.z), body,
      );
      this.colliderFactory.byHandle.set(collider.handle, {
        topY: position.y + colliderTopY(def.collider, scale),
        surfaceType: def.surfaceTag,
      });
    }
    this.placedBodies.push(body);
    return group.mesh;
  }

  private placeClonedStatic(
    propTypeId: string, def: PropDefinition,
    position: THREE.Vector3, rot: readonly [number, number, number], scale: number,
  ): THREE.Object3D | null {
    const source = this.sources.get(propTypeId);
    if (!source) return null;
    const mesh = source.clone(true);
    MaterialVariantLibrary.retintInPlace(mesh, def.materialVariant);
    mesh.position.copy(position);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.scale.setScalar(scale);
    mesh.castShadow = def.castShadow;
    mesh.receiveShadow = def.receiveShadow;
    mesh.name = `Prop_${propTypeId}`;
    this.root.add(mesh);

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: _quat.setFromEuler(_euler.set(rot[0], rot[1], rot[2])).x, y: _quat.y, z: _quat.z, w: _quat.w }),
    );
    for (const { desc, offset } of buildColliderDescs(def.collider, scale)) {
      const d = desc.setTranslation(offset.x, offset.y, offset.z);
      d.setFriction(0.7).setRestitution(0.1);
      const collider = this.physics.world.createCollider(d, body);
      this.colliderFactory.byHandle.set(collider.handle, {
        topY: position.y + colliderTopY(def.collider, scale),
        surfaceType: def.surfaceTag,
      });
    }
    this.placedBodies.push(body);

    if (def.emissiveLight) {
      const lampHead = findByName(mesh, 'LampHead') ?? mesh;
      const p = lampHead.getWorldPosition(new THREE.Vector3());
      const light = new THREE.PointLight(
        def.emissiveLight.color, def.emissiveLight.intensity, def.emissiveLight.distance, 1.8,
      );
      light.position.copy(p).y += 0.15;
      this.root.add(light);
      this.placedLights.push(light);
    }
    if (def.animated === 'sway') {
      this.swayAnimators.push(new CraneSwayAnimator(mesh));
    }
    if (this.culling) {
      const handle = this.culling.register(mesh, {
        id: `prop:${propTypeId}`,
        maxDistance: def.cullDistance,
      });
      this.cullingHandles.push(handle);
      if (def.animated === 'sway') {
        this.animatorCulling.set(
          this.swayAnimators[this.swayAnimators.length - 1], handle,
        );
      }
    }
    return mesh;
  }

  private placeDynamic(
    propTypeId: string, position: THREE.Vector3,
    rot: readonly [number, number, number],
  ): THREE.Object3D | null {
    const pool = this.dynamicPools.get(propTypeId);
    const slot = pool?.slots.find((s) => !s.inUse);
    if (!pool || !slot) {
      console.warn(`PropPool: dynamic pool exhausted for ${propTypeId}`);
      return null;
    }
    slot.inUse = true;
    slot.health = slot.def.health ?? Infinity;
    _quat.setFromEuler(_euler.set(rot[0], rot[1], rot[2]));
    slot.body.setEnabled(true);
    slot.body.setTranslation({ x: position.x, y: position.y + 0.45, z: position.z }, true);
    slot.body.setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }, true);
    slot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    slot.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    slot.mesh.visible = true;

    for (const collider of slot.colliders) {
      this.colliderFactory.byHandle.set(collider.handle, {
        topY: position.y + colliderTopY(slot.def.collider),
        surfaceType: slot.def.surfaceTag,
        hittable: {
          object: slot.mesh,
          metadata: {
            surfaceType: slot.def.surfaceTag,
            takeDamage: (amount: number, point: THREE.Vector3) => {
              this.damageDynamic(slot, amount, point);
            },
          },
        },
      });
      this.dynamicHitHandles.add(collider.handle);
    }
    // ExplosionDamageResolver works off the shared ballistics hittable registry.
    ballistics.registerHittable(slot.mesh, {
      surfaceType: slot.def.surfaceTag,
      takeDamage: (amount: number, point: THREE.Vector3) => {
        this.damageDynamic(slot, amount, point);
      },
    });
    return slot.mesh;
  }

  // -------------------------------------------------------------------------
  // Dynamics: damage, chain explosions, per-frame sync
  // -------------------------------------------------------------------------

  private damageDynamic(slot: DynamicSlot, amount: number, point?: THREE.Vector3): void {
    if (!slot.inUse || !Number.isFinite(slot.health)) return;
    slot.health -= amount;
    // A shot/knock nudges the barrel — dynamic bodies on a low-grit surface
    // keep sliding until damping settles them.
    if (point) {
      _dir.set(point.x, point.y, point.z);
      const c = slot.body.translation();
      _dir.set(c.x - _dir.x, 0.35, c.z - _dir.z).normalize();
      slot.body.applyImpulse(
        { x: _dir.x * 0.6, y: 0.25, z: _dir.z * 0.6 }, true,
      );
    }
    if (slot.health > 0) return;
    if (slot.def.explodesOnDestroy && slot.def.explosion) {
      const p = slot.body.translation();
      const explosion = slot.def.explosion;
      this.releaseDynamic(slot);
      // Defer by a macrotask: the emit's listeners (damage resolver, VFX,
      // knockback) re-enter this class — never let that happen inside the
      // Rapier WASM borrow chain of the current call.
      window.setTimeout(() => {
        eventBus.emit('combat:explosion', {
          point: { x: p.x, y: p.y + 0.2, z: p.z },
          radius: explosion.radius,
          maxDamage: explosion.maxDamage,
          falloffCurve: 'quadratic',
          weaponId: 'exploding_barrel',
          presetId: explosion.presetId,
        });
      }, 0);
      return;
    }
    this.releaseDynamic(slot);
  }

  private releaseDynamic(slot: DynamicSlot): void {
    slot.inUse = false;
    slot.body.setEnabled(false);
    slot.mesh.visible = false;
    for (const collider of slot.colliders) {
      this.colliderFactory.byHandle.delete(collider.handle);
      this.dynamicHitHandles.delete(collider.handle);
    }
    ballistics.unregisterHittable(slot.mesh);
  }

  private onExplosion(payload: {
    point: { x: number; y: number; z: number }; radius: number; maxDamage: number;
  }): void {
    for (const pool of this.dynamicPools.values()) {
      for (const slot of pool.slots) {
        if (!slot.inUse) continue;
        const p = slot.body.translation();
        const dx = p.x - payload.point.x;
        const dy = p.y + 0.4 - payload.point.y;
        const dz = p.z - payload.point.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > payload.radius * 1.25) continue;
        const fall = 1 - Math.min(1, dist / (payload.radius * 1.25));
        const k = PropPool.EXPLOSION_IMPULSE * fall;
        slot.body.applyImpulse({
          x: (dx / Math.max(dist, 0.4)) * k,
          y: k * 0.55,
          z: (dz / Math.max(dist, 0.4)) * k,
        }, true);
        // Pure knockback, no damage — the shared ExplosionDamageResolver
        // already strains barrels through the ballistics registry.
      }
    }
  }

  /** Per-frame: sync dynamic meshes to their live Rapier bodies. */
  /** Called by MapBuilder after the manifest's last placement: derive each
   *  instanced group's union bounding sphere from the actual placements and
   *  hand it to the global culling manager (catalog-driven distance band). */
  finalizeCulling(): void {
    if (!this.culling) return;
    for (const [propTypeId, pending] of this.pendingInstancedBounds) {
      if (pending.positions.length === 0) continue;
      const box = new THREE.Box3();
      for (const p of pending.positions) {
        box.expandByPoint(p);
        box.expandByScalar(instancedReach(pending.def));
        box.min.y = Math.min(box.min.y, p.y);
        box.max.y = Math.max(box.max.y, p.y + colliderTopY(pending.def.collider, 1));
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      this.cullingHandles.push(this.culling.registerSphere(pending.mesh, sphere, {
        id: `prop:${propTypeId}`,
        maxDistance: pending.def.cullDistance,
      }));
    }
    this.pendingInstancedBounds.clear();
  }

  update(dt: number, elapsed: number): void {
    for (const pool of this.dynamicPools.values()) {
      for (const slot of pool.slots) {
        if (!slot.inUse) continue;
        const t = slot.body.translation();
        const r = slot.body.rotation();
        slot.mesh.position.set(t.x, t.y - 0.45, t.z);
        slot.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
    for (const animator of this.swayAnimators) {
      const cull = this.animatorCulling.get(animator);
      if (cull && !cull.isVisible()) continue; // hidden to EVERY active camera
      animator.update(dt, elapsed);
    }
  }

  // -------------------------------------------------------------------------
  // Teardown (level unload — LevelLoader drives this)
  // -------------------------------------------------------------------------

  disposeAll(): void {
    for (const body of this.placedBodies) {
      for (let i = 0; i < body.numColliders(); i += 1) {
        const collider = body.collider(i);
        this.colliderFactory.byHandle.delete(collider.handle);
        this.dynamicHitHandles.delete(collider.handle);
      }
      this.physics.world.removeRigidBody(body);
    }
    this.placedBodies.length = 0;
    for (const pool of this.dynamicPools.values()) {
      for (const slot of pool.slots) ballistics.unregisterHittable(slot.mesh);
    }
    this.dynamicPools.clear();
    for (const handle of this.cullingHandles) handle.release();
    this.cullingHandles.length = 0;
    this.animatorCulling.clear();
    this.pendingInstancedBounds.clear();
    this.instancedGroups.clear();
    this.sources.clear();
    this.swayAnimators.length = 0;
    this.placedLights.length = 0;
    this.root.clear();
  }
}

// ---------------------------------------------------------------------------
// Instancing merge: bake every submesh's geometry into one buffer per
// material slot ('Paint' vs everything else) with real index groups, keeping
// a sample of the "other" material so non-container props keep their authored
// look (wood pallets, metal cranes) instead of the container tint fallback.
// ---------------------------------------------------------------------------
function instancedReach(def: PropDefinition): number {
  const c = def.collider as { halfExtents?: readonly [number, number, number] };
  const h = c.halfExtents ?? ([0.5, 0.5, 0.5] as const);
  return Math.sqrt(h[0] * h[0] + h[2] * h[2]) + 0.5;
}

function mergeForInstancing(source: THREE.Object3D): {
  geometry: THREE.BufferGeometry;
  paintGeometry: boolean;
  otherGeometry: boolean;
  otherMaterial: THREE.Material | null;
} | null {
  source.updateMatrixWorld(true);
  const paintGeos: THREE.BufferGeometry[] = [];
  const otherGeos: THREE.BufferGeometry[] = [];
  let otherMaterial: THREE.Material | null = null;
  source.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = (mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position' && key !== 'normal') geo.deleteAttribute(key);
    }
    // GLTFLoader de-dupes repeated node names ('Paint_1', 'Paint_2', …) —
    // match by prefix so every painted rib/casting lands in the paint bucket.
    if (mesh.name.startsWith('Paint') || (mesh.parent as THREE.Mesh)?.name?.startsWith('Paint')) {
      paintGeos.push(geo);
    } else {
      otherGeos.push(geo);
      if (!otherMaterial) {
        const mat = mesh.material as THREE.Material;
        otherMaterial = Array.isArray(mat) ? mat[0] : mat;
      }
    }
  });
  if (paintGeos.length + otherGeos.length === 0) return null;
  const paintMerged = paintGeos.length ? mergeGeometries(paintGeos, false) : null;
  const otherMerged = otherGeos.length ? mergeGeometries(otherGeos, false) : null;
  if (paintMerged && otherMerged) {
    const geometry = mergeGeometries([paintMerged, otherMerged], true);
    if (!geometry) return null;
    // mergeGeometries(useGroups=true) orders groups in argument order.
    return {
      geometry, paintGeometry: true, otherGeometry: true, otherMaterial,
    };
  }
  if (paintMerged) {
    return {
      geometry: paintMerged, paintGeometry: true, otherGeometry: false, otherMaterial,
    };
  }
  return {
    geometry: otherMerged as THREE.BufferGeometry,
    paintGeometry: false, otherGeometry: true, otherMaterial,
  };
}

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((n) => { if (!found && n.name === name) found = n; });
  return found;
}

export default PropPool;
