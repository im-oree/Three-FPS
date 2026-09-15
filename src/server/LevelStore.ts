/**
 * LevelStore.ts — where the server gets its collision geometry.
 *
 * The data is baked by tools/bakeCollision.mjs into assets/collision/*.json,
 * so the server never parses glTF and never needs a renderer to know what is
 * solid. Both deployments load the same files: the browser fetches them, the
 * backend reads them from disk. That difference is confined to the `fetcher`
 * passed in here, which is the only environment-specific line.
 */
import type { Vec3 } from '../net/Protocol';
import type { Box } from './CollisionWorld';

export interface LevelCollision {
  readonly levelId: string;
  readonly spawn: Vec3;
  readonly spawnYaw: number;
  readonly killPlaneY: number;
  readonly boxes: readonly Box[];
}

/** Supplies the raw JSON for a level id. Injected, so this stays portable. */
export type LevelFetcher = (levelId: string) => Promise<unknown>;

export class LevelStore {
  private readonly cache = new Map<string, LevelCollision>();

  constructor(private readonly fetcher: LevelFetcher) {}

  get cachedCount(): number { return this.cache.size; }

  /**
   * Load a level's collision, memoised.
   *
   * Caching matters on a backend: twenty rooms on the same map should parse
   * it once, not twenty times, and the data is immutable so sharing is safe.
   */
  async load(levelId: string): Promise<LevelCollision> {
    const cached = this.cache.get(levelId);
    if (cached) return cached;

    const raw = await this.fetcher(levelId);
    const parsed = this.validate(levelId, raw);
    this.cache.set(levelId, parsed);
    return parsed;
  }

  /** Already-loaded levels only; null if it has not been fetched yet. */
  peek(levelId: string): LevelCollision | null {
    return this.cache.get(levelId) ?? null;
  }

  clear(): void { this.cache.clear(); }

  /**
   * Validate rather than trust. This data is loaded over the network in the
   * browser, and a malformed file should fail loudly at load with a usable
   * message rather than as NaN positions three systems later.
   */
  private validate(levelId: string, raw: unknown): LevelCollision {
    const data = raw as Partial<LevelCollision> & { boxes?: unknown };
    if (!data || typeof data !== 'object') {
      throw new Error(`level "${levelId}": collision data is not an object`);
    }
    if (!Array.isArray(data.boxes)) {
      throw new Error(`level "${levelId}": collision data has no boxes array`);
    }
    const boxes: Box[] = [];
    for (const entry of data.boxes as Box[]) {
      const numbers = [entry.minX, entry.minY, entry.minZ, entry.maxX, entry.maxY, entry.maxZ];
      if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
        throw new Error(`level "${levelId}": a collision box has non-finite bounds`);
      }
      // An inverted box silently swallows raycasts, so normalise here.
      boxes.push({
        minX: Math.min(entry.minX, entry.maxX), maxX: Math.max(entry.minX, entry.maxX),
        minY: Math.min(entry.minY, entry.maxY), maxY: Math.max(entry.minY, entry.maxY),
        minZ: Math.min(entry.minZ, entry.maxZ), maxZ: Math.max(entry.minZ, entry.maxZ),
        surface: typeof entry.surface === 'string' ? entry.surface : 'concrete',
      });
    }
    const spawn = Array.isArray(data.spawn) && data.spawn.length === 3
      ? (data.spawn as unknown as Vec3)
      : ([0, 1, 0] as Vec3);

    return {
      levelId,
      spawn,
      spawnYaw: typeof data.spawnYaw === 'number' ? data.spawnYaw : 0,
      killPlaneY: typeof data.killPlaneY === 'number' ? data.killPlaneY : -25,
      boxes,
    };
  }
}

/** Browser: fetch the baked file over HTTP. */
export function httpLevelFetcher(baseUrl = '/assets/collision'): LevelFetcher {
  return async (levelId: string) => {
    const response = await fetch(`${baseUrl}/${levelId}.json`);
    if (!response.ok) throw new Error(`level "${levelId}": HTTP ${response.status}`);
    return response.json();
  };
}
