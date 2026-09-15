/**
 * AssetParserPool.ts — main-thread handle on the JSON parsing worker.
 *
 * One worker is enough: the payloads are fetched sequentially during a level
 * build anyway, and spawning several would trade a real saving for scheduler
 * noise. The pool exists mainly so callers get a promise-shaped API instead
 * of wiring message handlers at every call site.
 *
 * GRACEFUL DEGRADATION IS DELIBERATE
 * ----------------------------------
 * If Workers are unavailable (an old browser, a restrictive embedding, a
 * test harness), every method falls back to fetching on the main thread. The
 * result is identical, just less smooth -- which is the right failure mode
 * for something whose entire purpose is smoothness.
 */
import type { ParseRequest, ParseResponse } from '../workers/assetParser.worker';

export interface TerrainData {
  width: number;
  depth: number;
  nrows: number;
  ncols: number;
  scale: { x: number; y: number; z: number };
  heights: Float32Array;
}

type Pending = {
  resolve: (value: ParseResponse) => void;
  reject: (reason: Error) => void;
};

export class AssetParserPool {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private failed = false;

  private ensureWorker(): Worker | null {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(
        new URL('../workers/assetParser.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (event: MessageEvent<ParseResponse>) => {
        const entry = this.pending.get(event.data.id);
        if (!entry) return;
        this.pending.delete(event.data.id);
        entry.resolve(event.data);
      };
      this.worker.onerror = () => {
        // One hard failure disables the worker path for the session rather
        // than retrying per asset and stalling each time.
        this.failed = true;
        for (const [, entry] of this.pending) {
          entry.reject(new Error('asset parser worker failed'));
        }
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
      return this.worker;
    } catch {
      this.failed = true;
      return null;
    }
  }

  private request(url: string, kind: ParseRequest['kind']): Promise<ParseResponse> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.reject(new Error('no worker'));
    const id = this.nextId += 1;
    return new Promise<ParseResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, url, kind } satisfies ParseRequest);
    });
  }

  /** Fetch + parse + validate a terrain heightfield. */
  async loadTerrain(url: string): Promise<TerrainData> {
    try {
      const response = await this.request(url, 'terrain');
      if (!response.ok) throw new Error(response.error);
      if (response.kind !== 'terrain') throw new Error('wrong response kind');
      return response;
    } catch {
      // Main-thread fallback: same result, just blocking.
      const data = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
        return r.json();
      });
      const expected = (data.nrows + 1) * (data.ncols + 1);
      if (data.heights.length !== expected) {
        throw new Error(
          `terrain heightfield size mismatch: got ${data.heights.length}, `
          + `expected ${expected}`,
        );
      }
      return { ...data, heights: new Float32Array(data.heights) };
    }
  }

  /** Fetch + parse any JSON off-thread. */
  async loadJson<T>(url: string): Promise<T> {
    try {
      const response = await this.request(url, 'json');
      if (!response.ok) throw new Error(response.error);
      if (response.kind !== 'json') throw new Error('wrong response kind');
      return response.data as T;
    } catch {
      return fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
        return r.json() as Promise<T>;
      });
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export const assetParserPool = new AssetParserPool();
export default assetParserPool;
