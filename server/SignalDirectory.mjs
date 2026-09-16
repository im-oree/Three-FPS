/**
 * SignalDirectory.mjs — the backend's entire job in the P2P arrangement.
 *
 * It keeps a list of who is hosting a game and relays SDP/ICE between two
 * peers so they can open a direct connection. It holds NO game state, runs no
 * simulation, and stops being involved the moment the DataChannel opens. The
 * host's browser is the authoritative server.
 *
 * Written as a plain class over an abstract "peer" (anything with send/close)
 * rather than against `ws` directly, so the acceptance suite can drive it
 * in-process with fake peers and assert on the real logic instead of a mock.
 */
import { randomUUID } from 'node:crypto';

/** Listings older than this are dropped: the host's tab went away. */
export const LISTING_TIMEOUT_SECONDS = 15;

export class SignalDirectory {
  constructor(now = () => Date.now() / 1000) {
    this.now = now;
    /** peerId -> { send, close, hostedGameId } */
    this.peers = new Map();
    /** gameId -> listing */
    this.games = new Map();
  }

  get peerCount() { return this.peers.size; }
  get gameCount() { return this.games.size; }

  /** Register a freshly connected socket. Returns its peer id. */
  addPeer(send, close = () => {}) {
    const peerId = `peer_${randomUUID().slice(0, 8)}`;
    this.peers.set(peerId, { send, close, hostedGameId: null, lastPingAt: 0, rttMs: 0 });
    send({ t: 'lobbyWelcome', peerId });
    return peerId;
  }

  /**
   * Drop a peer and everything that depended on it.
   *
   * A host leaving must delist its game, or the browser fills with rows that
   * cannot be joined -- the single most common complaint about every server
   * browser ever shipped.
   */
  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (peer.hostedGameId) {
      const game = this.games.get(peer.hostedGameId);
      this.games.delete(peer.hostedGameId);
      // Tell anyone mid-handshake that the host vanished, so their UI can
      // say so instead of spinning forever.
      if (game) {
        for (const guestId of game.pendingGuests) {
          this.peers.get(guestId)?.send({ t: 'peerGone', peerId });
        }
      }
    }
    // Any host still expecting this guest should stop waiting.
    for (const game of this.games.values()) {
      if (game.pendingGuests.delete(peerId)) {
        this.peers.get(game.hostPeerId)?.send({ t: 'peerGone', peerId });
      }
    }
    this.peers.delete(peerId);
  }

  /** Every listing a browser should show, freshest first. */
  listings() {
    this.pruneStale();
    const now = this.now();
    return [...this.games.values()]
      .map((game) => ({
        id: game.id,
        name: game.name,
        levelId: game.levelId,
        modeId: game.modeId,
        playerCount: game.playerCount,
        maxPlayers: game.maxPlayers,
        inProgress: game.inProgress,
        hasPassword: game.password !== null,
        pingMs: this.peers.get(game.hostPeerId)?.rttMs ?? 0,
        ageSeconds: Math.max(0, now - game.updatedAt),
      }))
      .sort((a, b) => a.ageSeconds - b.ageSeconds);
  }

  /** Forget listings whose host stopped checking in. */
  pruneStale() {
    const cutoff = this.now() - LISTING_TIMEOUT_SECONDS;
    for (const [id, game] of this.games) {
      if (game.updatedAt < cutoff) {
        this.games.delete(id);
        const host = this.peers.get(game.hostPeerId);
        if (host) host.hostedGameId = null;
      }
    }
  }

  /**
   * Handle one lobby message. Returns nothing; replies go through the peer's
   * own send function, which is also how relays reach the other side.
   */
  handle(peerId, msg) {
    const peer = this.peers.get(peerId);
    if (!peer || typeof msg?.t !== 'string') return;

    switch (msg.t) {
      case 'hostGame': {
        // One listing per peer: re-hosting replaces rather than duplicates.
        if (peer.hostedGameId) this.games.delete(peer.hostedGameId);
        const id = `game_${randomUUID().slice(0, 8)}`;
        this.games.set(id, {
          id,
          hostPeerId: peerId,
          name: sanitiseName(msg.name),
          levelId: typeof msg.levelId === 'string' ? msg.levelId : 'shipment',
          modeId: typeof msg.modeId === 'string' ? msg.modeId : 'ffa',
          playerCount: clampCount(msg.playerCount, 1),
          maxPlayers: clampCount(msg.maxPlayers, 8),
          inProgress: false,
          password: typeof msg.password === 'string' && msg.password ? msg.password : null,
          pendingGuests: new Set(),
          updatedAt: this.now(),
        });
        peer.hostedGameId = id;
        peer.send({ t: 'hosting', gameId: id });
        break;
      }

      case 'heartbeat': {
        const game = peer.hostedGameId ? this.games.get(peer.hostedGameId) : null;
        if (!game) break;
        game.playerCount = clampCount(msg.playerCount, game.playerCount);
        game.inProgress = msg.inProgress === true;
        game.updatedAt = this.now();
        break;
      }

      case 'stopHosting': {
        if (peer.hostedGameId) this.games.delete(peer.hostedGameId);
        peer.hostedGameId = null;
        break;
      }

      case 'listGames':
        peer.send({ t: 'gameList', games: this.listings() });
        break;

      case 'joinGame': {
        this.pruneStale();
        const game = this.games.get(msg.gameId);
        if (!game) {
          peer.send({ t: 'joinRejected', reason: 'that game is no longer listed' });
          break;
        }
        if (game.playerCount >= game.maxPlayers) {
          peer.send({ t: 'joinRejected', reason: 'game is full' });
          break;
        }
        if (game.password !== null && msg.password !== game.password) {
          peer.send({ t: 'joinRejected', reason: 'wrong password' });
          break;
        }
        const host = this.peers.get(game.hostPeerId);
        if (!host) {
          this.games.delete(game.id);
          peer.send({ t: 'joinRejected', reason: 'the host disconnected' });
          break;
        }
        game.pendingGuests.add(peerId);
        // Both sides learn the other's id, and signalling can begin. The
        // host opens the peer connection because it owns the server.
        peer.send({ t: 'joinAccepted', gameId: game.id, hostPeerId: game.hostPeerId });
        host.send({ t: 'guestArrived', peerId });
        break;
      }

      case 'signal': {
        // Relay verbatim. The directory does not parse SDP -- it could not
        // usefully validate it, and pretending to would only add a way to
        // break future browsers.
        const target = this.peers.get(msg.to);
        if (!target) {
          peer.send({ t: 'peerGone', peerId: msg.to });
          break;
        }
        target.send({ t: 'signal', from: peerId, payload: msg.payload });
        break;
      }

      case 'ping':
        peer.send({ t: 'pong', id: msg.id });
        break;

      case 'pong': {
        // Hosts answer our pings; that is where a listing's ping figure
        // comes from.
        if (typeof msg.id === 'number' && msg.id === peer.lastPingAt) {
          peer.rttMs = Math.max(0, Math.round(Date.now() - msg.id));
        }
        break;
      }

      default:
        break;
    }
  }

  /** Measure RTT to every hosting peer, so listings can show a real ping. */
  pingHosts() {
    for (const game of this.games.values()) {
      const host = this.peers.get(game.hostPeerId);
      if (!host) continue;
      host.lastPingAt = Date.now();
      host.send({ t: 'ping', id: host.lastPingAt });
    }
  }
}

function sanitiseName(raw, fallback = 'UNNAMED LOBBY') {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 28);
  return cleaned.length > 0 ? cleaned : fallback;
}

function clampCount(raw, fallback) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(64, Math.max(0, Math.floor(raw)));
}
