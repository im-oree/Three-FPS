/**
 * Capability.ts — an action an agent can take, expressed as input.
 *
 * THE ONE RULE
 * ------------
 * A capability never mutates the world. It returns a partial `InputFrame` —
 * the exact structure a browser builds from keyboard and mouse — and the
 * server's normal systems decide what actually happens. That is what makes a
 * bot bounded like a player: it cannot teleport into a vehicle, because all
 * it can do is walk to the door and set `Interact`. If the mount range is
 * wrong, or the weapon is reloading, or the seat is taken, the bot fails for
 * the same reason a human would.
 *
 * WHY THIS SHAPE
 * --------------
 * The brain (Perception -> Needs -> Utility/Planner) must never name a
 * capability. It iterates whatever list the agent was given and asks each one
 * two questions: can you run, and how much do you want to. Adding parachuting
 * or a new killstreak is then a new file plus a registry line — no change to
 * any file under ai/ that does the deciding.
 *
 * Preconditions and effects are declared as flat string keys so the planner
 * can chain capabilities it has never heard of: "EnterVehicle" declares it
 * produces `inVehicle`, "Drive" declares it needs `inVehicle`, and the
 * planner discovers the sequence without either file knowing the other
 * exists.
 */
import type { InputFrame } from '../../net/Protocol';
import type { AgentContext } from './AgentContext';

/**
 * A capability's contribution to one tick of input.
 *
 * Partial because most capabilities only care about a few fields: shooting
 * sets buttons and aim, walking sets movement. The emitter merges them over a
 * neutral frame, so an unset field means "no input", never "zero it out".
 */
export interface InputIntent {
  readonly moveX?: number;
  readonly moveZ?: number;
  readonly yaw?: number;
  readonly pitch?: number;
  /** Buttons to hold this tick, OR-ed into the frame. */
  readonly buttons?: number;
}

/** Flat world facts the planner reasons over. */
export type Facts = Readonly<Record<string, boolean>>;

/**
 * A capability that has been started and is running over multiple ticks.
 *
 * Capabilities are not instantaneous: walking to a door takes seconds, and
 * the bot must keep producing input the whole time. The handle is that
 * in-flight state.
 */
export interface Behaviour {
  /** Produce this tick's input. Called every agent tick until done. */
  tick(ctx: AgentContext): InputIntent;
  /** Has this finished? Checked after tick(). */
  isDone(ctx: AgentContext): boolean;
  /** Abandoned before finishing — release any claim. */
  interrupt?(ctx: AgentContext): void;
}

export interface Capability {
  /** Stable id, matching the registry key and loadout data. */
  readonly id: string;
  /** Coarse grouping, for debugging and for tests that assert coverage. */
  readonly tags: readonly string[];

  /**
   * Could this run right now? Cheap checks only — ammo, cooldown, range.
   * Called for every capability of every thinking agent, every tick.
   */
  isAvailable(ctx: AgentContext): boolean;

  /**
   * How much does the agent want this, 0..1?
   *
   * This is the reactive layer: the highest scorer wins the tick. Returning a
   * constant makes a capability a fallback; reading NeedsModel makes it
   * situational.
   */
  scoreUtility(ctx: AgentContext): number;

  /** Facts that must hold before the planner may schedule this. */
  preconditions?(ctx: AgentContext): Facts;
  /** Facts that become true once it completes. */
  effects?(ctx: AgentContext): Facts;
  /** Relative cost, for choosing between valid plans. */
  cost?(ctx: AgentContext): number;

  /** Begin running. Returns the handle ticked until it reports done. */
  begin(ctx: AgentContext): Behaviour;
}

/**
 * The capability registry.
 *
 * Deliberately a plain map keyed by string: a loadout is data (a list of ids
 * in JSON), so the set of things a bot can do is configuration, not code. A
 * bot without "Swim" in its list does not know swimming exists, and the
 * navigation layer prices water at Infinity for it, with no special case
 * anywhere.
 */
const factories = new Map<string, () => Capability>();

export const CapabilityRegistry = {
  register(id: string, factory: () => Capability): void {
    factories.set(id, factory);
  },

  /** Instantiate one capability. Throws on an unknown id — a typo in loadout
   *  data should fail loudly at match start, not silently disable a bot. */
  create(id: string): Capability {
    const factory = factories.get(id);
    if (!factory) {
      throw new Error(
        `AI: unknown capability "${id}". Register it with `
        + 'CapabilityRegistry.register() before referencing it in a loadout.',
      );
    }
    return factory();
  },

  /** Instantiate a whole loadout. */
  createAll(ids: readonly string[]): Capability[] {
    return ids.map((id) => CapabilityRegistry.create(id));
  },

  has(id: string): boolean { return factories.has(id); },
  get registered(): string[] { return [...factories.keys()]; },

  /** Test seam: drop every registration. */
  clear(): void { factories.clear(); },
};

/** A frame with nothing pressed — the base every intent merges onto. */
export function neutralIntent(): InputIntent {
  return { moveX: 0, moveZ: 0, buttons: 0 };
}

/**
 * Merge an intent onto a complete InputFrame.
 *
 * Aim is absolute (the agent's current facing) rather than a delta, matching
 * what InputFrame carries on the wire; movement and buttons default to
 * neutral so an unset field is never mistaken for a deliberate zero.
 */
export function intentToFrame(
  intent: InputIntent, seq: number, dt: number, yaw: number, pitch: number,
): InputFrame {
  return {
    seq,
    dt,
    moveX: intent.moveX ?? 0,
    moveZ: intent.moveZ ?? 0,
    yaw: intent.yaw ?? yaw,
    pitch: intent.pitch ?? pitch,
    buttons: intent.buttons ?? 0,
  };
}
