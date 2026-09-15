/**
 * assetParser.worker.ts — JSON fetching and parsing off the main thread.
 *
 * WHY
 * ---
 * Deploying a level fetches and parses several sizeable JSON payloads: the
 * terrain heightfield (up to ~120 KB, ~16k floats), the prop manifest (~90 KB)
 * and the callout zones. `JSON.parse` is synchronous and blocking, so doing
 * this on the main thread freezes the UI -- which is precisely when the
 * loading screen is trying to animate and report progress. A frozen loading
 * bar during the slowest part of loading is the worst possible time to stall.
 *
 * WHAT IT DOES *NOT* DO
 * ---------------------
 * It does not touch Rapier or three.js. Physics bodies and GPU resources can
 * only be created on the main thread, so the worker's job ends at "here is a
 * validated, typed array". Moving the parse is worth it; pretending the whole
 * build can move is not.
 *
 * Heights come back as a transferable Float32Array, so the payload is moved
 * rather than copied -- a structured clone of 16k numbers would hand back a
 * good chunk of what the worker just saved.
 */

export interface ParseRequest {
  id: number;
  url: string;
  kind: 'terrain' | 'json';
}

export interface TerrainResult {
  id: number;
  ok: true;
  kind: 'terrain';
  width: number;
  depth: number;
  nrows: number;
  ncols: number;
  scale: { x: number; y: number; z: number };
  heights: Float32Array;
}

export interface JsonResult {
  id: number;
  ok: true;
  kind: 'json';
  data: unknown;
}

export interface ErrorResult {
  id: number;
  ok: false;
  error: string;
}

export type ParseResponse = TerrainResult | JsonResult | ErrorResult;

self.onmessage = async (event: MessageEvent<ParseRequest>): Promise<void> => {
  const { id, url, kind } = event.data;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    const data = await response.json();

    if (kind === 'terrain') {
      const expected = (data.nrows + 1) * (data.ncols + 1);
      if (!Array.isArray(data.heights) || data.heights.length !== expected) {
        throw new Error(
          `terrain heightfield size mismatch: got ${data.heights?.length}, `
          + `expected ${expected} for ${data.nrows}x${data.ncols}`,
        );
      }
      // Convert here too: Rapier wants a Float32Array, and building it in the
      // worker means the main thread never walks the 16k-element array.
      const heights = new Float32Array(data.heights);
      const message: TerrainResult = {
        id, ok: true, kind: 'terrain',
        width: data.width, depth: data.depth,
        nrows: data.nrows, ncols: data.ncols,
        scale: data.scale, heights,
      };
      // Transfer the buffer instead of cloning it.
      (self as unknown as Worker).postMessage(message, [heights.buffer]);
      return;
    }

    const message: JsonResult = { id, ok: true, kind: 'json', data };
    (self as unknown as Worker).postMessage(message);
  } catch (error) {
    const message: ErrorResult = {
      id, ok: false, error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(message);
  }
};
