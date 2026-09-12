/**
 * WeaponSockets.ts — the weapon socket/bone contract (FP-Controller &
 * Viewmodel spec §2.2). The whole grip/IK/muzzle/reload/ADS system drives
 * off these names; a weapon missing a mandatory socket is an invalid asset
 * (the /tools export step asserts this — runtime validation here warns so
 * bad assets are loud in console and in the acceptance harness).
 */
import type * as THREE from 'three';

export const REQUIRED_WEAPON_SOCKETS = [
  'Socket_Grip',
  'Socket_GripSecondary',
  'Socket_Muzzle',
  'Socket_Magazine',
  'Socket_Optic',
] as const;

/** Optional mechanical bones / polish sockets; absent = feature skipped. */
export const OPTIONAL_WEAPON_NODES = [
  'Socket_Ejection',
  'Bone_Bolt',
  'Bone_Magazine',
  'Bone_ChargingHandle',
] as const;

export interface WeaponAssetReport {
  readonly valid: boolean;
  readonly missingSockets: string[];
  readonly presentOptional: string[];
}

export function validateWeaponAsset(root: THREE.Object3D): WeaponAssetReport {
  const names = new Set<string>();
  root.traverse((o) => names.add(o.name));
  const missingSockets = REQUIRED_WEAPON_SOCKETS.filter((s) => !names.has(s));
  const presentOptional = OPTIONAL_WEAPON_NODES.filter((s) => names.has(s));
  return { valid: missingSockets.length === 0, missingSockets, presentOptional };
}
