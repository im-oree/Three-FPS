/**
 * HandSkinRegistry.ts — Document A §3.4: skins are MATERIAL swaps, never new
 * geometry. A new skin is one registry entry; a silhouette variant is a second
 * saved .glb from the same builder with different colors — zero code.
 */
import * as THREE from 'three';

export interface HandSkin {
  readonly id: string;
  readonly skinColor: number;
  readonly sleeveColor: number;
}

export const HAND_SKINS: Record<string, HandSkin> = {
  standard: { id: 'standard', skinColor: 0xd8a878, sleeveColor: 0x33361f },
  gloved: { id: 'gloved', skinColor: 0x2a2a2e, sleeveColor: 0x1c1e14 },
  desert: { id: 'desert', skinColor: 0xc49a6c, sleeveColor: 0x8a7146 },
};

export function applySkin(root: THREE.Object3D, skin: HandSkin): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat?.color) return;
    const isSleeve = /UpperArm|Shoulder/i.test(mesh.name);
    mat.color.setHex(isSleeve ? skin.sleeveColor : skin.skinColor);
  });
}
