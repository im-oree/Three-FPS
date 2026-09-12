/**
 * ImpactEffect.ts — pooled impact bursts (Document 3 §12).
 * Listens to `combat:hit`. Each instance is a group of IMPACT_PARTICLE_COUNT
 * sprite puffs with random hemispherical velocities around the surface
 * normal, plus one decal quad oriented by the normal and offset along it to
 * avoid z-fighting. `surfaceType` selects the variant:
 *   'dummy'   → organic red-spark burst (impact_spark),
 *   default   → grey dust puff (impact_dust).
 * Fixed pool of EFFECTS.POOL_SIZE instances; zero allocations at hit time.
 */
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import eventBus from '../core/EventBus';
import { EFFECTS } from '../utils/Constants';

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
}

interface ImpactInstance {
  group: THREE.Group;
  particles: Particle[];
  decal: THREE.Mesh;
  decalMaterial: THREE.MeshBasicMaterial;
  life: number;
  active: boolean;
}

export class ImpactEffect {
  private readonly pool: ImpactInstance[] = [];
  private dustTex: THREE.Texture | null = null;
  private sparkTex: THREE.Texture | null = null;

  constructor(assetLoader: AssetLoader, private readonly worldScene: THREE.Scene) {
    Promise.all([
      assetLoader.loadTexture('effects/impact_dust.png'),
      assetLoader.loadTexture('effects/impact_spark.png'),
    ]).then(([dust, spark]) => {
      this.dustTex = dust;
      this.sparkTex = spark;
      for (let i = 0; i < EFFECTS.POOL_SIZE; i += 1) this.pool.push(this.createInstance());
    });
    eventBus.on('combat:hit', (payload) =>
      this.trigger(payload as { point: THREE.Vector3 | number[]; normal: THREE.Vector3 | number[]; surfaceType: string }),
    );
  }

  private createInstance(): ImpactInstance {
    const group = new THREE.Group();
    group.visible = false;
    const particles: Particle[] = [];
    for (let i = 0; i < EFFECTS.IMPACT_PARTICLE_COUNT; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: this.dustTex ?? undefined,
        blending: THREE.AdditiveBlending,
        transparent: true,
      });
      const sprite = new THREE.Sprite(material);
      particles.push({ sprite, velocity: new THREE.Vector3() });
      group.add(sprite);
    }
    const decalMaterial = new THREE.MeshBasicMaterial({
      map: this.dustTex ?? undefined,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(EFFECTS.DECAL_SIZE, EFFECTS.DECAL_SIZE), decalMaterial);
    group.add(decal);
    this.worldScene.add(group);
    return { group, particles, decal, decalMaterial, life: 0, active: false };
  }

  trigger(payload: { point: THREE.Vector3 | number[]; normal: THREE.Vector3 | number[]; surfaceType: string }): void {
    if (!this.dustTex) return;
    const instance = this.pool.find((p) => !p.active);
    if (!instance) return;
    instance.active = true;
    instance.life = EFFECTS.IMPACT_LIFETIME_SECONDS;
    const point = payload.point instanceof THREE.Vector3 ? payload.point : new THREE.Vector3(...payload.point);
    const normal = payload.normal instanceof THREE.Vector3 ? payload.normal : new THREE.Vector3(...payload.normal);
    const isDummy = payload.surfaceType === 'dummy';
    const tex = isDummy ? this.sparkTex ?? this.dustTex : this.dustTex;
    const tint = isDummy ? EFFECTS.IMPACT_COLOR_DUMMY : EFFECTS.IMPACT_COLOR_GENERIC;

    instance.group.position.copy(point);
    instance.group.visible = true;
    for (const particle of instance.particles) {
      particle.sprite.material.map = tex;
      particle.sprite.material.color.setHex(tint);
      particle.sprite.material.opacity = 1;
      particle.sprite.material.needsUpdate = true;
      particle.sprite.position.set(0, 0, 0);
      particle.sprite.scale.setScalar(EFFECTS.IMPACT_PARTICLE_SCALE_MIN + Math.random() * (EFFECTS.IMPACT_PARTICLE_SCALE_MAX - EFFECTS.IMPACT_PARTICLE_SCALE_MIN));
      // Random velocity in the hemisphere around the normal.
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      dir.add(normal.clone().multiplyScalar(1.5)).normalize();
      particle.velocity.copy(dir).multiplyScalar(EFFECTS.IMPACT_PARTICLE_SPEED * (0.5 + Math.random() * 0.5));
    }
    instance.decal.position.copy(normal).multiplyScalar(EFFECTS.DECAL_SURFACE_OFFSET); // z-fight offset
    instance.decal.lookAt(point.clone().add(normal));
    instance.decalMaterial.map = tex;
    instance.decalMaterial.color.setHex(isDummy ? EFFECTS.IMPACT_DECAL_COLOR_DUMMY : EFFECTS.IMPACT_DECAL_COLOR_GENERIC);
    instance.decalMaterial.opacity = isDummy ? 0 : 0.85; // dummies don't decal
    instance.decalMaterial.needsUpdate = true;
  }

  update(dt: number): void {
    for (const instance of this.pool) {
      if (!instance.active) continue;
      instance.life -= dt;
      const t = Math.max(0, instance.life / EFFECTS.IMPACT_LIFETIME_SECONDS);
      for (const particle of instance.particles) {
        particle.sprite.position.addScaledVector(particle.velocity, dt);
        particle.velocity.y -= EFFECTS.IMPACT_GRAVITY * dt;
        particle.sprite.material.opacity = t;
      }
      instance.decalMaterial.opacity = Math.min(instance.decalMaterial.opacity, t * 0.85);
      if (instance.life <= 0) {
        instance.active = false;
        instance.group.visible = false;
      }
    }
  }
}

export default ImpactEffect;
