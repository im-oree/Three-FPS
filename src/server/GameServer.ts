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
import type { HitZone } from './systems/CombatSystem';
import { AISystem } from './systems/AISystem';
import { KillstreakSystem } from './systems/KillstreakSystem';
import { MatchSystem } from './systems/MatchSystem';
import {
  customise, getGameMode, sanitiseOverrides, RULE_LIMITS, GAME_MODES,
  type GameModeDefinition,
} from './GameModes';
import { NameAuthority, NameRandom } from './Identity';
import { hashString, pickTier } from './ai/BotProfile';
import { SeededRandom } from './ai/Difficulty';
import { registerBuiltinCapabilities } from './ai/registerCapabilities';
import { getNavGrid } from './ai/NavContext';
import { EventLog } from './EventLog';
import { ReplayRecorder } from './ReplayRecorder';
import {
  registerBuiltinCameraProfiles, buildKillcamPlan, type KillcamPlan,
} from './CameraDirector';
import type { KillcamClip } from './ReplayRecorder';
import type { AgentOptions } from './ai/AgentController';
import type { SpawnPoint } from './ServerWorld';
import type {
  KillfeedWire, LoadoutSpec, MatchStateWire, Vec3,
} from '../net/Protocol';
import type { MatchEvent } from './systems/MatchSystem';
import { DamageSystem } from './systems/DamageSystem';

/**
 * Weapons and operators a bot may be issued.
 *
 * Kept as plain id lists rather than imported from the client catalogues,
 * which would drag the renderer into the server bundle (the purity check
 * would reject it, correctly). The ids are validated against the server's own
 * weapon table at fire time, so a typo here fails loudly rather than silently
 * arming nobody.
 */
const BOT_PRIMARIES = ['rifle', 'smg', 'shotgun', 'sniper'] as const;

/**
 * How often each primary is issued, by how big the map is.
 *
 * A uniform roll put a sniper rifle in the hands of a quarter of the lobby on
 * Killhouse -- a warehouse whose longest sightline is about twenty metres.
 * Those bots lost every fight they took, which is not "the AI is bad", it is
 * "nobody would ever bring that gun here". Humans pick a weapon for the map;
 * so should a bot.
 *
 * Weights are relative, not percentages. Map size is measured from the nav
 * grid, which the server already builds -- no client level data crosses the
 * purity boundary to get here.
 */
const PRIMARY_WEIGHTS: Record<'close' | 'medium' | 'open', Record<string, number>> = {
  // Corridor maps: Killhouse, Shipment. Shotguns and SMGs rule, and a sniper
  // is a novelty pick rather than a quarter of the lobby.
  close: { rifle: 3, smg: 4, shotgun: 2, sniper: 0.4 },
  // Mixed maps: rifles lead, everything is viable.
  medium: { rifle: 4, smg: 3, shotgun: 1.4, sniper: 1.6 },
  // Open maps with real sightlines: rifles and snipers come into their own.
  open: { rifle: 4, smg: 1.6, shotgun: 0.5, sniper: 3 },
};

/** Classify the current map by playable area, in square metres. */
function mapProfile(): 'close' | 'medium' | 'open' {
  const grid = getNavGrid();
  if (!grid) return 'medium';
  // Walkable cells, not the bounding box: a big map that is mostly wall
  // plays small. CELL_SIZE is 2 m, so each cell is 4 m^2.
  let walkable = 0;
  for (const cell of grid.cells) if (cell) walkable += 1;
  const area = walkable * 4;
  if (area < 4000) return 'close';
  if (area < 20000) return 'medium';
  return 'open';
}

/** Weighted pick from the table for this map. */
function pickPrimary(rng: SeededRandom): string {
  const weights = PRIMARY_WEIGHTS[mapProfile()];
  let total = 0;
  for (const id of BOT_PRIMARIES) total += weights[id] ?? 0;
  let roll = rng.next() * total;
  for (const id of BOT_PRIMARIES) {
    roll -= weights[id] ?? 0;
    if (roll <= 0) return id;
  }
  return 'rifle';
}
const BOT_OPERATORS = [
  'ghost', 'sentry', 'nomad', 'warden', 'vandal', 'ronin',
] as const;

/**
 * Give a bot a random kit.
 *
 * Bots draw from the SAME operator roster and the same weapons a human picks
 * from, because a lobby where every opponent carries the identical rifle and
 * wears the identical uniform reads as a lobby of bots no matter how well
 * they play.
 */
function randomLoadout(seedSource: string): LoadoutSpec {
  const rng = new SeededRandom(hashString(`kit:${seedSource}`));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng.next() * list.length)];
  return {
    primaryId: pickPrimary(rng),
    secondaryId: 'pistol',
    tacticalId: 'flash',
    killstreakIds: ['uav', 'airstrike', 'guided_missile'],
    operatorId: pick(BOT_OPERATORS),
  };
}

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
  /**
   * Top the lobby up to the mode's player count when someone joins.
   *
   * On by default, because a match is supposed to be a populated lobby. Off
   * for tests that need an exactly-known population -- a two-player ballistics
   * arena must contain two players, not two plus six that wandered into the
   * line of fire.
   */
  readonly fillLobby?: boolean;
}

export class GameServer {
  readonly world = new ServerWorld();
  /** The authoritative collision geometry every system queries. */
  readonly collision = new CollisionWorld();
  private readonly levels: LevelStore | null;

  /** Player count named by a custom-match host, if any. */
  private explicitPlayerCount: number | null = null;
  /** Bots for THIS match, when the host asked for them. */
  private botsRequested = false;
  /** Tracks the load in flight, so a fast re-join cannot race it. */
  private levelLoad: Promise<void> | null = null;
  /** Kept for ammo queries; also registered as an ordinary system. */
  readonly combat: CombatSystem;
  /** The single authority on health. Every damage source routes through it. */
  readonly damage: DamageSystem;
  /**
   * Everything notable that happened this match, semantically.
   *
   * The second of the two chokepoints (the first is DamageSystem). Anything
   * that wants to know what happened -- killcam, replay recorder, timeline
   * markers, an anti-cheat review tool -- reads this instead of hooking the
   * individual systems, which is what stops each new feature from needing a
   * new observer.
   */
  readonly events = new EventLog();

  /**
   * The rolling recording, for killcams and replays.
   *
   * Server-side so every client's killcam agrees with the authoritative
   * simulation rather than with whatever that client happened to receive.
   */
  readonly replay = new ReplayRecorder({ windowSeconds: 12, tickHz: TICK_HZ });

  /**
   * Tell every system a player's life has begun.
   *
   * Public because respawn is driven by match events, and because tests need
   * to reproduce a spawn without faking a death.
   */
  notifySpawn(id: PlayerId): void {
    for (const system of this.systems) system.onPlayerSpawn?.(id);
  }

  /** Whether joining tops the lobby up with agents. See GameServerOptions. */
  private readonly autoFill: boolean;

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
    // Damage is a single shared verb. Every source -- bullets, blasts, fall,
    // vehicles -- goes through this one system, so friendly fire, health
    // regeneration and death reporting have exactly one implementation.
    // It is constructed before every system that can hurt something.
    this.damage = new DamageSystem();
    this.damage.setEventLog(this.events);
    this.addSystem(this.damage);
    const movement = new MovementSystem(this.collision, this.damage);
    // Falling out of the world is a death, and the match owns deaths. Wiring
    // it here keeps MovementSystem ignorant of scoring while still making the
    // rule server-authoritative for every player, human or AI alike.
    movement.fellOutOfWorld = (player) => {
      this.match.registerDeath(this.world, player);
    };
    this.addSystem(movement);
    // Order matters: combat reads the button mask movement publishes, so
    // movement must have consumed this tick's input before combat runs.
    this.combat = new CombatSystem(this.collision, this.damage);
    this.addSystem(this.combat);
    // Killstreaks run after combat so a kill scored this tick counts toward
    // the streak this tick, and so a blast resolves against the same health
    // values bullets just wrote.
    this.killstreaks = new KillstreakSystem(this.collision, this.damage);
    // Kills scored by bullets feed streak progress. Injected so the streak
    // system never imports combat, and so objective scoring can feed it too.
    this.killstreaks.setKillSource(() => this.combat.lastShots);
    // Scavenging: a kill tops the killer's reserve up. Driven off the shared
    // damage system so a blast kill resupplies exactly like a bullet kill.
    this.damage.onDeath((death) => {
      if (death.source && death.source !== death.target.id) {
        this.combat.resupplyOnKill(death.source);
      }

      // EVERY player death reaches the match, whatever killed them.
      //
      // The match used to learn about deaths only by scanning CombatSystem's
      // list of resolved shots, so a player killed by anything that is not a
      // bullet -- an explosion, a killstreak, a future ability -- was left
      // dead forever: no score, no respawn timer, no 'died' message, so no
      // death camera either. Hooking the damage chokepoint instead means the
      // rule is "if it died, the match hears about it", which is true for
      // sources that do not exist yet.
      //
      // registerDeath is idempotent per life (it early-outs when a respawn is
      // already pending), so the bullet path crediting the same death a
      // moment later is harmless.
      if (death.targetKind !== 'player') return;
      const victim = this.world.getPlayer(death.target.id as PlayerId);
      if (!victim) return;

      // Hand over whoever the damage names as the killer. Without this the
      // match would see a death with no shooter and book every explosion,
      // killstreak and ability kill as "fell out of the world", stealing the
      // credit from the player who earned it.
      const killer = death.source && death.source !== victim.id
        ? this.world.getPlayer(death.source)
        : null;
      this.match.registerDeath(this.world, victim, killer ? {
        shooter: killer.id,
        victim: victim.id,
        zone: death.zone as HitZone | null,
        damage: 0,
        distance: Math.hypot(killer.px - victim.px, killer.py - victim.py, killer.pz - victim.pz),
        point: [victim.px, victim.py, victim.pz] as Vec3,
        lethal: true,
      } : undefined);
    });
    this.addSystem(this.killstreaks);
    // AI runs last: it reads the world the other systems just produced and
    // queues input for the NEXT tick, exactly like a network client whose
    // packet arrives between frames. Registering it here rather than leaving
    // it to the caller keeps the in-process server and the hosted backend
    // from booting with different system sets.
    // The match owns score, the clock, death and respawn. It runs after
    // combat and killstreaks (so a kill scored this tick is counted this
    // tick) and before AI, so a bot's brain sees the post-death world.
    // Bots are OFF unless somebody asks for them.
    //
    // This used to default to true so single-player had opponents. With a
    // server browser that is no longer defensible: a room advertising 6/8
    // players has to mean six people, or every number in the list is a lie.
    // A host who wants bots turns them on per match (joinMatch rules.bots),
    // and the AI is unchanged when they do.
    this.autoFill = options.fillLobby ?? false;
    this.match = new MatchSystem(this.collision);
    // Subscribe rather than drain: consumeEvents() is destructive, so a
    // second consumer would silently starve whichever ran second.
    this.match.onEvent((event) => this.dispatchMatchEvents(event));
    this.match.setKillSource(() => this.combat.lastShots);
    // Teams come from the match, because they are a MODE concept. The damage
    // system must not know what a game mode is; it just asks.
    // In a free-for-all every player is their own side, so nobody is ever a
    // teammate. MatchSystem reports the literal team 'FFA' for everyone in
    // that mode, which would otherwise make the whole lobby friendly and
    // block every bullet in the game.
    this.damage.configure(
      (id) => {
        const team = this.match.teamOf(id);
        return team === 'FFA' ? null : team;
      },
      false,
    );
    this.addSystem(this.match);

    registerBuiltinCapabilities();
    // Camera profiles are DATA. Registering them here means a capability
    // added later needs no change to the director; it simply gets the
    // generic profile until somebody chooses to give it a better one.
    registerBuiltinCameraProfiles();
    this.ai = new AISystem(this.collision);
    this.addSystem(this.ai);
  }

  /** Bots. Public so a room can fill empty slots. */
  readonly ai: AISystem;
  /** Score, clock, death and respawn. */
  readonly match: MatchSystem;
  /** Hands out names nobody else holds, for humans and bots alike. */
  readonly names = new NameAuthority();
  private nameRng = new NameRandom(0x5eed);
  /** Killstreak authority: earning, cooldowns and blast damage. */
  readonly killstreaks: KillstreakSystem;

  /**
   * Add a bot to the match.
   *
   * A bot is a PLAYER: it goes through world.addPlayer like any client, gets
   * a spawn point, health and a loadout, and appears in snapshots. The only
   * difference is where its input comes from. Nothing downstream of
   * queueInput can tell the difference, which is the whole contract.
   */
  addBot(name?: string, options: AgentOptions = {}): PlayerId {
    // The id deliberately carries NO marker. It used to be `bot:<n>`, which
    // meant every snapshot told the client exactly which players were not
    // human -- a scoreboard, a killfeed or a nameplate could trivially sort
    // them out. A bot is a player; the only thing that knows otherwise is
    // the identity record, which never leaves the server.
    const id = `p${this.nextBotIndex()}`;
    const displayName = this.names.generateUnique(this.nameRng);
    // A bot with no explicit tier rolls one, so a filled lobby has the spread
    // of ability a real one does rather than eight identical opponents.
    const rolled = options.tier ?? pickTier(new SeededRandom(hashString(id)));
    const loadout = options.loadout ?? randomLoadout(id);
    this.world.addPlayer(id, loadout);
    const spawned = this.world.getPlayer(id);
    if (spawned) {
      spawned.displayName = displayName;
      // Spread them out properly rather than stacking on the world's single
      // fallback spawn point.
      this.match.placePlayer(this.world, spawned);
    }
    this.match.identities.bind(id, {
      identityId: `id_${id}`,
      displayName,
      isBot: true,
      botProfileId: name ?? displayName,
    });
    this.match.addPlayer(id, displayName);
    // First life counts as a spawn too.
    this.notifySpawn(id);
    this.ai.addAgent(id, { ...options, tier: rolled, loadout });
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
        // A custom match is the SAME mode definition with a clamped patch
        // applied -- there is no separate custom-match code path, which is
        // what makes every setting work rather than each needing plumbing.
        // `bots` is a boolean, so it does not go through sanitiseOverrides
        // (which clamps numbers). A host opting in turns filling back on for
        // this match only; resetAll() clears it again.
        if (msg.rules && typeof msg.rules.bots === 'boolean') {
          this.botsRequested = msg.rules.bots;
        }
        const clean = msg.rules ? sanitiseOverrides(msg.rules) : undefined;
        const custom = clean
          ? customise(getGameMode(msg.modeId ?? 'ffa'), clean)
          : undefined;
        this.startMatch(msg.levelId, msg.modeId, custom);
        // AFTER startMatch: it calls resetAll(), which deliberately clears
        // this so one match's custom size cannot leak into the next. The
        // host's explicit count must outlive that reset, so it is recorded
        // once the new match exists.
        this.explicitPlayerCount = typeof clean?.maxPlayers === 'number'
          ? clean.maxPlayers
          : null;
        const spawn = this.world.addPlayer(connection.id, msg.loadout);
        // A human is a player exactly as a bot is: same name authority, same
        // scoreboard, same spawn selection. Without this registration the
        // human would be missing from their own match's scoreboard, which is
        // the kind of asymmetry that makes bots detectable.
        const chosen = msg.loadout?.operatorId;
        const player = this.world.getPlayer(connection.id);
        if (player) {
          player.displayName = msg.name
            ? this.names.claim(msg.name, this.nameRng)
            : this.names.generateUnique(this.nameRng);
          this.match.placePlayer(this.world, player);
          if (chosen && player.loadout) {
            player.loadout = { ...player.loadout, operatorId: chosen };
          }
        }
        this.match.addPlayer(connection.id, player?.displayName);
        this.notifySpawn(connection.id);
        this.match.identities.bind(connection.id, {
          identityId: `identity:${connection.id}`,
          displayName: player?.displayName ?? connection.id,
          isBot: false,
        });
        // Fill the lobby to the mode's player count, so a solo player joins a
        // populated match rather than an empty map.
        if (this.botsEnabled) this.fillLobby();
        // Report where the player ACTUALLY is, not the world's fallback
        // spawn: placePlayer may have moved them, and a client told the wrong
        // spawn teleports itself somewhere the server does not agree with.
        const placed = player ?? null;
        this.sendTo(connection, {
          t: 'matchReady',
          levelId: msg.levelId,
          spawn: placed ? [placed.px, placed.py, placed.pz] : spawn.pos,
          spawnYaw: placed ? placed.yaw : spawn.yaw,
        });
        break;
      }

      case 'leaveMatch': {
        connection.joined = false;
        this.world.removePlayer(connection.id);
        this.match.removePlayer(connection.id);
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

  startMatch(levelId: string, modeId?: string, mode?: GameModeDefinition): void {
    // Re-joining a match already running on this level AND these rules is a
    // no-op (a second client joining must not restart the match). But a
    // different mode, or a custom rule set, IS a different match -- checking
    // only the level meant replaying the same map as Team Deathmatch
    // silently kept the previous match's free-for-all rules.
    const requested = mode ?? getGameMode(modeId ?? this.match.getMode().id);
    const current = this.match.getMode();
    const sameRules = current.id === requested.id
      && current.scoreLimit === requested.scoreLimit
      && current.timeLimitSeconds === requested.timeLimitSeconds
      && current.maxPlayers === requested.maxPlayers
      && current.respawnDelaySeconds === requested.respawnDelaySeconds;
    if (this.levelId === levelId && this.running && sameRules) return;
    // The mode has to be set BEFORE onMatchStart, because the match system
    // reads its time limit there. `mode` wins over `modeId` so a custom match
    // can pass an edited definition rather than a registry lookup.
    this.match.setMode(requested);
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
      this.collision.load(cached.boxes, cached.terrain, cached.killPlaneY);
      this.world.setSpawnPoints([{ pos: cached.spawn, yaw: cached.spawnYaw }]);
      this.applySpawnSets(cached);
      this.ai.buildNavigation();
      return;
    }
    // Until the real geometry lands, a floor: without one, every player
    // spawned during the fetch falls out of the world.
    this.collision.load([{
      minX: -200, minY: -1, minZ: -200, maxX: 200, maxY: 0, maxZ: 200, surface: 'concrete',
    }], null, -25);
    this.levelLoad = this.levels.load(levelId).then((data) => {
      // The match may have ended or changed level while this was in flight.
      if (this.levelId !== levelId) return;
      this.collision.load(data.boxes, data.terrain, data.killPlaneY);
      this.world.setSpawnPoints([{ pos: data.spawn, yaw: data.spawnYaw }]);
      this.applySpawnSets(data);
      // Players who joined while this was in flight were placed against the
      // temporary floor, which has no spawn sets -- so they are all standing
      // on the same fallback point. Now that the real geometry and its spawn
      // sets are here, place them properly.
      this.replaceAllSpawns();
      // Navigation is derived from the collision that just landed, so it can
      // never describe a different world than the one players collide with.
      this.ai.buildNavigation();
      // The map's own lobby size only becomes knowable now: anyone who joined
      // during the fetch was sized against the mode alone, because the level
      // data carrying `recommendedPlayers` had not arrived yet. Top up once
      // it has, so a large map is populated rather than eight players lost
      // in it. fillLobby only ever ADDS, so this cannot evict anyone.
      //
      // Only when somebody has actually JOINED, though. A server that has
      // been handed a level but has no players is a server nobody asked to
      // populate -- filling it here would conjure a lobby out of a bare
      // startMatch() and make the population depend on load timing.
      if (this.botsEnabled && this.running && this.hasJoinedPlayer()) this.fillLobby();
    }).catch((error: unknown) => {
      console.warn(`[server] level "${levelId}" collision failed to load:`, error);
    });
  }

  /**
   * Hand the level's spawn sets to the selector.
   *
   * The sets ride along in the collision payload because they are derived
   * from exactly that geometry (tools/generateSpawnPoints.mjs probes the
   * baked boxes), so shipping them together means they can never describe a
   * layout the server is not simulating. A level without sets falls back to
   * its single legacy spawn, which is why old maps keep working.
   */
  private applySpawnSets(data: { spawns?: unknown; spawn: Vec3; spawnYaw: number }): void {
    const sets = data.spawns as
      | { ffa?: SpawnPoint[]; teamA?: SpawnPoint[]; teamB?: SpawnPoint[] }
      | undefined;
    if (sets && (sets.ffa?.length || sets.teamA?.length)) {
      this.match.spawns.loadSets(sets);
      return;
    }
    const single = [{ pos: data.spawn, yaw: data.spawnYaw }];
    this.match.spawns.loadSets({ ffa: single, teamA: single, teamB: single });
  }

  /**
   * Re-place every player using the now-loaded spawn sets.
   *
   * Only safe at the very start of a match, which is the only time it is
   * called: teleporting a player mid-fight would be indefensible.
   */
  private replaceAllSpawns(): void {
    for (const player of this.world.allPlayers) {
      this.match.placePlayer(this.world, player);
      const connection = this.connections.get(player.id);
      if (connection?.joined) {
        this.sendTo(connection, {
          t: 'respawned', pos: [player.px, player.py, player.pz], yaw: player.yaw,
        });
      }
    }
  }

  /** Resolves once any in-flight level load has settled. For tests. */
  whenLevelReady(): Promise<void> { return this.levelLoad ?? Promise.resolve(); }

  /**
   * Top the lobby up to the mode's player count.
   *
   * Call of Duty does not drop you into an empty map, and neither should we:
   * FFA is an eight-player mode, so eight players is what a match has. The
   * ones the matchmaker could not find humans for are filled in — which is
   * exactly what COD does too, and exactly why they must be indistinguishable
   * from the humans they are standing in for.
   */
  /** Bots are on when the server was built for them or a host asked. */
  private get botsEnabled(): boolean {
    return this.autoFill || this.botsRequested;
  }

  fillLobby(): void {
    const target = this.lobbyTarget();
    let present = 0;
    for (const connection of this.connections.values()) {
      if (connection.joined) present += 1;
    }
    present += this.ai.agentCount;
    for (let i = present; i < target; i += 1) this.addBot();
  }

  /**
   * How many players this match should contain.
   *
   * The mode's count is balanced for a normal-sized map, so a large one may
   * ask for more via `recommendedPlayers` -- otherwise eight players spread
   * over 520 m never meet and the match plays like an empty server. A host
   * who named a player count in a custom match always wins: an explicit
   * choice must not be silently overruled by a map's preference.
   */
  private lobbyTarget(): number {
    const mode = this.match.getMode();
    if (this.explicitPlayerCount !== null) return this.explicitPlayerCount;
    const hint = this.levels?.peek(this.levelId ?? '')?.recommendedPlayers;
    if (typeof hint !== 'number' || !Number.isFinite(hint)) return mode.maxPlayers;
    // Never below the mode's own count: a map hint raises a thin lobby, it
    // does not shrink a mode that wants a crowd.
    return Math.max(mode.maxPlayers, Math.min(RULE_LIMITS.maxPlayers.max, Math.round(hint)));
  }

  /**
   * Build the killcam for a death, from what was actually recorded.
   *
   * Returns null when the death is too old to still be in the rolling window
   * -- a caller must handle that rather than assume a clip always exists.
   *
   * The plan is computed FRESH every time, never stored. That is what lets
   * improved camera logic apply retroactively to a replay recorded before it
   * was written.
   */
  buildKillcam(victimId: PlayerId): KillcamClip & { plan: KillcamPlan } | null {
    // The most recent kill with this victim. Searching the log rather than
    // tracking deaths separately means anything that can kill -- including
    // abilities added later -- is found without registering itself here.
    const kills = this.events.ofType('kill');
    for (let i = kills.length - 1; i >= 0; i -= 1) {
      const event = kills[i];
      const payload = event.payload as {
        victim: string; killer: string | null; causer: string | null;
        capabilityId: string | null; selfInflicted: boolean;
      };
      if (payload.victim !== victimId) continue;

      const plan = buildKillcamPlan({
        tick: event.tick,
        victim: payload.victim,
        killer: payload.killer,
        causer: payload.causer,
        capabilityId: payload.capabilityId,
        selfInflicted: payload.selfInflicted,
      }, TICK_HZ);

      const frames = this.replay.window(plan.fromTick, plan.toTick);
      if (frames.length === 0) return null;

      return {
        plan,
        frames,
        events: this.events.slice(plan.fromTick, plan.toTick),
        fromTick: frames[0].tick,
        toTick: frames[frames.length - 1].tick,
      };
    }
    return null;
  }

  /** The modes this server can actually run. Test/UI seam. */
  knownModeIds(): string[] {
    return GAME_MODES.map((m) => m.id);
  }

  /** Whether any connection has actually joined the match. */
  private hasJoinedPlayer(): boolean {
    for (const connection of this.connections.values()) {
      if (connection.joined) return true;
    }
    return false;
  }

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
    // A new match starts with no history. Leaving the log populated would
    // put the previous match's kills on the new one's timeline.
    this.events.reset();
    this.replay.reset();
    // Geometry is match-scoped too: leaving it loaded means the next match
    // starts with the last map's walls until its own data arrives.
    this.collision.clear();
    this.accumulator = 0;
    this.tick = 0;
    this.elapsed = 0;
    this.pausedBySolo = false;
    // Bot numbering restarts, so a second match's roster is `p1..p8` again
    // rather than continuing from where the last one stopped.
    this.botCounter = 0;
    // Forget the last scoreboard we pushed. Without this the first state of
    // a NEW match can be suppressed as a duplicate of the old one's, and the
    // scoreboard silently shows the previous match until someone scores.
    this.lastMatchFingerprint = '';
    // A custom match's player count belongs to THAT match. Leaving it set
    // would size the next, ordinary match to the last host's choice.
    this.explicitPlayerCount = null;
    // One match's bot choice must not leak into the next.
    this.botsRequested = false;
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

  /** Last pushed match state, so unchanged scoreboards are not resent. */
  private lastMatchFingerprint = '';

  private broadcastSnapshot(): void {
    const entities: EntityState[] = this.world.collectEntityStates();
    // Built once per tick, not once per connection: the list is identical for
    // everyone, and a 32-player lobby would otherwise rebuild it 32 times.
    const allStates = this.world.getAllPlayerPublicStates()
      .map((state) => ({ ...state, team: this.match.teamOf(state.id) }));
    const removed = this.world.consumeRemovedIds();
    const fx: FxEvent[] = this.world.consumeFxEvents();

    // Archive the authoritative view ONCE, before the per-connection loop.
    //
    // This is the whole recorder: the entity list, removals and effects have
    // already been built to send over the wire, so keeping a reference costs
    // nothing beyond the array itself. `ackSeq` is per-connection and
    // meaningless to a replay, so the recorded frame carries zero.
    this.replay.append({
      tick: this.tick,
      time: this.elapsed,
      // The players, who are the subject of any killcam, plus the entities.
      players: allStates,
      snapshot: {
        tick: this.tick,
        time: this.elapsed,
        ackSeq: 0,
        entities,
        ...(removed.length ? { removed } : {}),
        ...(fx.length ? { fx } : {}),
      },
    });

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

      // ...and everyone else, or the client renders an empty map while the
      // killfeed fills with names it has never seen a body for.
      this.sendTo(connection, { t: 'playerStates', states: allStates });

      const slots = this.world.getKillstreakSlots(connection.id);
      if (slots) this.sendTo(connection, { t: 'killstreakState', slots });
    }

    this.broadcastMatchState();
  }

  /**
   * Push scoreboard/clock/phase, but only when it actually changed.
   *
   * The clock is quantised to whole seconds for this comparison: it changes
   * continuously, and a client that re-renders the scoreboard sixty times a
   * second to move a timer that displays whole seconds is burning frames for
   * nothing.
   */
  private broadcastMatchState(): void {
    const snap = this.match.snapshot();
    const state: MatchStateWire = {
      phase: snap.phase,
      modeId: snap.modeId,
      modeName: snap.modeName,
      timeRemaining: snap.timeRemaining,
      countdown: this.match.countdownRemaining,
      scoreLimit: snap.scoreLimit,
      teamBased: snap.teamBased,
      teamScores: snap.teamScores,
      standings: snap.standings.map((row) => ({
        id: row.id,
        name: row.name,
        team: row.team,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        score: row.score,
        streak: row.streak,
      })),
    };

    const fingerprint = `${state.phase}|${Math.ceil(state.timeRemaining)}`
      + `|${Math.ceil(state.countdown)}|${state.teamScores.A}|${state.teamScores.B}|`
      + state.standings.map((r) => `${r.id}:${r.score}:${r.kills}:${r.deaths}`).join(',');
    if (fingerprint === this.lastMatchFingerprint) return;
    this.lastMatchFingerprint = fingerprint;

    for (const connection of this.connections.values()) {
      if (!connection.joined) continue;
      this.sendTo(connection, { t: 'matchState', state });
    }
  }

  /**
   * Turn the match system's events into client messages.
   *
   * Death is the one that matters: the victim is TOLD they died, by whom, and
   * when they may return. The client never decides any of that, which is what
   * makes a death impossible to desync.
   */
  private dispatchMatchEvents(event: MatchEvent): void {
    {
      if (event.kind === 'death') {
        const record = event.record;
        const entry: KillfeedWire = {
          killerName: record.killer ? this.match.identities.nameOf(record.killer) : null,
          victimName: this.match.identities.nameOf(record.victim),
          weaponId: record.weaponId,
          headshot: record.headshot,
          killerId: record.killer,
          victimId: record.victim,
          killerTeam: record.killer ? this.match.teamOf(record.killer) : null,
          victimTeam: this.match.teamOf(record.victim),
        };
        for (const connection of this.connections.values()) {
          if (!connection.joined) continue;
          this.sendTo(connection, { t: 'killfeed', entry });
        }
        const victimConnection = this.connections.get(record.victim);
        if (victimConnection?.joined) {
          this.sendTo(victimConnection, {
            t: 'died',
            death: {
              victim: record.victim,
              victimName: entry.victimName,
              killer: record.killer,
              killerName: entry.killerName,
              weaponId: record.weaponId,
              headshot: record.headshot,
              distance: record.distance,
              victimPos: [...record.victimPos] as Vec3,
              killerPos: record.killerPos ? [...record.killerPos] as Vec3 : null,
            },
            respawnIn: Math.max(0, event.respawnAt - this.elapsed),
          });
        }
      } else if (event.kind === 'respawn') {
        // Tell every system a life began, so per-life state (ammunition,
        // equipment, regeneration timers) is rebuilt rather than inherited
        // from the corpse.
        this.notifySpawn(event.player);
        const connection = this.connections.get(event.player);
        const player = this.world.getPlayer(event.player);
        if (connection?.joined && player) {
          this.sendTo(connection, {
            t: 'respawned', pos: [player.px, player.py, player.pz], yaw: player.yaw,
          });
        }
      } else if (event.kind === 'ended') {
        for (const connection of this.connections.values()) {
          if (!connection.joined) continue;
          this.sendTo(connection, { t: 'matchEnded', reason: event.reason });
        }
      }
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
  /** How many agents are on the roster. Reset between matches. */
  get aiAgentCount(): number { return this.ai.agentCount; }
  get playerCount(): number { return this.connections.size; }
  get activeLevelId(): string | null { return this.levelId; }
  get isMatchActive(): boolean { return this.running; }
}
