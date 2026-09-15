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
  private bgMap: THREE.Texture | null = null;
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
    if (this.appliedPath === hdriPath && this.envMap && this.bgMap) {
      this.scene.background = this.bgMap;
      this.scene.environment = this.envMap;
      return;
    }
    const hdr = await new RGBELoader().loadAsync(hdriPath);
    const env = this.pmrem.fromEquirectangular(hdr).texture;
    this.clearSceneBindings();
    this.envMap?.dispose();
    this.bgMap?.dispose();
    this.envMap = env;
    this.bgMap = hdr;   // kept alive: it IS the visible sky
    this.appliedPath = hdriPath;
    // Background = the RAW equirect texture; environment = the PMREM.
    // Using the PMREM for BOTH smeared the tight sun disc into a giant pale
    // wedge filling a quarter of the sky (PMREM mip blur is a lighting
    // convolution, not a skybox).
    this.scene.background = hdr;
    this.scene.environment = env;
    const legacyScene = this.scene as THREE.Scene & { environmentIntensity?: number };
    if ('environmentIntensity' in legacyScene) legacyScene.environmentIntensity = intensity;
  }

  clear(): void {
    this.clearSceneBindings();
    this.envMap?.dispose();
    this.envMap = null;
    this.bgMap?.dispose();
    this.bgMap = null;
    this.appliedPath = null;
  }

  private clearSceneBindings(): void {
    this.scene.background = null;
    this.scene.environment = null;
  }
}

export default HDRISkyManager;
