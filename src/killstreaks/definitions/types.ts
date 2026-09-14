/**
 * types.ts — the KillstreakDefinition data contract (Document H §1.1).
 *
 * A killstreak is DATA. Everything the manager needs to track, gate, display
 * and dispatch one lives here; behaviour lives in its controller.
 */

export type ActivationType = 'instant' | 'directional' | 'placed' | 'controlled';

export interface KillstreakDefinition {
  readonly id: string;
  readonly displayName: string;
  /** Kills needed when EARN_MODE is 'kills'. Ignored in 'open' mode. */
  readonly killsRequired: number;
  readonly activationType: ActivationType;
  /** Short label drawn on the HUD tile. */
  readonly iconLabel: string;
  readonly soundKeys: {
    readonly activate: string;
    readonly ambient?: string;
  };
  /** How long the streak runs. 0 = fire-and-forget (e.g. an airstrike). */
  readonly durationSeconds: number;
  /** Seconds after it ENDS before it can be called again. */
  readonly cooldownSeconds: number;
  /** Key into the controller lookup map. */
  readonly controllerClass: string;
}
