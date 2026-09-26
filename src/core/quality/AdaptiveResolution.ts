/**
 * AdaptiveResolution.ts — the closed loop that actually DEFENDS the frame rate.
 *
 * Every other optimisation in this folder reduces work by a fixed amount
 * decided ahead of time. None of them can promise a frame rate, because none
 * of them know what the machine is or what is on screen this second. This one
 * measures the real frame time and changes the only parameter that scales
 * smoothly and continuously — the number of pixels shaded — until the
 * measured time fits the budget.
 *
 * WHY RESOLUTION IS THE RIGHT KNOB
 * On the target hardware (integrated graphics, no dedicated VRAM) the frame
 * is fill-rate bound: cost is roughly linear in pixel count, and pixel count
 * is the one thing that can be changed per-frame with no asset work, no
 * popping, and no gameplay effect. Dropping geometry or shadows mid-match is
 * visible and jarring; dropping 15% of linear resolution mostly is not.
 *
 * CONTROL DESIGN (the parts that stop it oscillating)
 *   - Median, not mean. One 200 ms hitch (shader compile, GC, level stream)
 *     must not trigger a resolution collapse. A median over the window is
 *     immune to a minority of outliers in a way an average is not.
 *   - Asymmetric response. Dropping resolution is urgent (the player is
 *     already dropping frames) so it happens fast and in a big step; raising
 *     it is a luxury, so it happens slowly, in small steps, and only after a
 *     sustained run of comfortable frames.
 *   - Dead band. Between the raise and lower thresholds nothing happens at
 *     all. Without this the controller sits on the boundary and pumps the
 *     resolution up and down forever, which looks far worse than being
 *     slightly too low.
 *   - Cooldown + settling. After any change the window is discarded, because
 *     the frames immediately following a resize are unrepresentative (the
 *     driver reallocates the backing store).
 */
import type * as THREE from 'three';

export interface AdaptiveResolutionOptions {
  /** Frame-time budget in ms. 16.67 = 60 fps. */
  targetFrameMs?: number;
  /** Frames sampled before a decision is considered. */
  windowSize?: number;
  minScale?: number;
  maxScale?: number;
  /** Seconds to wait after a change before judging again. */
  cooldown?: number;
  onChange?: (scale: number, reason: 'raise' | 'lower') => void;
}

export class AdaptiveResolution {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly samples: number[] = [];
  private readonly sorted: number[] = [];
  private targetFrameMs: number;
  private windowSize: number;
  private minScale: number;
  private maxScale: number;
  private cooldown: number;
  private onChange?: (scale: number, reason: 'raise' | 'lower') => void;

  private scale = 1;
  private basePixelRatio = 1;
  private cooldownLeft = 0;
  private enabled = true;
  /** Consecutive windows that were comfortably fast — gates any raise. */
  private goodWindows = 0;
  private lastAppliedCss = { w: 0, h: 0 };

  constructor(renderer: THREE.WebGLRenderer, options: AdaptiveResolutionOptions = {}) {
    this.renderer = renderer;
    this.targetFrameMs = options.targetFrameMs ?? 1000 / 60;
    this.windowSize = options.windowSize ?? 45;
    this.minScale = options.minScale ?? 0.5;
    this.maxScale = options.maxScale ?? 1;
    this.cooldown = options.cooldown ?? 1.1;
    this.onChange = options.onChange;
    this.scale = this.maxScale;
  }

  /** Called by RenderQualityManager whenever the preset changes. */
  configure(opts: {
    minScale: number; maxScale: number; basePixelRatio: number; targetFrameMs?: number;
  }): void {
    this.minScale = opts.minScale;
    this.maxScale = opts.maxScale;
    this.basePixelRatio = opts.basePixelRatio;
    if (opts.targetFrameMs) this.targetFrameMs = opts.targetFrameMs;
    this.scale = Math.min(Math.max(this.scale, this.minScale), this.maxScale);
    this.samples.length = 0;
    this.goodWindows = 0;
    this.apply();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.scale = this.maxScale;
      this.samples.length = 0;
      this.apply();
    }
  }

  get isEnabled(): boolean { return this.enabled; }
  get currentScale(): number { return this.scale; }

  /** Effective device pixel ratio actually handed to the renderer. */
  get effectivePixelRatio(): number { return this.basePixelRatio * this.scale; }

  /**
   * Feed one frame's delta (seconds). Cheap: a push, a shift and — only once
   * per full window — a sort of `windowSize` numbers.
   */
  update(dt: number): void {
    if (!this.enabled) return;
    if (this.cooldownLeft > 0) {
      this.cooldownLeft -= dt;
      return;
    }
    // Ignore absurd deltas outright: tab-restore, breakpoint, alt-tab. They
    // are not rendering cost and must never move the resolution.
    const ms = dt * 1000;
    if (ms > 250) return;
    this.samples.push(ms);
    if (this.samples.length < this.windowSize) return;

    this.sorted.length = 0;
    for (const s of this.samples) this.sorted.push(s);
    this.sorted.sort((a, b) => a - b);
    const median = this.sorted[this.sorted.length >> 1];
    this.samples.length = 0;

    const lowerThreshold = this.targetFrameMs * 1.06;  // >6% over budget: act
    const raiseThreshold = this.targetFrameMs * 0.74;  // >26% headroom: climb

    if (median > lowerThreshold && this.scale > this.minScale) {
      this.goodWindows = 0;
      // Step proportionally to how far over budget we are — a machine at
      // 30 fps should not creep down in 5% steps, it should arrive quickly.
      const overshoot = median / this.targetFrameMs;
      const step = overshoot > 1.6 ? 0.14 : overshoot > 1.25 ? 0.09 : 0.05;
      this.setScale(Math.max(this.minScale, this.scale - step), 'lower');
    } else if (median < raiseThreshold && this.scale < this.maxScale) {
      // Two consecutive comfortable windows before giving pixels back, so a
      // brief lull (staring at a wall) does not immediately undo a drop that
      // the open map will need again a second later.
      this.goodWindows += 1;
      if (this.goodWindows >= 2) {
        this.goodWindows = 0;
        this.setScale(Math.min(this.maxScale, this.scale + 0.04), 'raise');
      }
    } else {
      this.goodWindows = 0;
    }
  }

  private setScale(next: number, reason: 'raise' | 'lower'): void {
    const rounded = Math.round(next * 100) / 100;
    if (Math.abs(rounded - this.scale) < 0.005) return;
    this.scale = rounded;
    this.cooldownLeft = this.cooldown;
    this.apply();
    this.onChange?.(this.scale, reason);
  }

  /** Re-apply on resize (Renderer calls this after setSize). */
  apply(): void {
    const ratio = Math.max(0.1, this.basePixelRatio * this.scale);
    // setPixelRatio alone does NOT resize an already-sized renderer, so the
    // CSS size has to be re-asserted for the backing store to be reallocated.
    this.renderer.setPixelRatio(ratio);
    const size = this.lastAppliedCss.w > 0
      ? this.lastAppliedCss
      : { w: window.innerWidth, h: window.innerHeight };
    this.renderer.setSize(size.w, size.h, false);
  }

  /** Renderer.onWindowResize tells us the new CSS size. */
  noteCssSize(w: number, h: number): void {
    this.lastAppliedCss = { w, h };
  }

  getStats(): { scale: number; pixelRatio: number; enabled: boolean } {
    return {
      scale: this.scale,
      pixelRatio: Math.round(this.effectivePixelRatio * 100) / 100,
      enabled: this.enabled,
    };
  }
}

export default AdaptiveResolution;
