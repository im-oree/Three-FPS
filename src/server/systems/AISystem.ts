/**
 * AISystem.ts — runs the bots inside the server's fixed tick.
 *
 * This is an ordinary ServerSystem, which is the point: the AI is not a
 * parallel subsystem bolted onto the loop, it is one more thing that runs
 * between beginTick and endTick, queueing input like everything else.
 *
 * THE BUDGET IS THE DESIGN
 * ------------------------
 * Thirty agents thinking every tick at 60 Hz is 1800 brain evaluations a
 * second, and the perception raycasts alone would dominate the frame on the
 * integrated-graphics target hardware. So thinking is throttled by relevance:
 * a bot in a firefight thinks every tick, a bot nobody can see thinks eight
 * times less often. Its BODY still simulates every tick at full fidelity —
 * only the deciding is rationed, so throttling can never cause a bot to fall
 * through the floor or skip a collision.
 *
 * Raycasts are additionally capped globally, nearest-first, because that is
 * the one cost that scales with the square of the player count.
 */
import type { PlayerId } from '../../net/Protocol';
import { TICK_SECONDS } from '../../net/Protocol';
import type { CollisionWorld } from '../CollisionWorld';
import type { ServerSystem } from '../ServerSystem';
import type { ServerWorld } from '../ServerWorld';
import { AgentController, type AgentOptions } from '../ai/AgentController';
import { resetPathBudget, NavGrid } from '../ai/Navigation';
import { setNavGrid } from '../ai/NavContext';
import { SquadBlackboard } from '../ai/SquadBlackboard';

/** Global per-tick raycast ceiling across every agent. */
const RAY_BUDGET_PER_TICK = 40;

/** How often each relevance tier thinks, in ticks. */
const THINK_INTERVAL = { combat: 1, near: 3, far: 8 } as const;

/** Beyond this from any human, a bot is in the cheapest tier. */
const NEAR_RADIUS = 55;

export class AISystem implements ServerSystem {
  readonly name = 'ai';

  private readonly agents = new Map<PlayerId, AgentController>();
  private readonly squad = new SquadBlackboard();
  private world: ServerWorld | null = null;
  private tickCount = 0;
  /** Round-robin cursor, so the same agents do not always get the raycasts. */
  private cursor = 0;

  constructor(private readonly collision: CollisionWorld) {}

  attach(world: ServerWorld): void { this.world = world; }

  /**
   * Add a bot. It must already exist as a player in the world, because a bot
   * IS a player — same record, same spawn, same health, same everything.
   */
  addAgent(id: PlayerId, options: AgentOptions = {}): AgentController {
    if (!this.world) throw new Error('AISystem: attach() before addAgent()');
    const agent = new AgentController(id, this.world, this.collision, this.squad, options);
    this.agents.set(id, agent);
    return agent;
  }

  removeAgent(id: PlayerId): void {
    this.squad.releaseAll(id);
    this.agents.delete(id);
  }

  getAgent(id: PlayerId): AgentController | undefined { return this.agents.get(id); }
  get agentCount(): number { return this.agents.size; }
  get agentIds(): PlayerId[] { return [...this.agents.keys()]; }

  /**
   * Build the navigation grid from whatever collision the level loaded.
   *
   * Called after the level's geometry is in place. Deriving the grid from
   * collision rather than from a separate authored asset means it cannot
   * disagree with what the player physically collides with.
   */
  buildNavigation(bounds?: {
    minX: number; maxX: number; minZ: number; maxZ: number;
  }): number {
    const area = bounds ?? inferBounds(this.collision);
    if (!area) { setNavGrid(null); return 0; }
    const grid = NavGrid.build(this.collision, area);
    setNavGrid(grid);
    return grid.walkableCount;
  }

  // dt is intentionally unused: the server tick is fixed, so agents advance
  // on tick COUNT (which is what the throttle intervals are expressed in)
  // rather than on wall-clock time.
  tick(_dt: number, world: ServerWorld): void {
    if (this.agents.size === 0) return;
    this.tickCount += 1;
    // Fresh pathfinding allowance for this tick. Without it, every agent
    // repathing on the same tick (which happens on the first tick of a
    // match, and whenever a map-wide event moves everyone) costs hundreds of
    // milliseconds in one hitch.
    resetPathBudget();

    const humans = collectHumanPositions(world, this.agents);
    let rayBudget = RAY_BUDGET_PER_TICK;

    // Round-robin start point: with a tight ray budget, a fixed order would
    // starve the same agents every tick and they would never see anything.
    const ids = [...this.agents.keys()];
    const count = ids.length;
    this.cursor = (this.cursor + 1) % Math.max(1, count);

    for (let offset = 0; offset < count; offset += 1) {
      const id = ids[(this.cursor + offset) % count];
      const agent = this.agents.get(id);
      if (!agent) continue;
      const player = world.getPlayer(id);
      if (!player) continue;

      const interval = thinkInterval(player, agent, humans);
      if (this.tickCount % interval !== 0) { agent.repeatLastInput(); continue; }
      // Re-queue the agent's last intent on the ticks it does not think.
      // MovementSystem applies one input per tick using the SERVER's dt and
      // ignores the frame's own, so an agent thinking every 8th tick would
      // otherwise supply movement for one tick in eight and coast (with
      // friction) through the other seven -- it crawls instead of walking.
      // Holding the intent is also exactly what a real client does: a held
      // key produces an identical frame every tick, not one frame per
      // decision.

      // Each agent may spend at most a quarter of what remains, so an early
      // agent in a busy frame cannot consume the entire budget.
      const slice = Math.max(1, Math.ceil(rayBudget / 4));
      const used = agent.think(interval * TICK_SECONDS, Math.min(slice, rayBudget));
      rayBudget -= used;
      if (rayBudget <= 0) break;
    }
  }

  onMatchStart(): void {
    this.squad.reset();
    for (const agent of this.agents.values()) agent.reset();
  }

  onMatchEnd(): void {
    this.squad.reset();
    for (const agent of this.agents.values()) agent.reset();
  }

  /**
   * Full reset between matches: the roster is DISCARDED, not just cleared.
   *
   * Keeping the agents alive here was the "starting a new game reopens the
   * previous one" bug: `resetAll()` wiped the world's players but left the
   * AI controllers registered, so the next match began with agents driving
   * player ids that no longer existed. A new match builds a new roster.
   */
  reset(): void {
    this.squad.reset();
    for (const agent of this.agents.values()) agent.reset();
    this.agents.clear();
    this.tickCount = 0;
  }

  dispose(): void {
    this.agents.clear();
    this.squad.reset();
    setNavGrid(null);
  }
}

/** Which tier an agent is in, expressed as its think interval. */
function thinkInterval(
  player: { px: number; pz: number },
  agent: AgentController,
  humans: { x: number; z: number }[],
): number {
  // Anything the bot can actually see outranks distance: a bot in a fight on
  // the far side of the map still needs full-rate decisions.
  for (const sighting of agent.beliefs.sightings.values()) {
    if (sighting.visible) return THINK_INTERVAL.combat;
  }
  for (const human of humans) {
    if (Math.hypot(human.x - player.px, human.z - player.pz) < NEAR_RADIUS) {
      return THINK_INTERVAL.near;
    }
  }
  return THINK_INTERVAL.far;
}

/** Positions of every non-bot player, for relevance tiering. */
function collectHumanPositions(
  world: ServerWorld, agents: Map<PlayerId, AgentController>,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const player of world.allPlayers) {
    if (agents.has(player.id)) continue;
    out.push({ x: player.px, z: player.pz });
  }
  return out;
}

/** Derive navigation bounds from the loaded collision boxes. */
function inferBounds(collision: CollisionWorld): {
  minX: number; maxX: number; minZ: number; maxZ: number;
} | null {
  const boxes = collision.allBoxes;
  if (!boxes.length) return null;
  let minX = Infinity; let maxX = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (const box of boxes) {
    if (box.minX < minX) minX = box.minX;
    if (box.maxX > maxX) maxX = box.maxX;
    if (box.minZ < minZ) minZ = box.minZ;
    if (box.maxZ > maxZ) maxZ = box.maxZ;
  }
  // Clamp: a skybox-sized box would otherwise produce a grid with hundreds of
  // thousands of cells and stall match start.
  const span = 260;
  return {
    minX: Math.max(minX, -span), maxX: Math.min(maxX, span),
    minZ: Math.max(minZ, -span), maxZ: Math.min(maxZ, span),
  };
}
