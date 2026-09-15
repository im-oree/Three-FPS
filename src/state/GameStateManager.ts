/**
 * GameStateManager.ts — which high-level state the game is in.
 *
 * Document 1 shipped the enum plus setState()/'game:stateChanged'. Document 5
 * completes it: the LOADOUT and SETTINGS screens join the enum, and the
 * manager now answers the question the engine needs every frame —
 * `isSimulationActive()`.
 *
 * SIMULATION GATING (Document 5 §6): the scene keeps RENDERING in every
 * state, so a paused game shows the frozen last frame behind the menu, but
 * gameplay updatables only tick while PLAYING. Engine.js checks this flag,
 * which is the resolution of the deferred integration note left in Document 1.
 */
import eventBus from '../core/EventBus';

export const GameState = {
  BOOT: 'BOOT',
  MAIN_MENU: 'MAIN_MENU',
  LOADOUT: 'LOADOUT',
  SETTINGS: 'SETTINGS',
  LOADING: 'LOADING',
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

  /**
   * The one question Engine asks before running gameplay updatables.
   * Rendering is deliberately NOT gated on this.
   */
  isSimulationActive(): boolean {
    return this.state === GameState.PLAYING;
  }

  is(state: GameStateValue): boolean {
    return this.state === state;
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
