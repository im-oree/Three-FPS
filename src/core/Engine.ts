/**
 * Engine.ts — the central orchestrator, instantiated exactly once (main.ts).
 *
 * Owns the render loop and the subsystem singletons; knows nothing about
 * gameplay. Per-frame systems from future documents (PlayerController,
 * WeaponManager, ...) plug in exclusively through registerUpdatable(), so
 * this file never imports them.
 */
import type { WebGLRenderer } from 'three';
import AssetLoader from './AssetLoader';
import Clock from './Clock';
import InputManager from './InputManager';
import Renderer from './Renderer';
import SceneManager from './SceneManager';
import Debug from '../utils/Debug';

/** Anything the Engine should tick once per frame, in registration order. */
export interface Updatable {
  update(dt: number): void;
}

export class Engine {
  readonly clock: Clock;
  readonly sceneManager: SceneManager;
  readonly renderer: Renderer;
  readonly inputManager: InputManager;
  readonly assetLoader: AssetLoader;
  readonly debug: Debug;

  private readonly updatables: Updatable[] = [];
  private postRenderHook: ((renderer: WebGLRenderer) => void) | null = null;
  private rafHandle: number | null = null;
  private running = false;

  // Arrow-function field keeps `this` bound for requestAnimationFrame.
  private readonly loop = (): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    const dt = this.clock.getDelta();

    // FORWARD-LOOKING SEAM (Document 5): this step will be gated so updates
    // halt while a menu/pause screen is open. Document 1 intentionally has no
    // pause/resume gating.
    for (const updatable of this.updatables) updatable.update(dt);

    // Document 2.5 §3.2 (implemented exactly): ONE camera, TWO passes.
    // Pass 1 (world): camera masked to layer 0.
    const camera = this.sceneManager.getCamera();
    const prevMask = camera.layers.mask;
    camera.layers.set(0);
    this.renderer.getRenderer().render(this.sceneManager.getScene(), camera);
    camera.layers.mask = prevMask;

    // Pass 2 (viewmodel): the hook clearDepth()s, flips the SAME camera to
    // layer 1, renders the SAME scene, and restores the mask — the held
    // weapon always draws in front, FOV perfectly shared, no second camera.
    if (this.postRenderHook) this.postRenderHook(this.renderer.getRenderer());

    // Complete the input tap-latch: releases observed this frame stop being
    // reported by isActionDown() from the next frame on.
    this.inputManager.endFrame();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.clock = new Clock();
    this.sceneManager = new SceneManager(this.clock);
    this.renderer = new Renderer(canvas, this.sceneManager);
    this.inputManager = new InputManager();
    this.assetLoader = new AssetLoader(this.renderer.getRenderer());
    this.debug = new Debug(this.inputManager, this.renderer.getRenderer());

    this.registerUpdatable(this.debug);
  }

  /** Begin the requestAnimationFrame loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.rafHandle = requestAnimationFrame(this.loop);
  }

  /** Cancel the loop (cleanup / tests). */
  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  /** THE extension seam: add a per-frame system exposing update(dt). */
  /** Document 3: second render pass seam (WeaponViewmodel.renderPass). */
  setPostRenderHook(hook: ((renderer: WebGLRenderer) => void) | null): void {
    this.postRenderHook = hook;
  }

  registerUpdatable(obj: Updatable): void {
    if (!this.updatables.includes(obj)) this.updatables.push(obj);
  }

  unregisterUpdatable(obj: Updatable): void {
    const index = this.updatables.indexOf(obj);
    if (index !== -1) this.updatables.splice(index, 1);
  }
}

export default Engine;
