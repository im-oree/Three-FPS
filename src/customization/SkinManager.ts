/**
 * SkinManager.ts — Document 5 §7.3.
 *
 * Swaps a real texture onto a weapon's material slots. The textures are
 * committed PNG files produced by tools/generateSkinTextures.js, per the
 * standing asset policy — this module only loads and assigns them, it never
 * computes a colour.
 */
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';

export interface SkinDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly texturePath: string;
  /** Swatch colour for the UI chip (cosmetic only). */
  readonly swatch: string;
  readonly roughness: number;
  readonly metalness: number;
}

export const SKINS: readonly SkinDefinition[] = [
  {
    id: 'standard',
    displayName: 'Standard',
    texturePath: 'weapons/skins/weapon_skin_standard.png',
    swatch: '#2e3136',
    roughness: 0.62,
    metalness: 0.55,
  },
  {
    id: 'desert',
    displayName: 'Desert',
    texturePath: 'weapons/skins/weapon_skin_desert.png',
    swatch: '#96805c',
    roughness: 0.85,
    metalness: 0.12,
  },
  {
    id: 'urban',
    displayName: 'Urban',
    texturePath: 'weapons/skins/weapon_skin_urban.png',
    swatch: '#4e525a',
    roughness: 0.74,
    metalness: 0.3,
  },
];

export function getSkin(id: string): SkinDefinition {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export class SkinManager {
  private readonly textures = new Map<string, THREE.Texture>();

  constructor(private readonly assetLoader: AssetLoader) {}

  async preload(): Promise<void> {
    await Promise.all(SKINS.map(async (skin) => {
      if (this.textures.has(skin.id)) return;
      try {
        const texture = await this.assetLoader.loadTexture(skin.texturePath);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textures.set(skin.id, texture);
      } catch {
        console.warn(`[SkinManager] missing skin texture: ${skin.texturePath}`);
      }
    }));
  }

  get loadedCount(): number {
    return this.textures.size;
  }

  /**
   * Apply a skin to every mesh under `root`.
   *
   * Materials are CLONED on first application: weapon models come from the
   * AssetLoader cache with shared materials, so assigning a map in place
   * would repaint every other instance of that weapon too — including the
   * third-person prop while the viewmodel is being previewed.
   */
  apply(root: THREE.Object3D, skinId: string): void {
    const skin = getSkin(skinId);
    const texture = this.textures.get(skin.id) ?? null;
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material;
      const materials = Array.isArray(source) ? source : [source];
      const next = materials.map((material) => {
        const std = material as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) return material;
        const clone = std.userData.skinClone === true ? std : std.clone();
        clone.userData.skinClone = true;
        clone.map = texture;
        clone.roughness = skin.roughness;
        clone.metalness = skin.metalness;
        // A base-colour map multiplies the material colour, so leave it white
        // or the skin reads as a muddy tint of the original part colour.
        if (texture) clone.color.setHex(0xffffff);
        clone.needsUpdate = true;
        return clone;
      });
      mesh.material = Array.isArray(source) ? next : next[0];
    });
  }
}

export default SkinManager;
