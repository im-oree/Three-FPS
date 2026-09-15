/**
 * Planner.ts — GOAP over whatever capabilities the agent happens to have.
 *
 * The reactive utility layer answers "what should I do this instant". It
 * cannot answer "how do I get to the far side of the map", because that needs
 * a sequence: walk to the truck, get in, drive, get out. This file finds that
 * sequence by forward search over capability preconditions and effects.
 *
 * WHY THE PLANNER NAMES NOTHING
 * -----------------------------
 * There is no mention of vehicles, weapons or killstreaks below. Capabilities
 * declare their own preconditions and effects as flat string keys, and the
 * search chains them. Register a `Parachute` capability that requires
 * `airborne` and produces `atLandingZone`, and plans through the air become
 * available to every agent that has it, with no edit here.
 *
 * COST CONTROL
 * ------------
 * Search is capped on nodes rather than run to exhaustion. A bot that cannot
 * find a plan within the cap falls back to the reactive layer, which always
 * has an answer. Thirty agents each running an unbounded A* is exactly how an
 * AI system becomes the thing that drops the frame rate, and a plan that took
 * 40 ms to compute is worthless anyway — the world changed while it thought.
 */
import type { AgentContext } from './AgentContext';
import type { Capability, Facts } from './Capability';

interface Node {
  state: Record<string, boolean>;
  path: Capability[];
  cost: number;
}

/** Hard cap on expanded nodes per plan attempt. */
const MAX_NODES = 120;

function satisfies(state: Record<string, boolean>, goal: Facts): boolean {
  for (const key of Object.keys(goal)) {
    if (state[key] !== goal[key]) return false;
  }
  return true;
}

function keyOf(state: Record<string, boolean>): string {
  return Object.keys(state).sort().map((k) => `${k}:${state[k] ? 1 : 0}`).join('|');
}

/**
 * Find an ordered capability list that turns `start` into `goal`.
 *
 * Returns null when no plan exists within the node cap — a normal outcome,
 * not an error. The caller falls back to reactive behaviour.
 */
export function plan(
  start: Facts,
  goal: Facts,
  capabilities: readonly Capability[],
  ctx: AgentContext,
): Capability[] | null {
  const initial: Record<string, boolean> = { ...start };
  if (satisfies(initial, goal)) return [];

  // Uniform-cost search. A* would want an admissible heuristic over arbitrary
  // string facts, which cannot be written generically without assuming what
  // the facts mean — exactly the coupling this design is avoiding.
  const open: Node[] = [{ state: initial, path: [], cost: 0 }];
  const seen = new Set<string>([keyOf(initial)]);
  let expanded = 0;

  while (open.length > 0 && expanded < MAX_NODES) {
    // Cheapest first.
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (open[i].cost < open[bestIndex].cost) bestIndex = i;
    }
    const node = open.splice(bestIndex, 1)[0];
    expanded += 1;

    for (const capability of capabilities) {
      const pre = capability.preconditions?.(ctx) ?? {};
      if (!satisfies(node.state, pre)) continue;

      const effects = capability.effects?.(ctx) ?? {};
      if (Object.keys(effects).length === 0) continue;

      const next: Record<string, boolean> = { ...node.state, ...effects };
      const nextKey = keyOf(next);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);

      const path = [...node.path, capability];
      if (satisfies(next, goal)) return path;

      open.push({ state: next, path, cost: node.cost + (capability.cost?.(ctx) ?? 1) });
    }
  }

  return null;
}

/**
 * Snapshot the agent's current world state as planner facts.
 *
 * Only self-knowledge and perceived knowledge appear here, so a plan can
 * never be built on information the agent was not entitled to.
 */
export function currentFacts(ctx: AgentContext): Facts {
  const { self, needs } = ctx;
  return {
    alive: self.alive,
    inVehicle: self.vehicleId !== null,
    hasTarget: needs.hasEngageableTarget(),
    hasLead: needs.hasLead(),
    healthy: needs.health() > 0.5,
    grounded: self.grounded,
  };
}
