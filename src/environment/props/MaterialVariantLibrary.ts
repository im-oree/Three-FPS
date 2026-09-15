/**
 * MaterialVariantLibrary.ts — Document K §4.4: container color variants
 * WITHOUT duplicate models. One GLB per prop family carries a node named
 * 'Paint' whose material gets retinted per catalog variant at map-build time.
 */
import * as THREE from 'three';

const PAINT_COLORS: Record<string, number> = {
  red: 0xb3352c,
  blue: 0x2c5ea3,
  green: 0x3a6647,
  teal: 0x2c8f96,
  rust: 0x6b4a35,
  hazard_red: 0x9e2f24,
};

export const MaterialVariantLibrary = {
  colorFor(variantName: string | undefined): number {
    return PAINT_COLORS[variantName ?? ''] ?? PAINT_COLORS.red;
  },

  /**
   * Retint a model IN PLACE (for cloned/individual props): the material of
   * every 'Paint'-named node is replaced by a variant-tinted clone.
   */
  retintInPlace(root: THREE.Object3D, variantName: string | undefined): void {
    const paint = new THREE.MeshStandardMaterial({
      color: this.colorFor(variantName),
      roughness: 0.72, metalness: 0.35, flatShading: true,
    });
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.name.startsWith('Paint')) {
        (node as THREE.Mesh).material = paint;
      }
    });
  },

  /**
   * Variant material for the PAINT group of a merged instanced batch
   * (PropPool path — the source GLB itself is never mutated).
   */
  resolveMaterial(variantName: string | undefined): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: this.colorFor(variantName),
      roughness: 0.72, metalness: 0.35, flatShading: true,
    });
  },
};

export default MaterialVariantLibrary;
