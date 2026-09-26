/**
 * TheatreScreen.ts — the replay viewer.
 *
 * A thin shell over the playback layer: everything here reads state and
 * writes intent, and none of it knows how a frame is decoded, how a camera is
 * composed or what any particular ability looks like. That separation is the
 * reason the viewer did not need rewriting when the killcam gained slow
 * motion, and will not need rewriting when a camera profile improves.
 *
 * THE TIMELINE IS THE EVENT LOG
 * -----------------------------
 * Markers are not a hand-maintained list of "interesting things". They are
 * whatever is in the EventLog, filtered by type. A feature that records an
 * event it invented -- an EMP pulse, a flag capture -- gets timeline markers
 * for free, with no change to this file. That is the same property the
 * recorder and the camera director have, carried through to the UI.
 *
 * The player list is built from the CURRENT FRAME rather than from a match
 * roster, so scrubbing to before someone joined correctly shows them absent.
 */
import { button, div, el } from '../dom';
import type { Screen } from '../UIManager';
import type { GameEvent } from '../../server/EventLog';

export interface TheatreHandlers {
  onClose: () => void;
  onSaveClip: () => void;
  /** Watch a specific actor, or null for the free camera. */
  onFollow: (id: string | null) => void;
  onSeekFraction: (fraction: number) => void;
  onSetSpeed: (speed: number) => void;
  onTogglePlay: () => void;
  /** Start/stop a webm recording of the viewport. */
  onToggleRecord: () => void;
}

export interface TheatreFrameInfo {
  readonly playing: boolean;
  readonly speed: number;
  readonly position: number;
  readonly duration: number;
  readonly progress: number;
  readonly players: ReadonlyArray<{ id: string; name: string; alive: boolean }>;
  readonly followId: string | null;
  readonly recording: boolean;
}

/** Playback rates offered, from the spec's 0.25x-4x range. */
const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/**
 * Marker colour per event type.
 *
 * An unknown type gets the neutral colour rather than being dropped, because
 * the whole point of an open event log is that the UI must cope with types
 * it has never heard of.
 */
const MARKER_CLASS: Record<string, string> = {
  kill: 'theatre__marker--kill',
  damage: 'theatre__marker--damage',
};

const formatTime = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

export class TheatreScreen implements Screen {
  readonly element = div('screen screen--transparent theatre');

  private readonly scrubber = div('theatre__scrub');
  private readonly markerLayer = div('theatre__markers');
  private readonly playhead = div('theatre__playhead');
  private readonly timeLabel = div('theatre__time', '0:00.00 / 0:00.00');
  private readonly playButton: HTMLButtonElement;
  private readonly recordButton: HTMLButtonElement;
  private readonly speedRow = div('theatre__speeds');
  private readonly rosterList = div('theatre__roster');
  private readonly hint = div('theatre__hint');

  private readonly speedButtons = new Map<number, HTMLButtonElement>();
  private readonly rosterButtons = new Map<string, HTMLButtonElement>();
  private rosterKey = '';
  private scrubbing = false;

  constructor(private readonly handlers: TheatreHandlers) {
    // --- top bar ---
    const bar = div('theatre__bar');
    const title = div('theatre__title', 'THEATRE');
    const spacer = div('theatre__spacer');

    this.recordButton = button('● REC', 'theatre__btn', () => handlers.onToggleRecord());
    bar.append(
      title,
      spacer,
      button('Save Clip', 'theatre__btn', () => handlers.onSaveClip()),
      this.recordButton,
      button('Close', 'theatre__btn theatre__btn--ghost', () => handlers.onClose()),
    );

    // --- left: who is in this frame ---
    const roster = div('theatre__panel theatre__panel--roster');
    roster.append(div('theatre__panel-title', 'PLAYERS'), this.rosterList);

    // --- bottom: transport ---
    const transport = div('theatre__transport');

    this.playButton = button('❚❚', 'theatre__btn theatre__btn--play', () => {
      handlers.onTogglePlay();
    });

    for (const speed of SPEEDS) {
      const node = button(`${speed}x`, 'theatre__speed', () => handlers.onSetSpeed(speed));
      this.speedButtons.set(speed, node);
      this.speedRow.append(node);
    }

    this.scrubber.append(this.markerLayer, this.playhead);
    this.wireScrubbing();

    transport.append(this.playButton, this.scrubber, this.timeLabel, this.speedRow);

    this.hint.textContent = 'WASD fly · Space/Ctrl up-down · Shift boost · drag to look'
      + ' · wheel speed · Tab cycle player · 1-9 saved angles · Home reset';

    this.element.append(bar, roster, transport, this.hint);
  }

  /**
   * Dragging anywhere on the bar scrubs, including outside it once started.
   *
   * Releasing outside the element is the normal way people use a scrub bar,
   * and a listener only on the bar itself would leave the playhead stuck to
   * the cursor.
   */
  private wireScrubbing(): void {
    const seekFromEvent = (event: MouseEvent): void => {
      const rect = this.scrubber.getBoundingClientRect();
      if (rect.width <= 0) return;
      const fraction = (event.clientX - rect.left) / rect.width;
      this.handlers.onSeekFraction(Math.max(0, Math.min(1, fraction)));
    };

    this.scrubber.addEventListener('mousedown', (event) => {
      this.scrubbing = true;
      seekFromEvent(event);
      event.preventDefault();
      // Stop the free camera from also treating this drag as a look.
      event.stopPropagation();
    });
    window.addEventListener('mousemove', (event) => {
      if (this.scrubbing) seekFromEvent(event);
    });
    window.addEventListener('mouseup', () => { this.scrubbing = false; });
  }

  /**
   * Rebuild the event markers.
   *
   * Called when a clip is loaded, not per frame: the markers only change when
   * the recording does, and rebuilding this DOM sixty times a second would be
   * the most expensive thing in the viewer by a wide margin.
   */
  setEvents(events: readonly GameEvent[], fromTick: number, toTick: number): void {
    this.markerLayer.replaceChildren();
    const span = Math.max(1, toTick - fromTick);
    for (const event of events) {
      const fraction = (event.tick - fromTick) / span;
      if (fraction < 0 || fraction > 1) continue;
      const marker = div(`theatre__marker ${MARKER_CLASS[event.type] ?? 'theatre__marker--other'}`);
      marker.style.left = `${fraction * 100}%`;
      marker.title = `${event.type} @ ${formatTime(event.time)}`;
      // Clicking a marker jumps to it: the fastest way to find the kill in a
      // ten-minute recording is to click the kill.
      marker.addEventListener('mousedown', (mouse) => {
        mouse.stopPropagation();
        this.handlers.onSeekFraction(fraction);
      });
      this.markerLayer.append(marker);
    }
  }

  /** Per-frame refresh. Deliberately cheap: text and a transform. */
  update(info: TheatreFrameInfo): void {
    this.playButton.textContent = info.playing ? '❚❚' : '▶';
    this.playhead.style.left = `${info.progress * 100}%`;
    this.timeLabel.textContent = `${formatTime(info.position)} / ${formatTime(info.duration)}`;

    for (const [speed, node] of this.speedButtons) {
      node.classList.toggle('theatre__speed--on', Math.abs(speed - info.speed) < 0.01);
    }

    this.recordButton.classList.toggle('theatre__btn--recording', info.recording);
    this.recordButton.textContent = info.recording ? '■ STOP' : '● REC';

    // The roster is rebuilt only when the CAST changes, not every frame:
    // scrubbing through a match would otherwise thrash the DOM continuously.
    const key = `${info.players.map((p) => `${p.id}:${p.alive ? 1 : 0}`).join(',')}|${info.followId}`;
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      this.rebuildRoster(info);
    }
  }

  private rebuildRoster(info: TheatreFrameInfo): void {
    this.rosterList.replaceChildren();
    this.rosterButtons.clear();

    const free = button('Free camera', 'theatre__roster-row', () => this.handlers.onFollow(null));
    free.classList.toggle('theatre__roster-row--on', info.followId === null);
    this.rosterList.append(free);

    for (const player of info.players) {
      const row = button(player.name, 'theatre__roster-row', () => this.handlers.onFollow(player.id));
      row.classList.toggle('theatre__roster-row--on', info.followId === player.id);
      row.classList.toggle('theatre__roster-row--dead', !player.alive);
      this.rosterButtons.set(player.id, row);
      this.rosterList.append(row);
    }

    if (!info.players.length) {
      this.rosterList.append(el('div', 'theatre__empty', 'No players in this frame'));
    }
  }

  onShow(): void { this.element.classList.add('theatre--open'); }
  onHide(): void { this.element.classList.remove('theatre--open'); }
}

export default TheatreScreen;
