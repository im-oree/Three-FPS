/**
 * LocalTransport.ts — an in-process socket.
 *
 * Creates a linked client/server pair that pass messages directly to each
 * other's handlers. No serialisation, no latency, no network — but the exact
 * same interface a WebSocket implements, so nothing above it can tell which
 * one it is holding.
 *
 * WHY MESSAGES ARE FROZEN AND DELIVERED ASYNCHRONOUSLY
 * ----------------------------------------------------
 * Two deliberate constraints make local play behave like the networked case
 * instead of quietly depending on being local:
 *
 *   1. Every message is deep-frozen. Over a real socket the receiver gets a
 *      fresh parsed object and mutating it is harmless; in-process, the
 *      sender and receiver would share one object, so a receiver that mutates
 *      an incoming message would corrupt the sender's state. That bug cannot
 *      exist over a wire, so it must not be possible here either — it would
 *      appear only after the backend was plugged in, which is the worst
 *      possible time to find it.
 *
 *   2. Delivery is queued to a microtask, never synchronous. A synchronous
 *      call would let the server reenter the client mid-update (client sends
 *      input -> server ticks -> server sends snapshot -> client applies it,
 *      all inside one client function). Real sockets always deliver on a
 *      later turn of the event loop; matching that here means the ordering
 *      assumptions the code builds up are the ones that will hold in
 *      production.
 *
 * `simulatedLatencyMs` exists so local play can be tested under realistic
 * delay without a backend — the single best way to find code that assumes an
 * instant reply.
 */
import type { Transport } from './Protocol';

interface Pending<T> {
  message: T;
  deliverAt: number;
}

/**
 * Recursively freeze a message so the receiver cannot mutate the sender's
 * object. Cheap: these are small, shallow, JSON-shaped values.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

class LocalEndpoint<TOut, TIn> implements Transport<TOut, TIn> {
  /** Set by LocalTransportPair once both ends exist. */
  peer: LocalEndpoint<TIn, TOut> | null = null;

  private readonly handlers = new Set<(message: TIn) => void>();
  private readonly queue: Pending<TIn>[] = [];
  private readonly closeHandlers = new Set<(reason: string) => void>();
  private open = false;
  private flushScheduled = false;

  constructor(private readonly latencyMs: number) {}

  get connected(): boolean { return this.open; }
  get rttMs(): number { return this.latencyMs * 2; }

  connect(): Promise<void> {
    this.open = true;
    return Promise.resolve();
  }

  close(): void {
    this.closeWith('closed by peer', true);
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  /**
   * Closing one end of a real socket delivers a close event to the other.
   * Imitating that here is what lets the server notice a client going away
   * without the client politely announcing it first.
   */
  private closeWith(reason: string, propagate: boolean): void {
    if (!this.open) return;
    // Deliver what is already queued FIRST. A graceful socket close flushes
    // buffered data before the peer sees the close, so a final message such
    // as 'matchEnded' must not be dropped on the way out.
    this.drainQueue();
    this.open = false;
    this.queue.length = 0;
    const peer = this.peer;
    for (const handler of this.closeHandlers) handler(reason);
    this.closeHandlers.clear();
    this.handlers.clear();
    if (propagate && peer) peer.closeWith('closed by peer', false);
  }

  send(message: TOut): void {
    if (!this.open || !this.peer) return;
    // The peer's INBOUND type is this endpoint's OUTBOUND type by
    // construction (see createLocalTransportPair), which the compiler cannot
    // see through the two independent type parameters.
    this.peer.deliver(deepFreeze(message));
  }

  onMessage(handler: (message: TIn) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Called by the peer's send(). Public to the pair, not to callers. */
  deliver(message: TIn): void {
    if (!this.open) return;
    this.queue.push({
      message,
      deliverAt: this.latencyMs > 0 ? performance.now() + this.latencyMs : 0,
    });
    this.scheduleFlush();
  }

  /**
   * Deliver every queued message immediately, ignoring simulated latency.
   * Used only on a graceful close, where a real socket would flush.
   */
  private drainQueue(): void {
    while (this.queue.length) {
      const next = this.queue.shift();
      if (!next) break;
      for (const handler of [...this.handlers]) handler(next.message);
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    if (this.latencyMs > 0) {
      setTimeout(() => { this.flushScheduled = false; this.flush(); }, this.latencyMs);
    } else {
      // Microtask, not synchronous: see the note at the top of the file.
      queueMicrotask(() => { this.flushScheduled = false; this.flush(); });
    }
  }

  private flush(): void {
    if (!this.open) return;
    const now = performance.now();
    while (this.queue.length) {
      const next = this.queue[0];
      if (next.deliverAt > now) break;
      this.queue.shift();
      for (const handler of this.handlers) handler(next.message);
    }
    if (this.queue.length) this.scheduleFlush();
  }
}

/**
 * Build a connected client/server transport pair.
 *
 * @param simulatedLatencyMs One-way delay. 0 for production local play;
 *   set it in tests to prove nothing assumes an instant reply.
 */
export function createLocalTransportPair<TClientOut, TServerOut>(
  simulatedLatencyMs = 0,
): {
    client: Transport<TClientOut, TServerOut>;
    server: Transport<TServerOut, TClientOut>;
  } {
  const client = new LocalEndpoint<TClientOut, TServerOut>(simulatedLatencyMs);
  const server = new LocalEndpoint<TServerOut, TClientOut>(simulatedLatencyMs);
  client.peer = server;
  server.peer = client;
  return { client, server };
}
