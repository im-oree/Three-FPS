/**
 * ReplayCodec.ts — the main thread's handle on the codec worker.
 *
 * Mirrors AssetParserPool deliberately: one worker, requests keyed by id, and
 * a hard failure disables the worker path for the session rather than
 * retrying per call and stalling each time.
 *
 * FALLING BACK IS NOT OPTIONAL
 * ----------------------------
 * Workers can fail to start for reasons that have nothing to do with this
 * code -- a strict CSP, a sandboxed iframe, a browser with the feature
 * switched off. When that happens the encode runs inline. A replay saved on
 * the main thread with a small hitch is a far better outcome than a Save
 * Clip button that silently does nothing, so the fallback is a first-class
 * path rather than an afterthought.
 */
import { encodeClip, decodeClip } from './BinaryFormat';
import type { RecordedFrame } from '../server/ReplayRecorder';
import type { CodecResponse } from '../workers/replayCodec.worker';

interface Pending {
  resolve: (value: CodecResponse) => void;
  reject: (error: Error) => void;
}

export interface EncodedReplay {
  readonly bytes: Uint8Array;
  readonly compressed: boolean;
  /** Size before compression, so callers can report a ratio honestly. */
  readonly rawBytes: number;
  /** True when the work ran on the main thread because no worker was available. */
  readonly inline: boolean;
}

export class ReplayCodec {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private failed = false;

  private ensureWorker(): Worker | null {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(
        new URL('../workers/replayCodec.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (event: MessageEvent<CodecResponse>) => {
        const entry = this.pending.get(event.data.id);
        if (!entry) return;
        this.pending.delete(event.data.id);
        entry.resolve(event.data);
      };
      this.worker.onerror = () => {
        this.failed = true;
        for (const [, entry] of this.pending) {
          entry.reject(new Error('replay codec worker failed'));
        }
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.failed = true;
      this.worker = null;
    }
    return this.worker;
  }

  /** Pack frames for storage. Never throws: it falls back to the main thread. */
  async encode(
    frames: readonly RecordedFrame[], compress = true,
  ): Promise<EncodedReplay> {
    const worker = this.ensureWorker();
    if (worker) {
      try {
        const response = await this.send(worker, {
          id: this.nextId++, op: 'encode', frames, compress,
        });
        if (response.ok && response.bytes) {
          return {
            bytes: new Uint8Array(response.bytes),
            compressed: response.compressed ?? false,
            rawBytes: response.rawBytes ?? response.bytes.byteLength,
            inline: false,
          };
        }
      } catch {
        // Fall through to the inline path below.
      }
    }
    const raw = encodeClip(frames);
    return { bytes: raw, compressed: false, rawBytes: raw.byteLength, inline: true };
  }

  /** Unpack a stored replay. */
  async decode(bytes: Uint8Array, compressed: boolean): Promise<readonly RecordedFrame[]> {
    const worker = this.ensureWorker();
    if (worker) {
      try {
        const copy = bytes.slice();
        const response = await this.send(worker, {
          id: this.nextId++, op: 'decode', bytes: copy.buffer, compressed,
        }, [copy.buffer]);
        if (response.ok && response.frames) return response.frames;
        if (response.error) throw new Error(response.error);
      } catch (error) {
        if (compressed) throw error instanceof Error ? error : new Error(String(error));
      }
    }
    // Uncompressed data can always be read inline; compressed cannot without
    // the platform's decompressor, and pretending otherwise would hand back
    // garbage frames rather than an error.
    if (compressed) throw new Error('cannot decompress a replay without a worker');
    return decodeClip(bytes).frames;
  }

  private send(
    worker: Worker, message: unknown, transfer: Transferable[] = [],
  ): Promise<CodecResponse> {
    const id = (message as { id: number }).id;
    return new Promise<CodecResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(message, transfer);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export default ReplayCodec;
