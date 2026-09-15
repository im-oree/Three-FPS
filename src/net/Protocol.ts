/**
 * Protocol.ts — the wire contract between client and server.
 *
 * THE POINT OF THIS FILE
 * ----------------------
 * This is the ONLY thing the client and the server agree on. Both sides
 * import these types and nothing else from each other. That constraint is
 * what makes the in-process server and a future hosted Node server
 * interchangeable: if a change does not appear here, it cannot possibly
 * desync the two, and if it does appear here, both sides get it from the
 * same declaration and TypeScript fails the build on either side that has
 * not handled it.
 *
 * Everything is a plain JSON-serialisable value. No THREE types, no class
 * instances, no functions. A message that cannot survive JSON.stringify
 * cannot cross a WebSocket, so allowing one here would let code compile
 * offline and fail the moment a real backend is plugged in.
 *
 * NAMING: `C2S` = client to server (intent). `S2C` = server to client
 * (authority). The client never tells the server what HAPPENED, only what
 * the player TRIED to do; the server decides and tells everyone.
 */

/** Protocol version. Bump on any breaking change; the server rejects mismatches. */
export const PROTOCOL_VERSION = 1;

/** Fixed simulation rate. Both sides must agree or reconciliation drifts. */
export const TICK_HZ = 60;
export const TICK_SECONDS = 1 / TICK_HZ;

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

/** Stable identity for anything the server simulates. */
export type EntityId = string;
/** Stable identity for a connected participant. */
export type PlayerId = string;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

/**
 * One frame of player intent.
 *
 * Deliberately intent, not results: `fire: true` means "the player pulled the
 * trigger", not "a bullet was fired" and certainly not "an enemy was hit".
 * The server owns whether the weapon was ready, whether a round existed, and
 * what it struck.
 *
 * `seq` lets the server acknowledge inputs so the client can reconcile its
 * prediction, and lets it discard duplicates and out-of-order arrivals.
 */
export interface InputFrame {
  readonly seq: number;
  /** Seconds this input covers. Clamped server-side; never trusted. */
  readonly dt: number;
  readonly moveX: number;
  readonly moveZ: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly buttons: number;
  /** Vehicle-specific axes, only meaningful while seated. */
  readonly vehicle?: {
    readonly throttle: number;
    readonly steer: number;
    readonly brake: number;
    readonly pitch: number;
    readonly roll: number;
    readonly yawAxis: number;
    readonly collective: number;
  };
}

/** Bitmask for InputFrame.buttons — one number beats fifteen booleans. */
export const Button = {
  Fire: 1 << 0,
  ADS: 1 << 1,
  Jump: 1 << 2,
  Crouch: 1 << 3,
  Sprint: 1 << 4,
  Reload: 1 << 5,
  Interact: 1 << 6,
  Melee: 1 << 7,
  ThrowLethal: 1 << 8,
  ThrowTactical: 1 << 9,
  SwapWeapon: 1 << 10,
} as const;

export type C2S =
  | { readonly t: 'hello'; readonly version: number; readonly name?: string }
  | { readonly t: 'joinMatch'; readonly levelId: string; readonly loadout?: LoadoutSpec }
  | { readonly t: 'leaveMatch' }
  | { readonly t: 'input'; readonly frame: InputFrame }
  | { readonly t: 'setLoadout'; readonly loadout: LoadoutSpec }
  | { readonly t: 'callKillstreak'; readonly slot: number }
  | { readonly t: 'enterVehicle'; readonly vehicle: EntityId; readonly seat: string }
  | { readonly t: 'exitVehicle' }
  /**
   * Pause is a REQUEST, not a command. In single-player the server may honour
   * it by halting the simulation; in multiplayer it must not, because one
   * player's menu cannot freeze everyone else's match. The client must never
   * assume the world stopped.
   */
  | { readonly t: 'requestPause'; readonly paused: boolean };

export interface LoadoutSpec {
  readonly primaryId: string;
  readonly secondaryId: string;
  readonly tacticalId: string;
  readonly killstreakIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

/**
 * A simulated entity's authoritative transform.
 *
 * Sent every snapshot for everything the client draws from server state.
 * `kind` tells the client which visual to bind; the client owns the model,
 * the server owns the numbers.
 */
export interface EntityState {
  readonly id: EntityId;
  readonly kind: string;
  readonly pos: Vec3;
  readonly rot?: Quat;
  /** Velocity, for client-side interpolation between snapshots. */
  readonly vel?: Vec3;
  /** Free-form per-kind state (rotor spin, turret yaw, health fraction...). */
  readonly data?: Readonly<Record<string, number | string | boolean>>;
}

/**
 * Cosmetic events: things that HAPPENED and should be drawn once.
 *
 * The decision recorded here (and agreed with the user): the server decides
 * WHAT happened, the client owns HOW it looks. Shipping per-particle state
 * over a wire is impractical for a hosted backend and would cap the effect
 * budget hard; shipping "an explosion of radius 8 occurred at X" costs one
 * small message and replicates perfectly.
 */
export type FxEvent =
  | { readonly t: 'tracer'; readonly from: Vec3; readonly to: Vec3; readonly weaponId?: string }
  | { readonly t: 'impact'; readonly at: Vec3; readonly normal: Vec3; readonly surface: string }
  | { readonly t: 'explosion'; readonly at: Vec3; readonly radius: number; readonly shake?: number }
  | { readonly t: 'muzzleFlash'; readonly entity: EntityId; readonly socket?: string }
  | { readonly t: 'sound'; readonly key: string; readonly at?: Vec3; readonly volume?: number }
  | { readonly t: 'hitMarker'; readonly lethal: boolean }
  | { readonly t: 'damage'; readonly target: EntityId; readonly amount: number; readonly at: Vec3 };

/** A full or delta view of the world at one tick. */
export interface Snapshot {
  readonly tick: number;
  /** Server time in seconds since the match started. */
  readonly time: number;
  /** Highest input seq the server has consumed for THIS client. */
  readonly ackSeq: number;
  readonly entities: readonly EntityState[];
  /** Entities that no longer exist and must be released by the client. */
  readonly removed?: readonly EntityId[];
  readonly fx?: readonly FxEvent[];
}

export type S2C =
  | { readonly t: 'welcome'; readonly version: number; readonly playerId: PlayerId; readonly tickHz: number }
  | { readonly t: 'rejected'; readonly reason: string }
  | { readonly t: 'matchLoading'; readonly levelId: string }
  | { readonly t: 'matchReady'; readonly levelId: string; readonly spawn: Vec3; readonly spawnYaw: number }
  | { readonly t: 'matchEnded'; readonly reason: string }
  | { readonly t: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly t: 'killstreakState'; readonly slots: readonly KillstreakSlotState[] }
  | { readonly t: 'playerState'; readonly state: PlayerPublicState }
  /** The server confirming whether the world is actually running. */
  | { readonly t: 'simulationState'; readonly running: boolean; readonly reason: string };

export interface KillstreakSlotState {
  readonly id: string;
  readonly state: 'ready' | 'locked' | 'cooling' | 'active';
  readonly remaining: number;
}

export interface PlayerPublicState {
  readonly id: PlayerId;
  readonly health: number;
  readonly maxHealth: number;
  readonly alive: boolean;
  readonly pos: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  /** Which vehicle/seat they occupy, if any. */
  readonly vehicle?: { readonly id: EntityId; readonly seat: string };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * The seam that makes local and networked play the same code.
 *
 * An in-process implementation calls the handler synchronously; a WebSocket
 * implementation serialises to JSON and calls it on receive. Nothing above
 * this interface can tell the difference, which is the entire point: the
 * game is written once, against a socket-shaped API, and gains real
 * networking by swapping the implementation.
 */
export interface Transport<TOut, TIn> {
  send(message: TOut): void;
  onMessage(handler: (message: TIn) => void): () => void;
  /** Resolves when the transport is ready to carry traffic. */
  connect(): Promise<void>;
  close(): void;
  /**
   * Notify when the link drops, from either end. A server that cannot observe
   * a disconnect leaks the player's slot and, with rooms, never frees the
   * room -- so this is part of the contract, not an optional extra.
   * Returns an unsubscribe function.
   */
  onClose(handler: (reason: string) => void): () => void;
  readonly connected: boolean;
  /** Round-trip time estimate in ms; 0 for in-process. */
  readonly rttMs: number;
}

export type ClientTransport = Transport<C2S, S2C>;
export type ServerTransport = Transport<S2C, C2S>;
