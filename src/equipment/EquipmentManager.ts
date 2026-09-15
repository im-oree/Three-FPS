/**
 * EquipmentManager.ts — Document F §3.
 *
 * Parallel to WeaponManager, NOT inside it: a throwable is not a weapon for
 * switching or ADS purposes. But it reuses every applicable pattern — data
 * definitions, Rapier physics flight, EventBus naming, pooled VFX.
 *
 * COOK MECHANIC: holding the throw key starts a cook timer and burns real
 * fuse time. Release throws with the REMAINING fuse. Holding past
 * maxCookSeconds auto-throws rather than detonating in hand — a safety valve,
 * because self-detonation from holding a key too long is a frustration, not
 * a skill test.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import eventBus from '../core/EventBus';
import { THROWABLE } from '../utils/Constants';
import { getThrowable, SMOKE_GRENADE } from './definitions';
import type { ThrowableProfile } from './definitions/types';
import type { AssetLoader } from '../core/AssetLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

interface LiveThrowable {
  profile: ThrowableProfile;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Object3D | null;
  fuse: number;
  /** Previous position, for swept impact detection and bounce speed. */
  prev: THREE.Vector3;
  lastBounceAt: number;
  age: number;
}

export interface EquipmentDeps {
  scene: THREE.Scene;
  assetLoader: AssetLoader;
  physics: PhysicsWorld;
  getEyePosition: () => THREE.Vector3;
  getForward: () => THREE.Vector3;
}

const _v = new THREE.Vector3();
const _step = new THREE.Vector3();

export class EquipmentManager {
  private deps: EquipmentDeps | null = null;
  private equipped: ThrowableProfile = SMOKE_GRENADE;
  private remaining = 0;
  private cooking = false;
  private cookElapsed = 0;
  /** Throw animation timer; the device leaves the hand partway through. */
  private throwTimer = 0;
  private pendingThrow: ThrowableProfile | null = null;
  private pendingFuse = 0;
  private readonly live: LiveThrowable[] = [];
  private readonly protoCache = new Map<string, THREE.Object3D>();

  attach(deps: EquipmentDeps): void {
    this.deps = deps;
    void this.preload();
  }

  private async preload(): Promise<void> {
    if (!this.deps) return;
    for (const id of ['smoke_grenade', 'stun_grenade', 'flashbang']) {
      const profile = getThrowable(id);
      if (!profile) continue;
      try {
        const model = await this.deps.assetLoader.loadModel(profile.modelPath);
        this.protoCache.set(id, model);
      } catch {
        console.warn(`[EquipmentManager] missing model ${profile.modelPath}`);
      }
    }
  }

  /** Loadout hook — which tactical device is carried. */
  setTactical(id: string): void {
    const profile = getThrowable(id);
    if (!profile) return;
    this.equipped = profile;
    this.remaining = profile.carryCount;
    eventBus.emit('equipment:countChanged', {
      id: profile.id, remaining: this.remaining,
    });
  }

  /** Refill on match start / respawn. */
  resupply(): void {
    this.remaining = this.equipped.carryCount;
    this.cooking = false;
    this.cookElapsed = 0;
    eventBus.emit('equipment:countChanged', {
      id: this.equipped.id, remaining: this.remaining,
    });
  }

  get tactical(): ThrowableProfile { return this.equipped; }
  get count(): number { return this.remaining; }
  get isCooking(): boolean { return this.cooking; }
  get cookProgress(): number {
    if (!this.cooking || this.equipped.maxCookSeconds <= 0) return 0;
    return Math.min(1, this.cookElapsed / this.equipped.maxCookSeconds);
  }
  get inFlightCount(): number { return this.live.length; }

  /** Throw key pressed. */
  beginCook(): void {
    if (this.cooking || this.remaining <= 0 || this.pendingThrow) return;
    this.cooking = true;
    this.cookElapsed = 0;
    eventBus.emit('equipment:cookStart', { id: this.equipped.id });
  }

  /** Throw key released — or the safety cutoff fired. */
  release(): void {
    if (!this.cooking) return;
    this.cooking = false;
    const profile = this.equipped;
    // Cooking burns real fuse. A non-cookable device always gets its full one.
    const fuse = profile.cookable
      ? Math.max(0.15, profile.fuseSeconds - this.cookElapsed)
      : profile.fuseSeconds;
    this.cookElapsed = 0;
    this.remaining -= 1;

    // The device leaves the hand PART WAY through the throw animation, not on
    // the key release — same percentage-of-duration pattern as reload beats.
    this.pendingThrow = profile;
    this.pendingFuse = fuse;
    this.throwTimer = 0;

    eventBus.emit('equipment:throwStart', { id: profile.id, fuse });
    eventBus.emit('equipment:countChanged', {
      id: profile.id, remaining: this.remaining,
    });
  }

  update(dt: number): void {
    if (this.cooking) {
      this.cookElapsed += dt;
      // Safety valve: auto-throw rather than detonate in hand.
      if (this.equipped.cookable && this.cookElapsed >= this.equipped.maxCookSeconds) {
        this.release();
      }
    }

    if (this.pendingThrow) {
      this.throwTimer += dt;
      const progress = this.throwTimer / THROWABLE.THROW_CLIP_SECONDS;
      if (progress >= THROWABLE.RELEASE_AT_PROGRESS) {
        this.spawn(this.pendingThrow, this.pendingFuse);
        this.pendingThrow = null;
      }
    }

    this.updateLive(dt);
  }

  private spawn(profile: ThrowableProfile, fuse: number): void {
    if (!this.deps) return;
    const eye = this.deps.getEyePosition();
    const forward = this.deps.getForward().clone().normalize();

    // Spawn clear of the player's own capsule, as rockets do.
    const origin = eye.clone().addScaledVector(forward, THROWABLE.SPAWN_OFFSET);
    // A slight upward bias so a flat look still produces a usable arc.
    const dir = forward.clone();
    dir.y += THROWABLE.THROW_UP_BIAS;
    dir.normalize();

    const speed = profile.throwForce * THROWABLE.THROW_SPEED_SCALE;
    const body = this.deps.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(dir.x * speed, dir.y * speed, dir.z * speed)
        .setAngvel({
          x: (Math.random() - 0.5) * 9,
          y: (Math.random() - 0.5) * 9,
          z: (Math.random() - 0.5) * 9,
        })
        .setGravityScale(profile.gravityScale)
        .setLinearDamping(THROWABLE.LINEAR_DAMPING)
        .setAngularDamping(THROWABLE.ANGULAR_DAMPING),
    );
    const collider = this.deps.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.05)
        .setRestitution(THROWABLE.BOUNCE_RESTITUTION),
      body,
    );

    let mesh: THREE.Object3D | null = null;
    const proto = this.protoCache.get(profile.id);
    if (proto) {
      mesh = proto.clone(true);
      mesh.position.copy(origin);
      this.deps.scene.add(mesh);
    }

    this.live.push({
      profile, body, collider, mesh, fuse,
      prev: origin.clone(), lastBounceAt: 0, age: 0,
    });
    eventBus.emit('equipment:thrown', { id: profile.id, fuse });
  }

  private updateLive(dt: number): void {
    if (!this.deps) return;
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const t = this.live[i];
      t.age += dt;
      t.fuse -= dt;

      const tr = t.body.translation();
      _v.set(tr.x, tr.y, tr.z);
      if (t.mesh) {
        t.mesh.position.copy(_v);
        const rot = t.body.rotation();
        t.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      }

      // Bounce audio: a real contact shows up as a sharp speed drop.
      _step.copy(_v).sub(t.prev);
      const travelled = _step.length() / Math.max(dt, 1e-4);
      const lv = t.body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      if (t.age - t.lastBounceAt > 0.12
          && travelled > THROWABLE.MIN_BOUNCE_SPEED
          && speed < travelled * 0.72) {
        t.lastBounceAt = t.age;
        eventBus.emit('equipment:bounce', {
          id: t.profile.id,
          point: { x: _v.x, y: _v.y, z: _v.z },
        });
        // An impact-triggered device detonates on its FIRST solid contact.
        if (t.profile.detonationTrigger === 'impact') {
          this.detonate(t, _v);
          this.live.splice(i, 1);
          continue;
        }
      }
      t.prev.copy(_v);

      if (t.profile.detonationTrigger === 'fuse' && t.fuse <= 0) {
        this.detonate(t, _v);
        this.live.splice(i, 1);
      }
    }
  }

  private detonate(t: LiveThrowable, at: THREE.Vector3): void {
    eventBus.emit('equipment:detonated', {
      id: t.profile.id,
      point: { x: at.x, y: at.y, z: at.z },
      radius: t.profile.effectRadius,
    });
    if (t.mesh) t.mesh.parent?.remove(t.mesh);
    this.deps?.physics.world.removeRigidBody(t.body);
  }

  /** Clear everything in flight (level unload). */
  clear(): void {
    for (const t of this.live) {
      if (t.mesh) t.mesh.parent?.remove(t.mesh);
      this.deps?.physics.world.removeRigidBody(t.body);
    }
    this.live.length = 0;
    this.cooking = false;
    this.pendingThrow = null;
  }
}

export const equipmentManager = new EquipmentManager();
export default equipmentManager;
