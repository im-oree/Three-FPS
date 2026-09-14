/**
 * MainMenu.ts — Document 5 §7.1.
 *
 * Branded landing screen with Play / Loadout / Settings / Quit. Play opens an
 * in-place level-select panel (a sub-panel, deliberately NOT its own
 * top-level state) listing the real levels from LevelDefinition by their
 * displayName.
 */
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import { LEVELS } from '../../environment/LevelDefinition';
import { button, div, el, uiSound } from '../dom';
import type { Screen } from '../UIManager';

export class MainMenu implements Screen {
  readonly element = div('screen');
  private readonly rightPane = div('level-list');
  private mode: 'root' | 'levels' | 'quit' = 'root';

  constructor(private readonly onPlayLevel: (levelId: string) => void) {
    const inner = div('screen__inner');
    const layout = div('main-menu__layout');

    // --- brand ------------------------------------------------------------
    const brand = div('main-menu__brand');
    const title = el('h1', 'title');
    title.append('OPER', (() => {
      const mark = el('span', 'title__mark', 'A');
      return mark;
    })(), 'TOR');
    const subtitle = el('p', 'subtitle', 'Tactical Movement Prototype');
    const version = div('main-menu__version', 'BUILD 0.5 — DOCUMENTS 1-5');
    brand.append(title, subtitle, version);

    // --- buttons ----------------------------------------------------------
    const column = div('btn-column');
    column.append(
      button('Play', 'btn btn--primary', () => this.showLevels()),
      button('Loadout', 'btn', () => {
        uiSound('confirm');
        eventBus.emit('ui:navigate', { to: GameState.LOADOUT });
      }),
      button('Settings', 'btn', () => {
        uiSound('confirm');
        eventBus.emit('ui:navigate', { to: GameState.SETTINGS });
      }),
      button('Quit', 'btn btn--ghost btn--danger', () => this.showQuit()),
    );
    brand.appendChild(div(undefined));
    brand.appendChild(column);

    layout.append(brand, this.rightPane);
    inner.appendChild(layout);
    this.element.appendChild(inner);
    this.showRoot();
  }

  onShow(): void {
    this.showRoot();
  }

  private showRoot(): void {
    this.mode = 'root';
    this.rightPane.replaceChildren();
    const hint = div('panel panel--tight');
    hint.appendChild(div('section-heading', 'Controls'));
    const lines = [
      ['Move', 'W A S D'],
      ['Sprint / tac sprint', 'Shift / double-tap Shift'],
      ['Crouch / slide', 'C'],
      ['Jump / mantle', 'Space'],
      ['Weapons', '1 - 7 or wheel'],
      ['Perspective', 'P'],
      ['Pause', 'Esc'],
    ];
    for (const [name, key] of lines) {
      const row = div('binding');
      row.append(div('binding__name', name), div('binding__key', key));
      hint.appendChild(row);
    }
    this.rightPane.appendChild(hint);
  }

  private showLevels(): void {
    this.mode = 'levels';
    uiSound('confirm');
    this.rightPane.replaceChildren();
    this.rightPane.appendChild(div('section-heading', 'Select Deployment'));
    for (const level of LEVELS) {
      const card = el('button', 'level-card');
      card.type = 'button';
      card.append(
        div('level-card__name', level.displayName),
        div('level-card__desc', level.description),
      );
      card.addEventListener('click', () => {
        uiSound('confirm');
        this.onPlayLevel(level.id);
      });
      this.rightPane.appendChild(card);
    }
    this.rightPane.appendChild(button('Back', 'btn btn--ghost btn--small', () => {
      uiSound('back');
      this.showRoot();
    }));
  }

  /**
   * A page cannot close its own tab for security reasons, so "Quit" shows a
   * real panel rather than attempting window.close() — and never a native
   * confirm() dialog (§10).
   */
  private showQuit(): void {
    this.mode = 'quit';
    this.rightPane.replaceChildren();
    const panel = div('panel');
    panel.append(
      div('section-heading', 'Session Ended'),
      div(undefined, 'Thanks for playing. Close the tab to exit, or head back in.'),
    );
    const row = div('btn-row');
    row.style.marginTop = '18px';
    row.appendChild(button('Back to Menu', 'btn btn--small', () => {
      uiSound('back');
      this.showRoot();
    }));
    panel.appendChild(row);
    this.rightPane.appendChild(panel);
  }

  /** Test seam. */
  get currentMode(): string { return this.mode; }
}

export default MainMenu;
