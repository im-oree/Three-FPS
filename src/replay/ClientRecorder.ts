/**
 * ClientRecorder.ts — record what this client was actually sent.
 *
 * WHY THE CLIENT RECORDS AT ALL
 * -----------------------------
 * A killcam has to work in a real multiplayer match, where `session.server`
 * is null because the server is somebody else's machine. If killcams only
 * came from the in-process server they would work in single player and
 * silently vanish online, which is precisely backwards.
 *
 * So the client keeps its own rolling window of what it received. This is
 * also the honest thing to show: it replays the match as this player
 * experienced it, latency and all, rather than a server-side truth they
 * never saw. When a clip and the server's own recording disagree, the
 * difference IS the network error, which is a thing worth being able to
 * measure rather than hide.
 *
 * COST
 * ----
 * None worth naming. The snapshot object already exists — it was just
 * decoded to drive the renderer — and the recorder keeps a reference to it
 * instead of a copy. The only allocation is the small wrapper per tick, and
 * the window is bounded, so memory is flat after the first few seconds.
 *
 * STITCHING TWO MESSAGES INTO ONE FRAME
 * -------------------------------------
 * Player states arrive in a SEPARATE message from entity snapshots, and the
 * server sends the snapshot FIRST. So a recorder that committed a frame the
 * moment a snapshot landed would pair tick N's entities with tick N-1's
 * players -- every body one tick stale, and a player who died on tick N
 * recorded as still alive and still standing where they used to be. Measured
 * against the server's own recording that was a mean error of 0.38 m and a
 * worst case of 34 m, on a transport with no loss at all.
 *
 * So the snapshot is HELD and committed when its player states arrive. The
 * tick number still comes from the snapshot, because that is what everything
 * downstream indexes by.
 */
import type { PlayerPublicState, Snapshot } from '../net/Protocol';
import type { GameEvent } from '../server/EventLog';
import { EventLog } from '../server/EventLog';
import { ReplayRecorder, type KillcamClip } from '../server/ReplayRecorder';

export interface ClientRecorderOptions {
  /** Seconds of instantly-available history. */
  readonly windowSeconds?: number;
  readonly tickHz?: number;
}

export class ClientRecorder {
  readonly recorder: ReplayRecorder;
  /**
   * Events this client can see happening.
   *
   * Reuses the server's EventLog class rather than defining a parallel one:
   * a killcam built from client events and one built from server events must
   * be the same code path, or they will drift.
   */
  readonly events = new EventLog();

  /** Snapshot waiting for the player states of the same tick. */
  private pending: Snapshot | null = null;
  private readonly tickHz: number;

  constructor(options: ClientRecorderOptions = {}) {
    this.tickHz = options.tickHz ?? 60;
    this.recorder = new ReplayRecorder({
      windowSeconds: options.windowSeconds ?? 12,
      tickHz: this.tickHz,
    });
  }

  /**
   * Player states arrived — they complete the snapshot already held, so this
   * is what actually commits a frame.
   *
   * Dropped silently if no snapshot is waiting: a `playerStates` with no
   * snapshot to pin it to has no tick, and a frame with a guessed tick is
   * worse than a missing one.
   */
  notePlayers(states: readonly PlayerPublicState[]): void {
    const snapshot = this.pending;
    if (!snapshot) return;
    this.pending = null;
    this.recorder.append({
      tick: snapshot.tick,
      time: snapshot.time,
      snapshot,
      players: states,
    });
  }

  /** A snapshot arrived: hold it until its player states land. */
  noteSnapshot(snapshot: Snapshot): void {
    this.pending = snapshot;
  }

  /** Record something worth putting on a timeline. */
  record<T>(event: GameEvent<T>): void {
    this.events.record(event);
  }

  /**
   * Build a killcam clip around a tick.
   *
   * Deliberately mirrors `GameServer.buildKillcam` in shape so the playback
   * UI is identical whether the frames came from this tab's recorder or from
   * an authoritative server recording.
   */
  clipAround(tick: number, leadSeconds: number, trailSeconds: number): KillcamClip | null {
    const from = Math.round(tick - leadSeconds * this.tickHz);
    const to = Math.round(tick + trailSeconds * this.tickHz);
    const frames = this.recorder.window(from, to);
    if (!frames.length) return null;
    return {
      frames,
      events: this.events.slice(from, to),
      fromTick: frames[0].tick,
      toTick: frames[frames.length - 1].tick,
    };
  }

  get frameCount(): number { return this.recorder.frameCount; }
  get newestTick(): number { return this.recorder.newestTick; }

  reset(): void {
    this.recorder.reset();
    this.events.reset();
    this.pending = null;
  }
}

export default ClientRecorder;
