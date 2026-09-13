/**
 * Constants.ts — the single home for every tunable design/engineering value.
 *
 * RULE (enforced from Document 1 onward): no gameplay or engine file may
 * hardcode a "magic number" that represents a tunable design value. Add it
 * here, import it from here. Documents 2-6 will each extend this file.
 */

/** Rendering / WebGLRenderer configuration. */
export const RENDER = {
  /** ACES filmic exposure applied by the renderer. */
  TONE_MAPPING_EXPOSURE: 1.0,
  /** devicePixelRatio cap — protects fill-rate on high-DPI displays. */
  MAX_PIXEL_RATIO: 2,
} as const;

/** Camera configuration. */
export const CAMERA = {
  /** Horizontal-ish vertical FOV in degrees; realistic FPS default. */
  DEFAULT_FOV: 90,
  NEAR: 0.1,
  FAR: 1000,
  /** Document 1 verification camera pose (replaced by PlayerCamera in Doc 2). */
  VERIFY_POSITION: { x: 0, y: 3, z: 8 },
} as const;

/** Timing / simulation. */
export const CLOCK = {
  /** Clamp for getDelta(): prevents huge sim jumps after tab throttling. */
  MAX_DELTA: 0.1,
  /** Default fixed timestep for deterministic physics (Document 2). */
  FIXED_DT: 1 / 60,
} as const;

/** Debug overlay (utils/Debug.ts). */
export const DEBUG = {
  /** Frames averaged for the on-screen FPS readout. */
  FPS_SAMPLE_FRAMES: 60,
} as const;

/** Settings persistence (core/SettingsStore.ts). */
export const SETTINGS = {
  /** Versioned localStorage key: bumping the suffix discards old shapes. */
  STORAGE_KEY: 'operator-fps-settings-v1',
} as const;

/** Asset URL roots (core/AssetLoader.ts resolves logical paths against these). */
export const ASSET_ROOTS = {
  models: '/assets/models/',
  animations: '/assets/animations/',
  /** Community/imported 3D models committed at repo root (hands, real guns). */
  imported: '/',
  textures: '/assets/textures/',
  audio: '/assets/audio/',
} as const;

/** Compressed-asset decoder payload locations (served from /public). */
export const DECODER_PATHS = {
  draco: '/draco/',
  basis: '/basis/',
} as const;

/** Default rebindable key bindings. Values are KeyboardEvent.code / Mouse<n>. */
export const DEFAULT_KEY_BINDINGS = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  // Document 2.5 §4.3: dedicated tactical-sprint bind (default UNBOUND —
  // double-tapping `sprint` is the default trigger; this stays rebindable).
  tacSprint: '',
  crouch: 'KeyC', // user directive: C, not Ctrl (slide inherits crouch)
  reload: 'KeyR',
  fire: 'Mouse0',
  ads: 'Mouse2',
  weaponSlot1: 'Digit1',
  weaponSlot2: 'Digit2',
  // Document 2.5 §5: future-reserved melee bind (edge-triggered pattern only).
  melee: 'KeyV',
  // Document 2.5 §8: cosmetic inspect one-shot, idle-only.
  inspect: 'KeyF',
  debugToggle: 'F3',
  debugGizmos: 'F4', // Document C §3.6 socket/joint orientation axes
  pause: 'Escape',
} as const;

/** Shape of the rebindable binding map (action name -> code). */
export type KeyBindingMap = Record<string, string>;


/** Mouse-look configuration. Values live in SettingsStore once edited (Doc 5 UI). */
export const MOUSE = {
  DEFAULT_SENSITIVITY: 0.0021,
  DEFAULT_INVERT_Y: false,
  /** Pitch clamp in degrees — prevents gimbal flip past straight up/down. */
  MAX_PITCH_DEG: 89,
} as const;

/** SettingsStore keys read by the camera (Document 5 will write them). */
export const SETTINGS_KEYS = {
  MOUSE_SENSITIVITY: 'mouseSensitivity',
  INVERT_Y: 'invertY',
  CROUCH_TOGGLE: 'crouchToggle',
  /** Document 2.5 §5: ADS hold (default) vs toggle — WeaponManager reads this. */
  ADS_TOGGLE: 'adsToggle',
} as const;

/** Horizontal movement model (units = metres, seconds). */
export const MOVEMENT = {
  WALK_SPEED: 5.4,
  SPRINT_SPEED_MULTIPLIER: 1.5,
  /** Document 2.5 §4.3: tac sprint is strictly faster than regular sprint. */
  TAC_SPRINT_SPEED_MULTIPLIER: 1.8,
  CROUCH_SPEED_MULTIPLIER: 0.42,
  GROUND_ACCELERATION: 46,
  AIR_ACCELERATION: 11,
  GROUND_FRICTION: 12,
} as const;

/** Sprint eligibility (Document 2, Section 6.3). */
export const SPRINT = {
  MAX_INPUT_ANGLE_DEG: 45,
} as const;

/** Tactical Sprint (Document 2.5, Section 4.3). Orthogonal flag alongside SPRINT. */
export const TAC_SPRINT = {
  /** Second sprint press-edge within this window of the first promotes to tac sprint. */
  DOUBLE_TAP_WINDOW_SECONDS: 0.3,
  /** Steeper stamina drain than regular sprint (STAMINA.DRAIN_PER_SECOND). */
  STAMINA_DRAIN_PER_SECOND: 0.55,
  /** Exit: forward-input component below this ends tac sprint (§4.3). */
  MIN_FORWARD_INPUT: 0.85,
  /** Exit: collision-stopped — horizontal speed stalled below this fraction of
   *  the tac-sprint target for WALL_STALL_SECONDS ends tac sprint (§4.3). */
  WALL_STALL_SPEED_FRACTION: 0.4,
  WALL_STALL_SECONDS: 0.1,
  /** How long a fire/ads press's "cancel" is remembered (§4.3 two-step rule). */
  CANCEL_SWALLOW_SECONDS: 0.25,
} as const;

/** Jump / gravity (Document 2, Section 6.4). Impulse is derived, never stored. */
export const JUMP = {
  GRAVITY: 22,
  DESIRED_JUMP_HEIGHT: 1.15,
  TERMINAL_VELOCITY: 45,
  COYOTE_TIME_SECONDS: 0.1,
} as const;

/** Capsule / eye-height configuration. */
export const PLAYER = {
  CAPSULE_RADIUS: 0.35,
  STAND_HEIGHT: 1.8,
  CROUCH_HEIGHT: 1.15,
  SLIDE_HEIGHT: 0.95,
  EYE_OFFSET_FROM_TOP: 0.12,
  /** Max obstacle height snapped over as a step (Document 2, Section 6.7). */
  MAX_STEP_HEIGHT: 0.45,
  /** Rapier KCC corrections shave the character-offset skin by sub-mm; a
   *  correction shorter than the desired delta by less than this is a PASS,
   *  not an obstruction (Document C §4.2 seam tolerance). */
  CORRECTION_EPSILON: 0.001,
  MAX_WALKABLE_SLOPE_DEG: 45,
  CROUCH_LERP_SECONDS: 0.18,
} as const;

/** COD-style slide (Document 2, Section 6.6). */
export const SLIDE = {
  BOOST_MULTIPLIER: 1.32,
  MAX_SPEED: 11.5,
  DURATION_SECONDS: 0.85,
  STEER_INFLUENCE: 0.3,
  COOLDOWN_SECONDS: 0.6,
  MIN_SPEED: 2.6,
  CAMERA_TILT_DEG: 4.5,
} as const;

/** Stamina resource (Document 2, Section 9). */
export const STAMINA = {
  DRAIN_PER_SECOND: 0.26,
  REGEN_PER_SECOND: 0.2,
  REGEN_DELAY_SECONDS: 1.1,
  /** Emit player:staminaChanged only when the value moved at least this much
   *  since the last emit (documented throttle choice: epsilon, not time). */
  EMIT_EPSILON: 0.02,
} as const;

/** Footstep cadence: metres travelled per step, per gait (Document 2, §11). */
export const FOOTSTEP = {
  STRIDE_WALK_METERS: 2.2,
  STRIDE_SPRINT_METERS: 2.9,
  STRIDE_CROUCH_METERS: 1.6,
} as const;

/** Head-bob amplitude (m) and lateral cycles per footstep, per gait.
 *  Phase is locked to the FOOTSTEP stride constants (one lateral cycle and
 *  two vertical bumps per step), so bob frequency equals gait cadence
 *  (~2.5 Hz walk / ~2.8 Hz sprint vertical-double ~5-5.6 Hz) — the previous
 *  rad-per-metre tuning produced a 16-32 Hz view vibration. */
export const HEAD_BOB = {
  WALK: { AMP_Y: 0.035, AMP_X: 0.022, CYCLES_PER_STEP: 1 },
  SPRINT: { AMP_Y: 0.055, AMP_X: 0.034, CYCLES_PER_STEP: 1 },
  CROUCH: { AMP_Y: 0.02, AMP_X: 0.012, CYCLES_PER_STEP: 1 },
} as const;

/** Landing feedback (Document 2, Sections 6.8 / 7). */
export const LANDING = {
  HARD_LANDING_VELOCITY_THRESHOLD: 9,
  STATE_DURATION_SECONDS: 0.16,
  CAMERA_DIP_METERS: 0.14,
  CAMERA_DIP_RECOVER_SECONDS: 0.4,
} as const;

/** Camera feel: FOV modifier targets and blend speeds. */
export const CAMERA_FEEL = {
  SPRINT_FOV: 97,
  SPRINT_FOV_LERP_SPEED: 8,
  /** Document 3 §6.4: ADS zoom blends through the same modifier stack; its
   *  priority outranks sprint so the two coexist without popping. */
  ADS_FOV_LERP_SPEED: 6,
  ADS_FOV_PRIORITY: 60,
  /** Doc C §8.3: 1x optics zoom to 0.92× base FOV (a subtle tighten, NOT the
   *  old fake 55° snap); real magnification divides baseFOV directly. */
  ADS_ONE_X_FEEL: 0.92,

  SLIDE_TILT_LERP_SPEED: 10,
  SHAKE_DECAY_EXPONENT: 2,
} as const;

/** Weapon handling globals (Document 3). Per-weapon numbers live in /definitions. */
export const WEAPON = {
  SWITCH_OUT_SECONDS: 0.35,
  SWITCH_IN_SECONDS: 0.45,
  /** Reload grants ammo at this fraction of the duration ("mag physically in").
   *  Fallback when a weapon profile has no reload event table (Document 2.5 §6.6
   *  percentage-event scheduling supersedes this where a table exists). */
  RELOAD_AMMO_INSERT_FRACTION: 0.65,
  /** Stopped firing longer than this and the recoil pattern index resets. */
  PATTERN_RESET_GRACE_SECONDS: 0.12,
  /** Document 2.5 §4.2: weapon lowers into the sprint "ready jog" over this long. */
  SPRINT_WEAPON_LOWER_DURATION: 0.2,
  /** Document 2.5 §4.2: snap-up delay after sprint-cancel before fire/ADS executes. */
  SPRINT_TO_READY_DURATION: 0.12,
  /** Document 2.5 §5 buffering: fire pressed within this window before a blocking
   *  action (reload/switch) completes is remembered and executed on completion. */
  FIRE_BUFFER_WINDOW_SECONDS: 0.1,
  /** Document 2.5 §8: inspect requires no fire input for this long beforehand. */
  INSPECT_QUIET_SECONDS: 1.5,
} as const;

/** Spread multipliers applied on top of per-weapon base/moving/jumping degrees. */
export const SPREAD = {
  SPRINT_MULTIPLIER: 1.6,
  SLIDE_MULTIPLIER: 1.8,
  AIR_MULTIPLIER: 2.0,
  CROUCH_IDLE_MULTIPLIER: 0.8,
} as const;

/** Recoil feel (Document 3 §10). */
export const RECOIL = {
  /** Document C §6: master switch for the CAMERA subtlety layer (the arm
   *  kick via WeaponSway is independent and always on). */
  CAMERA_ENABLED: true,
  /** Document C §6.1: per-shot camera punch = pattern step × this ratio.
   *  The camera layer is additive-only — it never mutates stored yaw/pitch;
   *  ballistics still read the punched FINAL camera transform, so shots
   *  climb with the pattern while the sim aim stays pristine. */
  CAMERA_RECOIL_RATIO: 0.3,
  /** Punch spring (damped oscillator toward the climb baseline): stiffness
   *  (rad/s² per rad) and damping (1/s). */
  CAMERA_PUNCH_STIFFNESS: 260,
  CAMERA_PUNCH_DAMPING: 16,
  /** After the grace period with no fire, the accumulated climb unwinds at
   *  this exponential rate (1/s). */
  CAMERA_CLIMB_RECOVER: 6,
  /** Sustained-fire aim jitter: grows linearly with consecutive shots up to
   *  JITTER_RAMP_SHOTS, capped at JITTER_MAX_RAD, decays instantly on cease. */
  CAMERA_JITTER_RAMP_SHOTS: 8,
  CAMERA_JITTER_MAX_RAD: 0.0035,
  CAMERA_JITTER_SMOOTH: 9,
  /** ADS tightens recoil: punch × lerp(1, ADS_RECOIL_DAMPING, adsWeight). */
  ADS_RECOIL_DAMPING: 0.65,
  /** Spring rate at which accumulated recoil unwinds after fire stops (1/s). */
  RECOVERY_SPEED: 6,
  /** ± fraction of each pattern step added as learnable-preserving jitter. */
  JITTER_FRACTION: 0.1,
  /** Viewmodel jolt exaggeration vs the camera kick, and its spring-back rate. */
  VIEWMODEL_KICK_SCALE: 1.6,
  VIEWMODEL_KICK_RECOVERY: 10,
  VM_KICK_SPRING_MULTIPLIER: 6,
  VM_KICK_DAMP_FACTOR: 0.6,
} as const;

/** Procedural viewmodel sway (Document 3 §9). */
export const SWAY = {
  MOUSE_ROT_RAD_PER_PIXEL: 0.0009,
  SPRING: 14,
  DAMPING: 7,
  CLAMP_RAD: 0.07,
  BREATH_AMP_RAD: 0.0035,
  /** Inertial strafe sway: metres of rig offset per m/s of camera-local
   *  horizontal velocity (opposite the movement), capped, exp-smoothed. */
  STRAFE_POS_FACTOR: 0.012,
  STRAFE_POS_MAX: 0.06,
  STRAFE_SMOOTH: 10,
  /** Share of the forward velocity that feeds the depth offset. */
  STRAFE_FWD_SHARE: 0.5,
  /** Procedural sprint tuck (blend-space stand-in, §4 of the viewmodel
   *  architecture note): rig offset blended in by speed fraction between
   *  walk and sprint, on top of the sprint clip's authored roll. */
  SPRINT_TUCK: { x: 0.03, y: -0.02 },
  SPRINT_TUCK_SMOOTH: 8,
  /** Speed window over which the tuck blends in: walk top .. sprint top
   *  (derived from MOVEMENT so the two can never drift apart). */
  TUCK_SPEED_START: MOVEMENT.WALK_SPEED,
  TUCK_SPEED_END: MOVEMENT.WALK_SPEED * MOVEMENT.SPRINT_SPEED_MULTIPLIER,
  BREATH_HZ: 0.35,
  ADS_SWAY_MULTIPLIER: 0.25,
  /** rotZ roll factor applied to the horizontal lag component. */
  ROTZ_FACTOR: 0.35,
  /** Position-offset factor (metres per radian of lag). */
  POS_FACTOR: 0.02,
  /** Share of breathing that lands on the vertical position offset. */
  BREATH_POS_FACTOR: 0.6,
  /** Recoil-kick spring constants for the viewmodel jolt. */
  KICK_SPRING_MULTIPLIER: 6,
  KICK_DAMP_FACTOR: 0.6,
  /** Horizontal speed below which the player counts as stationary. */
  STATIONARY_SPEED_EPS: 0.15,
} as const;

/** Viewmodel rig (Document 2.5 §3.1/§3.2): ViewmodelRigRoot is a CHILD OF THE
 *  MAIN CAMERA on THREE.Layers index 1; the world renders layer 0, then
 *  renderer.clearDepth() + a second pass on layer 1 — one camera, one FOV,
 *  no near-plane hacks. The old dedicated vm scene/camera is superseded. */
export const VIEWMODEL = {
  /** THREE.Layers index the whole viewmodel subtree lives on. */
  LAYER_INDEX: 1,
  /** Rest eye relief: camera-space distance the grip anchor sits at (metres).
   *  The per-weapon `hipRestPosition` supplies x/y; this supplies z fallback. */
  HIP_REST_Z: -0.5,
  /** 1/s exponential rate the rig root chases the camera frame — the residual
   *  lag on fast flicks gives the weapon weight (never weld 1:1). */
  FOLLOW_RATE: 20,
  /** 1/s rate the ADS alignment weight eases in/out (drives both the optic
   *  solve and the additive aim-pose layer, §6.1 layer 3). */
  ADS_LERP_RATE: 12,
  /** §8.2 ADS body lean: small backward shift of the upper-body rig (camera
   *  space, × adsWeight) helping the shoulder-to-grip distance stay inside
   *  the arm's reach. KEEP SMALL — a large pull drags the receiver through
   *  the camera (the rig has no near-plane squash yet). */
  ADS_LEAN_Z: 0.2,
  /** §8.2 anti-clip: the commanded ADS grip anchor must stay at least this
   *  far IN FRONT of the eye (camera-space z ≤ −this). Metres. */
  ADS_ANCHOR_MIN_FRONT: 0.1,
  /** Fraction of the summed procedural offsets (sway/recoil/pose) that the
   *  RIG ROOT itself follows. The IK grip anchor follows 100%; the shoulders
   *  follow this fraction, so arms absorb the residual — the weapon lands
   *  pixel-precise while the body reads as having mass (§6.1 layers 5-7). */
  ROOT_FOLLOW_FACTOR: 0.6,
  /** Fallback camera-space grip anchor when no weapon profile is active (fists). */
  FISTS_ANCHOR: { x: 0, y: -0.24, z: -0.42 },
} as const;

/** Two-bone IK (Document 2.5 §6.3). Bone-chain RESOLUTION is data-driven: the
 *  canonical names from §2.1 are tried first, then HANDS_BONE_ROLES patterns —
 *  a rig conforming to the spec needs zero config; the imported community rig
 *  conforms through its pattern table. */
export const IK = {
  /** World-space pole hint direction for elbow bend (camera-local, normalized
   *  at use): elbows bend down-and-out, never up/in through the torso (§6.3). */
  POLE_HINT_CAMERA_LOCAL: { x: 0.35, y: -1, z: 0.25 },
  /** Global weight of the IK correction (1 = hand exactly at the grip anchor). */
  GLOBAL_WEIGHT: 1,
  /** Damping on the per-frame correction so solve noise never pops. */
  SMOOTH_RATE: 30,
  /** Off-hand "support the wrist" target offset for gripStyle 'oneHanded'
   *  weapons (§6.3) — camera-local offset from the primary hand anchor. */
  ONE_HANDED_SUPPORT_OFFSET: { x: -0.07, y: -0.05, z: 0.03 },
} as const;

/** Document 2.5 §6.5: the reusable spring-damper profile table. Every spring
 *  consumer keys in here — no stiffness/damping numbers inline in systems. */
export interface SpringProfile {
  readonly STIFFNESS: number;
  readonly DAMPING: number;
}

export const SPRING_PROFILES = {
  /** Mouse-look weapon lag (also WeaponSway's legacy SPRING/DAMPING pair). */
  sway: { STIFFNESS: 14, DAMPING: 7 },
  /** Idle breathing settle (spring-filtered sine, §6.5). */
  breathing: { STIFFNESS: 8, DAMPING: 5 },
  /** Movement-state pose offset transitions (§6.5 "deliberate but not sluggish"). */
  poseState: { STIFFNESS: 42, DAMPING: 13 },
  /** Separated-part cycles (charging-handle rack, pump, mag reseat). */
  weaponPart: { STIFFNESS: 26, DAMPING: 9 },
  /** Document A §8.3 joint recoil recovery: wrist fast, elbow medium, shoulder slow. */
  jointWrist: { STIFFNESS: 120, DAMPING: 13 },
  jointElbow: { STIFFNESS: 60, DAMPING: 9 },
  jointShoulder: { STIFFNESS: 34, DAMPING: 7 },
  /** Airborne float offset (§4.6). */
  jumpFloat: { STIFFNESS: 26, DAMPING: 9 },
  /** Landing settle: hybrid instant-displacement + spring recovery (§4.6). */
  landSettle: { STIFFNESS: 90, DAMPING: 16 },
  /** Sprint/tac-sprint pose lowering (§4.2/§4.3 deliberate weight). */
  sprintLower: { STIFFNESS: 30, DAMPING: 11 },
} as const;

/** Document 2.5 §4.7: movement-state → rigid pose-offset targets for the
 *  viewmodel rig root (camera-local metres / radians). Targets are spring-
 *  damped toward (SPRING_PROFILES.poseState / sprintLower / jumpFloat). */
export const POSE_OFFSETS = {
  /** Regular sprint: lowered, angled-inward "ready jog" (§4.2). */
  SPRINT: { pos: [0.02, -0.06, 0.04], rotDeg: [-8, 18, 6] },
  /** Tactical sprint: extreme holster-adjacent lower (§4.3). */
  TAC_SPRINT: { pos: [0.05, -0.13, 0.09], rotDeg: [-24, 42, 14] },
  /** Slide: angled down/outward, counter-lean against the camera tilt (§4.4). */
  SLIDE: { pos: [0.01, -0.05, 0.02], rotDeg: [6, 10, -7] },
  /** Crouch: slightly lowered hip-rest, deliberately < camera drop (§4.5). */
  CROUCH: { pos: [0, -0.02, 0], rotDeg: [2, 4, 0] },
  /** Airborne float target (§4.6); landing kicks the spring, not this table. */
  AIR: { pos: [0, 0.03, -0.02], rotDeg: [-4, 0, 3] },
  /** Sprint-to-ready snap adds a punchy upward offset en route (§4.2). */
  READY_SNAP: { pos: [0, 0.015, -0.01], rotDeg: [3, -6, -2] },
} as const;

/**
 * THE PROCEDURAL ARM RIG (Document A §3): rigid box segments on named pivots,
 * generated once by tools/generateHandModel.js into real .glb assets. Skins
 * are material swaps (HandSkinRegistry); a silhouette variant is a second
 * saved .glb — the running game only ever LOADS these files.
 */
export const HANDS = {
  /** Default rig asset (data: swap to arms_gloved for the zero-code variant). */
  rigPath: 'characters/arms_standard.glb',
  /** §11/A swap-proof variant — same pivots, different proportions/colors. */
  altRigPath: 'characters/arms_gloved.glb',
  /** Static camera-local placement of ArmsRoot inside ViewmodelRigRoot. */
  RIG_OFFSET: { x: 0.02, y: -0.34, z: -0.06 },
  /** Socket_HandGrip_* position in the HAND-block frame (builder constant,
   *  mirrored here so the wrist-target math is data, not a second source). */
  HAND_GRIP_LOCAL: { x: 0, y: -0.0715, z: 0.01 },
  /** Rigid pivot names (Document A §3.1) — the IK chain nodes per side. */
  PIVOTS: {
    R: { shoulder: 'Shoulder_R', upperArm: 'UpperArmPivot_R', elbow: 'ElbowPivot_R', wrist: 'WristPivot_R' },
    L: { shoulder: 'Shoulder_L', upperArm: 'UpperArmPivot_L', elbow: 'ElbowPivot_L', wrist: 'WristPivot_L' },
  },
  /** Elbow bend pole hint (camera-local, normalized at use) — §6.3. */
  POLE_HINT: { x: 0.35, y: -1, z: 0.25 },
} as const;

/** §11/A: adding a weapon = one definitions file + one profile entry. */
export const BOOT_LOADOUT: readonly string[] = ['rifle', 'pistol'];

/**
 * Gun-melee data (Document B): timing windows drive MeleeHitDetection and the
 * baked punch-clip selection; all numbers in seconds/metres.
 */
export const MELEE = {
  RANGE_METERS: 2.2,
  DAMAGE: 55,
  LUNGE_DISTANCE: 1.1,
  RATE_SECONDS: 0.55,
  /** Strike window inside the 0.47s punch clip (start, end). */
  STRIKE_WINDOW: { START: 0.12, END: 0.34 },
  /** Chained hits inside this window advance the 3-variant combo. */
  COMBO_WINDOW_SECONDS: 1.0,
} as const;

/**
 * JOINT RECOIL (Document A §8.3): one shot displaces three joints in
 * different proportions (wrist most, camera least) — per-weapon scale lives
 * in the weapon definition (recoilJointScale).
 */
export const JOINT_RECOIL = {
  /** Instantaneous displacement (radians) per unit recoilJointScale. */
  WRIST: { x: 0.10, y: 0.015, z: 0.012 },
  ELBOW: { x: 0.05, y: 0.0, z: 0.008 },
  SHOULDER: { x: 0.022, y: 0.0, z: 0.004 },
  /** Random yaw jitter factor per shot. */
  YAW_JITTER: 0.5,
} as const;

/**
 * Weapon-part animation nodes + timelines (Document A §8.7): the procedural
 * weapons carry NAMED moving parts; visibility/positions are event-driven.
 */
export const WEAPON_PARTS = {
  /** Charging-handle rack: local -X pull, spring return (spring: weaponPart). */
  RACK_OFFSET: 0.024,
  RACK_SECONDS: 0.14,
  /** Shotgun pump: local +Z travel toward the shooter. */
  PUMP_TRAVEL: 0.075,
  PUMP_SECONDS: 0.24,
  /** Falling-magazine prop — SUPERSEDED by Doc C §5.6: dropped mags are
   *  pooled Rapier bodies (MAG block + DroppedMagSystem). */
  FALLING_MAG: { GRAVITY: 9.8, LIFETIME_SECONDS: 2.0, SPIN: 3.0 },
} as const;

/**
 * Dropped magazines (Document C §5.6) — pooled Rapier dynamic bodies spawned
 * at the magazine socket on the magazine_detach beat.
 */
export const MAG = {
  POOL_SIZE: 4,
  /** Collision cuboid half-extents (m) — matches the procedural mag mesh. */
  HALF_EXTENTS: { x: 0.018, y: 0.055, z: 0.032 },
  RESTITUTION: 0.15,
  FRICTION: 0.7,
  /** Detach toss: forward along the bore (m/s) + downward (m/s), tumble (rad/s). */
  TOSS_FORWARD: 0.35,
  TOSS_DOWN: 0.6,
  TUMBLE: 4.0,
  LIFETIME_SECONDS: 6.0,
  COLOR: 0x2a2a2e,
} as const;

/**
 * Shell casings (Document A §8.6) — individually simulated pooled physics.
 */
export const CASING = {
  GRAVITY: 9.8,
  RESTITUTION: 0.35,
  FRICTION: 0.6,
  MAX_BOUNCES: 4,
  SETTLE_SPEED: 0.1,
  SETTLE_FADE_SECONDS: 1.5,
  LIFETIME_SECONDS: 4.0,
  POOL_SIZE: 40,
  RADIUS: 0.006,
  LENGTH: 0.024,
  COLOR: 0xc8a23c,
  EJECT_SPEED_MIN: 1.2,
  EJECT_SPEED_MAX: 1.9,
  EJECT_UP_KICK: 0.9,
  EJECT_UP_VARIANCE: 0.4,
  SPIN_RANGE: 20,
  PROBE_DEPTH: 3,
} as const;

/**
 * Movement-state joint targets (Document A §9 table) — RADIAN deltas fed to
 * the shared joint springs; spring data lives in SPRING_PROFILES.
 */
export const RIG_POSES = {
  /** Regular sprint: weapon rotates inward/down toward the body. */
  SPRINT_SHOULDER: { x: 0.35, y: 0.25, z: -0.2 },
  /** Tactical sprint: weapon fully drops toward the hip/side. */
  TAC_SPRINT_SHOULDER: { x: 0.7, y: 0.55, z: -0.45 },
  /** Slide: both arms tucked toward the torso. */
  SLIDE_SHOULDER: { x: 0.5, y: 0.3, z: -0.5 },
  /** Airborne float offset. */
  AIR_SHOULDER: { x: -0.08, y: 0, z: 0 },
  /** Pose blend rate toward state targets (1/s). */
  STATE_BLEND_RATE: 9,
  /** Tactical-sprint off-hand free swing (stride-synced sine, Document A §9). */
  FREE_SWING: { FREQUENCY_HZ: 1.4, AMPLITUDE_RAD: 0.55, SPEED_REF: 6.0 },
  /** Fists running: BOTH arms swing (Document B §4). */
  FISTS_SWING: { FREQUENCY_HZ: 1.4, AMPLITUDE_RAD: 0.7, SPEED_REF: 6.0 },
} as const;

/**
 * Fists guard pose (Document B §3): additive target on the shoulder/elbow
 * springs when ADS is held with fists — reuses the ADS weight path, never
 * touches the camera FOV stack.
 */
export const FISTS_GUARD = {
  SHOULDER_R: { x: -0.55, y: -0.35, z: -0.15 },
  ELBOW_R: { x: -1.5, y: 0, z: 0 },
  SHOULDER_L: { x: -0.45, y: 0.3, z: 0.15 },
  ELBOW_L: { x: -1.35, y: 0, z: 0 },
  BLEND_RATE: 10,
} as const;

/**
 * Idle fidgets (Document B §6): shoulder/wrist-scale procedural pulses.
 * Randomized non-repeating selection, 8-20s window, any input interrupts.
 */
export const FIDGETS = {
  MIN_DELAY_SECONDS: 8,
  MAX_DELAY_SECONDS: 20,
  /** Per-variant spring target pulses {joint: [x,y,z] rad over duration}. */
  VARIANTS: [
    { name: 'weight_shift', duration: 1.2, shoulder: [0.06, 0.1, -0.06], wrist: [0.0, 0.04, 0.0] },
    { name: 'weapon_check', duration: 0.9, shoulder: [0.02, -0.06, 0.04], wrist: [0.0, 0.0, 0.35] },
    { name: 'shoulder_roll', duration: 1.0, shoulder: [0.0, 0.0, 0.18], wrist: [0.02, 0.0, 0.0] },
  ],
} as const;

/** Pooled combat VFX (Document 3 §12). */
export const EFFECTS = {
  POOL_SIZE: 20,
  MUZZLE_LIFETIME_SECONDS: 0.05,
  MUZZLE_SCALE_MIN: 0.7,
  MUZZLE_SCALE_MAX: 1.25,
  TRACER_SPEED: 180,
  TRACER_LIFETIME_SECONDS: 0.09,
  TRACER_WIDTH: 0.02,
  TRACER_COLOR: 0xffc070,
  IMPACT_COLOR_GENERIC: 0xcccccc,
  IMPACT_COLOR_DUMMY: 0xff6644,
  IMPACT_DECAL_COLOR_GENERIC: 0x555555,
  IMPACT_DECAL_COLOR_DUMMY: 0x882211,
  IMPACT_LIFETIME_SECONDS: 0.4,
  IMPACT_PARTICLE_COUNT: 6,
  IMPACT_PARTICLE_SPEED: 3,
  DECAL_SURFACE_OFFSET: 0.02,
  DECAL_SIZE: 0.18,
  /** Base quad size (metres) multiplied by the random muzzle scale range. */
  MUZZLE_BASE_SCALE: 0.22,
  /** Muzzle flash socket inset so the quad sits just inside the bore. */
  MUZZLE_SOCKET_INSET: 0.02,
  IMPACT_PARTICLE_SCALE_MIN: 0.09,
  IMPACT_PARTICLE_SCALE_MAX: 0.17,
  IMPACT_GRAVITY: 2.5,
  TRACER_TAIL_METERS: 2.5,
} as const;

/** Viewmodel animation blending (Document 3 §14, superseded by Document 2.5 §6). */
export const ANIMATION = {
  CROSSFADE_DEFAULT_SECONDS: 0.15,
  CROSSFADE_FAST_SECONDS: 0.08,
  /** `fire` one-shot keeps priority this long after the shot, then the base
   *  locomotion clip resumes (auto weapons re-trigger it every shot). */
  FIRE_HOLD_SECONDS: 0.12,
  /** §8 inspect one-shot hold (matches the baked clip duration). */
  INSPECT_HOLD_SECONDS: 1.6,
  /** §6.4 clip inventory names shared by every weapon (L1 base locomotion). */
  BASE_CLIPS: {
    idle: 'idle', walk: 'walk', walkBack: 'walk_back', strafeLeft: 'strafe_left',
    strafeRight: 'strafe_right', sprint: 'sprint', tacSprint: 'tac_sprint',
    crouchIdle: 'crouch_idle', crouchWalk: 'crouch_walk', slide: 'slide',
    jumpStart: 'jump_start', jumpLoop: 'jump_loop', jumpLand: 'jump_land',
  },
} as const;

/** Hitscan ray configuration (Document 3 §11.3). */
export const DUMMY = {
  HEALTH: 100,
  LEG_HEIGHT: 0.55,
  RESPAWN_SECONDS: 3,
  FLASH_DECAY_PER_SECOND: 4,
} as const;

export const BALLISTICS = {
  MAX_RANGE_METERS: 300,
} as const;
