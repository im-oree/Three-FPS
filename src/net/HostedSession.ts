/**
 * HostedSession.ts — "host a game" and "join a game", as sessions.
 *
 * These produce the same `GameSession` shape as createLocalSession, so
 * main.ts drives a peer-to-peer match with the code it already has. The
 * difference is invisible above this line:
 *
 *   HOST  runs the authoritative GameServer in this tab, plays through an
 *         in-process transport pair (zero latency to itself), and hands each
 *         arriving guest an RtcHostTransport straight into GameServer.accept.
 *         Guests are ordinary connections; the server cannot tell them from
 *         a WebSocket player, which is precisely the point.
 *
 *   GUEST has no GameServer at all. Its transport is an RtcGuestTransport
 *         pointed at the host, so its inputs travel peer-to-peer and it
 *         receives the host's snapshots. `session.server` is null and
 *         `update()` is a no-op, exactly as for a dedicated backend.
 */
import { GameClient, type GameClientEvents } from './GameClient';
import { createLocalTransportPair } from './LocalTransport';
import { LobbyClient } from './LobbyClient';
import { ServerClock } from './ServerClock';
import { RtcGuestTransport, RtcHostTransport, DEFAULT_ICE_SERVERS } from './RtcTransport';
import { GameServer } from '../server/GameServer';
import type { LevelFetcher } from '../server/LevelStore';
import type {
  C2S, S2C, ServerTransport, Transport as ClientTransportShape,
} from './Protocol';
import type { GameSession } from './GameSession';
import type { PeerId } from './LobbyProtocol';

type ClientTransport = ClientTransportShape<C2S, S2C>;

export interface HostOptions {
  /** Signalling backend, e.g. wss://host/ or ws://127.0.0.1:8137. */
  readonly lobbyUrl: string;
  readonly name: string;
  readonly levelId: string;
  readonly modeId: string;
  readonly maxPlayers: number;
  readonly password?: string;
  /** Fill empty slots with AI. Off by default: a listing should be honest. */
  readonly bots?: boolean;
  readonly levelFetcher?: LevelFetcher;
  readonly iceServers?: RTCIceServer[];
}

/** A hosted session, plus the handles the UI needs to manage the listing. */
export interface HostedGameSession extends GameSession {
  readonly lobby: LobbyClient;
  /** Guests currently connected, for the lobby UI. */
  readonly guestCount: number;
}

/**
 * Start a game other people can find and join.
 *
 * The listing is advertised immediately, so the game shows up in browsers
 * while the host is still loading -- COD does the same, and it is what makes
 * a custom lobby fill up instead of sitting empty.
 */
export async function createHostedSession(
  options: HostOptions,
  events: GameClientEvents = {},
): Promise<HostedGameSession> {
  const server = new GameServer({
    levelFetcher: options.levelFetcher,
    fillLobby: options.bots ?? false,
  });

  // The host plays through an in-process pair: no serialisation, no latency
  // to itself, and identical code to single-player.
  const { client: clientTransport, server: serverTransport } =
    createLocalTransportPair<C2S, S2C>(0);
  await serverTransport.connect();
  server.accept(serverTransport as ServerTransport);
  const client = new GameClient(clientTransport as ClientTransport, events);
  await client.connect();

  const guests = new Map<PeerId, RtcHostTransport<S2C, C2S>>();

  const lobby = new LobbyClient(options.lobbyUrl, {
    onGuestArrived: (peerId) => {
      // A guest is just another connection. The server is handed a transport
      // and never learns it is peer-to-peer.
      const transport = new RtcHostTransport<S2C, C2S>(
        lobby.channelTo(peerId),
        options.iceServers ?? DEFAULT_ICE_SERVERS,
      );
      guests.set(peerId, transport);
      transport.onClose(() => {
        guests.delete(peerId);
        pushStatus();
      });
      server.accept(transport as unknown as ServerTransport);
      pushStatus();
    },
    onPeerGone: (peerId) => {
      guests.get(peerId)?.close();
      guests.delete(peerId);
      pushStatus();
    },
  });

  /** Keep the listing's player count honest. */
  const pushStatus = () => {
    lobby.setStatus(server.playerCount, server.isMatchActive);
  };

  await lobby.connect();
  lobby.host({
    name: options.name,
    levelId: options.levelId,
    modeId: options.modeId,
    maxPlayers: options.maxPlayers,
    ...(options.password ? { password: options.password } : {}),
  });
  pushStatus();

  // The host's server runs on its OWN clock, not the render loop.
  //
  // Guests are simulated by this server, so tying it to the host's frame rate
  // would export the host's GPU load to every other player -- and a
  // backgrounded host tab, where rAF stops entirely, would freeze the match
  // for everybody. A timer keeps ticking regardless.
  const clock = new ServerClock((dt) => {
    server.update(dt);
    pushStatus();
  });
  clock.start();

  let disposed = false;
  const session: HostedGameSession = {
    client,
    server,
    lobby,
    get guestCount(): number { return guests.size; },
    update(): void {
      // Deliberately empty: the clock owns stepping. Kept so a hosted session
      // is drop-in compatible with every other GameSession.
    },
    async addLocalTestClient(): Promise<GameClient> {
      const pair = createLocalTransportPair<C2S, S2C>();
      await pair.server.connect();
      server.accept(pair.server as ServerTransport);
      const extra = new GameClient(pair.client as ClientTransport, {});
      await extra.connect();
      return extra;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clock.stop();
      for (const transport of guests.values()) transport.close();
      guests.clear();
      // Delist before tearing down, so nobody sees a row they cannot join.
      lobby.stopHosting();
      lobby.dispose();
      client.disconnect();
      server.shutdown();
    },
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => session.dispose(), { once: true });
  }
  return session;
}

export interface JoinOptions {
  readonly lobbyUrl: string;
  readonly gameId: string;
  readonly password?: string;
  readonly iceServers?: RTCIceServer[];
  /** How long to wait for the peer connection before giving up. */
  readonly timeoutMs?: number;
}

/**
 * Join someone else's game.
 *
 * Resolves only once the DataChannel is open, so the caller can show a
 * loading screen for the real handshake instead of guessing.
 */
export async function joinHostedSession(
  options: JoinOptions,
  events: GameClientEvents = {},
): Promise<GameSession> {
  const lobby = new LobbyClient(options.lobbyUrl);
  await lobby.connect();

  const hostPeer = await new Promise<PeerId>((resolve, reject) => {
    const timer = setTimeout(
      () => { off(); reject(new Error('the host did not respond')); },
      options.timeoutMs ?? 15000,
    );
    const off = lobby.listen({
      onJoinAccepted: (_gameId, hostPeerId) => {
        clearTimeout(timer); off(); resolve(hostPeerId);
      },
      onJoinRejected: (reason) => {
        clearTimeout(timer); off(); reject(new Error(reason));
      },
    });
    lobby.join(options.gameId, options.password);
  });

  const transport = new RtcGuestTransport<C2S, S2C>(
    lobby.channelTo(hostPeer),
    options.iceServers ?? DEFAULT_ICE_SERVERS,
  );
  const client = new GameClient(transport as ClientTransport, events);
  await client.connect();

  let disposed = false;
  return {
    client,
    server: null,
    update(): void {
      // The host owns the clock. Nothing to drive here, exactly as with a
      // dedicated backend.
    },
    addLocalTestClient(): Promise<GameClient> {
      return Promise.reject(new Error(
        'addLocalTestClient is host-only; a guest cannot admit players',
      ));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      client.disconnect();
      transport.close();
      lobby.dispose();
    },
  };
}
