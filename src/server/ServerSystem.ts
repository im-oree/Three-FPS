/**
 * ServerSystem.ts — the contract every authoritative system implements.
 *
 * This is the extension point that keeps GameServer from ever needing to know
 * what a bullet, a helicopter or a grenade is. Migrating a client system to
 * the server means writing one of these and calling server.addSystem() — no
 * change to GameServer itself, which is what stops it growing into a
 * thousand-line god object as the rest of the game moves across.
 *
 * The lifecycle hooks exist because a long-lived server must be able to
 * return to a clean slate without being restarted. `reset()` in particular is
 * not optional bookkeeping: it is what makes "quit to menu and start a new
 * match" produce a genuinely fresh world rather than one haunted by the last
 * one's entities, cooldowns and pooled objects.
 */
import type { ServerWorld } from './ServerWorld';
import type { PlayerId } from '../net/Protocol';

export interface ServerSystem {
  /** Stable name, for debugging and profiling. */
  readonly name: string;

  /** Called once when the system is registered. */
  attach?(world: ServerWorld): void;

  /** Fixed-timestep simulation step. dt is always TICK_SECONDS. */
  tick(dt: number, world: ServerWorld): void;

  /** A match is starting on this level. */
  onMatchStart?(levelId: string): void;

  /**
   * A player just (re)spawned and must be returned to a fighting state.
   *
   * Systems that hold per-life state implement this. Weapon ammunition is
   * the obvious one: without it, magazines and reserves persisted across
   * deaths, so after about a minute every bot in the match was standing
   * around at 0/0 with nothing to shoot and the kill count simply stopped.
   */
  onPlayerSpawn?(id: PlayerId): void;

  /** The match ended. Release anything match-scoped. */
  onMatchEnd?(reason: string): void;

  /**
   * Return to a pristine state: clear queues, release pooled objects, zero
   * timers. Called on match start AND match end, so it must be idempotent.
   */
  reset?(): void;

  /** Permanent teardown. The system will not be used again. */
  dispose?(): void;
}
