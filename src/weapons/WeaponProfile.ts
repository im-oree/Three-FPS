/**
 * WeaponProfile.ts — the presentation-data contract (Document A §4/§9).
 *
 * Purely visual: consumed ONLY by the viewmodel/animation stack. Gameplay
 * numbers stay in /definitions. Adding a weapon = one definitions file +
 * one profile entry here — zero code changes (Document A §13).
 */
import { VIEWMODEL } from '../utils/Constants';

/** Percentage-of-duration mechanical beat tables (Document A §8.7). */
export interface ReloadEvent {
  /** 0.0–1.0 fraction of the clip duration at which the beat fires (once). */
  atProgress: number;
  /** 'magazine_detach' | 'magazine_attach' | 'chamber_round' | 'pump_cycle'. */
  event: string;
}

export interface GripFineTuneOffset {
  readonly position: readonly [number, number, number];
  readonly rotationEuler: readonly [number, number, number];
}

export type GripStyle = 'twoHanded' | 'oneHanded' | 'fistsOnly';

/** The WeaponProfile schema. */
export interface WeaponProfile {
  readonly weaponId: string;
  readonly modelPath: string;
  /** Fine-tune applied AFTER automatic grip-socket alignment. */
  readonly gripFineTuneOffset: GripFineTuneOffset;
  readonly gripSecondaryFineTuneOffset: GripFineTuneOffset;
  /** Camera-local hip-fire rest BEFORE any sway/bob/pose offsets. */
  readonly hipRestPosition: readonly [number, number, number];
  readonly hipRestRotationEuler: readonly [number, number, number];
  /** Fine-tune ONLY — primary ADS alignment is automatic via Socket_Optic. */
  readonly adsCameraOffset: readonly [number, number, number];
  /** Document C §8.1 optic taxonomy. 'ironSights' = bare notch/post (no
   *  glass); the reflex/holo/prism/scope render paths land with per-weapon
   *  content (next document) — the data model is fixed NOW so profiles and
   *  the alignment solve never change again. */
  readonly opticType: 'ironSights' | 'reflexDot' | 'holo' | 'prism' | 'variableScope';
  /** §8.2: eye relief — camera-to-(Socket_Optic) distance at FULL ADS, metres
   *  along the optic's local −Z. Irons ~5-8 cm, prism 6-9, scope 9-15. */
  readonly eyeRelief: number;
  /** §8.3: sight magnification (1 = irons/RDS/holo). Drives the ADS FOV:
   *  adsFOV = baseFOV / max(magnification, 1/ADS_ONE_X_FEEL). */
  readonly magnification: number;
  /** §6.5/§8.5: scoped weapons get breath sway + Shift breath-hold. */
  readonly hasScopeShake: boolean;
  readonly gripStyle: GripStyle;
  /** Keys into the SWAY feel tables (data authors only). */
  readonly swayProfile: string;
  readonly breathingProfile: string;
  readonly reloadTacticalEvents?: readonly ReloadEvent[];
  readonly reloadEmptyEvents?: readonly ReloadEvent[];
}

const NO_FINETUNE: GripFineTuneOffset = { position: [0, 0, 0], rotationEuler: [0, 0, 0] };

const RIFLE_RELOAD_TACTICAL_EVENTS: readonly ReloadEvent[] = [
  { atProgress: 0.35, event: 'magazine_detach' },
  { atProgress: 0.55, event: 'magazine_attach' },
];
const RIFLE_RELOAD_EMPTY_EVENTS: readonly ReloadEvent[] = [
  { atProgress: 0.35, event: 'magazine_detach' },
  { atProgress: 0.55, event: 'magazine_attach' },
  { atProgress: 0.85, event: 'chamber_round' },
];
const PISTOL_RELOAD_TACTICAL_EVENTS: readonly ReloadEvent[] = [
  { atProgress: 0.35, event: 'magazine_detach' },
  { atProgress: 0.55, event: 'magazine_attach' },
];
const PISTOL_RELOAD_EMPTY_EVENTS: readonly ReloadEvent[] = [
  { atProgress: 0.35, event: 'magazine_detach' },
  { atProgress: 0.55, event: 'magazine_attach' },
  { atProgress: 0.85, event: 'chamber_round' },
];
/** Shotgun: shells in, then chamber + pump (Document A §8.7). */
const SHOTGUN_RELOAD_TACTICAL_EVENTS: readonly ReloadEvent[] = [
  { atProgress: 0.5, event: 'magazine_attach' },
  { atProgress: 0.82, event: 'chamber_round' },
  { atProgress: 0.86, event: 'pump_cycle' },
];
const SHOTGUN_RELOAD_EMPTY_EVENTS: readonly ReloadEvent[] = [
  { atProgress: 0.3, event: 'magazine_detach' },
  { atProgress: 0.5, event: 'magazine_attach' },
  { atProgress: 0.82, event: 'chamber_round' },
  { atProgress: 0.86, event: 'pump_cycle' },
];

/**
 * The per-weapon profile registry. Adding a weapon = adding one entry here.
 * Baked reload-clip durations MUST equal the definitions' reload durations
 * (data-integrity requirement — see tools-checked JSONs in /assets/animations).
 */
export const WEAPON_PROFILES: Record<string, WeaponProfile> = {
  rifle: {
    weaponId: 'rifle',
    modelPath: 'weapons/rifle.glb',
    gripFineTuneOffset: NO_FINETUNE,
    gripSecondaryFineTuneOffset: NO_FINETUNE,
    hipRestPosition: [0.17, -0.16, -0.44],
    hipRestRotationEuler: [0, 0, 0],
    adsCameraOffset: [0, 0.1, -0.111],
    opticType: 'ironSights',
    // Achieved in-front relief with ADS_ANCHOR_MIN_FRONT guard. The §8.2
    // 5-8 cm band needs upper-body IK (rig limit) — revisit per-weapon doc.
    eyeRelief: 0.1,
    magnification: 1,
    hasScopeShake: false,
    gripStyle: 'twoHanded',
    swayProfile: 'rifle_default',
    breathingProfile: 'rifle_default',
    reloadTacticalEvents: RIFLE_RELOAD_TACTICAL_EVENTS,
    reloadEmptyEvents: RIFLE_RELOAD_EMPTY_EVENTS,
  },

  shotgun: {
    weaponId: 'shotgun',
    modelPath: 'weapons/shotgun.glb',
    gripFineTuneOffset: NO_FINETUNE,
    gripSecondaryFineTuneOffset: NO_FINETUNE,
    hipRestPosition: [0.16, -0.16, -0.42],
    hipRestRotationEuler: [0, 0, 0],
    adsCameraOffset: [0, 0.1, -0.111],
    opticType: 'ironSights',
    eyeRelief: 0.06,
    magnification: 1,
    hasScopeShake: false,
    gripStyle: 'twoHanded',
    swayProfile: 'rifle_default',
    breathingProfile: 'rifle_default',
    reloadTacticalEvents: SHOTGUN_RELOAD_TACTICAL_EVENTS,
    reloadEmptyEvents: SHOTGUN_RELOAD_EMPTY_EVENTS,
  },

  pistol: {
    weaponId: 'pistol',
    modelPath: 'weapons/pistol.glb',
    gripFineTuneOffset: NO_FINETUNE,
    gripSecondaryFineTuneOffset: NO_FINETUNE,
    hipRestPosition: [0.13, -0.15, -0.36],
    hipRestRotationEuler: [0, 0, 0],
    adsCameraOffset: [0, 0.1, -0.111],
    opticType: 'ironSights',
    eyeRelief: 0.055,
    magnification: 1,
    hasScopeShake: false,
    gripStyle: 'oneHanded',
    swayProfile: 'pistol_default',
    breathingProfile: 'rifle_default',
    reloadTacticalEvents: PISTOL_RELOAD_TACTICAL_EVENTS,
    reloadEmptyEvents: PISTOL_RELOAD_EMPTY_EVENTS,
  },
};

/**
 * Fists/melee slot (Document B §1): no weapon file, no sockets — the rigid
 * arm rig IS the viewmodel and JointIK is never invoked.
 */
export const FISTS_PROFILE: WeaponProfile = {
  weaponId: 'fists',
  modelPath: '',
  gripFineTuneOffset: NO_FINETUNE,
  gripSecondaryFineTuneOffset: NO_FINETUNE,
  hipRestPosition: [VIEWMODEL.FISTS_ANCHOR.x, VIEWMODEL.FISTS_ANCHOR.y, VIEWMODEL.FISTS_ANCHOR.z],
  hipRestRotationEuler: [0, 0, 0],
  adsCameraOffset: [0, 0, 0], // fists: no optic solve
  opticType: 'ironSights',
  eyeRelief: 0.06,
  magnification: 1,
  hasScopeShake: false,
  gripStyle: 'fistsOnly',
  swayProfile: 'fists_default',
  breathingProfile: 'rifle_default',
};

/** Socket name resolution (canonical names; rename overrides hook in here). */
export function socketName(_profile: WeaponProfile, canonical: string): string {
  return canonical;
}

export function getProfile(weaponId: string): WeaponProfile {
  if (weaponId === 'fists') return FISTS_PROFILE;
  const profile = WEAPON_PROFILES[weaponId];
  if (!profile) throw new Error(`[WeaponProfile] no profile for "${weaponId}"`);
  return profile;
}
