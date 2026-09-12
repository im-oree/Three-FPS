/**
 * Debug.ts — fixed-position DOM overlay (top-left, monospace) inside #ui-root.
 * Hidden by default; edge-triggered toggle via the 'debugToggle' action (F3):
 * a fresh press toggles, holding does not flicker.
 *
 * Shows a rolling-average FPS (last DEBUG.FPS_SAMPLE_FRAMES frames), frame time
 * in ms, and live draw-call count from renderer.info.render.calls. All overlay
 * behaviour lives in this file — Engine merely ticks it as an Updatable.
 */
import { DEBUG } from './Constants';
import type InputManager from '../core/InputManager';
import type { WebGLRenderer } from 'three';

export class Debug {
  private readonly element: HTMLDivElement;
  private readonly input: InputManager;
  private readonly renderer: WebGLRenderer;
  private readonly frameTimes: number[] = [];
  private previousToggleDown = false;
  private visible = false;

  constructor(input: InputManager, renderer: WebGLRenderer) {
    this.input = input;
    this.renderer = renderer;
    this.element = document.createElement('div');
    this.element.id = 'debug-overlay';
    const uiRoot = document.getElementById('ui-root');
    (uiRoot ?? document.body).appendChild(this.element);
  }

  /** Per-frame tick (Engine registers this as an Updatable). */
  update(dt: number): void {
    this.updateToggle();
    if (!this.visible) return;

    this.frameTimes.push(dt);
    if (this.frameTimes.length > DEBUG.FPS_SAMPLE_FRAMES) this.frameTimes.shift();
    const avgDt = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;

    this.element.textContent =
      `FPS   ${avgDt > 0 ? (1 / avgDt).toFixed(1) : '--'}\n` +
      `FRAME ${(dt * 1000).toFixed(2)} ms\n` +
      `CALLS ${this.renderer.info.render.calls}`;
  }

  /** Edge-triggered visibility toggle on the debugToggle action. */
  private updateToggle(): void {
    const down = this.input.isActionDown('debugToggle');
    if (down && !this.previousToggleDown) {
      this.visible = !this.visible;
      this.element.classList.toggle('visible', this.visible);
    }
    this.previousToggleDown = down;
  }

  dispose(): void {
    this.element.remove();
  }
}

export default Debug;
