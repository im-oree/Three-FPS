/**
 * TracerEffect.ts — pooled stretched tracers (Document 3 §12).
 * Near-instant flight from the muzzle world position to the ray result
 * (hit point, or the max-range miss point) with a trailing quad. Listens to
 * the internal `combat:tracer` event BallisticsSystem emits per shot for
 * tracer weapons. Pool of EFFECTS.POOL_SIZE stretched quads; additive.
 */
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import eventBus from '../core/EventBus';
import { EFFECTS } from '../utils/Constants';

interface TracerInstance {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
  head: number; // 0..1 progress of the head along from→to
  life: number; // seconds remaining visible (flight + fade-out tail)
  active: boolean;
}

// Metres of glowing trail behind the head (Constants, §15 no inline tunables).

export class TracerEffect {
  private readonly pool: TracerInstance[] = [];
  private readonly geometry = new THREE.PlaneGeometry(1, 1);

  constructor(assetLoader: AssetLoader, private readonly worldScene: THREE.Scene) {
    assetLoader.loadTexture('effects/tracer.png').then((tex) => {
      for (let i = 0; i < EFFECTS.POOL_SIZE; i += 1) {
        const material = new THREE.MeshBasicMaterial({
          map: tex,
          color: EFFECTS.TRACER_COLOR,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.visible = false;
        this.worldScene.add(mesh);
        this.pool.push({ mesh, material, from: new THREE.Vector3(), to: new THREE.Vector3(), head: 0, life: 0, active: false });
      }
    });
    eventBus.on('combat:tracer', (payload) => {
      const p = payload as { from: [number, number, number]; to: [number, number, number] };
      this.trigger(p.from, p.to);
    });
  }

  trigger(from: [number, number, number], to: [number, number, number]): void {
    const instance = this.pool.find((p) => !p.active);
    if (!instance) return;
    instance.active = true;
    instance.head = 0;
    instance.life = EFFECTS.TRACER_LIFETIME_SECONDS;
    instance.from.set(...from);
    instance.to.set(...to);
    instance.mesh.visible = true;
    instance.material.opacity = 1;
    this.place(instance);
  }

  private place(instance: TracerInstance): void {
    const dir = instance.to.clone().sub(instance.from);
    const dist = dir.length();
    if (dist < 1e-4) return;
    dir.normalize();
    const headPos = instance.from.clone().addScaledVector(dir, instance.head * dist);
    const tailPos = headPos.clone().addScaledVector(dir, -Math.min(EFFECTS.TRACER_TAIL_METERS, instance.head * dist));
    const mid = headPos.clone().add(tailPos).multiplyScalar(0.5);
    const len = Math.max(0.001, headPos.distanceTo(tailPos));
    instance.mesh.position.copy(mid);
    instance.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    instance.mesh.scale.set(EFFECTS.TRACER_WIDTH, len, 1);
    // Keep the additive quad readable: face the camera-ish by rolling around dir.
    instance.mesh.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  }

  update(dt: number): void {
    for (const instance of this.pool) {
      if (!instance.active) continue;
      const dist = instance.from.distanceTo(instance.to);
      // Head flies at TRACER_SPEED (near-instant); once it arrives, the
      // trail burns out over the remaining TRACER_LIFETIME_SECONDS.
      instance.head = Math.min(1, instance.head + (EFFECTS.TRACER_SPEED * dt) / Math.max(dist, 0.001));
      instance.life -= dt;
      instance.material.opacity = Math.max(0, Math.min(1 - instance.head * 0.25, instance.life / EFFECTS.TRACER_LIFETIME_SECONDS));
      if (instance.life <= 0) {
        instance.active = false;
        instance.mesh.visible = false;
        continue;
      }
      this.place(instance);
    }
  }
}

export default TracerEffect;
