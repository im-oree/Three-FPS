/**
 * Renderer.ts — owns and configures the one and only THREE.WebGLRenderer.
 * No other file in the codebase may call `new THREE.WebGLRenderer()`.
 *
 * Quality-relevant flags (antialias, shadow map type/size, pixel ratio) are
 * NOT decided here any more: RenderQualityManager owns them, because several
 * of them have to change together and some have to change at runtime. The one
 * exception is `antialias`, which is a CONTEXT-CREATION flag in WebGL and can
 * never be changed afterwards — so it is read from the quality preset once,
 * here, before the context exists.
 */
import * as THREE from 'three';
import { RENDER } from '../utils/Constants';
import type { SceneManager } from './SceneManager';
import settingsStore from './SettingsStore';
import { QUALITY_PRESETS, isQualityTier } from './quality/QualityPresets';
import type RenderQualityManager from './quality/RenderQualityManager';

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sceneManager: SceneManager;
  private readonly onWindowResize: () => void;
  private quality: RenderQualityManager | null = null;

  constructor(canvas: HTMLCanvasElement, sceneManager: SceneManager) {
    this.sceneManager = sceneManager;

    // MSAA is baked into the WebGL context and cannot be toggled later, so
    // the stored tier has to be consulted before creation. On the integrated
    // GPUs this project targets, 4x MSAA on a full-resolution buffer is one
    // of the most expensive things available — every low tier turns it off.
    const storedTier = settingsStore.get<string>('video.quality', '');
    const antialias = isQualityTier(storedTier)
      ? QUALITY_PRESETS[storedTier].antialias
      : false;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias,
      // The depth buffer is needed; a stencil buffer is not, and asking for
      // one costs bandwidth on tiled/integrated parts for nothing.
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.MAX_PIXEL_RATIO));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.TONE_MAPPING_EXPOSURE;
    // Nothing in this project reads back the drawing buffer after a frame
    // (captures render explicitly into their own targets), so letting the
    // driver discard it avoids a full-framebuffer copy every frame.
    this.renderer.autoClear = true;

    this.onWindowResize = () => {
      this.quality?.adaptive.noteCssSize(window.innerWidth, window.innerHeight);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      // Re-assert the adaptive pixel ratio: setSize on its own would reset
      // the backing store to the full CSS size at the current ratio.
      this.quality?.adaptive.apply();
      this.sceneManager.setCameraAspect(window.innerWidth / window.innerHeight);
    };
    window.addEventListener('resize', this.onWindowResize);
  }

  /** Engine hands the quality manager over once it has been constructed. */
  attachQuality(quality: RenderQualityManager): void {
    this.quality = quality;
    quality.adaptive.noteCssSize(window.innerWidth, window.innerHeight);
    quality.adaptive.apply();
  }

  /** The raw renderer — Engine calls `.render(scene, camera)` on it. */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
  }
}

export default Renderer;
