/**
 * main.ts — OPERATOR entry point. Pure wiring, no implementation.
 *
 * Order is exactly as specified by Document 1, Section 5.4.
 */
import './style.css';
import Engine from './core/Engine';
import gameStateManager, { GameState } from './state/GameStateManager';
import eventBus from './core/EventBus';

// TEMPORARY — Document 1 acceptance proof (DELETE in Document 2): subscribe
// before boot events fire so the reserved-event log lines are observable.
eventBus.on('game:stateChanged', (p) => console.log('[TEMP-PROOF] game:stateChanged', p));
eventBus.on('assets:progress', (p) => console.log('[TEMP-PROOF] assets:progress', p));

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('[main] #game-canvas element missing from index.html');

const engine = new Engine(canvas);
engine.start();

// Document 1 boots straight into PLAYING (no menus exist yet).
// Document 5 changes this initial state to MAIN_MENU.
gameStateManager.setState(GameState.PLAYING);

// ---------------------------------------------------------------------------
// TEMPORARY — Document 1 acceptance proofs. DELETE in Document 2.
// 1) InputManager proof: log once when the 'jump' action is first held.
// 2) Test hook so the headless harness can reach subsystems.
// ---------------------------------------------------------------------------
let jumpProofLogged = false;
engine.registerUpdatable({
  update: () => {
    if (!jumpProofLogged && engine.inputManager.isActionDown('jump')) {
      jumpProofLogged = true;
      console.log('[TEMP-PROOF] InputManager.isActionDown("jump") === true');
    }
  },
});

interface OperatorTestHook {
  engine: Engine;
  gameStateManager: typeof gameStateManager;
  eventBus: typeof eventBus;
}
(window as unknown as { __OPERATOR__: OperatorTestHook }).__OPERATOR__ = {
  engine,
  gameStateManager,
  eventBus,
};
// ---------------------------------------------------------------------------
// End TEMPORARY block.
// ---------------------------------------------------------------------------
