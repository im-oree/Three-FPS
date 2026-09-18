/**
 * ReplayRecorder.ts — keep the bytes we already made.
 *
 * There is no "recording code" here in any meaningful sense. The server
 * already builds a snapshot of the world every tick to send to clients; the
 * recorder is a second destination for that same object, not a second
 * encoding pass. That is why this costs essentially nothing: the expensive
 * part (deciding what changed and packing it) has already happened.
 *
 * ONE BUFFER, TWO JOBS
 * --------------------
 * A rolling window in memory serves the instant killcam: when you die, the
 * last N seconds are already in RAM, so the cam starts on the same frame with
 * no network round trip and no disk read. The same buffer is the front of a
 * full-session recording -- entries are handed to a sink as they age out
 * rather than being dropped -- so there is no separate "session recorder"
 * with its own bugs.
 *
 * Playback does no simulation: it is decode and interpolate, which is
 * cheaper than live play. A dead player watching a killcam is not running a
 * second physics world.
 */
import type { Snapshot, PlayerPublicState } from '../net/Protocol';
import type { GameEvent } from './EventLog';

export interface RecordedFrame {
  readonly tick: number;
  readonly time: number;
  readonly snapshot: Snapshot;
  /**
   * Where every player was, this tick.
   *
   * Recorded separately because players are NOT entities in this server:
   * they travel to clients as their own `playerStates` message. A frame that
   * stored only `snapshot.entities` would replay an empty map with the
   * grenades and vehicles moving through it -- which is exactly what a
   * killcam must not be, since the players are the whole subject.
   */
  readonly players: readonly PlayerPublicState[];
}

/** Where frames go when they age out of the live window. */
export type FlushSink = (frames: readonly RecordedFrame[]) => void;

export interface RecorderOptions {
  /** Seconds to keep instantly available. COD's killcam needs ~10. */
  readonly windowSeconds?: number;
  readonly tickHz?: number;
  /**
   * Called with frames leaving the window. Omit and they are simply dropped,
   * which is the right behaviour for a client that only wants killcams.
   */
  readonly onFlush?: FlushSink;
}

export class ReplayRecorder {
  private frames: RecordedFrame[] = [];
  private readonly windowTicks: number;
  private readonly onFlush: FlushSink | null;
  /** Frames handed to the sink, so a test can prove nothing vanished. */
  private flushed = 0;

  constructor(options: RecorderOptions = {}) {
    const windowSeconds = options.windowSeconds ?? 12;
    const tickHz = options.tickHz ?? 60;
    this.windowTicks = Math.max(1, Math.round(windowSeconds * tickHz));
    this.onFlush = options.onFlush ?? null;
  }

  /**
   * Archive one tick.
   *
   * Takes the snapshot the server just built. Deliberately stores it by
   * reference: the server treats snapshots as immutable once broadcast, so
   * copying would be pure waste at 60 Hz.
   */
  append(frame: RecordedFrame): void {
    this.frames.push(frame);
    this.trim();
  }

  private trim(): void {
    const newest = this.frames[this.frames.length - 1];
    if (!newest) return;
    const cutoff = newest.tick - this.windowTicks;
    let evictedTo = 0;
    while (evictedTo < this.frames.length && this.frames[evictedTo].tick < cutoff) {
      evictedTo += 1;
    }
    if (evictedTo === 0) return;
    const evicted = this.frames.splice(0, evictedTo);
    this.flushed += evicted.length;
    // Hand them on BEFORE they are gone, so a full-session recording is
    // continuous rather than missing whatever the window dropped.
    this.onFlush?.(evicted);
  }

  /**
   * The frames a killcam needs, straight out of memory.
   *
   * Clamped to what is actually held: a kill in the first second of a match
   * has less lead-in than asked for, and that must produce a short clip
   * rather than an error.
   */
  window(fromTick: number, toTick: number): RecordedFrame[] {
    return this.frames.filter((f) => f.tick >= fromTick && f.tick <= toTick);
  }

  get frameCount(): number { return this.frames.length; }
  get flushedCount(): number { return this.flushed; }
  get oldestTick(): number { return this.frames[0]?.tick ?? -1; }
  get newestTick(): number { return this.frames[this.frames.length - 1]?.tick ?? -1; }

  reset(): void {
    this.frames = [];
    this.flushed = 0;
  }
}

/**
 * A killcam clip: the frames to play, and the events that occurred in them.
 *
 * Both halves are needed. The frames say where everything was; the events say
 * what it meant, which is how the clip can show a hit marker at the right
 * moment without the renderer re-deriving it.
 */
export interface KillcamClip {
  readonly frames: readonly RecordedFrame[];
  readonly events: readonly GameEvent[];
  readonly fromTick: number;
  readonly toTick: number;
}
