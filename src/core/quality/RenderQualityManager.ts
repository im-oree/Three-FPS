/**
 * RenderQualityManager.ts — one owner for every render-cost decision.
 *
 * Before this existed, quality-relevant settings were scattered: the renderer
 * hardcoded antialias and PCFSoftShadowMap, LevelLoader hardcoded a 2048
 * shadow map sized to the whole map, the catalog's cull distances were
 * absolute, and the settings menu's "Quality Preset" dropdown was stored and
 * then ignored. Nothing could answer "what is this machine actually doing?".
 *
 * This class is that answer. It owns:
 *   - the active QualityPreset (auto-detected, user-overridable, persisted),
 *   - the AdaptiveResolution loop that defends the frame budget,
 *   - the ShadowDirector (player-centred shadow box + caster distance),
 *   - the OcclusionCuller,
 *   - the renderer flags that can only be set centrally.
 *
 * Everything else reads the preset through here rather than deciding for
 * itself, so there is exactly one place to look when the game is too slow and
 * exactly one place to change when a new tier is needed.
 */
import * as THREE from 'three';
import eventBus from '../EventBus';
import settingsStore from '../SettingsStore';
import AdaptiveResolution from './AdaptiveResolution';
import OcclusionCuller from './OcclusionCuller';
import ShadowDirector from './ShadowDirector';
import {
  QUALITY_PRESETS, detectQualityTier, isQualityTier,
  type QualityPreset, type QualityTierName,
} from './QualityPresets';

const SETTING_KEY = 'video.quality';
const ADAPTIVE_KEY = 'video.adaptiveResolution';
/** Chosen for the user's stated goal: a stable 60 fps. */
const TARGET_FPS = 60;

export class RenderQualityManager {
  readonly shadows = new ShadowDirector();
  readonly occlusion = new OcclusionCuller();
  readonly adaptive: AdaptiveResolution;

  private readonly renderer: THREE.WebGLRenderer;
  private preset: QualityPreset;
  private tier: QualityTierName;
  /** True when the tier came from hardware detection, not the user. */
  private autoDetected: boolean;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    const stored = settingsStore.get<string>(SETTING_KEY, '');
    if (isQualityTier(stored)) {
      this.tier = stored;
      this.autoDetected = false;
    } else {
      this.tier = detectQualityTier(renderer);
      this.autoDetected = true;
      // Persist the detection so the next launch is stable and the settings
      // menu has something concrete to display.
      settingsStore.set(SETTING_KEY, this.tier);
    }
    this.preset = QUALITY_PRESETS[this.tier];

    this.adaptive = new AdaptiveResolution(renderer, {
      targetFrameMs: 1000 / TARGET_FPS,
      onChange: (scale, reason) => {
        eventBus.emit('quality:resolutionChanged', { scale, reason });
      },
    });
    this.adaptive.setEnabled(settingsStore.get<boolean>(ADAPTIVE_KEY, true));
    this.applyPreset();
    this.bindSettings();

    console.log(
      `[Quality] tier '${this.tier}'${this.autoDetected ? ' (auto-detected)' : ' (user setting)'}`
      + `, renderScale ${this.preset.renderScale}, shadows `
      + `${this.preset.shadows.enabled ? `${this.preset.shadows.mapSize}px @ ${this.preset.shadows.radius}m` : 'off'}`
      + `, adaptive ${this.adaptive.isEnabled ? 'on' : 'off'}.`,
    );
  }

  get current(): QualityPreset { return this.preset; }
  get currentTier(): QualityTierName { return this.tier; }
  get wasAutoDetected(): boolean { return this.autoDetected; }

  /** Switch tiers at runtime (settings menu). Persisted. */
  setTier(tier: QualityTierName): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.autoDetected = false;
    this.preset = QUALITY_PRESETS[tier];
    settingsStore.set(SETTING_KEY, tier);
    this.applyPreset();
    eventBus.emit('quality:tierChanged', { tier });
    console.log(`[Quality] tier -> '${tier}'.`);
  }

  /**
   * Listen for the settings menu writing 'video.quality'. The menu is built
   * long before (and independently of) the renderer, so an event is a much
   * cleaner seam than threading this manager down through the UI tree.
   */
  private bindSettings(): void {
    eventBus.on('settings:changed', (e: { key: string; value: unknown }) => {
      if (e.key === SETTING_KEY && isQualityTier(e.value)) this.setTier(e.value);
      else if (e.key === ADAPTIVE_KEY) this.setAdaptiveEnabled(e.value !== false);
    });
  }

  setAdaptiveEnabled(enabled: boolean): void {
    settingsStore.set(ADAPTIVE_KEY, enabled);
    this.adaptive.setEnabled(enabled);
    if (enabled) this.adaptive.configure(this.adaptiveConfig());
  }

  private adaptiveConfig(): {
    minScale: number; maxScale: number; basePixelRatio: number;
  } {
    return {
      minScale: this.preset.renderScaleMin,
      maxScale: this.preset.renderScale,
      basePixelRatio: Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio),
    };
  }

  /** Push the whole preset into the renderer and the subsystems. */
  private applyPreset(): void {
    const p = this.preset;

    this.renderer.shadowMap.enabled = p.shadows.enabled;
    this.renderer.shadowMap.type = p.shadows.type;
    // A shadow-type change invalidates every compiled program that samples
    // the map; three only notices if we say so.
    this.renderer.shadowMap.needsUpdate = true;

    this.shadows.configure({
      enabled: p.shadows.enabled,
      mapSize: p.shadows.mapSize,
      shadowType: p.shadows.type,
      radius: p.shadows.radius,
      casterDistance: p.shadows.casterDistance,
    });
    this.occlusion.setEnabled(p.occlusionCulling);
    this.adaptive.configure(this.adaptiveConfig());
  }

  /** Scale a catalog cull distance by the active preset. */
  cullDistance(base: number | undefined): number | undefined {
    if (!base) return base;
    return base * this.preset.cullDistanceScale;
  }

  /**
   * Per-frame tick. Called by Engine BEFORE the culling union update so the
   * shadow box and occluder set are already correct for this frame.
   */
  update(dt: number, playerPosition: THREE.Vector3 | null): void {
    this.adaptive.update(dt);
    if (playerPosition) this.shadows.update(dt, playerPosition);
  }

  /** Level swap: drop per-level registrations. */
  onLevelUnloaded(): void {
    this.shadows.reset();
    this.occlusion.clear();
  }

  getStats(): Record<string, unknown> {
    return {
      tier: this.tier,
      autoDetected: this.autoDetected,
      resolution: this.adaptive.getStats(),
      shadows: this.shadows.getStats(),
      occlusion: this.occlusion.getStats(),
    };
  }
}

export default RenderQualityManager;
