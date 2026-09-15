/**
 * NavContext.ts — per-level navigation shared by every agent.
 *
 * The grid is expensive to build and identical for all bots, so it is built
 * once when the level's collision loads and handed out here. Traversal tags
 * are per-agent, because they come from the agent's own capability list —
 * that is the mechanism by which a bot without `Swim` prices water at
 * Infinity while a bot beside it swims across.
 */
import type { AgentContext } from './AgentContext';
import type { NavGrid, TraversalCaps } from './Navigation';

let sharedGrid: NavGrid | null = null;

export function setNavGrid(grid: NavGrid | null): void { sharedGrid = grid; }
export function getNavGrid(): NavGrid | null { return sharedGrid; }

/** Traversal tags an agent has, cached on its context by the controller. */
const agentTags = new WeakMap<object, TraversalCaps>();

export function setTraversalCaps(owner: object, caps: TraversalCaps): void {
  agentTags.set(owner, caps);
}

const GROUND_ONLY: TraversalCaps = { tags: new Set(['ground']) };

export function navContext(ctx: AgentContext): {
  grid: NavGrid | null; caps: TraversalCaps;
} {
  return { grid: sharedGrid, caps: agentTags.get(ctx.self) ?? GROUND_ONLY };
}
