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
import gameStateManager from '../state/GameStateManager';
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
  /** Updatables that tick even while paused/in menus (UI, audio). */
  private readonly alwaysUpdatables: Updatable[] = [];
  private postRenderHook: ((renderer: WebGLRenderer) => void) | null = null;
  /** FPS/TPS Spec §1: supplies the world pass's layer mask (perspective). */
  private worldPassMaskProvider: (() => number) | null = null;
  private rafHandle: number | null = null;
  private running = false;

  // Arrow-function field keeps `this` bound for requestAnimationFrame.
  private readonly loop = (): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    const dt = this.clock.getDelta();

    // SIMULATION GATING (Document 5 §6 — this resolves Document 1's deferred
    // seam). Gameplay updatables only tick while PLAYING; in any menu or
    // while paused the world holds exactly where it was. RENDERING below is
    // deliberately NOT gated, so a pause screen shows the frozen last frame
    // rather than a black void, and resuming continues from the same instant.
    if (gameStateManager.isSimulationActive()) {
      for (const updatable of this.updatables) updatable.update(dt);
    }
    // ALWAYS-updatables run in EVERY state, including PLAYING. They are not
    // the "else" of the gate: the HUD, for instance, must tick during play to
    // drive the crosshair, and must ALSO tick while paused so a hit marker
    // cannot freeze mid-flash on the frozen frame behind the menu.
    for (const updatable of this.alwaysUpdatables) updatable.update(dt);

    // Global culling: every camera that will draw this frame is now in its
    // final pose, so the union-visibility pass runs exactly once here, ahead
    // of both render passes (world AND viewmodel) and of capture renders
    // (they push their camera and call flushNow() themselves).
    this.sceneManager.update(dt);

    // Document 2.5 §3.2 (implemented exactly): ONE camera, TWO passes.
    // Pass 1 (world): camera masked to layer 0 — PLUS the third-person body
    // layer whenever the FPS/TPS perspective controller says the body should
    // be visible (worldPassMaskProvider). One camera still, one world pass:
    // the perspective toggle is pure mask arithmetic.
    const camera = this.sceneManager.getCamera();
    const prevMask = camera.layers.mask;
    if (this.worldPassMaskProvider) camera.layers.mask = this.worldPassMaskProvider();
    else camera.layers.set(0);
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

  /** FPS/TPS Spec §1: PerspectiveController drives the world-pass mask. */
  setWorldPassMaskProvider(provider: (() => number) | null): void {
    this.worldPassMaskProvider = provider;
  }

  registerUpdatable(obj: Updatable): void {
    if (!this.updatables.includes(obj)) this.updatables.push(obj);
  }

  /**
   * Register something that must keep ticking while the simulation is gated
   * (menus, HUD animation). Use sparingly: anything gameplay-affecting
   * belongs in registerUpdatable so pause actually pauses it.
   */
  registerAlwaysUpdatable(obj: Updatable): void {
    if (!this.alwaysUpdatables.includes(obj)) this.alwaysUpdatables.push(obj);
  }

  unregisterUpdatable(obj: Updatable): void {
    const index = this.updatables.indexOf(obj);
    if (index !== -1) this.updatables.splice(index, 1);
  }
}

export default Engine;
