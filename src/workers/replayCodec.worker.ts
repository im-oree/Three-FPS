/**
 * replayCodec.worker.ts — encode and compress recordings off the main thread.
 *
 * WHY THIS IS NOT ON THE MAIN THREAD
 * ----------------------------------
 * Encoding a full session is tens of megabytes of work and deflate is worse.
 * Doing either between frames would drop them, and the moment you are most
 * likely to save a clip is right after something exciting happened, which is
 * exactly when the game is busiest. A hitch there is the difference between
 * "saved the clip" and "the game stuttered when I saved the clip".
 *
 * Output is returned as a transferable ArrayBuffer, so handing back a
 * megabyte costs a pointer move rather than a copy.
 *
 * NO pako DEPENDENCY
 * ------------------
 * The spec suggested pako, but every browser this ships to already has
 * DEFLATE built in via CompressionStream, which is native code rather than
 * a few hundred kilobytes of JavaScript we would have to download, parse and
 * keep updated. Where it is missing the codec returns the uncompressed
 * bytes and says so, because a slightly larger replay is a much better
 * outcome than no replay.
 */
import { encodeClip, decodeClip } from '../replay/BinaryFormat';
import type { RecordedFrame } from '../server/ReplayRecorder';

interface EncodeRequest {
  readonly id: number;
  readonly op: 'encode';
  readonly frames: readonly RecordedFrame[];
  readonly compress: boolean;
}

interface DecodeRequest {
  readonly id: number;
  readonly op: 'decode';
  readonly bytes: ArrayBuffer;
  readonly compressed: boolean;
}

type CodecRequest = EncodeRequest | DecodeRequest;

export interface CodecResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly error?: string;
  /** Encoded bytes, for an encode. */
  readonly bytes?: ArrayBuffer;
  /** Whether `bytes` actually came back compressed. */
  readonly compressed?: boolean;
  /** Decoded frames, for a decode. */
  readonly frames?: readonly RecordedFrame[];
  /** Bytes before compression, so a caller can report a ratio. */
  readonly rawBytes?: number;
}

/** Native DEFLATE, when the browser has it. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> {
  const Ctor = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!Ctor) return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new Ctor('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> {
  const Ctor = (globalThis as {
    DecompressionStream?: typeof DecompressionStream;
  }).DecompressionStream;
  if (!Ctor) return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new Ctor('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

self.onmessage = async (event: MessageEvent<CodecRequest>) => {
  const request = event.data;
  try {
    if (request.op === 'encode') {
      const raw = encodeClip(request.frames);
      let out: Uint8Array = raw;
      let compressed = false;
      if (request.compress) {
        const packed = await deflate(raw);
        if (packed) { out = packed; compressed = true; }
      }
      // Copy into a plain ArrayBuffer: the source may be backed by a
      // SharedArrayBuffer, which is not transferable.
      const buffer = new ArrayBuffer(out.byteLength);
      new Uint8Array(buffer).set(out);
      const response: CodecResponse = {
        id: request.id, ok: true, bytes: buffer, compressed, rawBytes: raw.byteLength,
      };
      (self as unknown as Worker).postMessage(response, [buffer]);
      return;
    }

    let bytes: Uint8Array = new Uint8Array(request.bytes);
    if (request.compressed) {
      const plain = await inflate(bytes);
      if (!plain) throw new Error('this browser cannot decompress replays');
      bytes = plain;
    }
    const decoded = decodeClip(bytes);
    const response: CodecResponse = { id: request.id, ok: true, frames: decoded.frames };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    const response: CodecResponse = {
      id: request.id, ok: false, error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
