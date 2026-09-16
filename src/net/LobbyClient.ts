/**
 * LobbyClient.ts — the browser's half of the server browser.
 *
 * Owns exactly one socket to the signalling backend and does three things
 * with it: list games, advertise a game this tab is hosting, and carry
 * SDP/ICE to a peer. It never touches game state -- once a peer connection
 * opens, gameplay flows through RtcTransport and this object is idle.
 *
 * Kept free of three.js and DOM so it passes the server-purity check and can
 * be exercised headlessly by the acceptance suite.
 */
import type {
  GameListing, LobbyC2S, LobbyS2C, PeerId,
} from './LobbyProtocol';
import { HEARTBEAT_SECONDS } from './LobbyProtocol';
import type { SignalChannel, SignalMessage } from './RtcTransport';

export interface LobbyEvents {
  /** The list refreshed — redraw the browser. */
  onGames?(games: readonly GameListing[]): void;
  /** A guest wants into the game this tab is hosting. */
  onGuestArrived?(peerId: PeerId): void;
  /** Our join request was accepted; signalling may begin with the host. */
  onJoinAccepted?(gameId: string, hostPeerId: PeerId): void;
  onJoinRejected?(reason: string): void;
  onPeerGone?(peerId: PeerId): void;
  onClosed?(reason: string): void;
}

export class LobbyClient {
  private socket: WebSocket | null = null;
  private peerId: PeerId | null = null;
  private hostedGameId: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly outbox: LobbyC2S[] = [];
  /** Per-peer signalling listeners, keyed by the peer on the other end. */
  private readonly signalHandlers = new Map<PeerId, Set<(m: SignalMessage) => void>>();
  /** What to report in the next heartbeat. Set by the host's game loop. */
  private status = { playerCount: 1, inProgress: false };

  /**
   * Extra listeners added after construction.
   *
   * A join flow needs to hear onJoinAccepted, but the LobbyClient may have
   * been built earlier by the server browser. Rather than reconstructing it
   * (and dropping the socket), callers layer listeners on.
   */
  private readonly extra = new Set<LobbyEvents>();

  constructor(
    private readonly url: string,
    private readonly events: LobbyEvents = {},
  ) {}

  /** Add a listener set. Returns an unsubscribe function. */
  listen(events: LobbyEvents): () => void {
    this.extra.add(events);
    return () => this.extra.delete(events);
  }

  /** Fan an event out to the constructor's listener and any added later. */
  private emit<K extends keyof LobbyEvents>(
    key: K, ...args: Parameters<NonNullable<LobbyEvents[K]>>
  ): void {
    const call = (set: LobbyEvents) => {
      const fn = set[key] as ((...a: unknown[]) => void) | undefined;
      fn?.call(set, ...args);
    };
    call(this.events);
    for (const set of this.extra) call(set);
  }

  get id(): PeerId | null { return this.peerId; }
  get hosting(): string | null { return this.hostedGameId; }
  get connected(): boolean { return this.socket?.readyState === WebSocket.OPEN; }

  connect(): Promise<void> {
    if (this.socket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const failed = (reason: string) => {
        this.emit('onClosed', reason);
        reject(new Error(reason));
      };

      socket.addEventListener('open', () => {
        for (const message of this.outbox.splice(0, this.outbox.length)) {
          socket.send(JSON.stringify(message));
        }
      });
      socket.addEventListener('error', () => failed('lobby socket error'));
      socket.addEventListener('close', () => {
        this.stopHeartbeat();
        this.emit('onClosed', 'lobby socket closed');
      });
      socket.addEventListener('message', (event) => {
        let msg: LobbyS2C;
        try {
          msg = JSON.parse(String(event.data)) as LobbyS2C;
        } catch {
          return;
        }
        // The welcome carries our peer id and means the link is usable.
        if (msg.t === 'lobbyWelcome') {
          this.peerId = msg.peerId;
          resolve();
          return;
        }
        this.dispatch(msg);
      });
    });
  }

  private dispatch(msg: LobbyS2C): void {
    switch (msg.t) {
      case 'gameList':
        this.emit('onGames', msg.games);
        break;
      case 'hosting':
        this.hostedGameId = msg.gameId;
        break;
      case 'guestArrived':
        this.emit('onGuestArrived', msg.peerId);
        break;
      case 'joinAccepted':
        this.emit('onJoinAccepted', msg.gameId, msg.hostPeerId);
        break;
      case 'joinRejected':
        this.emit('onJoinRejected', msg.reason);
        break;
      case 'peerGone':
        this.emit('onPeerGone', msg.peerId);
        break;
      case 'signal': {
        const listeners = this.signalHandlers.get(msg.from);
        if (listeners) {
          for (const listener of listeners) listener(msg.payload as SignalMessage);
        }
        break;
      }
      default:
        break;
    }
  }

  private send(message: LobbyC2S): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.outbox.push(message);
    }
  }

  /** Advertise a game this tab is running. */
  host(options: {
    name: string; levelId: string; modeId: string;
    maxPlayers: number; password?: string;
  }): void {
    this.send({ t: 'hostGame', ...options });
    this.startHeartbeat();
  }

  /**
   * Keep the listing fresh.
   *
   * A listing that is not refreshed is dropped after 15 s, which is what
   * stops the browser filling with games whose host closed the tab. The
   * host's loop reports its real player count here.
   */
  setStatus(playerCount: number, inProgress: boolean): void {
    this.status = { playerCount, inProgress };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const beat = () => this.send({
      t: 'heartbeat',
      playerCount: this.status.playerCount,
      inProgress: this.status.inProgress,
    });
    beat();
    this.heartbeat = setInterval(beat, HEARTBEAT_SECONDS * 1000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }

  stopHosting(): void {
    this.stopHeartbeat();
    this.hostedGameId = null;
    this.send({ t: 'stopHosting' });
  }

  refresh(): void { this.send({ t: 'listGames' }); }

  join(gameId: string, password?: string): void {
    this.send({ t: 'joinGame', gameId, ...(password ? { password } : {}) });
  }

  /**
   * A SignalChannel aimed at one specific peer.
   *
   * This is the adapter that lets RtcTransport stay ignorant of how
   * signalling reaches the other side; it just sends and receives.
   */
  channelTo(peer: PeerId): SignalChannel {
    return {
      send: (message: SignalMessage) => {
        this.send({ t: 'signal', to: peer, payload: message });
      },
      onMessage: (handler: (message: SignalMessage) => void) => {
        let set = this.signalHandlers.get(peer);
        if (!set) { set = new Set(); this.signalHandlers.set(peer, set); }
        set.add(handler);
        return () => set!.delete(handler);
      },
      close: () => { this.signalHandlers.delete(peer); },
    };
  }

  dispose(): void {
    this.stopHeartbeat();
    this.signalHandlers.clear();
    try { this.socket?.close(); } catch { /* already gone */ }
    this.socket = null;
  }
}
