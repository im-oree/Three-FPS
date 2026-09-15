/**
 * ExplosionEffect.ts — Document G. ONE explosion implementation, parameterised
 * by scale, shared by the rocket launcher, the stun/flashbang detonations, and
 * (Document H/I) killstreaks. There is no second explosion in this project.
 *
 * Six composited layers, every one scaled by the preset:
 *   1. instantaneous point-light flash  (genuinely lights nearby geometry)
 *   2. fireball core sprites            (additive, rapid grow then fade)
 *   3. shockwave ring                   (expanding, thinning annulus)
 *   4. debris chunks                    (REAL pooled Rapier dynamic bodies)
 *   5. ground scorch decal              (oriented to the surface normal)
 *   6. smoke plume                      (shared with the smoke grenade)
 *
 * DELIBERATE SEPARATION: this file is purely visual/audible. Damage is
 * ExplosionDamageResolver's job and camera shake is ShakeTriggers' job, both
 * driven off the same `combat:explosion` event. That split is what lets a stun
 * grenade reuse these visuals with zero blast damage.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AssetLoader } from '../core/AssetLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { EXPLOSION_FX } from '../utils/Constants';

export interface ExplosionPreset {
  readonly fireballScale: number;
  readonly smokeScale: number;
  readonly debrisCount: number;
  readonly shockwaveRadius: number;
  readonly lightFlashIntensity: number;
  /** Air-bursts skip the ground decal (Document I §6.11). */
  readonly groundDecal: boolean;
}

/** Document G §1.4 + Document I §6.9 — data, not code. */
export const EXPLOSION_PRESETS: Record<string, ExplosionPreset> = {
  rocketLauncher: {
    fireballScale: 1.0, smokeScale: 1.0, debrisCount: 10,
    shockwaveRadius: 6, lightFlashIntensity: 3.0, groundDecal: true,
  },
  tacticalDetonation: {
    fireballScale: 0.25, smokeScale: 0.2, debrisCount: 0,
    shockwaveRadius: 2, lightFlashIntensity: 1.5, groundDecal: false,
  },
  airstrikeBomb: {
    fireballScale: 1.8, smokeScale: 1.6, debrisCount: 18,
    shockwaveRadius: 12, lightFlashIntensity: 5.0, groundDecal: true,
  },
  missileKillstreak: {
    fireballScale: 1.4, smokeScale: 1.3, debrisCount: 14,
    shockwaveRadius: 9, lightFlashIntensity: 4.0, groundDecal: true,
  },
  missileAirburst: {
    fireballScale: 1.1, smokeScale: 1.0, debrisCount: 8,
    shockwaveRadius: 7, lightFlashIntensity: 3.4, groundDecal: false,
  },
  // Document K §2.5: the explosive oil barrel — a third, non-weapon consumer
  // of the exact same shared explosion system Document G designed.
  barrelPop: {
    fireballScale: 0.5, smokeScale: 0.55, debrisCount: 5,
    shockwaveRadius: 3.5, lightFlashIntensity: 1.8, groundDecal: true,
  },
};

interface DebrisChunk {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null;
  life: number;
}

interface ExplosionInstance {
  group: THREE.Group;
  light: THREE.PointLight;
  fireballs: THREE.Sprite[];
  shockwave: THREE.Mesh;
  smoke: THREE.Sprite[];
  smokeDrift: THREE.Vector3[];
  decal: THREE.Mesh;
  debris: DebrisChunk[];
  active: boolean;
  elapsed: number;
  preset: ExplosionPreset;
}

const POOL_SIZE = 4;
const MAX_DEBRIS = 18;
const SMOKE_PUFFS = 7;
const FIREBALL_SPRITES = 3;

const _v = new THREE.Vector3();

export class ExplosionEffect {
  private readonly pool: ExplosionInstance[] = [];
  private scene: THREE.Scene | null = null;
  private physics: PhysicsWorld | null = null;
  private fireballTex: THREE.Texture | null = null;
  private shockwaveTex: THREE.Texture | null = null;
  private smokeTex: THREE.Texture | null = null;
  private scorchTex: THREE.Texture | null = null;
  private ready = false;

  async load(assetLoader: AssetLoader, scene: THREE.Scene, physics: PhysicsWorld): Promise<void> {
    this.scene = scene;
    this.physics = physics;
    const [fire, shock, smoke, scorch] = await Promise.all([
      assetLoader.loadTexture('effects/explosion_fireball.png'),
      assetLoader.loadTexture('effects/explosion_shockwave.png'),
      assetLoader.loadTexture('effects/smoke_puff.png'),
      assetLoader.loadTexture('effects/scorch_decal.png'),
    ]);
    this.fireballTex = fire;
    this.shockwaveTex = shock;
    this.smokeTex = smoke;
    this.scorchTex = scorch;
    for (let i = 0; i < POOL_SIZE; i += 1) this.pool.push(this.createInstance());
    this.ready = true;
  }

  get isReady(): boolean { return this.ready; }

  /** Test seam: how many explosions are currently animating. */
  get activeCount(): number {
    return this.pool.filter((p) => p.active).length;
  }

  private createInstance(): ExplosionInstance {
    const group = new THREE.Group();
    group.visible = false;

    // 1. point-light flash — no shadows; a 3-frame flash cannot afford them.
    const light = new THREE.PointLight(0xffb060, 0, 30, 2);
    light.castShadow = false;
    group.add(light);

    // 2. fireball core
    const fireballs: THREE.Sprite[] = [];
    for (let i = 0; i < FIREBALL_SPRITES; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.fireballTex ?? undefined,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }));
      fireballs.push(sprite);
      group.add(sprite);
    }

    // 3. shockwave ring — a flat plane kept horizontal
    const shockwave = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.shockwaveTex ?? undefined,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    shockwave.rotation.x = -Math.PI / 2;
    group.add(shockwave);

    // 6. smoke plume — alpha blended so it OCCLUDES rather than glowing
    const smoke: THREE.Sprite[] = [];
    const smokeDrift: THREE.Vector3[] = [];
    for (let i = 0; i < SMOKE_PUFFS; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.smokeTex ?? undefined,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }));
      smoke.push(sprite);
      smokeDrift.push(new THREE.Vector3());
      group.add(sprite);
    }

    // 5. scorch decal
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.scorchTex ?? undefined,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    );
    decal.rotation.x = -Math.PI / 2;
    group.add(decal);

    // 4. debris — real meshes, given Rapier bodies on activation
    const debris: DebrisChunk[] = [];
    for (let i = 0; i < MAX_DEBRIS; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.09, 0.13),
        new THREE.MeshStandardMaterial({ color: 0x4a453e, roughness: 0.9, flatShading: true }),
      );
      mesh.visible = false;
      debris.push({ mesh, body: null, life: 0 });
      // Debris live in the SCENE, not the group: they fly off independently
      // and must not inherit the group's transform.
      this.scene?.add(mesh);
    }

    this.scene?.add(group);
    return {
      group, light, fireballs, shockwave, smoke, smokeDrift, decal, debris,
      active: false, elapsed: 0, preset: EXPLOSION_PRESETS.rocketLauncher,
    };
  }

  /**
   * Spawn an explosion. `surfaceNormal` orients the scorch decal; omit it for
   * an air-burst.
   */
  spawn(
    worldPos: THREE.Vector3,
    preset: ExplosionPreset = EXPLOSION_PRESETS.rocketLauncher,
    surfaceNormal?: THREE.Vector3,
  ): void {
    if (!this.ready) return;
    const fx = this.pool.find((p) => !p.active) ?? this.pool[0];
    this.release(fx);

    fx.active = true;
    fx.elapsed = 0;
    fx.preset = preset;
    fx.group.position.copy(worldPos);
    fx.group.visible = true;

    fx.light.intensity = preset.lightFlashIntensity * EXPLOSION_FX.LIGHT_INTENSITY_SCALE;
    fx.light.distance = 8 + preset.shockwaveRadius * 2;

    for (let i = 0; i < fx.fireballs.length; i += 1) {
      const sprite = fx.fireballs[i];
      sprite.visible = true;
      sprite.material.opacity = 1;
      // Offset each layer slightly so the ball has depth rather than reading
      // as one flat billboard.
      sprite.position.set(
        (Math.random() - 0.5) * 0.35 * preset.fireballScale,
        0.5 * preset.fireballScale + (Math.random() - 0.5) * 0.3 * preset.fireballScale,
        (Math.random() - 0.5) * 0.35 * preset.fireballScale,
      );
      // Size against the actual blast radius: a 6 m rocket blast should show
      // a fireball metres across, not a 3 m sprite lost against the terrain.
      sprite.scale.setScalar(preset.shockwaveRadius * 0.30 * preset.fireballScale);
    }

    fx.shockwave.visible = true;
    (fx.shockwave.material as THREE.MeshBasicMaterial).opacity = 0.9;
    fx.shockwave.scale.setScalar(0.5);
    // Sit the ring just off the ground to avoid z-fighting with the floor.
    fx.shockwave.position.y = 0.06;

    for (let i = 0; i < fx.smoke.length; i += 1) {
      const sprite = fx.smoke[i];
      sprite.visible = true;
      sprite.material.opacity = 0;
      const a = (i / fx.smoke.length) * Math.PI * 2;
      sprite.position.set(Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2);
      sprite.scale.setScalar(preset.shockwaveRadius * 0.22 * preset.smokeScale);
      fx.smokeDrift[i].set(
        Math.cos(a) * (0.5 + Math.random() * 0.5),
        0.7 + Math.random() * 0.6,
        Math.sin(a) * (0.5 + Math.random() * 0.5),
      ).multiplyScalar(preset.smokeScale);
    }

    if (preset.groundDecal) {
      fx.decal.visible = true;
      (fx.decal.material as THREE.MeshBasicMaterial).opacity = 0.95;
      const size = preset.shockwaveRadius * 0.7;
      fx.decal.scale.set(size, size, size);
      fx.decal.position.y = -worldPos.y + 0.02; // pin to ground plane
      if (surfaceNormal) {
        fx.decal.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1), surfaceNormal.clone().normalize(),
        );
      } else {
        fx.decal.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      }
    } else {
      fx.decal.visible = false;
    }

    this.spawnDebris(fx, worldPos, preset);
  }

  private spawnDebris(fx: ExplosionInstance, origin: THREE.Vector3, preset: ExplosionPreset): void {
    if (!this.physics) return;
    const count = Math.min(preset.debrisCount, MAX_DEBRIS);
    for (let i = 0; i < count; i += 1) {
      const chunk = fx.debris[i];
      chunk.mesh.visible = true;
      chunk.life = EXPLOSION_FX.DEBRIS_LIFETIME;
      const scale = 0.6 + Math.random() * 0.8;
      chunk.mesh.scale.setScalar(scale * preset.fireballScale);

      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(origin.x, origin.y + 0.3, origin.z)
          .setLinvel(
            (Math.random() - 0.5) * 12 * preset.fireballScale,
            (2 + Math.random() * 8) * preset.fireballScale,
            (Math.random() - 0.5) * 12 * preset.fireballScale,
          )
          .setAngvel({
            x: (Math.random() - 0.5) * 14,
            y: (Math.random() - 0.5) * 14,
            z: (Math.random() - 0.5) * 14,
          })
          .setLinearDamping(0.18),
      );
      this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.06, 0.05, 0.07), body);
      chunk.body = body;
    }
  }

  update(dt: number): void {
    if (!this.ready) return;
    for (const fx of this.pool) {
      if (!fx.active) continue;
      fx.elapsed += dt;
      const t = fx.elapsed;
      const p = fx.preset;

      // 1. light — very short flash, then dark
      fx.light.intensity = t < EXPLOSION_FX.LIGHT_SECONDS
        ? p.lightFlashIntensity * EXPLOSION_FX.LIGHT_INTENSITY_SCALE
          * (1 - t / EXPLOSION_FX.LIGHT_SECONDS)
        : 0;

      // 2. fireball — snap outward then collapse and fade
      const fbT = Math.min(1, t / EXPLOSION_FX.FIREBALL_SECONDS);
      for (const sprite of fx.fireballs) {
        const grow = 1 - Math.pow(1 - fbT, 3);
        const base = p.shockwaveRadius * 0.30 * p.fireballScale;
        sprite.scale.setScalar(base * (1 + grow * 2.2));
        // Hold near-full brightness through the first third, then fall off —
        // fading linearly from frame one made the core look weak.
        sprite.material.opacity = fbT < 0.3 ? 1 : Math.max(0, 1 - (fbT - 0.3) / 0.7);
        if (fbT >= 1) sprite.visible = false;
      }

      // 3. shockwave — expands and thins
      const swT = Math.min(1, t / EXPLOSION_FX.SHOCKWAVE_SECONDS);
      if (swT < 1) {
        const r = (1 - Math.pow(1 - swT, 2)) * p.shockwaveRadius * 2;
        fx.shockwave.scale.setScalar(Math.max(0.4, r));
        (fx.shockwave.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - swT);
      } else {
        fx.shockwave.visible = false;
      }

      // 6. smoke — rises, spreads, fades slowly
      const smT = Math.min(1, t / EXPLOSION_FX.SMOKE_SECONDS);
      for (let i = 0; i < fx.smoke.length; i += 1) {
        const sprite = fx.smoke[i];
        if (!sprite.visible) continue;
        sprite.position.addScaledVector(fx.smokeDrift[i], dt);
        sprite.scale.setScalar(p.shockwaveRadius * 0.22 * p.smokeScale * (1 + smT * 2.2));
        // Fade in fast, out slow: smoke should outlive the fire.
        sprite.material.opacity = smT < 0.12
          ? (smT / 0.12) * 0.8
          : 0.8 * (1 - (smT - 0.12) / 0.88);
        if (smT >= 1) sprite.visible = false;
      }

      // 5. decal — lingers, then fades
      if (fx.decal.visible) {
        const dT = Math.min(1, t / EXPLOSION_FX.DECAL_SECONDS);
        (fx.decal.material as THREE.MeshBasicMaterial).opacity =
          dT < 0.75 ? 0.95 : 0.95 * (1 - (dT - 0.75) / 0.25);
        if (dT >= 1) fx.decal.visible = false;
      }

      // 4. debris — follow their physics bodies, then fade and recycle
      let debrisLive = false;
      for (const chunk of fx.debris) {
        if (!chunk.body || chunk.life <= 0) continue;
        debrisLive = true;
        chunk.life -= dt;
        const tr = chunk.body.translation();
        chunk.mesh.position.set(tr.x, tr.y, tr.z);
        const rot = chunk.body.rotation();
        chunk.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
        if (chunk.life <= 0) this.releaseChunk(chunk);
      }

      const done = t > EXPLOSION_FX.TOTAL_SECONDS && !debrisLive;
      if (done) this.release(fx);
    }
  }

  private releaseChunk(chunk: DebrisChunk): void {
    if (chunk.body && this.physics) this.physics.world.removeRigidBody(chunk.body);
    chunk.body = null;
    chunk.life = 0;
    chunk.mesh.visible = false;
  }

  private release(fx: ExplosionInstance): void {
    fx.active = false;
    fx.group.visible = false;
    for (const chunk of fx.debris) this.releaseChunk(chunk);
    void _v;
  }
}

export const explosionEffect = new ExplosionEffect();
export default explosionEffect;
