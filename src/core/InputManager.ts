/**
 * InputManager.ts — raw input capture translated into named, rebindable
 * "actions". Contains zero gameplay logic.
 *
 * Contract for all future gameplay code (Document 2+): query input exclusively
 * through isActionDown(actionName) — never by raw key code. That is what makes
 * Document 5's rebinding UI work without touching a single gameplay file.
 */
import eventBus from './EventBus';
import settingsStore from './SettingsStore';
import { DEFAULT_KEY_BINDINGS, type KeyBindingMap } from '../utils/Constants';

export class InputManager {
  private readonly heldKeys = new Set<string>();
  private readonly heldMouseButtons = new Set<number>();
  // Keys/buttons released since the last endFrame(): their release is applied
  // at frame end so a tap shorter than one frame (keydown+keyup between two
  // update() polls) is still observable via isActionDown() for exactly one
  // frame. Without this latch, edge-triggered consumers (Debug overlay toggle)
  // would miss fast taps. Held-state semantics are unaffected (<=1 frame lag).
  private readonly pendingKeyReleases = new Set<string>();
  private readonly pendingMouseReleases = new Set<number>();
  private mouseDelta = { x: 0, y: 0 };
  private bindings: KeyBindingMap;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.pendingKeyReleases.delete(e.code);
    this.heldKeys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.pendingKeyReleases.add(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    // Accumulate movement deltas only while pointer lock is active.
    if (document.pointerLockElement) {
      this.mouseDelta.x += e.movementX;
      this.mouseDelta.y += e.movementY;
    }
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    this.pendingMouseReleases.delete(e.button);
    this.heldMouseButtons.add(e.button);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.pendingMouseReleases.add(e.button);
  };

  private readonly onPointerLockChange = (): void => {
    if (document.pointerLockElement) eventBus.emit('input:pointerlock:acquired');
    else eventBus.emit('input:pointerlock:lost');
  };

  constructor() {
    this.bindings = { ...settingsStore.get<KeyBindingMap>('keyBindings', { ...DEFAULT_KEY_BINDINGS }) };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  /** Is the bound key/mouse button for `actionName` currently held? */
  isActionDown(actionName: string): boolean {
    const bound = this.bindings[actionName];
    if (bound === undefined) return false;
    if (bound.startsWith('Mouse')) return this.heldMouseButtons.has(Number(bound.slice('Mouse'.length)));
    return this.heldKeys.has(bound);
  }

  /** Returns mouse movement accumulated since the last call, then resets it. */
  getMouseDelta(): { x: number; y: number } {
    const delta = this.mouseDelta;
    this.mouseDelta = { x: 0, y: 0 };
    return delta;
  }

  /**
   * Apply deferred key/button releases. Engine calls this once per frame after
   * every updatable has polled input, completing the tap-latch described above.
   */
  endFrame(): void {
    for (const code of this.pendingKeyReleases) this.heldKeys.delete(code);
    this.pendingKeyReleases.clear();
    for (const button of this.pendingMouseReleases) this.heldMouseButtons.delete(button);
    this.pendingMouseReleases.clear();
  }

  /** Rebind an action in memory and persist through SettingsStore. */
  rebind(actionName: string, newKeyOrButtonCode: string): void {
    this.bindings[actionName] = newKeyOrButtonCode;
    settingsStore.set('keyBindings', { ...this.bindings });
  }

  /** Current binding map (read-only snapshot; use rebind() to change). */
  getBindings(): Readonly<KeyBindingMap> {
    return { ...this.bindings };
  }

  requestPointerLock(element: HTMLElement): void {
    const result = element.requestPointerLock() as unknown as Promise<void> | undefined;
    result?.catch?.((err: unknown) => {
      console.warn('[InputManager] pointer lock request rejected:', err);
    });
  }

  exitPointerLock(): void {
    document.exitPointerLock();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }
}

export default InputManager;
