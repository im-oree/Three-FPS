/**
 * ServerWorld.ts — the authoritative state every system reads and writes.
 *
 * Holds entities, players, queued input and the per-tick effect queue. This
 * is the "one source of truth" the client is not allowed to second-guess.
 *
 * NO THREE, NO DOM. See the note in GameServer.ts: vectors here are plain
 * number triples, not THREE.Vector3, because this file has to run unmodified
 * inside a Node process with no renderer. Converting to THREE types is the
 * client's job, at the boundary, where it belongs.
 *
 * ENTITY POOLING
 * --------------
 * Entities are recycled through a free list rather than allocated per spawn.
 * A shooter spawns and destroys bullets, casings, explosions and corpses
 * constantly, and allocating a fresh object for each is what produces the
 * periodic GC hitch that makes a game feel worse than its frame rate says it
 * should. The pool is cleared on reset() — a pool that survives a match is
 * how a new match inherits a previous one's ghosts.
 */
import type {
  EntityId, EntityState, FxEvent, InputFrame, KillstreakSlotState,
  LoadoutSpec, PlayerId, PlayerPublicState, Vec3,
} from '../net/Protocol';
// Shared tuning: the server uses the SAME numbers the client always has, so
// there is no second set of movement constants to drift out of sync.
import { PLAYER } from '../utils/Constants';

/** Mutable server-side entity. Only a projection of this crosses the wire. */
export interface ServerEntity {
  id: EntityId;
  kind: string;
  /** Mutable position, written in place to avoid per-tick allocation. */
  px: number; py: number; pz: number;
  /** Orientation quaternion. */
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  /** Who spawned this, when that matters (killstreaks, projectiles). */
  owner: PlayerId | null;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** Per-kind extras that the client needs in order to draw it. */
  data: Record<string, number | string | boolean>;
  /** Set false to return the entity to the pool at the end of the tick. */
  active: boolean;
}

export interface ServerPlayer {
  id: PlayerId;
  /** Shown to other players. Set by whoever created the player. */
  displayName: string;
  px: number; py: number; pz: number;
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  loadout: LoadoutSpec | null;
  /** Input frames received but not yet consumed by the movement system. */
  pendingInput: InputFrame[];
  /** Occupied vehicle, if any. */
  vehicleId: EntityId | null;
  vehicleSeat: string | null;
  killstreakSlots: KillstreakSlotState[];

  // --- movement state, owned by MovementSystem -----------------------------
  // Velocity is authoritative: the client may predict it, but this is the
  // copy that decides where the player actually is.
  vx: number; vy: number; vz: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  /** Current capsule height; interpolates between stand and crouch. */
  height: number;
  /** Seconds of coyote time left — a jump is still legal just after a ledge. */
  coyote: number;
  /** Set while a jump input is held, so holding does not re-trigger. */
  jumpHeld: boolean;
  /** Highest Y reached since leaving the ground, for fall damage. */
  fallPeakY: number;
  /** Last input sequence consumed, echoed back so the client can reconcile. */
  lastProcessedSeq: number;
  /** Button mask from the most recent input, read by combat and interaction. */
  lastButtons: number;
}

export interface SpawnPoint { pos: Vec3; yaw: number }

export class ServerWorld {
  private readonly entities = new Map<EntityId, ServerEntity>();
  private readonly players = new Map<PlayerId, ServerPlayer>();

  /** Recycled entity objects, never handed out while active. */
  private readonly pool: ServerEntity[] = [];
  private nextEntityNumber = 0;

  /** Effects raised this tick, drained by the server when it broadcasts. */
  private readonly fx: FxEvent[] = [];
  /** Entities destroyed this tick, so the client can release its visuals. */
  private readonly removed: EntityId[] = [];

  private tickNumber = 0;
  private timeSeconds = 0;

  /** Where players spawn until a level supplies real spawn points. */
  private spawnPoints: SpawnPoint[] = [{ pos: [0, 1, 0], yaw: 0 }];
  private nextSpawnIndex = 0;

  // --- tick boundaries -----------------------------------------------------

  beginTick(tick: number, time: number): void {
    this.tickNumber = tick;
    this.timeSeconds = time;
  }

  /** Recycle anything that died this tick. */
  endTick(): void {
    for (const entity of this.entities.values()) {
      if (entity.active) continue;
      this.entities.delete(entity.id);
      this.removed.push(entity.id);
      this.pool.push(entity);
    }
  }

  get tick(): number { return this.tickNumber; }
  get time(): number { return this.timeSeconds; }

  // --- entities ------------------------------------------------------------

  spawnEntity(kind: string, pos: Vec3, owner: PlayerId | null = null): ServerEntity {
    const recycled = this.pool.pop();
    const id: EntityId = `e${this.nextEntityNumber++}`;
    const entity: ServerEntity = recycled ?? {
      id, kind,
      px: 0, py: 0, pz: 0,
      qx: 0, qy: 0, qz: 0, qw: 1,
      vx: 0, vy: 0, vz: 0,
      owner: null, health: 1, maxHealth: 1, alive: true,
      data: {}, active: true,
    };
    // A recycled entity must be fully reinitialised. Leaving a single stale
    // field is how a reused bullet arrives already "dead", or a new
    // helicopter spawns with the last one's health.
    entity.id = id;
    entity.kind = kind;
    entity.px = pos[0]; entity.py = pos[1]; entity.pz = pos[2];
    entity.qx = 0; entity.qy = 0; entity.qz = 0; entity.qw = 1;
    entity.vx = 0; entity.vy = 0; entity.vz = 0;
    entity.owner = owner;
    entity.health = 1; entity.maxHealth = 1; entity.alive = true;
    entity.active = true;
    // Reuse the object rather than replacing it, so the pool does not churn
    // a fresh Record per spawn.
    for (const key of Object.keys(entity.data)) delete entity.data[key];
    this.entities.set(id, entity);
    return entity;
  }

  destroyEntity(id: EntityId): void {
    const entity = this.entities.get(id);
    if (entity) entity.active = false;   // recycled in endTick()
  }

  getEntity(id: EntityId): ServerEntity | undefined { return this.entities.get(id); }
  get allEntities(): IterableIterator<ServerEntity> { return this.entities.values(); }
  get entityCount(): number { return this.entities.size; }
  get pooledCount(): number { return this.pool.length; }

  // --- players -------------------------------------------------------------

  addPlayer(id: PlayerId, loadout?: LoadoutSpec): SpawnPoint {
    const spawn = this.spawnPoints[this.nextSpawnIndex % this.spawnPoints.length];
    this.nextSpawnIndex += 1;
    this.players.set(id, {
      id,
      displayName: id,
      px: spawn.pos[0], py: spawn.pos[1], pz: spawn.pos[2],
      yaw: spawn.yaw, pitch: 0,
      health: 100, maxHealth: 100, alive: true,
      loadout: loadout ?? null,
      pendingInput: [],
      vehicleId: null, vehicleSeat: null,
      killstreakSlots: [],
      vx: 0, vy: 0, vz: 0,
      grounded: false,
      crouching: false,
      sprinting: false,
      height: PLAYER.STAND_HEIGHT,
      coyote: 0,
      jumpHeld: false,
      fallPeakY: spawn.pos[1],
      lastProcessedSeq: -1,
      lastButtons: 0,
    });
    return spawn;
  }

  removePlayer(id: PlayerId): void { this.players.delete(id); }
  getPlayer(id: PlayerId): ServerPlayer | undefined { return this.players.get(id); }
  get allPlayers(): IterableIterator<ServerPlayer> { return this.players.values(); }
  get playerCount(): number { return this.players.size; }

  /** Every player id currently in the world. */
  playerIds(): PlayerId[] { return [...this.players.keys()]; }

  setSpawnPoints(points: readonly SpawnPoint[]): void {
    if (points.length) this.spawnPoints = [...points];
    this.nextSpawnIndex = 0;
  }

  queueInput(id: PlayerId, frame: InputFrame): void {
    const player = this.players.get(id);
    if (!player) return;
    // Bound the queue. A client that floods input (buggy or malicious) must
    // not grow server memory without limit; dropping the oldest keeps the
    // most recent intent, which is the one that matters.
    if (player.pendingInput.length > 32) player.pendingInput.shift();
    player.pendingInput.push(frame);
  }

  setLoadout(id: PlayerId, loadout: LoadoutSpec): void {
    const player = this.players.get(id);
    if (player) player.loadout = loadout;
  }

  // --- requests from clients (validated by the owning system) --------------

  /** Set by the killstreak system; the world only carries the request. */
  readonly killstreakRequests: { player: PlayerId; slot: number }[] = [];
  readonly vehicleEnterRequests: { player: PlayerId; vehicle: EntityId; seat: string }[] = [];
  readonly vehicleExitRequests: PlayerId[] = [];

  requestKillstreak(player: PlayerId, slot: number): void {
    this.killstreakRequests.push({ player, slot });
  }

  requestEnterVehicle(player: PlayerId, vehicle: EntityId, seat: string): void {
    this.vehicleEnterRequests.push({ player, vehicle, seat });
  }

  requestExitVehicle(player: PlayerId): void {
    this.vehicleExitRequests.push(player);
  }

  // --- effects -------------------------------------------------------------

  /**
   * Raise a cosmetic event.
   *
   * The server decides that an explosion happened and where; the client
   * decides what an explosion looks like. That split is why this is a small
   * tagged union rather than particle state.
   */
  raiseFx(event: FxEvent): void {
    // Cap per tick. A pathological frame (a cluster of explosions) must not
    // produce a snapshot so large it stalls the connection.
    if (this.fx.length < 128) this.fx.push(event);
  }

  consumeFxEvents(): FxEvent[] {
    if (!this.fx.length) return [];
    const out = this.fx.slice();
    this.fx.length = 0;
    return out;
  }

  consumeRemovedIds(): EntityId[] {
    if (!this.removed.length) return [];
    const out = this.removed.slice();
    this.removed.length = 0;
    return out;
  }

  // --- serialisation -------------------------------------------------------

  collectEntityStates(): EntityState[] {
    const out: EntityState[] = [];
    for (const e of this.entities.values()) {
      if (!e.active) continue;
      out.push({
        id: e.id,
        kind: e.kind,
        pos: [e.px, e.py, e.pz],
        rot: [e.qx, e.qy, e.qz, e.qw],
        vel: [e.vx, e.vy, e.vz],
        ...(Object.keys(e.data).length ? { data: { ...e.data } } : {}),
      });
    }
    return out;
  }

  getPlayerPublicState(id: PlayerId): PlayerPublicState | null {
    const p = this.players.get(id);
    if (!p) return null;
    return {
      id: p.id,
      name: p.displayName,
      operatorId: p.loadout?.operatorId ?? 'ghost',
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      pos: [p.px, p.py, p.pz],
      yaw: p.yaw,
      pitch: p.pitch,
      ...(p.vehicleId && p.vehicleSeat
        ? { vehicle: { id: p.vehicleId, seat: p.vehicleSeat } } : {}),
    };
  }

  getKillstreakSlots(id: PlayerId): KillstreakSlotState[] | null {
    return this.players.get(id)?.killstreakSlots ?? null;
  }

  // --- reset ---------------------------------------------------------------

  /**
   * Drop all match state.
   *
   * Entities are released to the pool rather than discarded, so a new match
   * starts warm; everything else is zeroed. The pool itself is capped so a
   * long session with many matches cannot grow it without bound.
   */
  reset(): void {
    for (const entity of this.entities.values()) {
      entity.active = false;
      if (this.pool.length < 512) this.pool.push(entity);
    }
    this.entities.clear();
    this.players.clear();
    this.fx.length = 0;
    this.removed.length = 0;
    this.killstreakRequests.length = 0;
    this.vehicleEnterRequests.length = 0;
    this.vehicleExitRequests.length = 0;
    this.tickNumber = 0;
    this.timeSeconds = 0;
    this.nextSpawnIndex = 0;
  }
}
