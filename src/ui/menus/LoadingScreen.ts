/**
 * LoadingScreen.ts — the deploy screen.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * 1. HONEST PROGRESS. The bar used to be driven only by AssetLoader's file
 *    counter, so it raced to 100% during the audio preload and then froze for
 *    the entire level build -- the part that actually takes the time. It now
 *    reads LoadProgress, which weights every real phase (audio, skins, map
 *    geometry, collision, props, lighting) and reports the stage by name.
 *
 * 2. NO START BUTTON. Deploying is not a two-step action: when the level is
 *    ready the match begins. The old "Click to Play" gate existed because
 *    pointer lock and AudioContext resume need a user gesture -- but the
 *    player ALREADY made one by choosing a map, and that gesture is still
 *    warm here. We enter directly and let the pointer-lock request ride it.
 *    If the browser refuses (the gesture went stale on a very slow load), a
 *    click-anywhere prompt appears as a fallback rather than as the norm.
 *
 * 3. THE MAP, BEHIND IT. The generated aerial preview fills the background
 *    with a slow Ken Burns drift. The animation is a single continuous
 *    sine-driven transform, not a keyframe loop, so it can never snap: at
 *    every instant the position is a function of time, and there is no seam
 *    to land on.
 */
import eventBus from '../../core/EventBus';
import { div, el } from '../dom';
import type { Screen } from '../UIManager';

export class LoadingScreen implements Screen {
  readonly element = div('screen screen--deploy');

  private readonly backdrop = div('deploy__backdrop');
  private readonly fill = div('deploy__fill');
  private readonly pct = div('deploy__pct', '0%');
  private readonly stageLabel = div('deploy__stage', 'Preparing');
  private readonly mapName = el('h1', 'deploy__map');
  private readonly mapDesc = div('deploy__desc');
  private readonly fallback = div('deploy__fallback', 'Click anywhere to deploy');

  private ready = false;
  private entered = false;
  private drift = 0;

  constructor(private readonly onEnter: () => void) {
    this.fallback.style.display = 'none';

    const bar = div('deploy__bar');
    bar.appendChild(this.fill);

    const foot = div('deploy__foot');
    foot.append(this.stageLabel, this.pct);

    const panel = div('deploy__panel');
    panel.append(
      div('deploy__kicker', 'DEPLOYING TO'),
      this.mapName,
      this.mapDesc,
      bar,
      foot,
      this.fallback,
    );

    this.element.append(this.backdrop, div('deploy__scrim'), panel);

    // Real staged progress.
    eventBus.on('load:progress', (payload) => {
      const { fraction, label } = payload as { fraction: number; label: string };
      this.setProgress(fraction);
      if (label) this.stageLabel.textContent = label;
    });

    // The asset loader's own file counter feeds the two preload stages.
    eventBus.on('level:loaded', (payload) => {
      const { displayName } = payload as { displayName?: string };
      if (displayName) this.mapName.textContent = displayName.toUpperCase();
      this.setProgress(1);
      this.stageLabel.textContent = 'Ready';
      this.enterWhenReady();
    });

    // Fallback path only: if the automatic entry was refused, any click works.
    this.element.addEventListener('click', () => {
      if (this.ready && !this.entered) this.enter();
    });
  }

  onShow(): void {
    this.ready = false;
    this.entered = false;
    this.fallback.style.display = 'none';
    this.setProgress(0);
    this.stageLabel.textContent = 'Preparing';
  }

  /** Called by main.ts with the level about to load. */
  setLevel(name: string, description: string, levelId: string): void {
    this.mapName.textContent = name.toUpperCase();
    this.mapDesc.textContent = description;
    // The generated aerial preview. Compulsory for every map: the generator's
    // --verify mode fails when one is missing.
    this.backdrop.style.backgroundImage = `url('assets/previews/${levelId}.jpg')`;
  }

  /** Back-compat for callers that only have a name. */
  setLevelName(name: string): void {
    this.mapName.textContent = name.toUpperCase();
  }

  setProgress(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.fill.style.width = `${(clamped * 100).toFixed(1)}%`;
    this.pct.textContent = `${Math.round(clamped * 100)}%`;
  }

  /**
   * Drive the background drift.
   *
   * Continuous sine functions of elapsed time, deliberately at
   * incommensurable frequencies, so the motion never repeats and there is no
   * loop point to snap at. A CSS keyframe animation would jump when it wraps
   * unless the start and end states match exactly.
   */
  update(dt: number): void {
    this.drift += dt;
    const x = Math.sin(this.drift * 0.13) * 1.6 + Math.sin(this.drift * 0.071) * 0.9;
    const y = Math.cos(this.drift * 0.097) * 1.1 + Math.sin(this.drift * 0.053) * 0.7;
    const zoom = 1.08 + Math.sin(this.drift * 0.061) * 0.025;
    this.backdrop.style.transform =
      `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0) scale(${zoom.toFixed(4)})`;
  }

  private enterWhenReady(): void {
    this.ready = true;
    // One frame of breathing room so the bar paints 100% before the match
    // takes over the screen -- otherwise the last 30% is never seen.
    requestAnimationFrame(() => requestAnimationFrame(() => this.enter()));
  }

  private enter(): void {
    if (this.entered) return;
    this.entered = true;
    try {
      this.onEnter();
    } catch {
      // The gesture went stale (very slow load). Offer the manual path.
      this.entered = false;
      this.fallback.style.display = '';
    }
  }

  /** Test seam. */
  get isReadyToEnter(): boolean { return this.ready; }
  get hasEntered(): boolean { return this.entered; }
}

export default LoadingScreen;
