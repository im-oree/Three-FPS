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
import { getDifficulty, SeededRandom, type DifficultyProfile } from './Difficulty';
import { NeedsModel } from './NeedsModel';
import { Beliefs, perceive } from './Perception';
import { setTraversalCaps } from './NavContext';
import type { SquadBlackboard } from './SquadBlackboard';
import type { TraversalCaps } from './Navigation';

export interface AgentOptions {
  readonly difficulty?: string;
  /** Capability ids. Omitted means DEFAULT_CAPABILITIES. */
  readonly capabilities?: readonly string[];
  readonly seed?: number;
  /** Weapons the bot spawns with, same shape a client sends. */
  readonly loadout?: LoadoutSpec;
}

/** The default loadout. Data, not code: change it without touching the brain. */
export const DEFAULT_CAPABILITIES = [
  'Engage', 'Hunt', 'Reload', 'Retreat', 'Patrol', 'EnterVehicle',
] as const;

export class AgentController {
  readonly id: PlayerId;
  readonly beliefs = new Beliefs();
  readonly profile: DifficultyProfile;
  private readonly needs = new NeedsModel();
  private readonly rng: SeededRandom;
  private readonly capabilities: Capability[];
  private current: Capability | null = null;
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
      rng: this.rng,
      dt: thinkDt,
    };
    this.needs.ctx = ctx;

    const rays = perceive(
      player, this.world, this.collision, this.beliefs, this.profile, rayBudget,
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
    if (this.behaviour?.isDone(ctx)) {
      this.behaviour = null;
      this.current = null;
    }

    this.sequence += 1;
    this.world.queueInput(this.id, intentToFrame(
      intent, this.sequence, thinkDt, player.yaw, player.pitch,
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
  private selectCapability(ctx: AgentContext): void {
    let best: Capability | null = null;
    let bestScore = -Infinity;
    this.lastScores.clear();

    for (const capability of this.capabilities) {
      if (!capability.isAvailable(ctx)) { this.lastScores.set(capability.id, 0); continue; }
      let score = capability.scoreUtility(ctx);
      score += this.rng.next() * this.profile.decisionJitter;
      if (capability === this.current) score += 0.08;
      this.lastScores.set(capability.id, score);
      if (score > bestScore) { bestScore = score; best = capability; }
    }

    if (!best) { this.behaviour = null; this.current = null; return; }
    if (best === this.current && this.behaviour) return;

    this.behaviour?.interrupt?.(ctx);
    this.current = best;
    this.behaviour = best.begin(ctx);
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
    this.world.queueInput(this.id, intentToFrame(
      this.lastIntent, this.sequence, TICK_SECONDS, player.yaw, player.pitch,
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
