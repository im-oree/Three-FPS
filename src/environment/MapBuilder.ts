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
import { resolvePropDefinition } from './props/PropCatalog';

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
  private elapsed = 0;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    colliderFactory: ColliderFactory,
    assetLoader: AssetLoader,
    culling: FrustumCullingManager | null = null,
  ) {
    this.propPool = new PropPool(scene, physics, colliderFactory, assetLoader, culling);
  }

  /** Build from a fetched manifest; poolSize overrides come from the level def. */
  async build(
    manifestUrl: string,
    poolSizeOverrides: Record<string, number> = {},
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
    // All instances placed → derive per-group union bounds for global culling.
    this.propPool.finalizeCulling();
    console.log(
      `[MapBuilder] placed ${placed}/${manifest.length} props across ${counts.size} prop types.`,
    );
    return placed;
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.propPool.update(dt, this.elapsed);
  }

  dispose(): void {
    this.propPool.disposeAll();
  }
}

export default MapBuilder;
