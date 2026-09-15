/**
 * GameSession.ts — boots the server and the client and wires them together.
 *
 * ONE PLACE decides whether this session talks to an in-process server or a
 * hosted one. Everything else in the game holds a GameClient and cannot tell
 * the difference, which is what makes "plug in a dedicated backend" a
 * configuration change rather than a refactor:
 *
 *   createLocalSession()                     // single player, server in-tab
 *   createRemoteSession('wss://host/game')   // dedicated backend
 *
 * LIFECYCLE
 * ---------
 * The user's requirement was explicit: closing the game must stop the server.
 * `dispose()` does that, and it is wired to both the quit-to-menu path and
 * the tab's own unload, so an abandoned session cannot leave a simulation
 * ticking in the background burning CPU.
 */
import { GameServer } from '../server/GameServer';
import { GameClient, type GameClientEvents } from './GameClient';
import { createLocalTransportPair } from './LocalTransport';
import { WebSocketTransport } from './WebSocketTransport';
import type { C2S, S2C, ClientTransport, ServerTransport } from './Protocol';
import type { LevelFetcher } from '../server/LevelStore';

export interface GameSession {
  readonly client: GameClient;
  /**
   * The in-process server, when there is one. Null for a remote session --
   * and that asymmetry is deliberate: any code that reaches for this is code
   * that would break against a dedicated backend, so it is visibly absent
   * rather than quietly unavailable.
   */
  readonly server: GameServer | null;
  /** Drive the in-process server. A no-op for a remote session. */
  update(realSeconds: number): void;
  /**
   * Attach an extra client to the in-process server, as a remote player's
   * connection would arrive. This is how the game is exercised as a populated
   * match before real networking exists -- the server genuinely has two
   * connections, so multiplayer-only behaviour (pause not stopping the world)
   * is reachable and testable today. Throws for a remote session, where the
   * backend owns admission.
   */
  addLocalTestClient(): Promise<GameClient>;
  dispose(): void;
}

/** Single-player: the authoritative server runs in this tab. */
export async function createLocalSession(
  events: GameClientEvents = {},
  options: { simulatedLatencyMs?: number; levelFetcher?: LevelFetcher } = {},
): Promise<GameSession> {
  const server = new GameServer({ levelFetcher: options.levelFetcher });
  const { client: clientTransport, server: serverTransport } =
    createLocalTransportPair<C2S, S2C>(options.simulatedLatencyMs ?? 0);

  await serverTransport.connect();
  server.accept(serverTransport as ServerTransport);

  const client = new GameClient(clientTransport as ClientTransport, events);
  await client.connect();

  let disposed = false;
  const session: GameSession = {
    client,
    server,
    update(realSeconds: number): void {
      if (disposed) return;
      server.update(realSeconds);
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
      client.disconnect();
      // Closing the game closes the server, as required.
      server.shutdown();
    },
  };

  // A reload or tab close must not leave the simulation running.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => session.dispose(), { once: true });
  }
  return session;
}

/** Multiplayer: the authority lives on a hosted backend. */
export async function createRemoteSession(
  url: string,
  events: GameClientEvents = {},
): Promise<GameSession> {
  const transport = new WebSocketTransport<C2S, S2C>(url);
  const client = new GameClient(transport, events);
  await client.connect();

  let disposed = false;
  return {
    client,
    server: null,
    update(): void {
      // Nothing to drive: the backend owns its own clock. This being a no-op
      // is the proof that the client never depended on pumping the server.
    },
    addLocalTestClient(): Promise<GameClient> {
      return Promise.reject(new Error(
        'addLocalTestClient is local-only; a remote backend admits its own players',
      ));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      client.disconnect();
    },
  };
}
