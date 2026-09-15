/**
 * QualityPresets.ts — the single table of render-quality tiers.
 *
 * TARGET HARDWARE. The stated floor for this project is a 6th-gen Intel i5
 * with NO discrete GPU (HD Graphics 520/530 class). That machine's limits are
 * not the ones a desktop GPU has, and optimising for the wrong one wastes
 * effort, so every number below is chosen against the three things that
 * actually stall integrated graphics:
 *
 *   1. FILL RATE. An HD 530 has ~1/30th the pixel throughput of a modern
 *      discrete card and shares system RAM for framebuffer traffic. Rendering
 *      1920x1080 with a per-pixel PBR shader is simply not affordable, so the
 *      dominant lever is RESOLUTION (renderScale), not geometry.
 *   2. DRAW-CALL / DRIVER OVERHEAD. Each draw call costs CPU in the driver.
 *      Presets cap how much the scene is allowed to split (batching is done
 *      by StaticBatcher; the preset only tunes its cell size).
 *   3. SHADOW TAPS. PCFSoftShadowMap costs many texture fetches per lit
 *      fragment. On the low tiers we drop to a single-tap map or disable
 *      shadows entirely — the single biggest per-pixel saving available.
 *
 * Presets are DATA. RenderQualityManager is the only thing that reads them,
 * so adding a tier is editing this table, never touching renderer code.
 */
import * as THREE from 'three';

export type QualityTierName = 'Potato' | 'Low' | 'Medium' | 'High' | 'Ultra';

export interface QualityPreset {
  readonly name: QualityTierName;
  /**
   * Renderer backing-store scale relative to CSS pixels. 1.0 = native.
   * The adaptive controller moves BETWEEN renderScaleMin and renderScale at
   * runtime; this value is the ceiling it is allowed to climb back to.
   */
  readonly renderScale: number;
  readonly renderScaleMin: number;
  /** devicePixelRatio ceiling; separate from renderScale so a HiDPI laptop
   *  cannot silently quadruple the pixel count before scaling even applies. */
  readonly maxPixelRatio: number;
  /** MSAA via the WebGL context. Free-ish on desktop GPUs, NOT on integrated. */
  readonly antialias: boolean;
  readonly shadows: {
    readonly enabled: boolean;
    readonly mapSize: number;
    readonly type: THREE.ShadowMapType;
    /** Half-extent (metres) of the sun's orthographic shadow box. Smaller =
     *  sharper shadows AND fewer casters rendered, because ShadowDirector
     *  keeps the box centred on the player instead of covering the map. */
    readonly radius: number;
    /** Props beyond this distance stop casting (ShadowDirector). */
    readonly casterDistance: number;
  };
  /** Global multiplier on every catalog cullDistance. <1 culls dressing sooner. */
  readonly cullDistanceScale: number;
  /** Distance at which a batched cell swaps to its simplified geometry. */
  readonly lodDistance: number;
  /** Vertex-clustering aggressiveness for the far LOD (fraction of the
   *  cell's bounding-box diagonal used as the weld grid). 0 disables LOD. */
  readonly lodStrength: number;
  /** Fraction of scattered foliage instances actually placed (1 = all). */
  readonly foliageDensity: number;
  /** Occluder-based CPU culling (OcclusionCuller). */
  readonly occlusionCulling: boolean;
  /** Point lights beyond this distance are switched off. */
  readonly lightCullDistance: number;
  /** Max simultaneously-enabled dynamic point lights. */
  readonly maxDynamicLights: number;
  /** scene.environment (PMREM IBL) — a real per-pixel cost on integrated
   *  parts. Disabled on Potato, where the hemisphere light stands in. */
  readonly imageBasedLighting: boolean;
  /** StaticBatcher spatial cell size (metres). Bigger = fewer draw calls but
   *  coarser culling; small maps want small cells, weak CPUs want big ones. */
  readonly batchCellSize: number;
}

const BASE = {
  cullDistanceScale: 1,
  occlusionCulling: true,
  imageBasedLighting: true,
} as const;

export const QUALITY_PRESETS: Record<QualityTierName, QualityPreset> = {
  /**
   * POTATO — the "it must simply run" tier. Half-resolution, no shadows, no
   * IBL, aggressive foliage thinning. This is the configuration that keeps a
   * GPU-less machine above 60 fps when everything else fails.
   */
  Potato: {
    ...BASE,
    name: 'Potato',
    renderScale: 0.62,
    renderScaleMin: 0.42,
    maxPixelRatio: 1,
    antialias: false,
    shadows: {
      enabled: false, mapSize: 512, type: THREE.BasicShadowMap,
      radius: 18, casterDistance: 22,
    },
    cullDistanceScale: 0.55,
    lodDistance: 26,
    lodStrength: 0.05,
    foliageDensity: 0.4,
    imageBasedLighting: false,
    lightCullDistance: 22,
    maxDynamicLights: 2,
    batchCellSize: 16,
  },

  /** LOW — the default the auto-detector picks for integrated graphics. */
  Low: {
    ...BASE,
    name: 'Low',
    renderScale: 0.78,
    renderScaleMin: 0.5,
    maxPixelRatio: 1,
    antialias: false,
    shadows: {
      // One-tap hard shadows: the silhouette reads, the cost does not.
      enabled: true, mapSize: 1024, type: THREE.BasicShadowMap,
      radius: 26, casterDistance: 34,
    },
    cullDistanceScale: 0.7,
    lodDistance: 38,
    lodStrength: 0.04,
    foliageDensity: 0.6,
    lightCullDistance: 30,
    maxDynamicLights: 3,
    batchCellSize: 16,
  },

  Medium: {
    ...BASE,
    name: 'Medium',
    renderScale: 1,
    renderScaleMin: 0.66,
    maxPixelRatio: 1.25,
    antialias: false,
    shadows: {
      enabled: true, mapSize: 1536, type: THREE.PCFShadowMap,
      radius: 34, casterDistance: 52,
    },
    cullDistanceScale: 0.9,
    lodDistance: 58,
    lodStrength: 0.03,
    foliageDensity: 0.85,
    lightCullDistance: 45,
    maxDynamicLights: 5,
    batchCellSize: 16,
  },

  High: {
    ...BASE,
    name: 'High',
    renderScale: 1,
    renderScaleMin: 0.8,
    maxPixelRatio: 1.5,
    antialias: true,
    shadows: {
      enabled: true, mapSize: 2048, type: THREE.PCFSoftShadowMap,
      radius: 44, casterDistance: 75,
    },
    lodDistance: 85,
    lodStrength: 0.02,
    foliageDensity: 1,
    lightCullDistance: 65,
    maxDynamicLights: 8,
    batchCellSize: 16,
  },

  Ultra: {
    ...BASE,
    name: 'Ultra',
    renderScale: 1,
    renderScaleMin: 1,
    maxPixelRatio: 2,
    antialias: true,
    shadows: {
      enabled: true, mapSize: 4096, type: THREE.PCFSoftShadowMap,
      radius: 60, casterDistance: 120,
    },
    lodDistance: 140,
    lodStrength: 0,
    foliageDensity: 1,
    lightCullDistance: 90,
    maxDynamicLights: 12,
    batchCellSize: 16,
  },
};

export const QUALITY_TIER_ORDER: readonly QualityTierName[] = [
  'Potato', 'Low', 'Medium', 'High', 'Ultra',
];

export function isQualityTier(value: unknown): value is QualityTierName {
  return typeof value === 'string' && value in QUALITY_PRESETS;
}

/**
 * Guess a starting tier from what the GL driver reports about itself.
 *
 * This is a HINT, not a verdict: the adaptive resolution controller measures
 * real frame times and corrects within a couple of seconds either way. The
 * point of guessing at all is that the first few seconds of the first match
 * should not be a slideshow on the machines this project targets.
 */
export function detectQualityTier(renderer: THREE.WebGLRenderer): QualityTierName {
  let rendererName = '';
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    rendererName = String(
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    ).toLowerCase();
  } catch {
    rendererName = '';
  }

  // Software rasterisers (SwiftShader/llvmpipe — also what the headless
  // verification harness runs on) cannot do better than the floor tier.
  if (/swiftshader|llvmpipe|software|basic render/.test(rendererName)) return 'Potato';

  // Intel integrated: the explicit target floor. HD/UHD 5xx-6xx era parts are
  // the 6th-gen-i5 machines this work is for; Iris/Xe are materially faster.
  if (/intel/.test(rendererName)) {
    if (/iris|xe|arc/.test(rendererName)) return 'Medium';
    return 'Low';
  }
  // Other shared-memory integrated parts.
  if (/vega \d|radeon\(tm\) graphics|apple m\d/.test(rendererName)) return 'Medium';
  // Discrete cards.
  if (/nvidia|geforce|rtx|gtx|radeon rx|quadro/.test(rendererName)) return 'High';

  // Unknown hardware: start conservative and let the adaptive controller
  // climb. Starting high and falling is a visible stutter; starting low and
  // rising is not.
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? 'Medium' : 'Low';
}

export default QUALITY_PRESETS;
