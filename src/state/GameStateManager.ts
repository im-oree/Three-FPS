/**
 * GameStateManager.ts — which high-level state the game is in. Document 1 ships
 * the enum + a singleton manager whose setState() emits 'game:stateChanged';
 * no screens react to it yet (that begins in Document 5).
 */
import eventBus from '../core/EventBus';

export const GameState = {
  BOOT: 'BOOT',
  LOADING: 'LOADING',
  MAIN_MENU: 'MAIN_MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER',
} as const;

export type GameStateValue = (typeof GameState)[keyof typeof GameState];

export class GameStateManager {
  private state: GameStateValue = GameState.BOOT;

  getState(): GameStateValue {
    return this.state;
  }

  setState(newState: GameStateValue): void {
    if (newState === this.state) return;
    const previous = this.state;
    this.state = newState;
    eventBus.emit('game:stateChanged', { previous, current: newState });
  }
}

/** The one shared manager for the whole application. */
export const gameStateManager = new GameStateManager();
export default gameStateManager;
