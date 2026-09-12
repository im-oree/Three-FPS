/**
 * Renderer.ts — owns and configures the one and only THREE.WebGLRenderer.
 * No other file in the codebase may call `new THREE.WebGLRenderer()`.
 */
import * as THREE from 'three';
import { RENDER } from '../utils/Constants';
import type { SceneManager } from './SceneManager';

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sceneManager: SceneManager;
  private readonly onWindowResize: () => void;

  constructor(canvas: HTMLCanvasElement, sceneManager: SceneManager) {
    this.sceneManager = sceneManager;

    // NOTE: `antialias: true` is the Document 1 placeholder default. Document 6
    // may switch to composer-based AA (FXAA/SMAA) and disable this flag.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.MAX_PIXEL_RATIO));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.TONE_MAPPING_EXPOSURE;

    this.onWindowResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.sceneManager.setCameraAspect(window.innerWidth / window.innerHeight);
    };
    window.addEventListener('resize', this.onWindowResize);
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
