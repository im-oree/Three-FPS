/**
 * UIManager.ts — Document 5 §5/§6.
 *
 * The ONLY module allowed to show or hide a top-level screen. Menus never
 * reach into each other's DOM; they emit `ui:navigate` and this router does
 * the swap, driven by a single state -> screen lookup table.
 *
 * That rule is what stops menu navigation degenerating into every screen
 * independently toggling every other screen's visibility.
 */
import eventBus from '../core/EventBus';
import gameStateManager, { GameState, type GameStateValue } from '../state/GameStateManager';

export interface Screen {
  readonly element: HTMLElement;
  /** Called whenever this screen becomes visible. */
  onShow?(): void;
  /** Called whenever it is hidden. */
  onHide?(): void;
}

export class UIManager {
  private readonly root: HTMLElement;
  private readonly screens = new Map<string, Screen>();
  /** state -> screen name. */
  private readonly routes = new Map<GameStateValue, string>();
  /** Persistent elements that belong to a match, hidden outside one. */
  private readonly matchHud: HTMLElement[] = [];
  /** Screens that render ON TOP of the routed screen (pause > settings). */
  private readonly overlays: string[] = [];
  private activeName: string | null = null;

  constructor(rootId = 'ui-root') {
    const root = document.getElementById(rootId);
    if (!root) throw new Error(`[UIManager] #${rootId} not found`);
    this.root = root;
  }

  register(name: string, screen: Screen, forState?: GameStateValue): void {
    this.screens.set(name, screen);
    screen.element.classList.add('screen');
    screen.element.dataset.screen = name;
    this.root.appendChild(screen.element);
    if (forState) this.routes.set(forState, name);
  }

  /** A persistent element that is not part of state routing (e.g. the HUD). */
  registerPersistent(element: HTMLElement): void {
    this.root.appendChild(element);
  }

  /**
   * A persistent element that belongs to the MATCH, not to the shell.
   *
   * The HUD, killfeed, match clock and scoreboard are "persistent" in the
   * sense that they are not a screen and must survive a pause -- but they are
   * not part of the main menu or the loading screen, and leaving them mounted
   * there showed a live scoreboard and killfeed over the lobby. Registering
   * them here keeps them in the DOM (so they never rebuild) while hiding them
   * whenever the game is not actually in a match.
   */
  registerMatchHud(element: HTMLElement): void {
    this.root.appendChild(element);
    this.matchHud.push(element);
    this.applyMatchHudVisibility(gameStateManager.getState());
  }

  /** States during which the in-match HUD is allowed on screen. */
  private applyMatchHudVisibility(state: GameStateValue): void {
    // PAUSED counts: the pause menu sits OVER the match, and COD keeps the
    // HUD visible behind it. Everything else (menus, loading, debrief) is
    // outside the match.
    const inMatch = state === GameState.PLAYING || state === GameState.PAUSED;
    for (const element of this.matchHud) {
      element.classList.toggle('hud--offmatch', !inMatch);
    }
  }

  start(): void {
    eventBus.on('game:stateChanged', (payload) => {
      this.applyState((payload as { current: GameStateValue }).current);
    });
    eventBus.on('ui:navigate', (payload) => {
      const to = (payload as { to: GameStateValue }).to;
      gameStateManager.setState(to);
    });
    // Overlay requests are separate from state changes: opening Settings from
    // the pause menu must not leave the PAUSED state, or the simulation would
    // resume underneath it.
    eventBus.on('ui:overlay', (payload) => {
      const { name, open } = payload as { name: string; open: boolean };
      if (open) this.pushOverlay(name);
      else this.popOverlay(name);
    });
    this.applyState(gameStateManager.getState());
  }

  private applyState(state: GameStateValue): void {
    // Any state change dismisses overlays; they belong to the state that
    // opened them.
    for (const name of [...this.overlays]) this.popOverlay(name);
    this.applyMatchHudVisibility(state);

    const next = this.routes.get(state) ?? null;
    if (next === this.activeName) return;
    if (this.activeName) {
      const previous = this.screens.get(this.activeName);
      previous?.element.classList.remove('screen--active');
      previous?.onHide?.();
    }
    this.activeName = next;
    if (next) {
      const screen = this.screens.get(next);
      screen?.element.classList.add('screen--active');
      screen?.onShow?.();
    }
  }

  private pushOverlay(name: string): void {
    if (this.overlays.includes(name)) return;
    const screen = this.screens.get(name);
    if (!screen) return;
    this.overlays.push(name);
    screen.element.classList.add('screen--active');
    // Above the routed screen, and above earlier overlays.
    screen.element.style.zIndex = String(30 + this.overlays.length);
    screen.onShow?.();
  }

  private popOverlay(name: string): void {
    const index = this.overlays.indexOf(name);
    if (index < 0) return;
    this.overlays.splice(index, 1);
    const screen = this.screens.get(name);
    if (!screen) return;
    screen.element.classList.remove('screen--active');
    screen.element.style.zIndex = '';
    screen.onHide?.();
  }

  /** Test seam: which screen is routed, and which overlays are stacked. */
  get activeScreen(): string | null { return this.activeName; }
  get openOverlays(): readonly string[] { return this.overlays; }

  get isMenuVisible(): boolean {
    return this.activeName !== null && gameStateManager.getState() !== GameState.PLAYING;
  }
}

export default UIManager;
