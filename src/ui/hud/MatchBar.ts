/**
 * MatchBar.ts — the match clock and score, top centre, plus the pre-match
 * countdown.
 *
 * A game mode is only real to the player if they can see the goal and the
 * time left to reach it. This widget is that: the clock counting down, the
 * score counting up toward the limit, and the mode's name.
 *
 * Everything shown here comes from the server's `matchState`. The client owns
 * none of it — it cannot, because in a real multiplayer match the clock and
 * the scores are properties of the match, not of any one player's session.
 */
import { div, el } from '../dom';
import type { MatchStateWire } from '../../net/Protocol';

/** Below this many seconds the clock turns red. */
const URGENT_SECONDS = 30;

export class MatchBar {
  readonly element = div('match-bar');
  readonly countdownElement = div('match-countdown');

  private readonly scoreA = el('span', 'match-bar__score match-bar__score--a', '0');
  private readonly clock = el('span', 'match-bar__clock', '0:00');
  private readonly scoreB = el('span', 'match-bar__score match-bar__score--b', '0');
  private readonly mode = el('span', 'match-bar__mode', '');

  private readonly countdownNumber = div('match-countdown__number');
  private readonly countdownLabel = div('match-countdown__label', 'MATCH STARTING');

  constructor() {
    const stack = div();
    stack.style.display = 'flex';
    stack.style.flexDirection = 'column';
    stack.style.alignItems = 'center';
    stack.append(this.clock, this.mode);

    this.element.append(this.scoreA, stack, this.scoreB);

    this.countdownElement.append(this.countdownNumber, this.countdownLabel);
    this.countdownElement.style.display = 'none';
  }

  /**
   * Render a server match state.
   *
   * `localId` decides which score is shown on the left in a free-for-all: your
   * own. In FFA there are no teams, so the two slots become "you" and "the
   * best score in the lobby", which is the number that actually matters to a
   * player racing to the limit.
   */
  render(state: MatchStateWire, localId: string | null): void {
    this.clock.textContent = formatClock(state.timeRemaining);
    this.clock.classList.toggle(
      'match-bar__clock--urgent',
      state.timeRemaining <= URGENT_SECONDS && state.phase === 'live',
    );

    if (state.teamBased) {
      this.scoreA.textContent = String(state.teamScores.A);
      this.scoreB.textContent = String(state.teamScores.B);
      this.mode.textContent = `${state.modeName}  ·  ${state.scoreLimit}`;
    } else {
      const you = state.standings.find((row) => row.id === localId);
      const leader = state.standings[0];
      this.scoreA.textContent = String(you?.score ?? 0);
      this.scoreB.textContent = String(leader?.score ?? 0);
      const place = localId
        ? state.standings.findIndex((row) => row.id === localId) + 1
        : 0;
      this.mode.textContent = place > 0
        ? `${ordinal(place)} of ${state.standings.length}  ·  ${state.scoreLimit} TO WIN`
        : `${state.modeName}  ·  ${state.scoreLimit}`;
    }

    // The pre-match countdown owns the centre of the screen while it runs.
    if (state.phase === 'countdown' && state.countdown > 0) {
      this.countdownElement.style.display = '';
      this.countdownNumber.textContent = String(Math.ceil(state.countdown));
    } else {
      this.countdownElement.style.display = 'none';
    }
  }
}

/** m:ss, floored — a clock showing 0:00 while time remains would be a lie. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function ordinal(n: number): string {
  const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'TH'
    : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH';
  return `${n}${suffix}`;
}

export default MatchBar;
