/**
 * KillstreakControllerInterface.ts — Document H §1.4.
 *
 * THE extensibility point. Adding killstreak #4 means writing one controller
 * implementing this shape plus one data file, and registering it in the
 * lookup map. KillstreakManager itself never gains per-streak logic — it only
 * looks up and dispatches, exactly as WeaponManager relates to its weapon
 * definitions.
 */
import type * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { KillstreakDefinition } from './definitions/types';
import type { LevelDefinition } from '../environment/LevelDefinition';

/** Everything a controller may need, injected rather than imported. */
export interface KillstreakContext {
  readonly definition: KillstreakDefinition;
  readonly scene: THREE.Scene;
  readonly assetLoader: AssetLoader;
  readonly physics: PhysicsWorld;
  /** Live player position — controllers must not cache this. */
  readonly getPlayerPosition: () => THREE.Vector3;
  readonly getCameraForward: () => THREE.Vector3;
  /** The active level (airspace metadata for vehicle cinematics). */
  readonly getLevelDefinition: () => LevelDefinition | null;
  /** Call when the streak finishes on its own; the manager cleans up. */
  readonly reportEnded: () => void;
}

export abstract class KillstreakControllerInterface {
  protected context: KillstreakContext | null = null;

  /** Begin. Store the context; spawn whatever the streak owns. */
  abstract activate(context: KillstreakContext): void;

  /** Per-frame while active. */
  update(_dt: number): void {}

  /** Tear down everything spawned. MUST be idempotent. */
  abstract deactivate(): void;

  /** Seconds remaining, for the HUD countdown ring. */
  get remainingSeconds(): number { return 0; }
}

export default KillstreakControllerInterface;
