/**
 * AgentController.ts — one bot.
 *
 * The whole brain is four steps: perceive, score, run the winner, emit input.
 * The last step is the important one — it calls `world.queueInput()`, the
 * same function the network handler calls when a real client sends a frame.
 * From the simulation's point of view there is no way to tell the two apart,
 * which is the entire design goal.
 *
 * REACTIVE FIRST, PLANNED SECOND
 * ------------------------------
 * Utility scoring runs every think; the planner runs only when the reactive
 * layer has nothing worth doing and a goal is outstanding. That ordering
 * matters: a bot that consults a multi-step plan before noticing it is being
 * shot at feels broken, and replanning on every tick is how an AI system
 * eats a frame budget for no gain.
 */
import type { LoadoutSpec, PlayerId } from '../../net/Protocol';
import { Button, TICK_SECONDS } from '../../net/Protocol';
import type { CollisionWorld } from '../CollisionWorld';
import type { ServerWorld } from '../ServerWorld';
import type { AgentContext } from './AgentContext';
import type { Behaviour, Capability, InputIntent } from './Capability';
import { CapabilityRegistry, intentToFrame } from './Capability';
import {
  approachAngle, getDifficulty, SeededRandom, type DifficultyProfile,
} from './Difficulty';
import { NeedsModel } from './NeedsModel';
import { Beliefs, perceive } from './Perception';
import {
  createBotProfile, hashString as hashProfileId, type BotProfile, type SkillTier,
} from './BotProfile';
import { setTraversalCaps } from './NavContext';
import type { SquadBlackboard } from './SquadBlackboard';
import type { TraversalCaps } from './Navigation';

export interface AgentOptions {
  readonly difficulty?: string;
  /**
   * Skill tier. When given, the agent rolls an individual SkillProfile and
   * PersonalityProfile around that tier's baseline, so two bots on the same
   * tier are still different players. Omitted means the tier is derived from
   * `difficulty`, which keeps every existing caller working unchanged.
   */
  readonly tier?: SkillTier;
  /** Capability ids. Omitted means DEFAULT_CAPABILITIES. */
  readonly capabilities?: readonly string[];
  readonly seed?: number;
  /** Weapons the bot spawns with, same shape a client sends. */
  readonly loadout?: LoadoutSpec;
}

/**
 * How long a mid-action capability may outlive its own trigger, and the
 * score it holds while doing so. The score sits above Patrol (0.12) and
 * below Engage (~0.72), so finishing a retreat beats wandering but seeing
 * an enemy still interrupts it.
 */
const MAX_COMMIT_SECONDS = 2.5;
const RETAIN_SCORE = 0.4;

/** The default loadout. Data, not code: change it without touching the brain. */
export const DEFAULT_CAPABILITIES = [
  'Engage', 'Hunt', 'Reload', 'Retreat', 'Patrol', 'EnterVehicle',
  // Gates itself on this bot's skill roll, so a recruit never uses it.
  'Dropshot',
] as const;

export class AgentController {
  readonly id: PlayerId;
  readonly beliefs = new Beliefs();
  readonly profile: DifficultyProfile;
  /**
   * This bot as an individual: its rolled aim, movement tech and temperament.
   * `profile` above is the tier envelope (what it can perceive and how fast
   * it may turn); this is who it is inside that envelope.
   */
  readonly bot: BotProfile;
  private readonly needs = new NeedsModel();
  private readonly rng: SeededRandom;
  private readonly capabilities: Capability[];
  private current: Capability | null = null;
  /**
   * The facing the last decision asked for. Skipped ticks rotate toward it
   * at the clamped human rate instead of snapping when the next one lands.
   */
  private aimYaw = 0;
  private aimPitch = 0;
  /** Seconds the current capability has been running, for commitment. */
  private committedFor = 0;
  /** Per-decision jitter, held so the bot does not chase its own noise. */
  private readonly jitterRolls = new Map<string, number>();
  private behaviour: Behaviour | null = null;
  private sequence = 0;
  /** Accumulated real time since this agent last thought. */
  private sinceThink = 0;

  /** Debug/introspection: last utility scores, for the acceptance suite. */
  readonly lastScores = new Map<string, number>();
  /** The most recent intent, re-queued on ticks this agent does not think. */
  private lastIntent: InputIntent = {};

  constructor(
    id: PlayerId,
    private readonly world: ServerWorld,
    private readonly collision: CollisionWorld,
    private readonly squad: SquadBlackboard,
    options: AgentOptions = {},
  ) {
    this.id = id;
    this.profile = getDifficulty(options.difficulty ?? 'regular');
    // The individual roll. Seeded from the same id the RNG uses, so a bot is
    // reproducibly the same player across runs.
    const tier = (options.tier
      ?? (options.difficulty as SkillTier | undefined)
      ?? 'regular') as SkillTier;
    this.bot = createBotProfile(id, tier, options.seed ?? hashProfileId(id));
    this.rng = new SeededRandom(options.seed ?? hashString(id));
    this.capabilities = CapabilityRegistry.createAll(
      options.capabilities ?? DEFAULT_CAPABILITIES,
    );

    // Traversal tags come from the capability list: this is the hook that
    // makes water passable for a bot with Swim and impassable for one
    // without, with no branch anywhere in the pathfinder.
    const tags = new Set<string>(['ground']);
    for (const capability of this.capabilities) {
      const extra = (capability as { traversableTags?: readonly string[] }).traversableTags;
      if (extra) for (const tag of extra) tags.add(tag);
    }
    const player = world.getPlayer(id);
    if (player) setTraversalCaps(player, { tags } satisfies TraversalCaps);
  }

  /** Capability ids this agent holds. */
  get capabilityIds(): string[] { return this.capabilities.map((c) => c.id); }
  get currentCapabilityId(): string | null { return this.current?.id ?? null; }

  /**
   * Think, and queue one input frame.
   *
   * `dt` is real elapsed time; `rayBudget` is this agent's slice of the
   * global perception budget. Returns rays actually spent so the scheduler
   * can account for them.
   */
  think(dt: number, rayBudget: number): number {
    const player = this.world.getPlayer(this.id);
    if (!player) return 0;

    this.sinceThink += dt;
    const thinkDt = this.sinceThink;

    if (!player.alive) {
      // Dead bots release their claims so the living can use those spots.
      this.squad.releaseAll(this.id);
      this.beliefs.clear();
      this.behaviour = null;
      this.current = null;
      this.sinceThink = 0;
      return 0;
    }

    const ctx: AgentContext = {
      id: this.id,
      self: player,
      world: this.world,
      collision: this.collision,
      beliefs: this.beliefs,
      needs: this.needs,
      squad: this.squad,
      profile: this.profile,
      skill: this.bot.skill,
      rng: this.rng,
      dt: thinkDt,
    };
    this.needs.ctx = ctx;

    const rays = perceive(
      player, this.world, this.collision, this.beliefs, this.profile, rayBudget,
      this.bot.skill.reactionMs,
    );

    // Share what was actually seen. Teammates get it through the blackboard,
    // which is the bot equivalent of a callout — earned, not granted.
    for (const sighting of this.beliefs.sightings.values()) {
      if (sighting.visible) {
        this.squad.reportSighting(
          sighting.id, [sighting.x, sighting.y, sighting.z], this.id, this.world.time,
        );
      }
    }

    this.selectCapability(ctx);

    const intent = this.behaviour ? this.behaviour.tick(ctx) : {};
    this.lastIntent = intent;
    // Remember where the brain WANTS to look, so the skipped ticks between
    // now and the next decision can keep rotating toward it rather than
    // holding still and then snapping.
    this.aimYaw = intent.yaw ?? player.yaw;
    this.aimPitch = intent.pitch ?? player.pitch;
    if (this.behaviour?.isDone(ctx)) {
      this.behaviour = null;
      this.current = null;
    }

    this.sequence += 1;
    // Clamp the DECISION tick's turn to one tick's worth as well.
    //
    // Capabilities compute their desired yaw with ctx.dt, which for a
    // throttled agent is the whole think interval -- correct as a budget,
    // but the resulting angle was then applied in a single tick. That is
    // where the 2240 deg/s snaps came from. The body may only ever rotate
    // one tick's worth per tick; the remaining budget is spent by
    // repeatLastInput on the ticks in between.
    this.world.queueInput(this.id, intentToFrame(
      {
        ...intent,
        yaw: approachAngle(
          player.yaw, this.aimYaw, this.profile.maxTurnDegPerSecond, TICK_SECONDS,
        ),
        pitch: approachAngle(
          player.pitch, this.aimPitch, this.profile.maxTurnDegPerSecond, TICK_SECONDS,
        ),
      },
      this.sequence, thinkDt, player.yaw, player.pitch,
    ));

    this.sinceThink = 0;
    return rays;
  }

  /**
   * Pick the highest-scoring available capability.
   *
   * Hysteresis: the incumbent keeps a small bonus so a bot does not thrash
   * between two near-equal options every tick. Jitter breaks ties differently
   * per agent, so a squad given identical situations does not produce
   * identical behaviour.
   */
  /**
   * This decision's jitter for one capability, rolled once and remembered.
   */
  private jitterFor(id: string, ctx: AgentContext): number {
    const existing = this.jitterRolls.get(id);
    if (existing !== undefined) return existing;
    const rolled = this.rng.next() * ctx.profile.decisionJitter;
    this.jitterRolls.set(id, rolled);
    return rolled;
  }

  private selectCapability(ctx: AgentContext): void {
    let best: Capability | null = null;
    let bestScore = -Infinity;
    this.lastScores.clear();

    // Commitment. Without it the bot re-decides from scratch every tick and,
    // because decisionJitter (up to 0.18) is larger than any incumbency
    // bonus, two capabilities scoring within a hair of each other trade the
    // lead constantly: measured median lifetimes were 0.02-0.08s, so MoveTo
    // was rebuilt -- losing its path -- several times a second. That is what
    // made bots twitch on the spot instead of going somewhere.
    //
    // A human picks a plan and sees it through for a beat unless something
    // clearly better turns up. The stickiness bonus decays over the first
    // second of a behaviour, so a fresh decision is defended hardest.
    this.committedFor += ctx.dt;
    const stickiness = this.current
      ? 0.22 + 0.30 * Math.max(0, 1 - this.committedFor / 1.0)
      : 0;

    for (const capability of this.capabilities) {
      const running = capability === this.current && this.behaviour !== null;
      if (!capability.isAvailable(ctx)) {
        this.lastScores.set(capability.id, 0);
        // A capability that is MID-ACTION keeps its turn even once its
        // trigger has lapsed, until its own isDone says it is finished or
        // the commit window runs out. Retreat requires underThreat(), which
        // goes false the instant the bot breaks line of sight -- the first
        // thing running away achieves -- so availability-based eviction
        // killed it after a single tick and the bot bounced straight back
        // into the open. Ending an action is the behaviour's call, not the
        // trigger's.
        if (!running || this.committedFor >= MAX_COMMIT_SECONDS) continue;
      }
      let score = capability.isAvailable(ctx) ? capability.scoreUtility(ctx) : RETAIN_SCORE;
      // Jitter is rolled once per decision and then HELD, rather than
      // re-rolled every tick. Re-rolling turns the jitter into noise that
      // the bot chases; holding it makes the bot's choice individual, which
      // is what the jitter was for.
      score += this.jitterFor(capability.id, ctx);
      if (capability === this.current) score += stickiness;
      this.lastScores.set(capability.id, score);
      if (score > bestScore) { bestScore = score; best = capability; }
    }

    if (!best) { this.behaviour = null; this.current = null; return; }
    if (best === this.current && this.behaviour) return;

    this.behaviour?.interrupt?.(ctx);
    this.current = best;
    this.behaviour = best.begin(ctx);
    this.committedFor = 0;
    this.jitterRolls.clear();
  }

  /**
   * Re-queue the last intent without thinking.
   *
   * Called on the ticks a throttled agent skips, so held movement keeps
   * applying. Cheap by design: no perception, no scoring, just the frame.
   */
  repeatLastInput(): void {
    const player = this.world.getPlayer(this.id);
    if (!player || !player.alive) return;
    this.sequence += 1;
    // Keep turning toward the aim the last decision asked for.
    //
    // A throttled agent decides every Nth tick, and its turn was budgeted
    // for all N of those ticks -- but the resulting yaw used to be applied
    // in one frame and then held, which produced a snap of up to 2240
    // deg/s. A human turning with a mouse cannot do that, and it is exactly
    // what made the bots look robotic. Easing toward the goal every tick at
    // the same clamped rate spends the same budget smoothly.
    this.world.queueInput(this.id, intentToFrame(
      {
        ...this.lastIntent,
        yaw: approachAngle(
          player.yaw, this.aimYaw, this.profile.maxTurnDegPerSecond, TICK_SECONDS,
        ),
        pitch: approachAngle(
          player.pitch, this.aimPitch, this.profile.maxTurnDegPerSecond, TICK_SECONDS,
        ),
      },
      this.sequence, TICK_SECONDS, player.yaw, player.pitch,
    ));
  }

  /** Forget everything. Used on respawn and match reset. */
  reset(): void {
    this.beliefs.clear();
    this.behaviour = null;
    this.current = null;
    this.sinceThink = 0;
  }
}

/** Stable seed from a player id, so a given bot behaves identically on replay. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

/** Re-exported so callers can build an input frame without a deep import. */
export { Button };
