/**
 * PerspectiveSync.ts — cross-perspective desync prevention (FPS/TPS Spec §4).
 *
 * The rule the spec insists on: gameplay logic is NEVER dependent on the
 * length of a visual animation file. Gameplay owns a hard logical duration
 * (e.g. ReloadDuration = 2.4 s); each perspective plays its OWN, differently
 * authored asset; and every asset is time-scaled to the logical clock:
 *
 *     PlaybackRate = ClipLength / LogicalStateDuration
 *
 * so the magazine seats at the same instant whether you are looking through
 * the 1PS camera or watching the operator from outside.
 *
 * This module is deliberately free of Three.js coupling beyond AnimationAction
 * so it can scale a viewmodel action, a body action, or anything else exposing
 * a timeScale. It also resolves the per-perspective clip NAME for an action,
 * which is the other half of "perspective-specific assets".
 */
import { PERSPECTIVE_SYNC } from '../utils/Constants';

/** The minimum surface a scalable animation must expose. */
export interface ScalableAction {
  timeScale: number;
  getClip(): { duration: number };
}

/** A gameplay action whose duration is authoritative. */
export interface TimedAction {
  /** Logical id, e.g. 'reload_tactical'. */
  id: string;
  /** Hard gameplay duration in seconds — the single source of truth. */
  logicalDuration: number;
}

/**
 * PlaybackRate = clipLength / logicalDuration, clamped.
 * A zero/absent logical duration means "play at natural speed" (rate 1).
 */
export function computePlaybackRate(clipLength: number, logicalDuration: number): number {
  if (!(clipLength > 0) || !(logicalDuration > 0)) return 1;
  return clampRate(clipLength / logicalDuration);
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(PERSPECTIVE_SYNC.MAX_RATE, Math.max(PERSPECTIVE_SYNC.MIN_RATE, rate));
}

/**
 * Scale an action so it lasts exactly `logicalDuration`. Returns the applied
 * rate. No-ops when the change is below RATE_EPSILON so the mixer isn't
 * churned every frame by floating-point noise.
 */
export function scaleActionToDuration(action: ScalableAction, logicalDuration: number): number {
  const rate = computePlaybackRate(action.getClip().duration, logicalDuration);
  if (Math.abs(action.timeScale - rate) > PERSPECTIVE_SYNC.RATE_EPSILON) {
    action.timeScale = rate;
  }
  return rate;
}

/**
 * Registry of the logical durations gameplay owns. Both perspectives read
 * from here, which is what structurally prevents them from drifting apart:
 * there is exactly one number, and both visuals are scaled to it.
 */
export class LogicalDurationRegistry {
  private readonly durations = new Map<string, number>();

  set(id: string, seconds: number): void {
    this.durations.set(id, seconds);
  }

  get(id: string): number | undefined {
    return this.durations.get(id);
  }

  /** Bulk-register a weapon's action timings at equip time. */
  registerWeapon(weaponId: string, timings: Record<string, number>): void {
    for (const [action, seconds] of Object.entries(timings)) {
      this.durations.set(`${weaponId}:${action}`, seconds);
    }
  }

  /** Weapon-scoped lookup falling back to the global action id. */
  resolve(weaponId: string, action: string): number | undefined {
    return this.durations.get(`${weaponId}:${action}`) ?? this.durations.get(action);
  }

  clear(): void {
    this.durations.clear();
  }
}

/**
 * Perspective-specific asset naming. The 1PS clip is exaggerated and close to
 * screen; the 3PS clip is a full-body version of the same beat. They are
 * different FILES, resolved from one logical action id.
 */
export function resolveClipName(action: string, perspective: 'FIRST' | 'THIRD'): string {
  return perspective === 'THIRD' ? `${action}_3p` : action;
}

/**
 * The synchroniser both perspectives talk to. Gameplay calls `begin()` once
 * with the logical duration; each perspective then registers whichever action
 * it started, and every registered action is rate-scaled to the same clock.
 */
export class PerspectiveSync {
  readonly durations = new LogicalDurationRegistry();
  private readonly running = new Map<string, { elapsed: number; duration: number; actions: ScalableAction[] }>();

  /** Start (or restart) a logical action. */
  begin(id: string, logicalDuration: number): void {
    this.running.set(id, { elapsed: 0, duration: logicalDuration, actions: [] });
  }

  /** Attach a perspective's action to a running logical action and scale it. */
  attach(id: string, action: ScalableAction | null | undefined): number {
    const entry = this.running.get(id);
    if (!entry || !action) return 1;
    entry.actions.push(action);
    return scaleActionToDuration(action, entry.duration);
  }

  /** Progress 0..1 of a running logical action (identical for both rigs). */
  progress(id: string): number {
    const entry = this.running.get(id);
    if (!entry || entry.duration <= 0) return 0;
    return Math.min(1, entry.elapsed / entry.duration);
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  end(id: string): void {
    this.running.delete(id);
  }

  update(dt: number): void {
    for (const [id, entry] of this.running) {
      entry.elapsed += dt;
      if (entry.elapsed >= entry.duration) this.running.delete(id);
    }
  }
}

export default PerspectiveSync;
