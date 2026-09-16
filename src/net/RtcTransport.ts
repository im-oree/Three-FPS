/**
 * RtcTransport.ts — the same Transport seam, over a peer-to-peer DataChannel.
 *
 * The host's browser runs the authoritative GameServer. Guests connect
 * DIRECTLY to it over WebRTC; the backend only introduces the two peers and
 * then gets out of the way. That is the whole point of the arrangement: the
 * host owns the server, and gameplay traffic never touches our infrastructure.
 *
 * Both sides of the link implement the same `Transport<TOut, TIn>` interface
 * used by the in-process and WebSocket transports, so GameServer and
 * GameClient are unchanged. A guest's inputs arrive at the host's GameServer
 * through exactly the code path an in-process player uses.
 *
 * Why a signaling server is still required: two browsers cannot find each
 * other. Neither has a stable address a peer can dial, and browser JS cannot
 * open a raw socket to an IP. So the backend relays the SDP offer/answer and
 * ICE candidates -- a few hundred bytes, once, at join time -- and every
 * packet after that is peer-to-peer.
 *
 * Channel configuration is deliberate:
 *   - `ordered: false`, `maxRetransmits: 0` for snapshots and inputs. A game
 *     snapshot that arrives late is worthless; retransmitting it delays the
 *     NEXT one behind it (head-of-line blocking) and turns a dropped packet
 *     into a visible stall. UDP semantics are what a shooter wants.
 *   - a second RELIABLE channel for the handshake and match events, where
 *     losing 'matchReady' or 'welcome' would wedge the session permanently.
 */
import type { Transport } from './Protocol';

/** STUN lets a peer discover its public address. Google's is free and public. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Messages the signaling server relays between two peers, verbatim. */
export type SignalMessage =
  | { readonly kind: 'offer'; readonly sdp: string }
  | { readonly kind: 'answer'; readonly sdp: string }
  | { readonly kind: 'ice'; readonly candidate: RTCIceCandidateInit };

/** How a peer reaches the signaling relay. Injected so tests can fake it. */
export interface SignalChannel {
  send(message: SignalMessage): void;
  onMessage(handler: (message: SignalMessage) => void): () => void;
  close(): void;
}

const UNRELIABLE_LABEL = 'game';
const RELIABLE_LABEL = 'control';

/**
 * Messages that must never be dropped.
 *
 * Everything else is state that the next snapshot supersedes, so losing one
 * costs a frame of smoothness. These are one-shot events: lose the 'welcome'
 * and the client never learns its own id; lose a 'killfeed' row and a kill
 * silently never happened.
 */
const RELIABLE_TYPES = new Set([
  'hello', 'welcome', 'rejected',
  'joinMatch', 'matchLoading', 'matchReady', 'matchEnded', 'leaveMatch',
  'setLoadout', 'killfeed', 'killstreakState', 'callKillstreak',
  'enterVehicle', 'exitVehicle', 'requestPause', 'simulationState',
  'createRoom', 'joinRoom', 'leaveRoom', 'listRooms',
  'roomJoined', 'roomLeft', 'roomList', 'roomUpdated',
  'matchState', 'respawned', 'identity',
]);

/** Shared plumbing: both ends differ only in who creates the channels. */
abstract class RtcEndpoint<TOut, TIn> implements Transport<TOut, TIn> {
  protected pc: RTCPeerConnection;
  protected game: RTCDataChannel | null = null;
  protected control: RTCDataChannel | null = null;

  private readonly handlers = new Set<(message: TIn) => void>();
  private readonly closeHandlers = new Set<(reason: string) => void>();
  private readonly outbox: TOut[] = [];
  private opened: (() => void) | null = null;
  private failed: ((err: Error) => void) | null = null;
  private readonly ready: Promise<void>;
  private settled = false;
  private closedByUs = false;
  private rtt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    protected readonly signal: SignalChannel,
    iceServers: RTCIceServer[],
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.ready = new Promise<void>((resolve, reject) => {
      this.opened = resolve;
      this.failed = reject;
    });

    this.pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.signal.send({ kind: 'ice', candidate: event.candidate.toJSON() });
      }
    });
    this.pc.addEventListener('connectionstatechange', () => {
      const state = this.pc.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.fireClose(`peer connection ${state}`);
      }
    });
  }

  /** Wire a channel's events once it exists, whichever side made it. */
  protected adopt(channel: RTCDataChannel): void {
    if (channel.label === RELIABLE_LABEL) this.control = channel;
    else this.game = channel;

    channel.addEventListener('message', (event) => {
      let parsed: TIn | { t: '__ping'; id: number } | { t: '__pong'; id: number };
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return; // A malformed frame must not kill the session.
      }
      const tagged = parsed as { t?: string; id?: number };
      // Latency probe. Answered here rather than in the game code so RTT
      // works before a match exists and costs nothing to the simulation.
      if (tagged.t === '__ping') {
        this.raw({ t: '__pong', id: tagged.id }, true);
        return;
      }
      if (tagged.t === '__pong') {
        this.rtt = Math.max(0, Date.now() - (tagged.id ?? Date.now()));
        return;
      }
      for (const handler of this.handlers) handler(parsed as TIn);
    });

    channel.addEventListener('open', () => {
      // Ready once the unreliable game channel is up: it carries the traffic
      // that matters, and the control channel opens alongside it.
      if (channel.label !== UNRELIABLE_LABEL) return;
      this.flush();
      this.startPing();
      if (!this.settled) { this.settled = true; this.opened?.(); }
    });

    channel.addEventListener('close', () => {
      if (channel.label === UNRELIABLE_LABEL) this.fireClose('data channel closed');
    });
  }

  private startPing(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      if (this.control?.readyState === 'open') {
        this.raw({ t: '__ping', id: Date.now() }, true);
      }
    }, 2000);
  }

  /** Send without the reliability routing, for internal control frames. */
  private raw(message: unknown, reliable: boolean): void {
    const channel = reliable ? this.control : this.game;
    if (channel?.readyState !== 'open') return;
    try {
      channel.send(JSON.stringify(message));
    } catch {
      /* channel closing under us */
    }
  }

  send(message: TOut): void {
    const type = (message as { t?: string }).t ?? '';
    const reliable = RELIABLE_TYPES.has(type);
    const channel = reliable ? this.control : this.game;
    if (channel?.readyState !== 'open') {
      // Queue anything sent during the handshake. Without this the first
      // 'hello' is dropped and the session never starts.
      this.outbox.push(message);
      return;
    }
    this.raw(message, reliable);
  }

  private flush(): void {
    const pending = this.outbox.splice(0, this.outbox.length);
    for (const message of pending) this.send(message);
  }

  onMessage(handler: (message: TIn) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  protected fireClose(reason: string): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (!this.settled) { this.settled = true; this.failed?.(new Error(reason)); }
    const listeners = [...this.closeHandlers];
    this.closeHandlers.clear();
    for (const handler of listeners) handler(reason);
  }

  connect(): Promise<void> { return this.ready; }

  close(): void {
    if (this.closedByUs) return;
    this.closedByUs = true;
    try { this.game?.close(); } catch { /* already gone */ }
    try { this.control?.close(); } catch { /* already gone */ }
    try { this.pc.close(); } catch { /* already gone */ }
    this.signal.close();
    this.fireClose('closed locally');
  }

  get connected(): boolean { return this.game?.readyState === 'open'; }
  get rttMs(): number { return this.rtt; }
}

/**
 * The HOST side of one guest's connection.
 *
 * The host creates the channels and the offer. One of these exists per
 * connected guest, and each is handed to `GameServer.accept()` exactly as a
 * WebSocket connection would be.
 */
export class RtcHostTransport<TOut, TIn> extends RtcEndpoint<TOut, TIn> {
  constructor(signal: SignalChannel, iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS) {
    super(signal, iceServers);

    this.adopt(this.pc.createDataChannel(UNRELIABLE_LABEL, {
      ordered: false,
      maxRetransmits: 0,
    }));
    this.adopt(this.pc.createDataChannel(RELIABLE_LABEL, { ordered: true }));

    this.signal.onMessage(async (message) => {
      try {
        if (message.kind === 'answer') {
          await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        } else if (message.kind === 'ice') {
          await this.pc.addIceCandidate(message.candidate);
        }
      } catch (err) {
        this.fireClose(`signalling failed: ${(err as Error).message}`);
      }
    });

    void this.offer();
  }

  private async offer(): Promise<void> {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signal.send({ kind: 'offer', sdp: offer.sdp ?? '' });
    } catch (err) {
      this.fireClose(`offer failed: ${(err as Error).message}`);
    }
  }
}

/**
 * The GUEST side. Answers the host's offer and adopts the channels it made.
 */
export class RtcGuestTransport<TOut, TIn> extends RtcEndpoint<TOut, TIn> {
  constructor(signal: SignalChannel, iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS) {
    super(signal, iceServers);

    this.pc.addEventListener('datachannel', (event) => this.adopt(event.channel));

    this.signal.onMessage(async (message) => {
      try {
        if (message.kind === 'offer') {
          await this.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.signal.send({ kind: 'answer', sdp: answer.sdp ?? '' });
        } else if (message.kind === 'ice') {
          await this.pc.addIceCandidate(message.candidate);
        }
      } catch (err) {
        this.fireClose(`signalling failed: ${(err as Error).message}`);
      }
    });
  }
}
