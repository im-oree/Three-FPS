/**
 * AssetLoader.ts — the ONLY place in the codebase permitted to instantiate
 * GLTFLoader / TextureLoader / AudioLoader / DRACOLoader / KTX2Loader.
 *
 * Caching policy: parsed results are cached by logical path. loadModel()
 * returns an independent `.clone()` of the cached scene graph (so multiple
 * instances of the same weapon/prop never share transforms) while geometry,
 * material and texture data stay shared inside the clone for memory
 * efficiency. Textures and audio buffers are returned as the shared cached
 * object (they are immutable in practice).
 *
 * Logical paths are relative to their asset root, e.g.
 *   loadModel('weapons/assault_rifle.glb')  -> /assets/models/weapons/assault_rifle.glb
 *   loadTexture('concrete_basecolor.png')   -> /assets/textures/concrete_basecolor.png
 *   loadAudio('weapons/ar_fire.wav')        -> /assets/audio/weapons/ar_fire.wav
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import eventBus from './EventBus';
import { ASSET_ROOTS, DECODER_PATHS } from '../utils/Constants';

export interface PreloadManifest {
  models?: string[];
  textures?: string[];
  audio?: string[];
}

export class AssetLoader {
  private readonly gltfLoader: GLTFLoader;
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly audioLoader = new THREE.AudioLoader();
  private readonly modelCache = new Map<string, THREE.Group>();
  private readonly gltfCache = new Map<string, { scene: THREE.Group; animations: THREE.AnimationClip[] }>();
  private readonly textureCache = new Map<string, THREE.Texture>();
  private readonly audioCache = new Map<string, AudioBuffer>();

  constructor(renderer: THREE.WebGLRenderer) {
    const dracoLoader = new DRACOLoader().setDecoderPath(DECODER_PATHS.draco);
    const ktx2Loader = new KTX2Loader().setTranscoderPath(DECODER_PATHS.basis).detectSupport(renderer);
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(dracoLoader);
    this.gltfLoader.setKTX2Loader(ktx2Loader);
  }

  /** Absolute logical paths ('/x.glb') bypass the models root (repo-root imports). */
  private modelUrl(path: string): string {
    return path.startsWith('/') ? path : ASSET_ROOTS.models + path;
  }

  async loadModel(path: string): Promise<THREE.Group> {
    const cached = this.modelCache.get(path);
    if (cached) return cached.clone(true);
    try {
      const gltf = await this.gltfLoader.loadAsync(this.modelUrl(path));
      this.modelCache.set(path, gltf.scene);
      return gltf.scene.clone(true);
    } catch (err) {
      console.error(`[AssetLoader] failed to load model "${this.modelUrl(path)}":`, err);
      throw err;
    }
  }

  /**
   * Document 3: loadModel() variant that also returns the embedded animation
   * clips (loadModel() intentionally drops them — world props never needed
   * them). Clips are shared immutable data; the scene is cloned per caller so
   * each equipped viewmodel gets its own node hierarchy for mixer binding.
   */
  /**
   * THREE.Object3D.clone() does NOT remap SkinnedMesh skeletons (long-standing
   * three.js gotcha): a cloned skinned mesh keeps pointing its skeleton at the
   * SOURCE hierarchy's bones, so the clone's vertices animate with an orphaned
   * original tree while its own nodes/mixer do nothing. Remap every skeleton's
   * bones onto the cloned hierarchy by node name (boneInverses are rest-pose
   * data and stay valid).
   */
  private static rebindSkeletons(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.bones = mesh.skeleton.bones.map(
        (bone) => (root.getObjectByName(bone.name) as THREE.Bone | undefined) ?? bone,
      );
    });
  }

  private readonly jsonCache = new Map<string, unknown>();

  /** Baked joint-keyframe clips (Document A §7.2): plain JSON under /assets. */
  async loadJSON(path: string): Promise<unknown> {
    const cached = this.jsonCache.get(path);
    if (cached) return cached;
    const res = await fetch(this.modelUrl(path));
    if (!res.ok) throw new Error(`[AssetLoader] JSON ${path}: HTTP ${res.status}`);
    const data = await res.json();
    this.jsonCache.set(path, data);
    return data;
  }

  async loadModelWithAnimations(path: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
    const cached = this.gltfCache.get(path);
    if (cached) {
      const scene = cached.scene.clone(true);
      AssetLoader.rebindSkeletons(scene);
      return { scene, animations: cached.animations };
    }
    try {
      const gltf = await this.gltfLoader.loadAsync(this.modelUrl(path));
      this.gltfCache.set(path, { scene: gltf.scene, animations: gltf.animations });
      const scene = gltf.scene.clone(true);
      AssetLoader.rebindSkeletons(scene);
      return { scene, animations: gltf.animations };
    } catch (err) {
      console.error(`[AssetLoader] failed to load model "${this.modelUrl(path)}":`, err);
      throw err;
    }
  }

  async loadTexture(path: string): Promise<THREE.Texture> {
    const cached = this.textureCache.get(path);
    if (cached) return cached;
    try {
      const texture = await this.textureLoader.loadAsync(ASSET_ROOTS.textures + path);
      this.textureCache.set(path, texture);
      return texture;
    } catch (err) {
      console.error(`[AssetLoader] failed to load texture "${ASSET_ROOTS.textures + path}":`, err);
      throw err;
    }
  }

  async loadAudio(path: string): Promise<AudioBuffer> {
    const cached = this.audioCache.get(path);
    if (cached) return cached;
    try {
      const buffer = await this.audioLoader.loadAsync(ASSET_ROOTS.audio + path);
      this.audioCache.set(path, buffer);
      return buffer;
    } catch (err) {
      console.error(`[AssetLoader] failed to load audio "${ASSET_ROOTS.audio + path}":`, err);
      throw err;
    }
  }

  /**
   * Load every asset in `manifest` in parallel, emitting 'assets:progress'
   * with { loaded, total } after each individual asset completes — the exact
   * mechanism Document 5's loading screen binds to.
   */
  async preload(manifest: PreloadManifest): Promise<void> {
    const tasks: Array<Promise<unknown>> = [
      ...(manifest.models ?? []).map((p) => this.loadModel(p)),
      ...(manifest.textures ?? []).map((p) => this.loadTexture(p)),
      ...(manifest.audio ?? []).map((p) => this.loadAudio(p)),
    ];
    const total = tasks.length;
    let loaded = 0;
    await Promise.all(
      tasks.map((task) =>
        task
          .catch((err) => console.error('[AssetLoader] preload item failed:', err))
          .finally(() => {
            loaded += 1;
            eventBus.emit('assets:progress', { loaded, total });
          }),
      ),
    );
  }
}

export default AssetLoader;
