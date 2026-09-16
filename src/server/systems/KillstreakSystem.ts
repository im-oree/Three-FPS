/**
 * KillstreakSystem.ts — authoritative killstreak earning, gating and damage.
 *
 * WHAT MOVED, AND WHY
 * -------------------
 * The client's KillstreakManager decided, by itself, whether a streak was
 * available, when it went on cooldown, and how much damage its blast did. All
 * three are now decided here. A client that owns its own cooldown can call an
 * airstrike every frame; a client that owns its own blast damage can kill
 * anyone anywhere and the server would have no basis to disagree.
 *
 * WHAT DELIBERATELY DID NOT MOVE
 * ------------------------------
 * The cinematic. The jet fly-in, the camera whip-pan, the nose-cam and the
 * shake are PRESENTATION -- they exist on the calling player's screen and
 * change nothing another player can observe. Shipping camera keyframes over a
 * wire would cost bandwidth to reproduce something the client renders
 * perfectly well on its own. The server owns what HAPPENED (a missile was
 * called, it flew, it detonated HERE, these players took THIS much damage);
 * the client owns how that looks.
 *
 * The same split the rest of the codebase already makes: server owns numbers,
 * client owns pixels.
 */
import type { ServerSystem } from '../ServerSystem';
import type { ServerWorld, ServerPlayer } from '../ServerWorld';
import type { CollisionWorld } from '../CollisionWorld';
import type { KillstreakSlotState, PlayerId, Vec3 } from '../../net/Protocol';
import {
  SERVER_KILLSTREAKS, DEFAULT_KILLSTREAK_IDS, MAX_CONCURRENT_STREAKS,
  blastDamageAt, type EarnMode, type ServerKillstreak,
} from '../KillstreakStats';
import type { DamageSystem } from './DamageSystem';

/** A streak in flight, tracked so it can expire and free its slot. */
interface ActiveStreak {
  readonly owner: PlayerId;
  readonly slot: number;
  readonly streak: ServerKillstreak;
  /** Seconds remaining of its run. */
  remaining: number;
  /** Where a directional streak was aimed, if it was. */
  readonly target: Vec3 | null;
  /** Ticks until a pending detonation resolves. */
  fuse: number;
  detonated: boolean;
}

/** Per-player slot bookkeeping. */
interface SlotRuntime {
  readonly id: string;
  /** Seconds of cooldown left; 0 = not cooling. */
  cooldown: number;
  active: boolean;
  /** Times this slot has been spent, for the kills-mode consume rule. */
  used: number;
}

/**
 * How long after launch a directional strike lands.
 *
 * The client's cinematic runs about this long before impact, so the server's
 * damage lands when the player sees it land. It is a server-side number
 * because the damage is: a client cannot shorten its own fuse to kill faster.
 */
const STRIKE_FUSE_SECONDS = 2.2;

/**
 * Guided missile flight time before it must resolve.
 *
 * Generous, because the missile is PILOTED -- the player steers it and picks
 * the moment of impact. This is the watchdog that resolves it if they never
 * do, not the expected flight time.
 */
const MISSILE_MAX_FLIGHT_SECONDS = 30;

export interface KillstreakEvent {
  readonly owner: PlayerId;
  readonly streakId: string;
  readonly kind: 'called' | 'rejected' | 'detonated' | 'ended';
  readonly reason?: string;
  readonly at?: Vec3;
  /** Players hurt by a detonation, with the damage each took. */
  readonly hits?: readonly { readonly id: PlayerId; readonly damage: number; readonly lethal: boolean }[];
}

export class KillstreakSystem implements ServerSystem {
  readonly name = 'killstreaks';

  private readonly slots = new Map<PlayerId, SlotRuntime[]>();
  private readonly kills = new Map<PlayerId, number>();
  private readonly active: ActiveStreak[] = [];
  /** Events raised this tick, drained by tests and by the match log. */
  private readonly events: KillstreakEvent[] = [];

  /**
   * Supplies the kills scored since the last tick.
   *
   * Injected rather than imported so this system does not depend on
   * CombatSystem's shape: anything that can report "X killed Y" feeds
   * streak progress, including future scoring for objectives.
   */
  private killSource: (() => readonly { shooter: PlayerId; lethal: boolean }[]) | null = null;

  constructor(
    private readonly collision: CollisionWorld,
    /** Shared damage rules: blasts hurt exactly like bullets do. */
    private readonly damage: DamageSystem,
    private earnMode: EarnMode = 'open',
  ) {}

  /** Wire the kill feed. Called by GameServer once both systems exist. */
  setKillSource(source: () => readonly { shooter: PlayerId; lethal: boolean }[]): void {
    this.killSource = source;
  }

  private creditCombatKills(): void {
    if (!this.killSource) return;
    for (const shot of this.killSource()) {
      if (shot.lethal) this.creditKill(shot.shooter);
    }
  }

  /** Swap the earning rule at runtime. Used by tests and by match setup. */
  setEarnMode(mode: EarnMode): void { this.earnMode = mode; }
  get mode(): EarnMode { return this.earnMode; }

  /** Drain the events raised since the last call. */
  consumeEvents(): KillstreakEvent[] {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  /** Award a kill toward every streak this player has equipped. */
  creditKill(id: PlayerId): void {
    this.kills.set(id, (this.kills.get(id) ?? 0) + 1);
  }

  killsFor(id: PlayerId): number { return this.kills.get(id) ?? 0; }

  tick(dt: number, world: ServerWorld): void {
    this.ensureSlots(world);
    this.creditCombatKills();

    // --- cooldowns -----------------------------------------------------------
    for (const runtimes of this.slots.values()) {
      for (const slot of runtimes) {
        if (slot.cooldown > 0) slot.cooldown = Math.max(0, slot.cooldown - dt);
      }
    }

    // --- requests ------------------------------------------------------------
    for (const request of world.killstreakRequests) {
      this.handleRequest(request.player, request.slot, world);
    }
    world.killstreakRequests.length = 0;

    // --- active streaks ------------------------------------------------------
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const entry = this.active[i];

      if (entry.fuse > 0) {
        entry.fuse -= dt;
        if (entry.fuse <= 0 && !entry.detonated) this.detonate(entry, world);
      }

      if (entry.remaining > 0) {
        entry.remaining -= dt;
        if (entry.remaining > 0) continue;
      } else if (entry.fuse > 0) {
        continue;
      }

      this.finish(entry, world);
      this.active.splice(i, 1);
    }

    this.publish(world);
  }

  /**
   * Validate and act on a call request.
   *
   * Everything a client could lie about is re-derived here: whether the slot
   * exists, whether it is earned, whether it is cooling, and whether the
   * match is already saturated with streaks.
   */
  private handleRequest(id: PlayerId, slotIndex: number, world: ServerWorld): void {
    const player = world.getPlayer(id);
    if (!player) return;

    const runtimes = this.slots.get(id);
    if (!runtimes || slotIndex < 0 || slotIndex >= runtimes.length) {
      this.reject(id, 'unknown', 'no such slot');
      return;
    }
    const slot = runtimes[slotIndex];
    const streak = SERVER_KILLSTREAKS[slot.id];
    if (!streak) { this.reject(id, slot.id, 'unknown streak'); return; }

    // A dead player cannot call anything in.
    if (!player.alive) { this.reject(id, slot.id, 'dead'); return; }
    if (slot.active) { this.reject(id, slot.id, 'already active'); return; }
    if (slot.cooldown > 0) {
      this.reject(id, slot.id, `cooling ${slot.cooldown.toFixed(1)}s`);
      return;
    }
    if (this.earnMode === 'kills' && this.killsFor(id) < streak.killsRequired) {
      this.reject(id, slot.id, `needs ${streak.killsRequired} kills`);
      return;
    }
    if (this.active.length >= MAX_CONCURRENT_STREAKS) {
      this.reject(id, slot.id, 'too many active streaks');
      return;
    }

    // Directional streaks need somewhere to land. The client sends where it
    // designated; the server decides what is actually there by dropping a ray
    // onto the world, so a client cannot aim through a roof.
    const target = streak.activation === 'directional'
      ? this.resolveStrikePoint(player)
      : null;

    slot.active = true;
    slot.used += 1;
    if (this.earnMode === 'kills') {
      this.kills.set(id, Math.max(0, this.killsFor(id) - streak.killsRequired));
    }

    this.active.push({
      owner: id,
      slot: slotIndex,
      streak,
      remaining: streak.durationSeconds,
      target,
      fuse: streak.blastDamage
        ? (streak.id === 'guided_missile' ? MISSILE_MAX_FLIGHT_SECONDS : STRIKE_FUSE_SECONDS)
        : 0,
      detonated: false,
    });

    this.events.push({ owner: id, streakId: streak.id, kind: 'called', at: target ?? undefined });
    world.raiseFx({ t: 'sound', key: `killstreak_${streak.id}_activate` });
  }

  /**
   * Where a directional strike lands.
   *
   * Cast from the caller's eye along their aim onto the world. On a covered
   * map this is what stops a strike being called through a roof: the ray hits
   * the roof, and that is where it goes off.
   */
  private resolveStrikePoint(player: ServerPlayer): Vec3 {
    const eye: Vec3 = [player.px, player.py + 1.68, player.pz];
    const cosPitch = Math.cos(player.pitch);
    const dir: Vec3 = [
      -Math.sin(player.yaw) * cosPitch,
      Math.sin(player.pitch),
      Math.cos(player.yaw) * cosPitch,
    ];
    const hit = this.collision.raycast(eye, dir, 400);
    if (hit) return hit.point;
    return [eye[0] + dir[0] * 120, 0, eye[2] + dir[2] * 120];
  }

  /** Resolve a blast: who was in range, who had cover, who died. */
  private detonate(entry: ActiveStreak, world: ServerWorld): void {
    entry.detonated = true;
    const { streak } = entry;
    const at = entry.target ?? [0, 0, 0];
    const radius = streak.blastRadius ?? 0;
    const maxDamage = streak.blastDamage ?? 0;

    const hits: { id: PlayerId; damage: number; lethal: boolean }[] = [];
    for (const victim of world.allPlayers) {
      if (!victim.alive) continue;
      // Torso height, so a blast at someone's feet still registers.
      const centre: Vec3 = [victim.px, victim.py + 0.9, victim.pz];
      const raw = blastDamageAt(at, centre, radius, maxDamage);
      if (raw <= 0) continue;

      // Cover matters. A wall between the blast and the player stops it, so
      // hiding inside a building actually protects you -- without this, a
      // strike would kill through a roof it never penetrated.
      //
      // The test point is lifted off the impact surface first. A strike
      // resolves ON geometry (the ray stops at the floor), so a blast centre
      // sitting exactly on the ground has its line of sight blocked by that
      // same ground -- every strike would deal zero damage to someone
      // standing right next to it. Lifting by the blast's own scale keeps a
      // roof or a wall blocking while letting the ground it landed on out of
      // the way.
      if (!this.collision.hasLineOfSight(this.blastOrigin(at, radius), centre)) continue;

      const damage = Math.round(raw);
      if (damage <= 0) continue;
      // Through the shared damage system, so a blast obeys the same friendly
      // fire rules as a bullet and resets the same regeneration timer.
      const outcome = this.damage.apply(world, {
        target: victim,
        targetKind: 'player',
        amount: damage,
        type: 'explosive',
        source: entry.owner,
        at: centre,
      });
      if (outcome.blocked) continue;
      const lethal = outcome.lethal;
      hits.push({ id: victim.id, damage: outcome.applied, lethal });
      if (lethal && victim.id !== entry.owner) this.creditKill(entry.owner);
    }

    world.raiseFx({ t: 'explosion', at, radius, shake: 1.6 });
    this.events.push({
      owner: entry.owner, streakId: streak.id, kind: 'detonated', at, hits,
    });
  }

  /**
   * The point cover is tested FROM.
   *
   * Lifted a little off whatever the strike hit, so the surface it detonated
   * against does not shadow the entire blast. Capped small so it cannot lift
   * a blast through a low ceiling and defeat the cover test it exists to
   * support.
   */
  private blastOrigin(at: Vec3, radius: number): Vec3 {
    const lift = Math.min(0.75, Math.max(0.2, radius * 0.06));
    return [at[0], at[1] + lift, at[2]];
  }

  private finish(entry: ActiveStreak, world: ServerWorld): void {
    const runtimes = this.slots.get(entry.owner);
    const slot = runtimes?.[entry.slot];
    if (slot) {
      slot.active = false;
      slot.cooldown = entry.streak.cooldownSeconds;
    }
    this.events.push({ owner: entry.owner, streakId: entry.streak.id, kind: 'ended' });
    void world;
  }

  private reject(owner: PlayerId, streakId: string, reason: string): void {
    this.events.push({ owner, streakId, kind: 'rejected', reason });
  }

  /** Give every player a slot runtime derived from their loadout. */
  private ensureSlots(world: ServerWorld): void {
    for (const player of world.allPlayers) {
      if (this.slots.has(player.id)) continue;
      const ids = player.loadout?.killstreakIds?.length
        ? player.loadout.killstreakIds
        : DEFAULT_KILLSTREAK_IDS;
      this.slots.set(player.id, ids.map((id) => ({
        id, cooldown: 0, active: false, used: 0,
      })));
    }
  }

  /** Publish slot state so the HUD reads the server's view, not its own. */
  private publish(world: ServerWorld): void {
    for (const player of world.allPlayers) {
      const runtimes = this.slots.get(player.id);
      if (!runtimes) continue;
      const states: KillstreakSlotState[] = runtimes.map((slot) => {
        const streak = SERVER_KILLSTREAKS[slot.id];
        const earned = this.earnMode === 'open'
          || this.killsFor(player.id) >= (streak?.killsRequired ?? 0);
        let state: KillstreakSlotState['state'] = 'ready';
        let remaining = 0;
        if (slot.active) { state = 'active'; }
        else if (slot.cooldown > 0) { state = 'cooling'; remaining = slot.cooldown; }
        else if (!earned) { state = 'locked'; }
        return { id: slot.id, state, remaining };
      });
      player.killstreakSlots = states;
    }
  }

  /** Slot view for one player. Used by tests and the HUD bridge. */
  slotsFor(id: PlayerId): readonly KillstreakSlotState[] {
    const runtimes = this.slots.get(id);
    if (!runtimes) return [];
    return runtimes.map((slot) => ({
      id: slot.id,
      state: slot.active ? 'active' : slot.cooldown > 0 ? 'cooling' : 'ready',
      remaining: slot.cooldown,
    }));
  }

  get activeCount(): number { return this.active.length; }

  /** Idempotent: runs on both match start and match end. */
  reset(): void {
    this.slots.clear();
    this.kills.clear();
    this.active.length = 0;
    this.events.length = 0;
  }
}
