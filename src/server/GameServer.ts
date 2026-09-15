/**
 * GameServer.ts — the authoritative simulation.
 *
 * WHAT THIS OWNS
 * --------------
 * Everything that decides what is TRUE in the game: the tick loop, match
 * lifecycle, entity registry, and (as systems are migrated) physics,
 * ballistics, killstreaks and damage. The client owns rendering, audio, input
 * capture and UI, and nothing else.
 *
 * THE RULE THAT MAKES THIS WORTH DOING
 * ------------------------------------
 * This file and everything under src/server/ must never import from three,
 * from the DOM, or from any client module. That is not a style preference —
 * it is the mechanical guarantee that the same code can run inside the
 * browser tab today and inside a Node process on a hosted backend tomorrow
 * with no changes. A single `import * as THREE` here would silently couple
 * the simulation to a renderer and the "plug in a dedicated backend" promise
 * would quietly become a rewrite. tools/verify/server-purity.mjs enforces it.
 *
 * FIXED TIMESTEP
 * --------------
 * The server steps at a fixed TICK_HZ regardless of the client's frame rate,
 * accumulating real elapsed time and consuming it in whole ticks. Variable
 * timesteps make physics frame-rate dependent, which means two clients at
 * 30 and 144 FPS would diverge — fatal once there is a second player. The
 * accumulator is clamped so a long stall (a tab in the background, a GC
 * pause, a breakpoint) cannot produce a thousand-tick catch-up burst that
 * freezes the process.
 */
import {
  TICK_HZ, TICK_SECONDS, PROTOCOL_VERSION,
  type C2S, type S2C, type ServerTransport,
  type EntityState, type FxEvent, type PlayerId, type Snapshot,
} from '../net/Protocol';
import { ServerWorld } from './ServerWorld';
import type { ServerSystem } from './ServerSystem';
import { CollisionWorld } from './CollisionWorld';
import { LevelStore, type LevelFetcher } from './LevelStore';
import { MovementSystem } from './systems/MovementSystem';
import { CombatSystem } from './systems/CombatSystem';
import { AISystem } from './systems/AISystem';
import { registerBuiltinCapabilities } from './ai/registerCapabilities';
import type { AgentOptions } from './ai/AgentController';

/**
 * Longest real interval a single update() call will simulate. Beyond this the
 * server drops the backlog rather than trying to catch up: a 10-second stall
 * must not become 600 physics ticks in one frame.
 */
const MAX_CATCHUP_SECONDS = 0.25;

interface Connection {
  readonly id: PlayerId;
  readonly transport: ServerTransport;
  unsubscribe: () => void;
  /** Highest input sequence consumed, echoed back for reconciliation. */
  ackSeq: number;
  joined: boolean;
}

export interface GameServerOptions {
  /** Supplies baked collision data. Omit for a server with no geometry. */
  readonly levelFetcher?: LevelFetcher;
}

export class GameServer {
  readonly world = new ServerWorld();
  /** The authoritative collision geometry every system queries. */
  readonly collision = new CollisionWorld();
  private readonly levels: LevelStore | null;
  /** Tracks the load in flight, so a fast re-join cannot race it. */
  private levelLoad: Promise<void> | null = null;
  /** Kept for ammo queries; also registered as an ordinary system. */
  readonly combat: CombatSystem;

  private readonly connections = new Map<PlayerId, Connection>();
  private readonly systems: ServerSystem[] = [];
  private accumulator = 0;
  private tick = 0;
  private elapsed = 0;
  private running = false;
  private nextPlayerNumber = 0;
  private levelId: string | null = null;
  /**
   * Single-player courtesy pause. Multiplayer ignores this entirely: one
   * player opening a menu must not stop everyone else's world.
   */
  private pausedBySolo = false;

  constructor(options: GameServerOptions = {}) {
    this.levels = options.levelFetcher ? new LevelStore(options.levelFetcher) : null;
    // Movement is registered here rather than by the caller: a server that
    // does not move players is not a server, and making it opt-in would let
    // the backend and the browser boot with different system sets -- exactly
    // the divergence this architecture exists to prevent.
    this.addSystem(new MovementSystem(this.collision));
    // Order matters: combat reads the button mask movement publishes, so
    // movement must have consumed this tick's input before combat runs.
    this.combat = new CombatSystem(this.collision);
    this.addSystem(this.combat);
    // AI runs last: it reads the world the other systems just produced and
    // queues input for the NEXT tick, exactly like a network client whose
    // packet arrives between frames. Registering it here rather than leaving
    // it to the caller keeps the in-process server and the hosted backend
    // from booting with different system sets.
    registerBuiltinCapabilities();
    this.ai = new AISystem(this.collision);
    this.addSystem(this.ai);
  }

  /** Bots. Public so a room can fill empty slots. */
  readonly ai: AISystem;

  /**
   * Add a bot to the match.
   *
   * A bot is a PLAYER: it goes through world.addPlayer like any client, gets
   * a spawn point, health and a loadout, and appears in snapshots. The only
   * difference is where its input comes from. Nothing downstream of
   * queueInput can tell the difference, which is the whole contract.
   */
  addBot(name?: string, options: AgentOptions = {}): PlayerId {
    const id = `bot:${name ?? this.nextBotIndex()}`;
    this.world.addPlayer(id, options.loadout);
    this.ai.addAgent(id, options);
    return id;
  }

  /** Remove a bot and its agent together. */
  removeBot(id: PlayerId): void {
    this.ai.removeAgent(id);
    this.world.removePlayer(id);
  }

  private botCounter = 0;
  private nextBotIndex(): number { this.botCounter += 1; return this.botCounter; }

  // --- lifecycle -----------------------------------------------------------

  /** Register a simulation system. Order is the tick order. */
  addSystem(system: ServerSystem): void {
    this.systems.push(system);
    system.attach?.(this.world);
  }

  /** Accept a connection. Mirrors a socket 'connection' event exactly. */
  accept(transport: ServerTransport): PlayerId {
    const id: PlayerId = `p${this.nextPlayerNumber++}`;
    const connection: Connection = {
      id, transport, unsubscribe: () => {}, ackSeq: -1, joined: false,
    };
    const offMessage = transport.onMessage((msg) => this.handle(connection, msg));
    // A dropped link must free the slot on its own. Waiting for a polite
    // 'leaveMatch' means a crashed or backgrounded client holds a player slot
    // (and a room) forever.
    const offClose = transport.onClose(() => this.disconnect(id));
    connection.unsubscribe = () => { offMessage(); offClose(); };
    this.connections.set(id, connection);
    return id;
  }

  disconnect(id: PlayerId): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    connection.unsubscribe();
    this.world.removePlayer(id);
    this.connections.delete(id);
    // An empty server has nothing to simulate; stop cleanly rather than
    // spinning a tick loop over an empty world forever.
    if (this.connections.size === 0) this.stopMatch('all players left');
  }

  // --- message handling ----------------------------------------------------

  private handle(connection: Connection, msg: C2S): void {
    switch (msg.t) {
      case 'hello': {
        if (msg.version !== PROTOCOL_VERSION) {
          this.sendTo(connection, {
            t: 'rejected',
            reason: `protocol ${msg.version} != server ${PROTOCOL_VERSION}`,
          });
          return;
        }
        this.sendTo(connection, {
          t: 'welcome', version: PROTOCOL_VERSION, playerId: connection.id, tickHz: TICK_HZ,
        });
        break;
      }

      case 'joinMatch': {
        connection.joined = true;
        this.startMatch(msg.levelId);
        const spawn = this.world.addPlayer(connection.id, msg.loadout);
        this.sendTo(connection, {
          t: 'matchReady', levelId: msg.levelId, spawn: spawn.pos, spawnYaw: spawn.yaw,
        });
        break;
      }

      case 'leaveMatch': {
        connection.joined = false;
        this.world.removePlayer(connection.id);
        // A match with nobody in it is over. Without this, quitting to the
        // menu would leave the simulation running with zero players -- and on
        // a hosted backend that is a room that never frees its slot.
        this.endMatchIfEmpty();
        break;
      }

      case 'input': {
        // Out-of-order and duplicate inputs are discarded, not applied: over a
        // real socket these are routine, and applying a stale frame would
        // rewind the player.
        if (msg.frame.seq <= connection.ackSeq) return;
        connection.ackSeq = msg.frame.seq;
        this.world.queueInput(connection.id, msg.frame);
        break;
      }

      case 'setLoadout':
        this.world.setLoadout(connection.id, msg.loadout);
        break;

      case 'callKillstreak':
        this.world.requestKillstreak(connection.id, msg.slot);
        break;

      case 'enterVehicle':
        this.world.requestEnterVehicle(connection.id, msg.vehicle, msg.seat);
        break;

      case 'exitVehicle':
        this.world.requestExitVehicle(connection.id);
        break;

      case 'requestPause': {
        // Honoured ONLY when this is the sole participant. The client is told
        // the real answer either way and must render from that, never from
        // its own assumption that pressing Escape stopped the world.
        const solo = this.connections.size <= 1;
        this.pausedBySolo = solo && msg.paused;
        this.broadcast({
          t: 'simulationState',
          running: !this.pausedBySolo,
          reason: this.pausedBySolo ? 'paused by player'
            : (solo ? 'resumed' : 'multiplayer: pause does not stop the match'),
        });
        break;
      }

      default:
        break;
    }
  }

  // --- match lifecycle -----------------------------------------------------

  startMatch(levelId: string): void {
    if (this.levelId === levelId && this.running) return;
    // A new match must never inherit the previous one's state. This is the
    // reset seam the client used to do by hand in quitToMenu(), and doing it
    // here means it cannot be forgotten by a caller.
    this.resetAll();
    this.levelId = levelId;
    this.running = true;
    this.broadcast({ t: 'matchLoading', levelId });
    this.loadLevelCollision(levelId);
    for (const system of this.systems) system.onMatchStart?.(levelId);
  }

  /**
   * Load the level's geometry into the collision world.
   *
   * Asynchronous by necessity (the browser fetches it), but the match starts
   * immediately: players spawn and the loop runs while geometry arrives. The
   * alternative -- blocking the match on a fetch -- would mean a slow network
   * stalls a hosted room for everyone already in it.
   */
  private loadLevelCollision(levelId: string): void {
    if (!this.levels) return;
    const cached = this.levels.peek(levelId);
    if (cached) {
      this.collision.load(cached.boxes, cached.terrain);
      this.world.setSpawnPoints([{ pos: cached.spawn, yaw: cached.spawnYaw }]);
      this.ai.buildNavigation();
      return;
    }
    // Until the real geometry lands, a floor: without one, every player
    // spawned during the fetch falls out of the world.
    this.collision.load([{
      minX: -200, minY: -1, minZ: -200, maxX: 200, maxY: 0, maxZ: 200, surface: 'concrete',
    }]);
    this.levelLoad = this.levels.load(levelId).then((data) => {
      // The match may have ended or changed level while this was in flight.
      if (this.levelId !== levelId) return;
      this.collision.load(data.boxes, data.terrain);
      this.world.setSpawnPoints([{ pos: data.spawn, yaw: data.spawnYaw }]);
      // Navigation is derived from the collision that just landed, so it can
      // never describe a different world than the one players collide with.
      this.ai.buildNavigation();
    }).catch((error: unknown) => {
      console.warn(`[server] level "${levelId}" collision failed to load:`, error);
    });
  }

  /** Resolves once any in-flight level load has settled. For tests. */
  whenLevelReady(): Promise<void> { return this.levelLoad ?? Promise.resolve(); }

  /** End the match once the last player has gone. */
  private endMatchIfEmpty(): void {
    if (!this.running) return;
    let joined = 0;
    for (const connection of this.connections.values()) {
      if (connection.joined) joined += 1;
    }
    if (joined === 0) this.stopMatch('match empty');
  }

  stopMatch(reason: string): void {
    if (!this.running) return;
    this.running = false;
    for (const system of this.systems) system.onMatchEnd?.(reason);
    this.resetAll();
    this.levelId = null;
    this.broadcast({ t: 'matchEnded', reason });
  }

  /**
   * Return every system and the world to a clean slate.
   *
   * Explicitly includes pool release: entities are pooled, and a pool that
   * keeps objects across matches is how a fresh match ends up with a corpse
   * from the previous one still registered as a valid target.
   */
  private resetAll(): void {
    for (const system of this.systems) system.reset?.();
    this.world.reset();
    // Geometry is match-scoped too: leaving it loaded means the next match
    // starts with the last map's walls until its own data arrives.
    this.collision.clear();
    this.accumulator = 0;
    this.tick = 0;
    this.elapsed = 0;
    this.pausedBySolo = false;
  }

  /** Full shutdown. The client calls this when the tab/game closes. */
  shutdown(): void {
    this.stopMatch('server shutdown');
    for (const connection of this.connections.values()) {
      connection.unsubscribe();
      connection.transport.close();
    }
    this.connections.clear();
    for (const system of this.systems) system.dispose?.();
    this.systems.length = 0;
  }

  // --- the loop ------------------------------------------------------------

  /**
   * Advance the simulation by real elapsed seconds.
   *
   * In-process this is driven by the client's rAF; on a hosted backend by a
   * setInterval. Either way the simulation only ever advances in whole
   * TICK_SECONDS steps, so the two produce identical results.
   */
  update(realSeconds: number): void {
    if (!this.running || this.pausedBySolo) return;

    this.accumulator += Math.min(realSeconds, MAX_CATCHUP_SECONDS);
    let ticked = false;

    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      this.tick += 1;
      this.elapsed += TICK_SECONDS;
      this.world.beginTick(this.tick, this.elapsed);
      for (const system of this.systems) system.tick(TICK_SECONDS, this.world);
      this.world.endTick();
      ticked = true;
    }

    // One snapshot per update, not per tick: on a slow frame that consumed
    // three ticks, the client only needs the latest state, and sending three
    // would waste bandwidth to show two frames nobody will ever see.
    if (ticked) this.broadcastSnapshot();
  }

  private broadcastSnapshot(): void {
    const entities: EntityState[] = this.world.collectEntityStates();
    const removed = this.world.consumeRemovedIds();
    const fx: FxEvent[] = this.world.consumeFxEvents();

    for (const connection of this.connections.values()) {
      if (!connection.joined) continue;
      const snapshot: Snapshot = {
        tick: this.tick,
        time: this.elapsed,
        ackSeq: connection.ackSeq,
        entities,
        ...(removed.length ? { removed } : {}),
        ...(fx.length ? { fx } : {}),
      };
      this.sendTo(connection, { t: 'snapshot', snapshot });

      const playerState = this.world.getPlayerPublicState(connection.id);
      if (playerState) this.sendTo(connection, { t: 'playerState', state: playerState });

      const slots = this.world.getKillstreakSlots(connection.id);
      if (slots) this.sendTo(connection, { t: 'killstreakState', slots });
    }
  }

  private sendTo(connection: Connection, message: S2C): void {
    connection.transport.send(message);
  }

  private broadcast(message: S2C): void {
    for (const connection of this.connections.values()) {
      connection.transport.send(message);
    }
  }

  // --- introspection, for tests and the debug overlay ----------------------

  get currentTick(): number { return this.tick; }
  get isRunning(): boolean { return this.running && !this.pausedBySolo; }
  get playerCount(): number { return this.connections.size; }
  get activeLevelId(): string | null { return this.levelId; }
  get isMatchActive(): boolean { return this.running; }
}
