/**
 * WeaponProfile.ts — presentation-profile data contract (FP-Controller &
 * Viewmodel spec §2.3). Purely visual data consumed only by the
 * viewmodel/animation system; gameplay numbers stay on WeaponBase
 * (Document 3 §6.2). Adding a new gun = new WeaponBase entry + new profile
 * entry here + a conforming .glb — never a code change (spec §2.5).
 */
export type GripStyle = 'twoHanded' | 'oneHanded' | 'unarmed';

export interface OffsetTransform {
  readonly position: readonly [number, number, number];
  /** Degrees, applied XYZ after the automatic solve. */
  readonly rotationEuler: readonly [number, number, number];
}

export interface WeaponProfile {
  readonly weaponId: string;
  readonly modelPath: string;
  /** Artistic correction on top of the IK grip solve (spec §2.5). */
  readonly gripFineTuneOffset: OffsetTransform;
  readonly gripSecondaryFineTuneOffset: OffsetTransform;
  /** Hip-fire rest transform relative to the camera, pre-sway/bob. */
  readonly hipRestPosition: readonly [number, number, number];
  readonly hipRestRotationEuler: readonly [number, number, number];
  /** Fine-tune over automatic Socket_Optic alignment (spec §7.2). */
  readonly adsCameraOffset: readonly [number, number, number];
  /** Baked additive finger-curl clip, authored per grip STYLE (spec §6.4). */
  readonly holdPoseClipName: string;
  readonly gripStyle: GripStyle;
  /** Keys into ANIMATION.SWAY_PROFILES / ANIMATION.BREATHING_PROFILES. */
  readonly swayProfile: string;
  readonly breathingProfile: string;
}

const ZERO_OFFSET: OffsetTransform = { position: [0, 0, 0], rotationEuler: [0, 0, 0] };

/** Hip rest mirrors VIEWMODEL.HIP_LOCAL_OFFSET so the pre-spec look holds
 *  until the layer compositor (Phase 3) takes ownership of placement. */
const HIP: readonly [number, number, number] = [0.24, -0.24, -0.5];

export const WEAPON_PROFILES: Readonly<Record<string, WeaponProfile>> = {
  assault_rifle: {
    weaponId: 'assault_rifle',
    modelPath: 'weapons/assault_rifle.glb',
    gripFineTuneOffset: ZERO_OFFSET,
    gripSecondaryFineTuneOffset: ZERO_OFFSET,
    hipRestPosition: HIP,
    hipRestRotationEuler: [0, 0, 0],
    adsCameraOffset: [0, 0, 0],
    holdPoseClipName: 'hold_rifle_twoHanded',
    gripStyle: 'twoHanded',
    swayProfile: 'rifle_default',
    breathingProfile: 'rifle_default',
  },
  smg: {
    weaponId: 'smg',
    modelPath: 'weapons/smg.glb',
    gripFineTuneOffset: ZERO_OFFSET,
    gripSecondaryFineTuneOffset: ZERO_OFFSET,
    hipRestPosition: HIP,
    hipRestRotationEuler: [0, 0, 0],
    adsCameraOffset: [0, 0, 0],
    holdPoseClipName: 'hold_rifle_twoHanded',
    gripStyle: 'twoHanded',
    swayProfile: 'smg_default',
    breathingProfile: 'rifle_default',
  },
  pistol: {
    weaponId: 'pistol',
    modelPath: 'weapons/pistol.glb',
    gripFineTuneOffset: ZERO_OFFSET,
    gripSecondaryFineTuneOffset: ZERO_OFFSET,
    hipRestPosition: HIP,
    hipRestRotationEuler: [0, 0, 0],
    adsCameraOffset: [0, 0, 0],
    holdPoseClipName: 'hold_pistol_oneHanded',
    gripStyle: 'oneHanded',
    swayProfile: 'pistol_default',
    breathingProfile: 'pistol_default',
  },
  fists: {
    weaponId: 'fists',
    modelPath: '',
    gripFineTuneOffset: ZERO_OFFSET,
    gripSecondaryFineTuneOffset: ZERO_OFFSET,
    hipRestPosition: [0, -0.12, -0.34],
    hipRestRotationEuler: [0, 0, 0],
    adsCameraOffset: [0, 0, 0],
    holdPoseClipName: 'hold_fists_guard',
    gripStyle: 'unarmed',
    swayProfile: 'unarmed',
    breathingProfile: 'unarmed',
  },
};

/** Registry lookup; unknown ids fall back to a neutral profile so a
 *  mis-keyed definition can never crash the viewmodel layer. */
export function getWeaponProfile(weaponId: string): WeaponProfile {
  return WEAPON_PROFILES[weaponId] ?? {
    weaponId,
    modelPath: '',
    gripFineTuneOffset: ZERO_OFFSET,
    gripSecondaryFineTuneOffset: ZERO_OFFSET,
    hipRestPosition: HIP,
    hipRestRotationEuler: [0, 0, 0],
    adsCameraOffset: [0, 0, 0],
    holdPoseClipName: 'hold_rifle_twoHanded',
    gripStyle: 'twoHanded',
    swayProfile: 'rifle_default',
    breathingProfile: 'rifle_default',
  };
}
