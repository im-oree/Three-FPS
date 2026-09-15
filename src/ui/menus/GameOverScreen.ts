/**
 * GameOverScreen.ts — Document 5 §7.6.
 *
 * Real end-of-match summary built from MatchStatsTracker. `kills` and `score`
 * are displayed even though nothing sets them yet, so a future AI document
 * needs no changes here at all.
 */
import { button, div, el, uiSound } from '../dom';
import matchStats from '../../state/MatchStatsTracker';
import type { Screen } from '../UIManager';

export interface GameOverHandlers {
  onRetry: () => void;
  onMainMenu: () => void;
}

export class GameOverScreen implements Screen {
  readonly element = div('screen');
  private readonly grid = div('stat-grid');
  private readonly heading = el('h2', 'title', 'MATCH OVER');
  private readonly reason = el('p', 'subtitle', 'Debrief');

  constructor(handlers: GameOverHandlers) {
    const inner = div('screen__inner');
    const panel = div('panel');
    panel.append(this.reason, this.heading, this.grid);

    const row = div('btn-row');
    row.style.marginTop = '26px';
    row.append(
      button('Retry', 'btn btn--primary', () => {
        uiSound('confirm');
        handlers.onRetry();
      }),
      button('Main Menu', 'btn', () => {
        uiSound('back');
        handlers.onMainMenu();
      }),
    );
    panel.appendChild(row);
    inner.appendChild(panel);
    this.element.appendChild(inner);
  }

  /** Distinguish "you died" from the manual debug end. */
  setReason(text: string): void {
    this.reason.textContent = text;
  }

  onShow(): void {
    matchStats.freeze();
    const s = matchStats.snapshot;
    const mins = Math.floor(s.elapsedSeconds / 60);
    const secs = Math.floor(s.elapsedSeconds % 60);

    const cells: Array<[string, string]> = [
      ['Shots Fired', String(s.shotsFired)],
      ['Hits', String(s.hits)],
      ['Accuracy', `${s.accuracy.toFixed(1)}%`],
      ['Damage Dealt', s.damageDealt.toFixed(0)],
      ['Time', `${mins}:${String(secs).padStart(2, '0')}`],
      ['Kills', String(s.kills)],
    ];
    this.grid.replaceChildren();
    for (const [label, value] of cells) {
      const stat = div('stat');
      stat.append(div('stat__value', value), div('stat__label', label));
      this.grid.appendChild(stat);
    }
  }
}

export default GameOverScreen;
