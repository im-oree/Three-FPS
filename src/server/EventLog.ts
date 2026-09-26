/**
 * EventLog.ts — the single sink for "something notable happened".
 *
 * The recording guarantee in this project rests on two chokepoints:
 *
 *   1. all health loss goes through `DamageSystem.apply()`
 *   2. all notable happenings go through `EventLog.record()`
 *
 * Because the recorder only archives whatever passes through those two, a
 * feature that has never heard of the replay system is still fully recorded,
 * provided it uses the standard APIs the architecture already requires.
 *
 * WHY `type` IS A STRING AND `payload` IS FREE-FORM
 * -------------------------------------------------
 * A closed enum would mean every new ability had to edit this file, and the
 * recorder would have to learn each new case. It does not parse `type` at
 * all -- it stores events verbatim. A capability added a year from now that
 * records `{ type: 'emp_pulse' }` is archived and replayable without one line
 * changing here. That is the whole point, and it is why the temptation to
 * tighten these types must be resisted.
 *
 * This lives on the server and is renderer-free: `verify:purity` covers it.
 */
import type { PlayerId, EntityId, Vec3 } from '../net/Protocol';

/** Anything that can be a party to an event. */
export type ActorId = PlayerId | EntityId;

export interface GameEvent<TPayload = Record<string, unknown>> {
  /** Open-ended on purpose. See the note above. */
  readonly type: string;
  readonly tick: number;
  /** Server time in seconds, so a replay can seek without a tick rate. */
  readonly time: number;
  readonly at?: Vec3;
  /** Every entity involved: instigator, victim, projectile, vehicle... */
  readonly actors?: readonly ActorId[];
  readonly payload: TPayload;
}

/** How many events to keep. A 10-minute match produces a few thousand. */
const MAX_EVENTS = 20000;

export class EventLog {
  private events: GameEvent[] = [];
  private readonly listeners = new Set<(event: GameEvent) => void>();
  /** Dropped because the cap was hit, so a test can prove it never happens. */
  private dropped = 0;

  /**
   * Record one event and fan it out.
   *
   * Listeners are called synchronously: the killcam trigger needs to see a
   * death on the tick it happens, not a frame later, and the recorder must
   * archive it before the next snapshot overwrites the state it describes.
   */
  record<T>(event: GameEvent<T>): void {
    if (this.events.length >= MAX_EVENTS) {
      // Drop the OLDEST. A match that somehow overruns the cap should keep
      // its recent history, which is what a killcam reads.
      this.events.shift();
      this.dropped += 1;
    }
    this.events.push(event as GameEvent);
    for (const listener of this.listeners) listener(event as GameEvent);
  }

  /** Subscribe. Returns an unsubscribe, so a disposed system detaches. */
  onRecord(handler: (event: GameEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /** Everything in a tick window, in order. The killcam's read path. */
  slice(fromTick: number, toTick: number): GameEvent[] {
    return this.events.filter((e) => e.tick >= fromTick && e.tick <= toTick);
  }

  /** Every event of one type. Used by the timeline's marker strip. */
  ofType(type: string): GameEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  get all(): readonly GameEvent[] { return this.events; }
  get count(): number { return this.events.length; }
  get droppedCount(): number { return this.dropped; }

  /** A new match starts with no history. */
  reset(): void {
    this.events = [];
    this.dropped = 0;
  }
}
