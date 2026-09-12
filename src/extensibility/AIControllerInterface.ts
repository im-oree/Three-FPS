/**
 * AIControllerInterface.js — CONTRACT ONLY. No behaviour lives here.
 *
 * This interface exists so future enemy AI can be built as new files
 * implementing this contract, without modifying player, weapon, or combat
 * code. The "AI Enemies" document (after Document 6) will ship concrete
 * subclasses; core systems already route through the seams this defines
 * (EventBus events, BallisticsSystem hittable registration).
 */

/** Position shape kept Three-free so the contract stays serializable. */
export interface SpawnPosition {
  x: number;
  y: number;
  z: number;
}

export abstract class AIControllerInterface {
  /** Place/activate the AI entity in the world. */
  abstract spawn(position: SpawnPosition): void;

  /** Per-frame think/move tick. */
  abstract update(dt: number): void;

  /** React to incoming damage. */
  abstract onDamaged(amount: number, sourceObject: unknown): void;

  /** Terminal state: play death, unregister, clean up. */
  abstract die(): void;
}

export default AIControllerInterface;
