/**
 * WebSocketTransport.ts — the same seam, over a real socket.
 *
 * This exists now, before there is a backend to talk to, on purpose. It is
 * the proof that Transport is actually implementable over a wire: if the
 * interface had accidentally grown something socket-hostile (a synchronous
 * return value, a shared object reference, a function in a payload), this
 * file would not compile. Writing it later, after the game had been built
 * against the in-process version, is how projects discover their "network
 * ready" abstraction is nothing of the sort.
 *
 * Point it at a Node server on Render/Railway/Fly and single-player becomes
 * multiplayer with no gameplay changes:
 *
 *   const transport = new WebSocketTransport('wss://my-app.onrender.com/game');
 *   const client = new GameClient(transport);
 */
import type { Transport } from './Protocol';

export interface WebSocketTransportOptions {
  /** Attempt to reconnect on an unclean close. */
  readonly autoReconnect?: boolean;
  /** Base delay between reconnect attempts; grows exponentially. */
  readonly reconnectBaseMs?: number;
  readonly maxReconnectMs?: number;
  /** Ping cadence for the RTT estimate. 0 disables. */
  readonly pingIntervalMs?: number;
}

export class WebSocketTransport<TOut, TIn> implements Transport<TOut, TIn> {
  private socket: WebSocket | null = null;
  private readonly handlers = new Set<(message: TIn) => void>();
  private readonly closeHandlers = new Set<(reason: string) => void>();
  private readonly opts: Required<WebSocketTransportOptions>;
  private reconnectAttempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPingAt = 0;
  private rtt = 0;
  private closedByUs = false;
  /**
   * Messages sent before the socket opened. Without this, anything sent
   * during the connect handshake is silently dropped -- which in practice
   * means the very first 'hello' disappears and the session never starts.
   */
  private readonly outbox: TOut[] = [];

  constructor(
    private readonly url: string,
    options: WebSocketTransportOptions = {},
  ) {
    this.opts = {
      autoReconnect: options.autoReconnect ?? true,
      reconnectBaseMs: options.reconnectBaseMs ?? 500,
      maxReconnectMs: options.maxReconnectMs ?? 10000,
      pingIntervalMs: options.pingIntervalMs ?? 2000,
    };
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get rttMs(): number { return this.rtt; }

  connect(): Promise<void> {
    this.closedByUs = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.reconnectAttempt = 0;
        // Drain anything queued during the handshake, in order.
        while (this.outbox.length) {
          const pending = this.outbox.shift() as TOut;
          socket.send(JSON.stringify(pending));
        }
        this.startPing();
        if (!settled) { settled = true; resolve(); }
      });

      socket.addEventListener('message', (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          // A malformed frame must not kill the session.
          return;
        }
        // Transport-level pong, never surfaced to the game.
        if ((parsed as { t?: string })?.t === '__pong') {
          this.rtt = performance.now() - this.lastPingAt;
          return;
        }
        for (const handler of this.handlers) handler(parsed as TIn);
      });

      socket.addEventListener('close', () => {
        this.stopPing();
        if (!settled) { settled = true; reject(new Error('socket closed during connect')); }
        // Announce the drop before deciding whether to retry: a server-side
        // user of this transport needs to free the slot either way.
        this.emitClose(this.closedByUs ? 'closed locally' : 'connection lost');
        if (!this.closedByUs && this.opts.autoReconnect) this.scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        // 'close' always follows 'error'; reconnect is handled there so the
        // two paths cannot both fire a reconnect.
        if (!settled) { settled = true; reject(new Error('socket error during connect')); }
      });
    });
  }

  close(): void {
    this.closedByUs = true;
    this.stopPing();
    const hadSocket = this.socket !== null;
    this.socket?.close();
    this.socket = null;
    this.handlers.clear();
    this.outbox.length = 0;
    // If there was no live socket the 'close' event will never arrive, so
    // report it here rather than leaving listeners waiting on a dead link.
    if (!hadSocket) this.emitClose('closed locally');
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  private emitClose(reason: string): void {
    for (const handler of [...this.closeHandlers]) handler(reason);
    if (this.closedByUs) this.closeHandlers.clear();
  }

  send(message: TOut): void {
    if (this.connected) this.socket?.send(JSON.stringify(message));
    else this.outbox.push(message);
  }

  onMessage(handler: (message: TIn) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private startPing(): void {
    if (this.opts.pingIntervalMs <= 0) return;
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.connected) return;
      this.lastPingAt = performance.now();
      this.socket?.send(JSON.stringify({ t: '__ping' }));
    }, this.opts.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      this.opts.maxReconnectMs,
      this.opts.reconnectBaseMs * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    setTimeout(() => {
      if (this.closedByUs) return;
      void this.connect().catch(() => { /* the close handler retries */ });
    }, delay);
  }
}
