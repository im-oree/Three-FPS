/**
 * DamageSystem.ts — the one place anything in the world loses health.
 *
 * Before this existed, four systems each did their own `health = max(0,
 * health - n)` and each re-derived what "dead" means. They disagreed:
 *
 *   - combat killed players but could not hurt a helicopter,
 *   - killstreak blasts hurt players but not vehicles or each other,
 *   - fall damage bypassed both and never told the match who died,
 *   - nothing ever regenerated, so a bot left at 5 HP stayed at 5 HP for the
 *     rest of the match. That one deadlocked the AI: Retreat is only
 *     available while hurt AND threatened, but finishes the moment the threat
 *     is gone, so a permanently-hurt bot re-picked Retreat every tick, ended
 *     it every tick, and emitted a sprint button with no direction. It stood
 *     still, forever.
 *
 * So damage is now a single verb over a single interface. A source says how
 * much, of what type, from whom; the target is anything with health --
 * player, vehicle, killstreak, destructible prop, training dummy. Adding a
 * new damage source means calling `apply()`; adding a new damageable thing
 * means registering it. Neither requires touching the other.
 *
 * This is deliberately the same shape as the capability registry: behaviour
 * comes from data and registration, not from branches inside the system.
 */
import type { PlayerId, EntityId, Vec3 } from '../../net/Protocol';
import type { ServerWorld, ServerPlayer } from '../ServerWorld';
import type { ServerSystem } from '../ServerSystem';
import type { EventLog } from '../EventLog';
import { HEALTH } from '../../utils/Constants';

/** How a hit was delivered. Used for feedback and for scoring, never for maths. */
export type DamageType =
  | 'bullet'
  | 'explosive'
  | 'melee'
  | 'fall'
  | 'collision'
  | 'fire'
  | 'suicide';

/**
 * Anything in the world that can be hurt.
 *
 * Both ServerPlayer and ServerEntity already satisfy this shape, so neither
 * has to be wrapped or copied -- the system mutates the real object. The
 * caller says which kind it is, because the two are structurally identical
 * here and only players have teams and regeneration.
 */
export interface Damageable {
  readonly id: PlayerId | EntityId;
  health: number;
  readonly maxHealth: number;
  alive: boolean;
}

export interface DamageRequest {
  /** What is being hurt. Mutated in place. */
  readonly target: Damageable;
  /** Players have teams and regenerate; entities do neither. */
  readonly targetKind: 'player' | 'entity';
  /** Raw amount before armour and friendly-fire rules. */
  readonly amount: number;
  readonly type: DamageType;
  /** Who caused it, or null for the world (fall damage, out of bounds). */
  readonly source: PlayerId | null;
  /** Where it landed, for hit effects and directional indicators. */
  readonly at?: Vec3;
  /** Which body zone, when the source knows. Bullets do; explosions do not. */
  readonly zone?: string | null;
  /**
   * Skip the friendly-fire check. Used by scripted/out-of-bounds kills that
   * must land regardless of team.
   */
  readonly ignoreTeams?: boolean;
  /**
   * The PHYSICAL thing that did it: a grenade entity, a missile, a vehicle,
   * a killstreak aircraft. Distinct from `source`, which is who gets the
   * kill credit.
   *
   * This is what lets a killcam follow the grenade rather than the thrower,
   * with no per-weapon camera code: the camera is handed an entity id and
   * does not care what kind of thing it is.
   */
  readonly causer?: EntityId | null;
  /**
   * Which capability produced this damage. The key the camera director
   * looks up to decide how to film the kill; unknown ids fall back to a
   * generic cinematic shot rather than failing.
   */
  readonly capabilityId?: string;
  /** The weapon used, when there was one, for the killfeed and death card. */
  readonly weaponId?: string;
}

export interface DamageResult {
  /** Damage actually applied after every rule. */
  readonly applied: number;
  readonly lethal: boolean;
  /** True when the hit was refused (friendly fire, already dead, zero). */
  readonly blocked: boolean;
}

const NO_DAMAGE: DamageResult = { applied: 0, lethal: false, blocked: true };

/**
 * Decides team membership. Supplied by the match, because teams are a mode
 * concept and this system must not know what a mode is.
 */
export type TeamResolver = (id: PlayerId) => string | null;

export class DamageSystem implements ServerSystem {
  readonly name = 'damage';

  /** Wall-clock seconds since each player last took damage. */
  private readonly sinceHit = new Map<PlayerId, number>();
  /** Set by the match: null means free-for-all, so nobody is friendly. */
  private teamOf: TeamResolver = () => null;
  private friendlyFire = false;
  /**
   * Where damage and kills are published.
   *
   * Optional so a harness can build a DamageSystem with no log, but wired up
   * for real by GameServer. Everything downstream -- killcam, replay,
   * timeline markers -- reads this rather than hooking damage itself.
   */
  private events: EventLog | null = null;

  /** Subscribers notified the moment something dies. */
  private readonly deathListeners: ((death: {
    target: Damageable; targetKind: 'player' | 'entity';
    source: PlayerId | null; type: DamageType; zone: string | null;
  }) => void)[] = [];

  /** Reported to whoever wants to know a thing died. */
  readonly deaths: {
    target: Damageable; targetKind: 'player' | 'entity';
    source: PlayerId | null; type: DamageType; zone: string | null;
  }[] = [];

  /**
   * Supply the rules that depend on the match. Named separately from the
   * ServerSystem `attach(world)` lifecycle hook, which this class does not
   * need.
   */
  configure(teamOf: TeamResolver, friendlyFire: boolean): void {
    this.teamOf = teamOf;
    this.friendlyFire = friendlyFire;
  }

  /** Publish damage and kills to the match's event log. */
  setEventLog(log: EventLog | null): void { this.events = log; }

  /**
   * Apply damage. The ONLY way health goes down anywhere in the server.
   */
  apply(world: ServerWorld, request: DamageRequest): DamageResult {
    const { target, targetKind, type, source } = request;
    if (!target.alive || target.health <= 0) return NO_DAMAGE;

    const amount = Math.round(request.amount);
    if (amount <= 0) return NO_DAMAGE;

    // Friendly fire. Self-damage always lands (your own grenade hurts you,
    // as in COD), but shooting a teammate does nothing unless enabled.
    if (
      !request.ignoreTeams
      && !this.friendlyFire
      && source !== null
      && targetKind === 'player'
      && source !== target.id
    ) {
      const a = this.teamOf(source);
      const b = this.teamOf(target.id as PlayerId);
      if (a !== null && b !== null && a === b) return NO_DAMAGE;
    }

    target.health = Math.max(0, target.health - amount);
    const lethal = target.health === 0;
    if (lethal) target.alive = false;

    if (targetKind === 'player') {
      // Reset the regeneration timer. Being shot at all interrupts healing,
      // even if the shot was not lethal.
      this.sinceHit.set(target.id as PlayerId, 0);
    }

    if (request.at) {
      world.raiseFx({ t: 'damage', target: target.id, amount, at: request.at });
    }

    // Publish at the chokepoint, so no feature has to remember to.
    //
    // Note this runs for EVERY source of damage -- bullets, explosions, fall
    // damage, out-of-bounds -- because they all come through here. That is
    // the entire recording guarantee: nothing that can hurt you can avoid
    // being recorded, whatever it is and whenever it was added.
    this.events?.record({
      type: 'damage',
      tick: world.tick,
      time: world.time,
      ...(request.at ? { at: request.at } : {}),
      actors: [target.id, source, request.causer ?? null]
        .filter((x): x is PlayerId | EntityId => x !== null),
      payload: {
        target: target.id,
        targetKind,
        amount,
        type,
        source,
        causer: request.causer ?? null,
        capabilityId: request.capabilityId ?? null,
        weaponId: request.weaponId ?? null,
        zone: request.zone ?? null,
        headshot: request.zone === 'head',
        remaining: target.health,
        lethal,
      },
    });

    if (lethal) {
      const death = {
        target, targetKind, source, type, zone: request.zone ?? null,
      };
      this.deaths.push(death);

      // A kill is its own event, not a flag on the damage event, because the
      // killcam and the timeline both search for it by type.
      //
      // `selfInflicted` is decided HERE, once. Fall damage, your own grenade,
      // an out-of-bounds kill and a suicide all produce the same shape, so
      // the camera director never needs scattered "was this self-inflicted"
      // detection of its own.
      this.events?.record({
        type: 'kill',
        tick: world.tick,
        time: world.time,
        ...(request.at ? { at: request.at } : {}),
        actors: [target.id, source, request.causer ?? null]
          .filter((x): x is PlayerId | EntityId => x !== null),
        payload: {
          victim: target.id,
          victimKind: targetKind,
          killer: source,
          causer: request.causer ?? null,
          capabilityId: request.capabilityId ?? null,
          weaponId: request.weaponId ?? null,
          type,
          zone: request.zone ?? null,
          headshot: request.zone === 'head',
          selfInflicted: source === null || source === target.id,
        },
      });

      for (const listener of this.deathListeners) listener(death);
    }

    return { applied: amount, lethal, blocked: false };
  }

  /**
   * Heal a target, capped at its maximum. Used by regeneration and by any
   * future pickup or field upgrade.
   */
  heal(target: Damageable, amount: number): number {
    if (!target.alive) return 0;
    const before = target.health;
    target.health = Math.min(target.maxHealth, target.health + amount);
    return target.health - before;
  }

  /**
   * Health regeneration, COD-style: nothing for a few seconds after being
   * hit, then a fast heal back to full.
   */
  tick(dt: number, world: ServerWorld): void {
    for (const player of world.allPlayers) {
      if (!player.alive) { this.sinceHit.set(player.id, 0); continue; }
      const since = (this.sinceHit.get(player.id) ?? HEALTH.REGEN_DELAY_SECONDS) + dt;
      this.sinceHit.set(player.id, since);
      if (since < HEALTH.REGEN_DELAY_SECONDS) continue;
      if (player.health >= player.maxHealth) continue;
      player.health = Math.min(
        player.maxHealth, player.health + HEALTH.REGEN_PER_SECOND * dt,
      );
    }
  }

  /** Seconds since a player was last hurt. Exposed for the HUD and for tests. */
  secondsSinceHit(id: PlayerId): number {
    return this.sinceHit.get(id) ?? Infinity;
  }

  /** Called when a player respawns: full health, clean slate. */
  onRespawn(player: ServerPlayer): void {
    player.health = player.maxHealth;
    player.alive = true;
    this.sinceHit.set(player.id, HEALTH.REGEN_DELAY_SECONDS);
  }

  /** Subscribe to deaths. Additive, so several systems can react. */
  onDeath(listener: (death: {
    target: Damageable; targetKind: 'player' | 'entity';
    source: PlayerId | null; type: DamageType; zone: string | null;
  }) => void): void {
    this.deathListeners.push(listener);
  }

  clearDeaths(): void { this.deaths.length = 0; }

  reset(): void {
    this.sinceHit.clear();
    this.deaths.length = 0;
  }
}
