/**
 * GameOverScreen.ts — the end-of-match debrief.
 *
 * Two halves, and the distinction matters:
 *
 *  - the FINAL SCOREBOARD, which is the match's authoritative result. It comes
 *    from the server, because in a real multiplayer match the placings are a
 *    property of the match and not of anyone's client;
 *  - your PERSONAL stats (accuracy, damage, shots), which are local telemetry
 *    and always were.
 *
 * This screen is now reached only when the MATCH ends — the score limit, the
 * clock, or the player quitting. It used to be shown when the player died,
 * which was the bug: death is a three-second interruption, not a debrief.
 */
import { button, div, el, uiSound } from '../dom';
import matchStats from '../../state/MatchStatsTracker';
import type { Screen } from '../UIManager';
import type { MatchStateWire, ScoreRowWire } from '../../net/Protocol';

export interface GameOverHandlers {
  onRetry: () => void;
  onMainMenu: () => void;
}

export class GameOverScreen implements Screen {
  readonly element = div('screen');
  private readonly grid = div('stat-grid');
  private readonly heading = el('h2', 'title', 'MATCH OVER');
  private readonly reason = el('p', 'subtitle', 'Debrief');
  private readonly placement = div('debrief-placement');
  private readonly board = div('scoreboard');
  private finalState: MatchStateWire | null = null;
  private localId: string | null = null;

  constructor(handlers: GameOverHandlers) {
    const inner = div('screen__inner');
    const panel = div('panel');
    panel.append(this.reason, this.heading, this.placement, this.board, this.grid);

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

  /** Why the match ended: "Score Limit Reached", "Time Expired", ... */
  setReason(text: string): void {
    this.reason.textContent = text;
  }

  /**
   * The authoritative final standings.
   *
   * Null is a legitimate state (the player quit before a match state ever
   * arrived), and the screen simply omits the board rather than inventing
   * one.
   */
  setFinalState(state: MatchStateWire | null, localId: string | null): void {
    this.finalState = state;
    this.localId = localId;
  }

  private renderScoreboard(): void {
    this.board.replaceChildren();
    this.placement.textContent = '';
    const state = this.finalState;
    if (!state || state.standings.length === 0) {
      this.board.style.display = 'none';
      this.placement.style.display = 'none';
      return;
    }
    this.board.style.display = '';
    this.placement.style.display = '';

    const place = this.localId
      ? state.standings.findIndex((r) => r.id === this.localId) + 1
      : 0;
    if (place > 0) {
      // FFA pays out the top three, as COD does, so "did I win" is not a
      // single-winner question and the screen should not pretend it is.
      const podium = !state.teamBased && place <= 3;
      this.placement.textContent = podium
        ? `${ordinal(place)} PLACE — VICTORY`
        : `${ordinal(place)} PLACE`;
      this.placement.classList.toggle('debrief-placement--win', podium);
    }

    const header = div('scoreboard__row scoreboard__row--head');
    for (const [label, cls] of [
      ['PLAYER', 'name'], ['K', 'num'], ['D', 'num'],
      ['K/D', 'num'], ['SCORE', 'num'],
    ] as const) {
      header.appendChild(div(`scoreboard__cell scoreboard__cell--${cls}`, label));
    }
    this.board.appendChild(header);

    for (let i = 0; i < state.standings.length; i += 1) {
      this.board.appendChild(this.renderRow(state.standings[i], i + 1, state.teamBased));
    }
  }

  private renderRow(row: ScoreRowWire, rank: number, teamBased: boolean): HTMLElement {
    const node = div('scoreboard__row');
    if (row.id === this.localId) node.classList.add('scoreboard__row--you');
    if (teamBased) node.classList.add(`scoreboard__row--team-${row.team.toLowerCase()}`);

    const kd = row.deaths === 0 ? row.kills : row.kills / row.deaths;
    const name = div('scoreboard__cell scoreboard__cell--name');
    name.append(
      div('scoreboard__rank', String(rank)),
      div('scoreboard__name', row.name),
    );
    node.append(
      name,
      div('scoreboard__cell scoreboard__cell--num', String(row.kills)),
      div('scoreboard__cell scoreboard__cell--num', String(row.deaths)),
      div('scoreboard__cell scoreboard__cell--num', kd.toFixed(2)),
      div('scoreboard__cell scoreboard__cell--num', String(row.score)),
    );
    return node;
  }

  onShow(): void {
    this.renderScoreboard();
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

function ordinal(n: number): string {
  const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'TH'
    : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH';
  return `${n}${suffix}`;
}

export default GameOverScreen;
