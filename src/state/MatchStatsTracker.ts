/**
 * MatchStatsTracker.ts — Document 5 §7.6.
 *
 * Tallies shots, hits, accuracy and elapsed time for the end-of-match
 * summary, by subscribing to events that already exist.
 *
 * `kills` and `score` are present but always 0 in this document's scope. They
 * exist NOW so that a future AI/objectives document can start incrementing
 * them without touching the HUD or the summary screen at all.
 */
import eventBus from '../core/EventBus';

export interface MatchStats {
  shotsFired: number;
  hits: number;
  accuracy: number;
  damageDealt: number;
  elapsedSeconds: number;
  kills: number;
  score: number;
}

export class MatchStatsTracker {
  private shotsFired = 0;
  private hits = 0;
  private damageDealt = 0;
  private kills = 0;
  private score = 0;
  private startedAt: number | null = null;
  private frozenElapsed = 0;
  private bound = false;

  /** Subscribe once; the tracker then follows level load/unload itself. */
  start(): void {
    if (this.bound) return;
    this.bound = true;

    eventBus.on('combat:shotFired', () => {
      if (this.startedAt === null) return;
      this.shotsFired += 1;
    });
    eventBus.on('combat:hit', (payload) => {
      if (this.startedAt === null) return;
      this.hits += 1;
      const damage = (payload as { damage?: number }).damage;
      if (typeof damage === 'number') this.damageDealt += damage;
      if ((payload as { isKill?: boolean }).isKill) this.kills += 1;
    });
    eventBus.on('level:loaded', () => this.reset());
  }

  reset(): void {
    this.shotsFired = 0;
    this.hits = 0;
    this.damageDealt = 0;
    this.kills = 0;
    this.score = 0;
    this.frozenElapsed = 0;
    this.startedAt = performance.now();
  }

  /** Stop the clock (match over) without clearing the tallies. */
  freeze(): void {
    if (this.startedAt === null) return;
    this.frozenElapsed = (performance.now() - this.startedAt) / 1000;
    this.startedAt = null;
  }

  get snapshot(): MatchStats {
    const elapsed = this.startedAt === null
      ? this.frozenElapsed
      : (performance.now() - this.startedAt) / 1000;
    return {
      shotsFired: this.shotsFired,
      hits: this.hits,
      // A shotgun blast is one shot but up to 8 hits, so accuracy is capped.
      accuracy: this.shotsFired === 0
        ? 0
        : Math.min(100, (this.hits / this.shotsFired) * 100),
      damageDealt: this.damageDealt,
      elapsedSeconds: elapsed,
      kills: this.kills,
      score: this.score,
    };
  }
}

export const matchStats = new MatchStatsTracker();
export default matchStats;
