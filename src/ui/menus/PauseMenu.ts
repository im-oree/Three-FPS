/**
 * PauseMenu.ts — Document 5 §7.5.
 *
 * Resume must be triggered by clicking the button itself: re-acquiring
 * pointer lock needs a genuine user gesture, so it cannot be done from a
 * timer or from the state transition.
 *
 * Settings opens as a LAYERED OVERLAY rather than a state change, so the game
 * stays PAUSED underneath and Back returns here instead of to the main menu.
 */
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import { button, div, el, uiSound } from '../dom';
import type { Screen } from '../UIManager';

export interface PauseMenuHandlers {
  onResume: () => void;
  onOpenSettings: () => void;
  onQuitToMenu: () => void;
  onEndMatch: () => void;
}

export class PauseMenu implements Screen {
  readonly element = div('screen screen--overlay');

  constructor(handlers: PauseMenuHandlers) {
    const inner = div('screen__inner');
    inner.style.width = 'min(420px, 90vw)';
    const panel = div('panel');

    panel.append(
      el('p', 'subtitle', 'Match Paused'),
      el('h2', 'title', 'PAUSED'),
    );

    const column = div('btn-column');
    column.style.width = '100%';
    column.style.marginTop = '20px';
    column.append(
      button('Resume', 'btn btn--primary', () => handlers.onResume()),
      button('Settings', 'btn', () => {
        uiSound('confirm');
        handlers.onOpenSettings();
      }),
      // Stand-in for a real win/loss condition. A future AI/objectives
      // document replaces this with an actual match end.
      button('End Match (Debug)', 'btn btn--ghost', () => {
        uiSound('confirm');
        handlers.onEndMatch();
      }),
      button('Quit to Main Menu', 'btn btn--ghost btn--danger', () => {
        uiSound('back');
        handlers.onQuitToMenu();
      }),
    );
    panel.appendChild(column);
    inner.appendChild(panel);
    this.element.appendChild(inner);
    void GameState;
  }
}

export default PauseMenu;

/** Shared by main.ts — keeps the navigate event name in one place. */
export function navigate(to: string): void {
  eventBus.emit('ui:navigate', { to });
}
