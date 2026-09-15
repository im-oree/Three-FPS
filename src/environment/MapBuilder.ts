/**
 * MapBuilder.ts — Document K §3.3: turns a placement manifest (pure data)
 * into a fully collision-correct, instanced, pooled 3D scene. The same
 * manifest drives the greybox pass and the dressed pass — only the catalog
 * entry's visual model differs between them.
 *
 * Usage: constructed by LevelLoader when a level definition carries a
 * `propManifest` URL; build() resolves before level-load completion gates
 * the loading screen, exactly like every other level resource.
 */
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type ColliderFactory from '../physics/ColliderFactory';
import PropPool from './props/PropPool';
import type { FrustumCullingManager } from '../core/FrustumCullingManager';
import type RenderQualityManager from '../core/quality/RenderQualityManager';
import { resolvePropDefinition, preloadColliderData } from './props/PropCatalog';
import WindSwayAnimator from './props/WindSwayAnimator';

export interface PropManifestEntry {
  readonly propType: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale?: number;
}

/** Worst-case dynamic-pool budgets per type (Document K §2.4) — generous
 *  against chain reaction, not the initial placement count. */
const DEFAULT_DYNAMIC_POOL_SIZE = 24;

export class MapBuilder {
  readonly propPool: PropPool;
  /** Document N §5.3: palms sway individually; created only if a level asks. */
  readonly windSway = new WindSwayAnimator();
  private elapsed = 0;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    colliderFactory: ColliderFactory,
    assetLoader: AssetLoader,
    culling: FrustumCullingManager | null = null,
    quality: RenderQualityManager | null = null,
  ) {
    this.propPool = new PropPool(
      scene, physics, colliderFactory, assetLoader, culling, quality,
    );
  }

  /** Build from a fetched manifest; poolSize overrides come from the level def. */
  async build(
    manifestUrl: string,
    poolSizeOverrides: Record<string, number> = {},
    windSwayPropTypes: readonly string[] = [],
  ): Promise<number> {
    const manifest: PropManifestEntry[] = await fetch(manifestUrl).then((r) => {
      if (!r.ok) throw new Error(`MapBuilder: ${manifestUrl} -> HTTP ${r.status}`);
      return r.json();
    });

    // Pass 1: pre-size every prop type exactly (static) or generously (dynamic).
    const counts = new Map<string, number>();
    for (const entry of manifest) {
      counts.set(entry.propType, (counts.get(entry.propType) ?? 0) + 1);
    }

    // Document N §4: buildings keep their compound colliders in sidecar JSON.
    // Fetch them ALL before any placement — collider resolution inside the
    // placement loop is synchronous, so a lazy fetch there would place
    // buildings before their collision existed.
    await preloadColliderData(counts.keys());
    for (const [propTypeId, count] of counts) {
      const def = resolvePropDefinition(propTypeId);
      const poolSize = def.physicsBehavior === 'dynamic'
        ? (poolSizeOverrides[propTypeId] ?? Math.max(DEFAULT_DYNAMIC_POOL_SIZE, count * 2))
        : count;
      await this.propPool.preparePropType(propTypeId, poolSize);
    }

    // Pass 2: place every manifest entry.
    let placed = 0;
    for (const entry of manifest) {
      const obj = this.propPool.placeInstance(
        entry.propType,
        new THREE.Vector3(...entry.position),
        entry.rotation,
        entry.scale ?? 1,
      );
      if (obj) placed += 1;
    }
    // Document N §5.3: register wind sway on the cloned-static tree instances.
    let swayNodes = 0;
    for (const propTypeId of windSwayPropTypes) {
      for (const model of this.propPool.getPlacedModels(propTypeId)) {
        swayNodes += this.windSway.registerTree(model);
      }
      // Swaying trees rotate their crowns every frame, so they must survive
      // static batching as individual objects.
      this.propPool.excludeTypeFromBatching(propTypeId);
    }

    // All instances placed → derive per-group union bounds for global culling.
    this.propPool.finalizeCulling();
    console.log(
      `[MapBuilder] placed ${placed}/${manifest.length} props across ${counts.size} prop types`
      + (swayNodes ? `, ${swayNodes} wind-sway nodes.` : '.'),
    );
    return placed;
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.propPool.update(dt, this.elapsed);
    this.windSway.update(dt, this.elapsed);
  }

  dispose(): void {
    this.windSway.clear();
    this.propPool.disposeAll();
  }
}

export default MapBuilder;
