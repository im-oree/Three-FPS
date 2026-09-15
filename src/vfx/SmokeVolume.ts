/**
 * SmokeVolume.ts — Document F §6.1.
 *
 * A pooled cluster of alpha-blended billboards that expands, holds, then
 * thins. Deliberately NOT additive: smoke must OCCLUDE, not glow.
 *
 * Also registers itself into VisionObstructionRegistry — a seam only. A
 * future AI document's line-of-sight checks can query it with no changes
 * here; this document just has to create the entry correctly.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { SMOKE } from '../utils/Constants';
import visionObstructions from '../world/VisionObstructionRegistry';
import type { AssetLoader } from '../core/AssetLoader';

interface Puff {
  sprite: THREE.Sprite;
  drift: THREE.Vector3;
  phase: number;
}

interface Volume {
  id: string;
  group: THREE.Group;
  puffs: Puff[];
  centre: THREE.Vector3;
  radius: number;
  elapsed: number;
  linger: number;
  active: boolean;
}

const POOL_SIZE = 3;

export class SmokeVolume {
  private readonly pool: Volume[] = [];
  private scene: THREE.Scene | null = null;
  private texture: THREE.Texture | null = null;
  private nextId = 0;
  private ready = false;

  async load(assetLoader: AssetLoader, scene: THREE.Scene): Promise<void> {
    this.scene = scene;
    this.texture = await assetLoader.loadTexture('effects/smoke_puff.png');
    for (let i = 0; i < POOL_SIZE; i += 1) this.pool.push(this.createVolume());
    this.ready = true;

    eventBus.on('smoke:deployed', (payload) => {
      const p = payload as {
        point: { x: number; y: number; z: number };
        radius: number;
        linger: number;
      };
      this.deploy(new THREE.Vector3(p.point.x, p.point.y, p.point.z), p.radius, p.linger);
    });
  }

  private createVolume(): Volume {
    const group = new THREE.Group();
    group.visible = false;
    const puffs: Puff[] = [];
    for (let i = 0; i < SMOKE.PUFF_COUNT; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.texture ?? undefined,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }));
      puffs.push({
        sprite,
        drift: new THREE.Vector3(),
        phase: Math.random() * Math.PI * 2,
      });
      group.add(sprite);
    }
    this.scene?.add(group);
    return {
      id: '', group, puffs, centre: new THREE.Vector3(),
      radius: 7, elapsed: 0, linger: SMOKE.LINGER_SECONDS, active: false,
    };
  }

  deploy(centre: THREE.Vector3, radius: number, linger: number): void {
    if (!this.ready) return;
    const vol = this.pool.find((v) => !v.active) ?? this.pool[0];
    if (vol.active) this.release(vol);

    this.nextId += 1;
    vol.id = `smoke_${this.nextId}`;
    vol.active = true;
    vol.elapsed = 0;
    vol.radius = radius;
    vol.linger = linger;
    vol.centre.copy(centre);
    vol.group.position.copy(centre);
    vol.group.visible = true;

    for (const puff of vol.puffs) {
      // Distribute through the volume, biased low — smoke pools then rises.
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.6;
      puff.sprite.position.set(
        Math.cos(a) * r, Math.random() * 0.4, Math.sin(a) * r,
      );
      puff.sprite.material.opacity = 0;
      puff.sprite.scale.setScalar(radius * 0.28);
      puff.drift.set(
        Math.cos(a) * (0.5 + Math.random() * 0.7),
        0.22 + Math.random() * 0.3,
        Math.sin(a) * (0.5 + Math.random() * 0.7),
      );
    }

    visionObstructions.add(vol.id, centre.x, centre.y, centre.z, radius);
  }

  /**
   * 0..1 how deep inside a smoke volume the given point is. Ramps across the
   * boundary rather than snapping, so walking into smoke fades in.
   */
  occlusionAt(point: THREE.Vector3): number {
    let worst = 0;
    for (const vol of this.pool) {
      if (!vol.active) continue;
      const d = vol.centre.distanceTo(point);
      const inner = vol.radius - SMOKE.VISION_FADE_MARGIN;
      if (d >= vol.radius) continue;
      const t = d <= inner ? 1 : 1 - (d - inner) / SMOKE.VISION_FADE_MARGIN;
      // Thin out as the volume disperses.
      const life = this.densityOf(vol);
      worst = Math.max(worst, t * life);
    }
    return worst;
  }

  private densityOf(vol: Volume): number {
    const growEnd = SMOKE.GROW_SECONDS;
    const holdEnd = growEnd + vol.linger;
    if (vol.elapsed < growEnd) return vol.elapsed / growEnd;
    if (vol.elapsed < holdEnd) return 1;
    return Math.max(0, 1 - (vol.elapsed - holdEnd) / SMOKE.DISPERSE_SECONDS);
  }

  get activeCount(): number {
    return this.pool.filter((v) => v.active).length;
  }

  update(dt: number): void {
    if (!this.ready) return;
    for (const vol of this.pool) {
      if (!vol.active) continue;
      vol.elapsed += dt;
      const density = this.densityOf(vol);
      const growT = Math.min(1, vol.elapsed / SMOKE.GROW_SECONDS);

      for (const puff of vol.puffs) {
        puff.phase += dt * 0.5;
        puff.sprite.position.addScaledVector(puff.drift, dt * (1 - growT * 0.6));
        // Gentle churn so the cloud is not a set of sliding billboards.
        puff.sprite.position.x += Math.sin(puff.phase) * dt * 0.15;
        puff.sprite.position.z += Math.cos(puff.phase * 0.8) * dt * 0.15;
        puff.sprite.scale.setScalar(vol.radius * (0.28 + growT * 0.55));
        puff.sprite.material.opacity = 0.72 * density;
      }

      if (density <= 0 && vol.elapsed > SMOKE.GROW_SECONDS) this.release(vol);
    }
  }

  private release(vol: Volume): void {
    vol.active = false;
    vol.group.visible = false;
    visionObstructions.remove(vol.id);
  }

  clear(): void {
    for (const vol of this.pool) if (vol.active) this.release(vol);
  }
}

export const smokeVolume = new SmokeVolume();
export default smokeVolume;
