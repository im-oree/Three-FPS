/**
 * ServerBrowser.ts — find a game somebody else is hosting, and join it.
 *
 * Modelled on the Black Ops / MW server browser: a dense table of rows, each
 * one a real game, with the four columns a player actually decides on —
 * NAME, MAP + MODE, PLAYERS, PING — and a signal-bar glyph for ping because
 * a number alone is hard to scan. Sorting is by ping ascending, since the
 * nearest playable game is almost always the one you want.
 *
 * Every control is live. There is no placeholder row and no fake data: the
 * list is whatever the signalling directory reports, and JOIN performs the
 * real WebRTC handshake.
 */
import { button, div, el, uiSound } from '../dom';
import { LobbyClient } from '../../net/LobbyClient';
import type { GameListing } from '../../net/LobbyProtocol';
import { getLevel } from '../../environment/LevelDefinition';
import { getGameMode } from '../../server/GameModes';

/** Ping thresholds for the signal-bar glyph, in ms. */
const PING_GOOD = 60;
const PING_OK = 120;

export interface ServerBrowserDeps {
  /** Where the signalling backend lives. */
  readonly lobbyUrl: string;
  /** Join a listed game. Resolves when the match is actually starting. */
  readonly onJoin: (game: GameListing, password?: string) => Promise<void>;
  /** Open the host flow (the custom match window, in hosting mode). */
  readonly onHost: () => void;
}

export class ServerBrowser {
  readonly element = div('mapwin');

  private readonly rows = div('browser__rows');
  private readonly status = div('browser__status');
  private lobby: LobbyClient | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private games: readonly GameListing[] = [];
  private selectedId: string | null = null;
  private joining = false;

  constructor(private readonly deps: ServerBrowserDeps) {
    const panel = div('mapwin__panel mapwin__panel--browser');

    const head = div('mapwin__head');
    head.append(
      div('mapwin__title', 'SERVER BROWSER'),
      button('CLOSE', 'btn btn--small btn--ghost', () => this.close()),
    );

    // Column headers, so the table reads as a table rather than a list of
    // strings. Mirrors the reference's ordering.
    const header = div('browser__header');
    header.append(
      div('browser__col browser__col--name', 'GAME'),
      div('browser__col browser__col--map', 'MAP'),
      div('browser__col browser__col--mode', 'MODE'),
      div('browser__col browser__col--players', 'PLAYERS'),
      div('browser__col browser__col--ping', 'PING'),
    );

    const foot = div('mapwin__foot browser__foot');
    foot.append(this.status);
    const actions = div('browser__actions');
    actions.append(
      button('REFRESH', 'btn btn--small btn--ghost', () => {
        uiSound('confirm');
        this.refresh();
      }),
      button('HOST GAME', 'btn btn--small', () => {
        uiSound('confirm');
        this.close();
        this.deps.onHost();
      }),
      button('JOIN', 'btn btn--primary', () => this.joinSelected()),
    );
    foot.appendChild(actions);

    panel.append(head, header, this.rows, foot);
    this.element.appendChild(panel);
    this.element.addEventListener('click', (event) => {
      if (event.target === this.element) this.close();
    });

    void this.open();
  }

  /** Connect and start polling. */
  private async open(): Promise<void> {
    this.setStatus('Connecting to the game list…');
    this.lobby = new LobbyClient(this.deps.lobbyUrl, {
      onGames: (games) => {
        this.games = games;
        this.paint();
      },
      onClosed: () => this.setStatus('Lost contact with the game list.', true),
    });
    try {
      await this.lobby.connect();
    } catch {
      this.setStatus('Could not reach the game list. Is the backend running?', true);
      this.paint();
      return;
    }
    this.refresh();
    // Poll: listings carry a player count and a ping that both move.
    this.refreshTimer = setInterval(() => this.refresh(), 3000);
  }

  private refresh(): void {
    this.lobby?.refresh();
  }

  private setStatus(text: string, bad = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('browser__status--bad', bad);
  }

  /** Redraw the table. Preserves the selection across refreshes. */
  private paint(): void {
    this.rows.replaceChildren();

    if (this.games.length === 0) {
      const empty = div('browser__empty');
      empty.append(
        div('browser__empty-title', 'NO GAMES FOUND'),
        div('browser__empty-hint',
          'Nobody is hosting right now. Host a game and it will appear here for everyone else.'),
      );
      this.rows.appendChild(empty);
      this.setStatus('0 games');
      return;
    }

    // Nearest first: the usual default, and the one a player wants. Games
    // with no measurement yet sort last rather than pretending to be 0 ms.
    const rank = (g: GameListing): number => (g.pingMs > 0 ? g.pingMs : Number.MAX_SAFE_INTEGER);
    const sorted = [...this.games].sort((a, b) => rank(a) - rank(b));
    for (const game of sorted) {
      this.rows.appendChild(this.buildRow(game));
    }
    const players = sorted.reduce((n, g) => n + g.playerCount, 0);
    this.setStatus(`${sorted.length} game${sorted.length === 1 ? '' : 's'} · ${players} player${players === 1 ? '' : 's'} online`);
  }

  private buildRow(game: GameListing): HTMLElement {
    const row = el('button', 'browser__row');
    row.type = 'button';
    if (game.id === this.selectedId) row.classList.add('browser__row--on');
    // A full game is still shown — knowing it exists matters — but it reads
    // as unavailable rather than silently failing when JOIN is pressed.
    const full = game.playerCount >= game.maxPlayers;
    if (full) row.classList.add('browser__row--full');

    const name = div('browser__col browser__col--name');
    name.append(div('browser__name', game.name));
    if (game.hasPassword) name.append(div('browser__lock', 'LOCKED'));
    if (game.inProgress) name.append(div('browser__live', 'LIVE'));

    row.append(
      name,
      div('browser__col browser__col--map', safeLevelName(game.levelId)),
      div('browser__col browser__col--mode', safeModeName(game.modeId)),
      div('browser__col browser__col--players', `${game.playerCount}/${game.maxPlayers}`),
      this.buildPing(game.pingMs),
    );

    row.addEventListener('click', () => {
      uiSound('confirm');
      this.selectedId = game.id;
      this.paint();
    });
    // Double-click joins, as the reference does.
    row.addEventListener('dblclick', () => {
      this.selectedId = game.id;
      void this.joinSelected();
    });
    return row;
  }

  /**
   * Ping as a number plus a four-bar signal glyph.
   *
   * A freshly listed game has not been measured yet. Showing that as "0 ms,
   * four green bars" is worse than showing nothing: it advertises a perfect
   * connection to a host nobody has timed. Unmeasured reads as "--" with
   * unlit bars until a real figure arrives.
   */
  private buildPing(ms: number): HTMLElement {
    const cell = div('browser__col browser__col--ping');
    const measured = ms > 0;
    const quality = !measured ? 'none' : ms <= PING_GOOD ? 'good' : ms <= PING_OK ? 'ok' : 'bad';
    cell.appendChild(div('browser__ping-text', measured ? `${Math.round(ms)}` : '--'));
    const bars = div(`browser__bars browser__bars--${quality}`);
    const lit = !measured ? 0 : ms <= PING_GOOD ? 4 : ms <= PING_OK ? 3 : ms <= 250 ? 2 : 1;
    for (let i = 1; i <= 4; i += 1) {
      bars.appendChild(div(`browser__bar${i <= lit ? ' browser__bar--on' : ''}`));
    }
    cell.appendChild(bars);
    return cell;
  }

  private async joinSelected(): Promise<void> {
    if (this.joining) return;
    const game = this.games.find((g) => g.id === this.selectedId);
    if (!game) {
      this.setStatus('Select a game first.', true);
      return;
    }
    if (game.playerCount >= game.maxPlayers) {
      this.setStatus('That game is full.', true);
      return;
    }

    let password: string | undefined;
    if (game.hasPassword) {
      const entered = window.prompt(`"${game.name}" is password protected.`);
      if (entered === null) return;
      password = entered;
    }

    uiSound('confirm');
    this.joining = true;
    this.setStatus(`Connecting to ${game.name}…`);
    try {
      await this.deps.onJoin(game, password);
      this.close();
    } catch (err) {
      this.joining = false;
      this.setStatus(`Could not join: ${(err as Error).message}`, true);
    }
  }

  close(): void {
    uiSound('back');
    this.dispose();
    this.element.remove();
  }

  dispose(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    this.lobby?.dispose();
    this.lobby = null;
  }
}

/** A listing names a level this build may not have; never throw over it. */
function safeLevelName(levelId: string): string {
  try {
    return getLevel(levelId).displayName;
  } catch {
    return levelId.toUpperCase();
  }
}

function safeModeName(modeId: string): string {
  try {
    return getGameMode(modeId).displayName;
  } catch {
    return modeId.toUpperCase();
  }
}
