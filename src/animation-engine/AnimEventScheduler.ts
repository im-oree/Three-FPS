/**
 * AnimEventScheduler.ts — Document C §5.5.
 *
 * Fires per-clip {atProgress, event} beat tables via the EventBus. Gameplay
 * systems (reload, fidgets) own the LOGICAL duration; the scheduler owns the
 * beat cursor and the exactly-once guarantee as progress crosses each beat.
 * Event names are GENERIC (magazine_detach / magazine_attach / chamber_round
 * + per-weapon extras like shell_insert) — consumers key on names, never on
 * weapon identity (ReloadSystem stays weapon-agnostic by construction).
 */
import eventBus from '../core/EventBus';

export interface ScheduledBeat {
  /** 0..1 fraction of the owning action's LOGICAL duration. */
  readonly atProgress: number;
  /** Generic event name emitted on `anim:beat`. */
  readonly event: string;
}

interface Timeline {
  readonly id: string;
  readonly beats: readonly ScheduledBeat[];
  readonly payload: Record<string, unknown>;
  cursor: number;
  onBeat?: (beat: ScheduledBeat) => boolean | void;
  onComplete?: () => void;
  cancelled: boolean;
}

export class AnimEventScheduler {
  private readonly timelines: Timeline[] = [];

  /**
   * Register a beat timeline. `onBeat` runs BEFORE the bus emission and may
   * return false to suppress it (e.g. the ammo-grant beat handled internally
   * by ReloadSystem). Returns the timeline id (for cancel()).
   */
  play(
    id: string,
    beats: readonly ScheduledBeat[],
    payload: Record<string, unknown>,
    onBeat?: (beat: ScheduledBeat) => boolean | void,
    onComplete?: () => void,
  ): string {
    this.cancel(id);
    this.timelines.push({
      id,
      beats: [...beats].sort((a, b) => a.atProgress - b.atProgress),
      payload,
      cursor: 0,
      onBeat,
      onComplete,
      cancelled: false,
    });
    return id;
  }

  cancel(id: string): void {
    const timeline = this.timelines.find((t) => t.id === id);
    if (timeline) timeline.cancelled = true;
  }

  /** Advance every live timeline; `progress` comes from the OWNER's logical timer. */
  update(id: string, progress: number): void {
    const timeline = this.timelines.find((t) => t.id === id && !t.cancelled);
    if (!timeline) return;
    while (
      timeline.cursor < timeline.beats.length
      && progress >= timeline.beats[timeline.cursor].atProgress
    ) {
      const beat = timeline.beats[timeline.cursor];
      timeline.cursor += 1;
      const emit = timeline.onBeat ? timeline.onBeat(beat) : true;
      if (emit !== false) {
        eventBus.emit('anim:beat', { ...timeline.payload, event: beat.event, atProgress: beat.atProgress });
      }
    }
  }

  /** Complete a timeline (fires onComplete once, then drops it). */
  finish(id: string): void {
    const index = this.timelines.findIndex((t) => t.id === id && !t.cancelled);
    if (index === -1) return;
    const [timeline] = this.timelines.splice(index, 1);
    timeline.onComplete?.();
  }
}

export default AnimEventScheduler;
