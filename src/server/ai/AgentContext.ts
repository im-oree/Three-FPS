/**
 * AgentContext.ts — everything one capability is allowed to see.
 *
 * Capabilities receive this and nothing else. That is deliberate: it is the
 * seam that keeps a capability from reaching into the world and mutating it,
 * and it is what makes the fair-perception audit possible — enemy knowledge
 * arrives only through `beliefs`, which only Perception.ts writes.
 *
 * `world` and `collision` are here because capabilities legitimately need
 * geometry (where is the ground, is there a wall between me and that corner)
 * and self-state. They must not be used to read enemy positions directly;
 * the acceptance suite asserts a bot cannot act on an unseen enemy.
 */
import type { PlayerId } from '../../net/Protocol';
import type { CollisionWorld } from '../CollisionWorld';
import type { ServerPlayer, ServerWorld } from '../ServerWorld';
import type { Beliefs } from './Perception';
import type { DifficultyProfile, SeededRandom } from './Difficulty';
import type { SkillProfile } from './BotProfile';
import type { NeedsModel } from './NeedsModel';
import type { SquadBlackboard } from './SquadBlackboard';

export interface AgentContext {
  readonly id: PlayerId;
  /** The agent's own player record. Self-knowledge is always fair. */
  readonly self: ServerPlayer;
  readonly world: ServerWorld;
  readonly collision: CollisionWorld;
  /** Perceived enemy knowledge. The ONLY route to enemy information. */
  readonly beliefs: Beliefs;
  readonly needs: NeedsModel;
  readonly squad: SquadBlackboard;
  readonly profile: DifficultyProfile;
  /**
   * This bot's individual roll. `profile` is the tier envelope (perception
   * and turn rate — the fairness limits); `skill` is execution within it.
   * Capabilities should read `skill` for aim and movement tech so two bots on
   * the same tier do not shoot identically.
   */
  readonly skill: SkillProfile;
  readonly rng: SeededRandom;
  /** Seconds this agent tick covers — larger than TICK_SECONDS when the
   *  scheduler has throttled this agent to think less often. */
  readonly dt: number;
}
