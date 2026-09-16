/**
 * MatchSystem.ts — the match itself: clock, score, death and respawn.
 *
 * This is the system that makes a session a GAME rather than a sandbox. It is
 * authoritative for everything a scoreboard shows and everything that decides
 * when you are allowed to be alive.
 *
 * The single most important behavioural change it introduces: dying no longer
 * ends anything. Before this, `player:died` ran `endMatch()` on the client and
 * the whole session tore down. Now death is an ordinary state transition owned
 * here — you die, a timer runs, the spawn selector picks somewhere safe, and
 * you come back. The match ends only when the score limit or the clock says so.
 *
 * Killcam readiness: every death records who did it, from where, with what,
 * and at what simulation time (`DeathRecord`). Nothing consumes the full
 * record yet, but a killcam is "replay the last N seconds from the killer's
 * eye", and the identifying half of that is exactly this record. The field is
 * populated now so the killcam does not require a change to death handling.
 */
import type { PlayerId } from '../../net/Protocol';
import type { CollisionWorld } from '../CollisionWorld';
import type { ServerSystem } from '../ServerSystem';
import type { ServerPlayer, ServerWorld } from '../ServerWorld';
import type { ShotResult } from './CombatSystem';
import { FREE_FOR_ALL, type GameModeDefinition, type TeamId } from '../GameModes';
import { IdentityRegistry } from '../Identity';
import { SpawnSelector, type SpawnSetName } from '../SpawnSelector';

/** Cap on the undrained event queue, so an unsubscribed server cannot leak. */
const MAX_PENDING_EVENTS = 128;

export type MatchPhase = 'warmup' | 'countdown' | 'live' | 'ended';

export interface PlayerScore {
  readonly id: PlayerId;
  name: string;
  team: TeamId;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  /** Current consecutive kills, for killstreaks and the "on a streak" UI. */
  streak: number;
  bestStreak: number;
}

/** Everything a killcam will need, recorded at the moment of death. */
export interface DeathRecord {
  readonly victim: PlayerId;
  readonly killer: PlayerId | null;
  readonly weaponId: string | null;
  readonly at: number;
  readonly victimPos: readonly [number, number, number];
  readonly killerPos: readonly [number, number, number] | null;
  readonly headshot: boolean;
  /** Distance of the killing blow, shown on the death card. */
  readonly distance: number;
}

export type MatchEvent =
  | { kind: 'countdown'; secondsLeft: number }
  | { kind: 'started' }
  | { kind: 'death'; record: DeathRecord; respawnAt: number }
  | { kind: 'respawn'; player: PlayerId }
  | { kind: 'ended'; reason: string; standings: readonly PlayerScore[] };

export interface MatchSnapshot {
  readonly phase: MatchPhase;
  readonly modeId: string;
  readonly modeName: string;
  readonly timeRemaining: number;
  readonly scoreLimit: number;
  readonly teamBased: boolean;
  readonly teamScores: { readonly A: number; readonly B: number };
  readonly standings: readonly PlayerScore[];
}

export class MatchSystem implements ServerSystem {
  readonly name = 'match';

  private mode: GameModeDefinition = FREE_FOR_ALL;
  private phase: MatchPhase = 'warmup';
  private clock = 0;
  private countdown = 0;

  private readonly scores = new Map<PlayerId, PlayerScore>();
  private readonly teams = new Map<PlayerId, TeamId>();
  private readonly respawnAt = new Map<PlayerId, number>();
  private readonly deaths: DeathRecord[] = [];
  private events: MatchEvent[] = [];
  private readonly listeners = new Set<(event: MatchEvent) => void>();

  readonly spawns = new SpawnSelector();
  readonly identities = new IdentityRegistry();

  /** Supplies the shots resolved this tick, so kills can be credited. */
  private shotSource: (() => readonly ShotResult[]) | null = null;
  private collision: CollisionWorld | null = null;

  constructor(collision?: CollisionWorld) {
    this.collision = collision ?? null;
  }

  setCollision(collision: CollisionWorld): void { this.collision = collision; }

  setKillSource(source: () => readonly ShotResult[]): void { this.shotSource = source; }

  setMode(mode: GameModeDefinition): void {
    this.mode = mode;
    this.clock = mode.timeLimitSeconds;
  }

  getMode(): GameModeDefinition { return this.mode; }

  get currentPhase(): MatchPhase { return this.phase; }

  get timeRemaining(): number { return Math.max(0, this.clock); }

  /** Join a player to the match. Team is assigned to keep the sides even. */
  addPlayer(id: PlayerId, name?: string): PlayerScore {
    const existing = this.scores.get(id);
    if (existing) return existing;

    const team = this.mode.teamBased ? this.smallestTeam() : 'FFA';
    this.teams.set(id, team);

    const entry: PlayerScore = {
      id,
      name: name ?? this.identities.nameOf(id),
      team,
      kills: 0, deaths: 0, assists: 0, score: 0,
      streak: 0, bestStreak: 0,
    };
    this.scores.set(id, entry);
    return entry;
  }

  removePlayer(id: PlayerId): void {
    this.scores.delete(id);
    this.teams.delete(id);
    this.respawnAt.delete(id);
  }

  teamOf(id: PlayerId): TeamId { return this.teams.get(id) ?? 'FFA'; }

  scoreOf(id: PlayerId): PlayerScore | undefined { return this.scores.get(id); }

  /** Seconds until this player may respawn; 0 when they are alive or ready. */
  respawnIn(id: PlayerId, now: number): number {
    const at = this.respawnAt.get(id);
    return at === undefined ? 0 : Math.max(0, at - now);
  }

  /** Begin the pre-match countdown. */
  beginCountdown(): void {
    this.phase = 'countdown';
    this.countdown = this.mode.startCountdownSeconds;
    this.clock = this.mode.timeLimitSeconds;
  }

  /** Skip straight to live play — used by tests and by warm-up-free modes. */
  beginLive(): void {
    this.phase = 'live';
    this.countdown = 0;
    this.clock = this.mode.timeLimitSeconds;
    this.emit({ kind: 'started' });
  }

  /**
   * Drain the queue.
   *
   * Prefer `onEvent` for anything that must not miss an event: this is
   * destructive, so two callers cannot both use it — the first to drain wins
   * and the second sees nothing. The subscription path has no such hazard,
   * which is why the server's own dispatch uses it and this remains for
   * tests and one-off inspection.
   */
  consumeEvents(): MatchEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * Subscribe to match events. Returns an unsubscribe function.
   *
   * Every subscriber sees every event, so the network dispatch and any number
   * of other listeners coexist without fighting over one queue.
   */
  onEvent(listener: (event: MatchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: MatchEvent): void {
    this.events.push(event);
    // Cap the drain-based queue: if nobody ever calls consumeEvents (the
    // normal case in production, where the server subscribes instead), it
    // must not grow without bound for the life of the match.
    if (this.events.length > MAX_PENDING_EVENTS) this.events.shift();
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        console.error('[MatchSystem] event listener threw:', err);
      }
    }
  }

  /** The most recent deaths, newest last. Killcam source. */
  get deathLog(): readonly DeathRecord[] { return this.deaths; }

  tick(dt: number, world: ServerWorld): void {
    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after >= 0) {
        this.emit({ kind: 'countdown', secondsLeft: after });
      }
      if (this.countdown <= 0) {
        this.phase = 'live';
        this.emit({ kind: 'started' });
      }
      return;
    }

    if (this.phase !== 'live') return;

    this.creditKills(world);
    this.processRespawns(world);

    this.clock -= dt;
    if (this.clock <= 0) {
      this.end('time limit reached');
      return;
    }
    if (this.reachedScoreLimit()) this.end('score limit reached');
  }

  // --- kills ----------------------------------------------------------------

  private creditKills(world: ServerWorld): void {
    if (!this.shotSource) return;
    const shots = this.shotSource();
    // CombatSystem rebuilds its list each tick, so anything in it is new.
    for (const shot of shots) {
      if (!shot.lethal || !shot.victim) continue;
      const victim = world.getPlayer(shot.victim as PlayerId);
      if (!victim) continue;             // an entity died, not a player
      this.registerDeath(world, victim, shot);
    }
  }

  /**
   * Record a death and start the respawn timer.
   *
   * Public because not every death comes from a bullet: explosions, fall
   * damage and the kill plane all end lives too, and they all have to go
   * through one place or the score and the respawn timer drift apart.
   */
  registerDeath(
    world: ServerWorld,
    victim: ServerPlayer,
    shot?: ShotResult,
  ): void {
    // Already counted: a player can absorb two lethal hits in one tick.
    if (this.respawnAt.has(victim.id)) return;

    victim.alive = false;
    victim.health = 0;

    const killerId = shot && shot.shooter !== victim.id ? shot.shooter : null;
    const killer = killerId ? world.getPlayer(killerId) : undefined;

    const record: DeathRecord = {
      victim: victim.id,
      killer: killerId,
      weaponId: killer?.loadout?.primaryId ?? null,
      at: world.time,
      victimPos: [victim.px, victim.py, victim.pz],
      killerPos: killer ? [killer.px, killer.py, killer.pz] : null,
      headshot: shot?.zone === 'head',
      distance: shot?.distance ?? 0,
    };
    this.deaths.push(record);
    if (this.deaths.length > 64) this.deaths.shift();

    const victimScore = this.scores.get(victim.id);
    if (victimScore) {
      victimScore.deaths += 1;
      victimScore.streak = 0;
    }

    if (killerId) {
      const killerScore = this.scores.get(killerId);
      if (killerScore) {
        // No credit for killing a teammate; COD subtracts instead.
        const sameTeam = this.mode.teamBased
          && this.teamOf(killerId) === this.teamOf(victim.id);
        if (sameTeam) {
          killerScore.score -= this.mode.pointsPerKill;
        } else {
          killerScore.kills += 1;
          killerScore.score += this.mode.pointsPerKill;
          killerScore.streak += 1;
          killerScore.bestStreak = Math.max(killerScore.bestStreak, killerScore.streak);
        }
      }
    }

    this.spawns.noteDeath(victim.px, victim.pz, world.time);

    const respawnTime = world.time + this.mode.respawnDelaySeconds;
    this.respawnAt.set(victim.id, respawnTime);
    this.emit({ kind: 'death', record, respawnAt: respawnTime });
  }

  // --- respawn ---------------------------------------------------------------

  private processRespawns(world: ServerWorld): void {
    if (!this.collision) return;
    for (const [id, at] of [...this.respawnAt]) {
      if (world.time < at) continue;
      const player = world.getPlayer(id);
      if (!player) { this.respawnAt.delete(id); continue; }
      this.respawnPlayer(world, player);
      this.respawnAt.delete(id);
    }
  }

  /**
   * Place a player at the safest point the selector can find.
   *
   * Used for the INITIAL spawn as well as every respawn, deliberately: the
   * world's own `addPlayer` round-robins a static list, which for a level
   * whose sets have not loaded yet is a single point — so an eight-player
   * lobby all started life stacked on one tile, visibly inside each other.
   * One placement path means the first spawn is as well chosen as the tenth.
   */
  placePlayer(world: ServerWorld, player: ServerPlayer): void {
    this.respawnPlayer(world, player);
  }

  /** Put a player back in the world at the safest point the selector can find. */
  respawnPlayer(world: ServerWorld, player: ServerPlayer): void {
    const team = this.teamOf(player.id);
    const set: SpawnSetName = team === 'A' ? 'teamA' : team === 'B' ? 'teamB' : 'ffa';

    const enemies: ServerPlayer[] = [];
    const friends: ServerPlayer[] = [];
    for (const other of world.allPlayers) {
      if (other.id === player.id) continue;
      const sameTeam = this.mode.teamBased && this.teamOf(other.id) === team;
      if (sameTeam) friends.push(other); else enemies.push(other);
    }

    const point = this.collision
      ? this.spawns.select(set, enemies, friends, this.collision, world.time)
      : null;

    if (point) {
      player.px = point.pos[0];
      player.py = point.pos[1];
      player.pz = point.pos[2];
      player.yaw = point.yaw;
    }

    player.pitch = 0;
    player.health = player.maxHealth;
    player.alive = true;
    player.vx = 0; player.vy = 0; player.vz = 0;
    player.grounded = false;
    player.fallPeakY = player.py;
    this.emit({ kind: 'respawn', player: player.id });
  }

  // --- match end -------------------------------------------------------------

  private reachedScoreLimit(): boolean {
    if (this.mode.teamBased) {
      const t = this.teamTotals();
      return t.A >= this.mode.scoreLimit || t.B >= this.mode.scoreLimit;
    }
    for (const entry of this.scores.values()) {
      if (entry.score >= this.mode.scoreLimit) return true;
    }
    return false;
  }

  private teamTotals(): { A: number; B: number } {
    let A = 0; let B = 0;
    for (const entry of this.scores.values()) {
      if (entry.team === 'A') A += entry.score;
      else if (entry.team === 'B') B += entry.score;
    }
    return { A, B };
  }

  end(reason: string): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.emit({ kind: 'ended', reason, standings: this.standings() });
  }

  /** Sorted leaderboard: score, then fewest deaths, then name for stability. */
  standings(): PlayerScore[] {
    return [...this.scores.values()].sort((a, b) => (
      b.score - a.score
      || a.deaths - b.deaths
      || a.name.localeCompare(b.name)
    ));
  }

  /** Seconds left on the pre-match countdown. */
  get countdownRemaining(): number { return Math.max(0, this.countdown); }

  snapshot(): MatchSnapshot {
    return {
      phase: this.phase,
      modeId: this.mode.id,
      modeName: this.mode.displayName,
      timeRemaining: this.timeRemaining,
      scoreLimit: this.mode.scoreLimit,
      teamBased: this.mode.teamBased,
      teamScores: this.teamTotals(),
      standings: this.standings(),
    };
  }

  private smallestTeam(): TeamId {
    let a = 0; let b = 0;
    for (const team of this.teams.values()) {
      if (team === 'A') a += 1; else if (team === 'B') b += 1;
    }
    return a <= b ? 'A' : 'B';
  }

  /**
   * A match begins in its pre-match countdown, not in warmup.
   *
   * `warmup` is the state a MatchSystem is in before anyone starts a match —
   * it is the constructed state, not a phase a real match passes through.
   * Leaving the phase there was a real bug: `tick()` returns early for
   * anything that is not 'live', so the clock never moved, respawns never
   * processed and no kill was ever credited. The match looked like it was
   * running because players could move (movement is a different system) while
   * nothing that made it a MATCH was happening.
   */
  onMatchStart(): void {
    this.reset();
    this.clock = this.mode.timeLimitSeconds;
    this.beginCountdown();
  }

  onMatchEnd(): void { this.phase = 'ended'; }

  reset(): void {
    this.events.length = 0;
    this.phase = 'warmup';
    this.clock = this.mode.timeLimitSeconds;
    this.countdown = 0;
    this.scores.clear();
    this.teams.clear();
    this.respawnAt.clear();
    this.deaths.length = 0;
    this.events = [];
    this.spawns.reset();
    this.identities.reset();
  }
}
