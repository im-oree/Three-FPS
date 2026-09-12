/**
 * EventBus.ts — minimal, dependency-free pub/sub singleton.
 *
 * Every module that does `import eventBus from '.../EventBus'` shares the exact
 * same instance. This is the decoupling seam future documents (AI, network,
 * UI, audio) plug into without touching core files.
 *
 * RESERVED EVENT NAME CONVENTION (append-only; never redefine):
 *   'assets:progress'             -> { loaded: number, total: number }
 *   'input:pointerlock:acquired'  -> (no payload)
 *   'input:pointerlock:lost'      -> (no payload)
 *   'game:stateChanged'           -> { previous: GameState, current: GameState }
 * Future documents add their own names here as they introduce them.
 */

export type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler<never>>>();

  /** Register `handler` for `eventName`. Returns an unsubscribe function. */
  on<T = unknown>(eventName: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(eventName);
    if (!set) {
      set = new Set();
      this.handlers.set(eventName, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(eventName, handler);
  }

  /** Remove a specific handler previously registered with `on`. */
  off<T = unknown>(eventName: string, handler: EventHandler<T>): void {
    this.handlers.get(eventName)?.delete(handler as EventHandler<never>);
  }

  /**
   * Synchronously invoke every handler for `eventName` with `payload`.
   * No listeners is fine; a throwing listener is isolated (logged, not fatal)
   * so one broken subscriber can never take down unrelated systems.
   */
  emit<T = unknown>(eventName: string, payload?: T): void {
    const set = this.handlers.get(eventName);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<T>)(payload as T);
      } catch (err) {
        console.error(`[EventBus] handler for "${eventName}" threw:`, err);
      }
    }
  }
}

/** The one shared bus for the whole application. */
const eventBus = new EventBus();
export default eventBus;
