/**
 * types.ts — the ThrowableProfile data contract (Document F §2).
 *
 * All three tactical devices share one throw/cook/physics/pooling path and
 * differ ONLY by the data in here. Adding a frag grenade later is a new
 * definition file, not new systems.
 */

export type ThrowableCategory = 'tactical' | 'lethal';
export type DetonationTrigger = 'fuse' | 'impact';
export type ScreenEffect = 'flashWhiteout' | 'concussionBlur' | null;

export interface ThrowableProfile {
  readonly id: string;
  readonly displayName: string;
  /** Short label for the HUD tile. */
  readonly iconLabel: string;
  readonly category: ThrowableCategory;
  readonly modelPath: string;

  readonly throwForce: number;
  readonly gravityScale: number;
  /** Seconds from leaving the hand to detonation, when trigger is 'fuse'. */
  readonly fuseSeconds: number;
  readonly detonationTrigger: DetonationTrigger;

  readonly cookable: boolean;
  /** Safety cutoff: holding past this auto-throws rather than self-detonating. */
  readonly maxCookSeconds: number;

  readonly effectRadius: number;
  readonly effectFalloff: 'linear' | 'quadratic';

  /** How many the player carries into a match. */
  readonly carryCount: number;

  // --- optional, per-device effects ----------------------------------------
  /** Movement multiplier applied while affected (stun only). */
  readonly slowMoveMultiplier?: number;
  readonly slowDuration?: number;
  readonly screenEffect?: ScreenEffect;
  readonly screenEffectPeakDuration?: number;
  readonly screenEffectFadeDuration?: number;
  readonly audioMuffleDuration?: number;
  /** Smoke only: how long the world volume persists. */
  readonly smokeLingerSeconds?: number;

  readonly soundKeys: {
    readonly pinPull: string;
    readonly throw: string;
    readonly bounce: string;
    readonly detonate: string;
    readonly ringTone?: string;
  };
}
