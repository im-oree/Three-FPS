/**
 * HDRISkyManager.ts — Document K §5.3: applies a real generated equirect
 * .hdr as both visible background and `scene.environment` IBL source. One
 * PMREM pass per level load; the previous environment is released on swap
   * (LevelLoader calls clear() during unload so a Warehouse reload never
   * sees Shipment's baked light).
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export class HDRISkyManager {
  private readonly pmrem: THREE.PMREMGenerator;
  private envMap: THREE.Texture | null = null;
  private appliedPath: string | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /** Apply the HDRI as background + environment; cached per path. */
  async apply(hdriPath: string, intensity = 1.0): Promise<void> {
    if (this.appliedPath === hdriPath && this.envMap) {
      this.scene.background = this.envMap;
      this.scene.environment = this.envMap;
      return;
    }
    const hdr = await new RGBELoader().loadAsync(hdriPath);
    const env = this.pmrem.fromEquirectangular(hdr).texture;
    this.clearSceneBindings();
    this.envMap?.dispose();
    this.envMap = env;
    this.appliedPath = hdriPath;
    this.scene.background = env;
    this.scene.environment = env;
    const legacyScene = this.scene as THREE.Scene & { environmentIntensity?: number };
    if ('environmentIntensity' in legacyScene) legacyScene.environmentIntensity = intensity;
    hdr.dispose();
  }

  clear(): void {
    this.clearSceneBindings();
    this.envMap?.dispose();
    this.envMap = null;
    this.appliedPath = null;
  }

  private clearSceneBindings(): void {
    this.scene.background = null;
    this.scene.environment = null;
  }
}

export default HDRISkyManager;
