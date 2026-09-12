/**
 * CanonicalRig.ts — the arm/hand bone-name contract (FP-Controller &
 * Viewmodel spec §2.1) plus the data-only adaptation layer that lets legacy
 * imported rigs conform WITHOUT code changes: a per-model rename table
 * (regex -> canonical name) applied once at load. New models authored to the
 * canonical names need no table at all.
 *
 * Canonical chain (both sides, _R/_L):
 *   Root_Arms -> Shoulder_* -> UpperArm_* -> Forearm_* -> Hand_*
 *     -> {Thumb,Index,Middle,Ring,Pinky}_*_01..03
 *
 * validateArmRig() checks the canonical chain exists in ancestor order;
 * intermediate helper bones (deltoids, twist bones) are tolerated and
 * reported as `extra` so asset reviews can see them, but every canonical
 * name must be present for clips/IK to retarget by name (spec §1).
 */
import type * as THREE from 'three';

export const CANONICAL_ARM_BONES: readonly string[] = [
  'Root_Arms',
  'Shoulder_R', 'UpperArm_R', 'Forearm_R', 'Hand_R',
  'Thumb_R_01', 'Thumb_R_02', 'Thumb_R_03',
  'Index_R_01', 'Index_R_02', 'Index_R_03',
  'Middle_R_01', 'Middle_R_02', 'Middle_R_03',
  'Ring_R_01', 'Ring_R_02', 'Ring_R_03',
  'Pinky_R_01', 'Pinky_R_02', 'Pinky_R_03',
  'Shoulder_L', 'UpperArm_L', 'Forearm_L', 'Hand_L',
  'Thumb_L_01', 'Thumb_L_02', 'Thumb_L_03',
  'Index_L_01', 'Index_L_02', 'Index_L_03',
  'Middle_L_01', 'Middle_L_02', 'Middle_L_03',
  'Ring_L_01', 'Ring_L_02', 'Ring_L_03',
  'Pinky_L_01', 'Pinky_L_02', 'Pinky_L_03',
];

/** Parent chain each canonical bone must sit under (ancestor order). */
const CHAIN_PARENT: Readonly<Record<string, string>> = {
  UpperArm_R: 'Shoulder_R', Forearm_R: 'UpperArm_R', Hand_R: 'Forearm_R',
  UpperArm_L: 'Shoulder_L', Forearm_L: 'UpperArm_L', Hand_L: 'Forearm_L',
  Shoulder_R: 'Root_Arms', Shoulder_L: 'Root_Arms',
};

export interface ArmRenameRule {
  /** Regex source tested against authored bone names. */
  readonly match: string;
  readonly to: string;
}

/** Legacy imported rig (first_person_hands_rigged.glb) -> canonical names.
 *  Data only: a differently-named legacy model gets a new table entry. */
export const ARM_RENAME_MAPS: Readonly<Record<string, readonly ArmRenameRule[]>> = {
  first_person_hands_rigged: [
    { match: '^_rootJoint$', to: 'Root_Arms' },
    { match: '^clavicleR_', to: 'Shoulder_R' }, { match: '^clavicleL_', to: 'Shoulder_L' },
    { match: '^upper_armR_', to: 'UpperArm_R' }, { match: '^upper_armL_', to: 'UpperArm_L' },
    { match: '^forearmR_\\d', to: 'Forearm_R' }, { match: '^forearmL_\\d', to: 'Forearm_L' },
    { match: '^handR_', to: 'Hand_R' }, { match: '^handL_', to: 'Hand_L' },
    { match: '^thumb01R_', to: 'Thumb_R_01' }, { match: '^thumb02R_', to: 'Thumb_R_02' }, { match: '^thumb03R_', to: 'Thumb_R_03' },
    { match: '^thumb01L_', to: 'Thumb_L_01' }, { match: '^thumb02L_', to: 'Thumb_L_02' }, { match: '^thumb03L_', to: 'Thumb_L_03' },
    { match: '^f_index01R_', to: 'Index_R_01' }, { match: '^f_index02R_', to: 'Index_R_02' }, { match: '^f_index03R_', to: 'Index_R_03' },
    { match: '^f_index01L_', to: 'Index_L_01' }, { match: '^f_index02L_', to: 'Index_L_02' }, { match: '^f_index03L_', to: 'Index_L_03' },
    { match: '^f_middle01R_', to: 'Middle_R_01' }, { match: '^f_middle02R_', to: 'Middle_R_02' }, { match: '^f_middle03R_', to: 'Middle_R_03' },
    { match: '^f_middle01L_', to: 'Middle_L_01' }, { match: '^f_middle02L_', to: 'Middle_L_02' }, { match: '^f_middle03L_', to: 'Middle_L_03' },
    { match: '^f_ring01R_', to: 'Ring_R_01' }, { match: '^f_ring02R_', to: 'Ring_R_02' }, { match: '^f_ring03R_', to: 'Ring_R_03' },
    { match: '^f_ring01L_', to: 'Ring_L_01' }, { match: '^f_ring02L_', to: 'Ring_L_02' }, { match: '^f_ring03L_', to: 'Ring_L_03' },
    { match: '^f_pinky01R_', to: 'Pinky_R_01' }, { match: '^f_pinky02R_', to: 'Pinky_R_02' }, { match: '^f_pinky03R_', to: 'Pinky_R_03' },
    { match: '^f_pinky01L_', to: 'Pinky_L_01' }, { match: '^f_pinky02L_', to: 'Pinky_L_02' }, { match: '^f_pinky03L_', to: 'Pinky_L_03' },
  ],
};

/** Apply a rename table once at load; returns the rename count. */
export function applyArmRenameMap(root: THREE.Object3D, mapKey: string): number {
  const rules = ARM_RENAME_MAPS[mapKey];
  if (!rules) return 0;
  const compiled = rules.map((r) => ({ re: new RegExp(r.match), to: r.to }));
  let renamed = 0;
  root.traverse((o) => {
    for (const rule of compiled) {
      if (rule.re.test(o.name)) {
        o.name = rule.to;
        renamed += 1;
        break;
      }
    }
  });
  return renamed;
}

export interface ArmRigReport {
  readonly ok: boolean;
  readonly missing: string[];
  /** Canonical-chain violations (bone present but parented wrong). */
  readonly misparented: string[];
  /** Non-canonical bones kept as helpers (twist/deltoid/palm bones). */
  readonly extra: string[];
}

/** Contract check (spec §2.1): canonical names present + chained. Extras
 *  tolerated (legacy twist/palm helpers) but surfaced for asset review. */
export function validateArmRig(root: THREE.Object3D): ArmRigReport {
  const byName = new Map<string, THREE.Object3D>();
  const extras: string[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone && !byName.has(o.name)) byName.set(o.name, o);
  });
  const missing: string[] = [];
  const misparented: string[] = [];
  const canonical = new Set(CANONICAL_ARM_BONES);
  for (const name of CANONICAL_ARM_BONES) {
    const bone = byName.get(name);
    if (!bone) { missing.push(name); continue; }
    const wantParent = CHAIN_PARENT[name];
    if (!wantParent) continue;
    let anc = bone.parent;
    let found = false;
    while (anc) {
      if (anc.name === wantParent) { found = true; break; }
      anc = anc.parent;
    }
    if (!found) misparented.push(`${name}!under:${wantParent}`);
  }
  for (const name of byName.keys()) {
    if (!canonical.has(name)) extras.push(name);
  }
  return { ok: missing.length === 0 && misparented.length === 0, missing, misparented, extra: extras };
}
