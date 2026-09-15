/**
 * RoomManager.ts — many matches on one process.
 *
 * A room owns exactly one GameServer. That is the whole design: rooms are not
 * a feature inside the simulation, they are a layer that OWNS simulations. So
 * the simulation never learns it might be one of several, and nothing written
 * against a single match has to change to support many.
 *
 * The same class backs both deployments. In-process there is one room and the
 * player is dropped straight into it; on a hosted backend there are many and
 * the player picks. Because the client speaks the same protocol messages
 * either way, "host a game" is not a separate code path from "play solo".
 *
 * PURE: no renderer, no DOM, no client imports. Enforced by
 * tools/verify/server-purity.mjs.
 */
import { GameServer } from './GameServer';
import type { RoomInfo, PlayerId, ServerTransport } from '../net/Protocol';

export interface RoomOptions {
  readonly name: string;
  readonly levelId: string;
  readonly maxPlayers?: number;
  readonly private?: boolean;
}

/** Bounded so a hosted process cannot be driven out of memory by room spam. */
const MAX_ROOMS = 64;
const DEFAULT_MAX_PLAYERS = 12;
/** A room with nobody in it is torn down after this long. */
const EMPTY_ROOM_GRACE_SECONDS = 30;

export class Room {
  readonly server = new GameServer();
  /** Seconds this room has been empty. Reset whenever anyone is present. */
  private emptyFor = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly levelId: string,
    readonly maxPlayers: number,
    readonly isPrivate: boolean,
  ) {}

  get playerCount(): number { return this.server.playerCount; }
  get isFull(): boolean { return this.playerCount >= this.maxPlayers; }
  get isEmpty(): boolean { return this.playerCount === 0; }
  get expired(): boolean { return this.isEmpty && this.emptyFor >= EMPTY_ROOM_GRACE_SECONDS; }

  get info(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      levelId: this.levelId,
      playerCount: this.playerCount,
      maxPlayers: this.maxPlayers,
      inProgress: this.server.isMatchActive,
      private: this.isPrivate,
    };
  }

  admit(transport: ServerTransport): PlayerId {
    this.emptyFor = 0;
    return this.server.accept(transport);
  }

  update(realSeconds: number): void {
    // An empty room still gets ticked, briefly: a player reconnecting within
    // the grace window rejoins the match they were in rather than a new one.
    if (this.isEmpty) this.emptyFor += realSeconds;
    else this.emptyFor = 0;
    this.server.update(realSeconds);
  }

  dispose(): void {
    this.server.shutdown();
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private nextRoomNumber = 0;

  get count(): number { return this.rooms.size; }
  get all(): readonly Room[] { return [...this.rooms.values()]; }

  /** Rooms a lobby should display: public, not full, not finished. */
  get listable(): readonly RoomInfo[] {
    return this.all.filter((r) => !r.isPrivate && !r.isFull).map((r) => r.info);
  }

  get(id: string): Room | null { return this.rooms.get(id) ?? null; }

  create(options: RoomOptions): Room {
    if (this.rooms.size >= MAX_ROOMS) {
      throw new Error(`room limit reached (${MAX_ROOMS})`);
    }
    const id = `r${this.nextRoomNumber++}`;
    // Clamp rather than trust: maxPlayers arrives from a client.
    const maxPlayers = Math.max(
      1,
      Math.min(options.maxPlayers ?? DEFAULT_MAX_PLAYERS, DEFAULT_MAX_PLAYERS),
    );
    const name = options.name.slice(0, 40).trim() || `Room ${id}`;
    const room = new Room(id, name, options.levelId, maxPlayers, options.private ?? false);
    this.rooms.set(id, room);
    return room;
  }

  destroy(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    room.dispose();
    this.rooms.delete(id);
  }

  /**
   * Advance every room, then reap the ones that have been empty too long.
   *
   * Reaping is the difference between a backend that survives a weekend and
   * one that accumulates dead matches until it is killed by the host.
   */
  update(realSeconds: number): void {
    for (const room of this.rooms.values()) room.update(realSeconds);
    for (const room of [...this.rooms.values()]) {
      if (room.expired) this.destroy(room.id);
    }
  }

  disposeAll(): void {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}
