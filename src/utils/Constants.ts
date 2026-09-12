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
  crouch: 'KeyC', // user directive: C, not Ctrl (slide inherits crouch)
  reload: 'KeyR',
  fire: 'Mouse0',
  ads: 'Mouse2',
  weaponSlot1: 'Digit1',
  weaponSlot2: 'Digit2',
  debugToggle: 'F3',
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
} as const;

/** Horizontal movement model (units = metres, seconds). */
export const MOVEMENT = {
  WALK_SPEED: 5.4,
  SPRINT_SPEED_MULTIPLIER: 1.5,
  CROUCH_SPEED_MULTIPLIER: 0.42,
  GROUND_ACCELERATION: 46,
  AIR_ACCELERATION: 11,
  GROUND_FRICTION: 12,
} as const;

/** Sprint eligibility (Document 2, Section 6.3). */
export const SPRINT = {
  MAX_INPUT_ANGLE_DEG: 45,
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
  SLIDE_TILT_LERP_SPEED: 10,
  SHAKE_DECAY_EXPONENT: 2,
} as const;

/** Weapon handling globals (Document 3). Per-weapon numbers live in /definitions. */
export const WEAPON = {
  SWITCH_OUT_SECONDS: 0.35,
  SWITCH_IN_SECONDS: 0.45,
  /** Reload grants ammo at this fraction of the duration ("mag physically in").
   *  Stand-in for animation-embedded clip events if the pipeline ever exports them. */
  RELOAD_AMMO_INSERT_FRACTION: 0.65,
  /** Stopped firing longer than this and the recoil pattern index resets. */
  PATTERN_RESET_GRACE_SECONDS: 0.12,
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

/** Viewmodel rig + its dedicated render pass (Document 3 §8). */
export const VIEWMODEL = {
  // Model origin sits at the receiver centre, so the rig offset must place
  // the GRIP (local z ~ +0.02) at hands distance and let the stock fall into
  // the bottom-right corner near the near plane — putting the receiver at
  // hands distance instead floods the lower frame with unidentifiable slabs.
  HIP_LOCAL_OFFSET: { x: 0.24, y: -0.24, z: -0.5 },
  // Sight line (local y ~ +0.05) onto the camera axis for a centred picture.
  ADS_LOCAL_OFFSET: { x: 0.0, y: -0.055, z: -0.34 },
  ADS_LERP_RATE: 12,
  /** 1/s exponential rate at which the decoupled viewmodel rig chases the
   *  camera frame. High = tight; the residual lag on fast flicks is what
   *  gives the weapon its weight (industry practice: never weld 1:1). */
  FOLLOW_RATE: 20,
  FOV: 60,
  NEAR: 0.01,
  FAR: 10,
} as const;

/** Boot loadout: guns are DISABLED for the hands-first phase — fists only.
 *  WeaponManager.debugSetLoadout() restores guns (acceptance harness, later
 *  documents). Wheel + slot keys cycle this list, never the raw inventory. */
export const BOOT_LOADOUT: readonly string[] = ['fists'];

/** Fists / gun-melee feel + procedural hands animation tunables. */
export const MELEE = {
  RANGE_METERS: 2.2,
  DAMAGE: 55,
  /** Punch timeline seconds: wind-up, strike, recover. */
  WINDUP_SECONDS: 0.12,
  STRIKE_SECONDS: 0.09,
  RECOVER_SECONDS: 0.26,
  /** Finger curl 0..1 for the boxing guard vs a thrown punch. */
  GUARD_CURL: 0.8,
  PUNCH_CURL: 0.8,
  /** Local-X curl radians per phalanx (proximal, middle, distal). */
  FINGER_CURL_RAD: [1.15, 1.25, 0.85],
  /** Thumb tucks across the fist. */
  THUMB_CURL_RAD: [0.9, 1.0, 0.6],
  /** Procedural fist-aim: knuckle direction target in rig space. Imported
   *  rigs rest at arbitrary orientations; HandsRig measures each hand's
   *  authored finger direction and rotates it onto this vector (retarget-safe,
   *  no per-model code). INWARD pulls the knuckles toward the screen center
   *  line, UP tips them slightly above the view axis. */
  /** Procedural fist-aim directions (rig space, normalized in code; X is
   *  INWARD-positive, mirrored per side). The authored arm pose is kept
   *  as-is (this rig's twist bones are root-parented, so arm rotations tear
   *  interleaved skin weights); only the fists rotate, about their own
   *  wrist origin - the exact blend point of the hand/twist weights, so the
   *  seam never stretches. Measurement-based => retarget-safe. */
  /** Arm aim-chain directions (rig space, X inward-positive, mirrored per
   *  side). elbow = upper_arm->forearm dir; forearmDir = the direction the
   *  forearm points (elbow->wrist). Directions only (no positions) keeps the
   *  tables rig-unit-independent. Safe because HandsRig re-parents the
   *  root-hanging twist bones under the forearms at load (world-preserving),
   *  making the arm chain fully connected. */
  GUARD_ARM: { elbow: [-0.45, -0.85, 0.30], forearmDir: [0.30, -0.90, -0.30] },
  STRIKE_ARM: { elbow: [-0.15, -0.30, 0.10], forearmDir: [0.10, 0.15, -1.0] },
  FIST_GUARD_DIR: [0.30, 0.10, -1.0],
  FIST_STRIKE_DIR: [0.04, 0.02, -1.0],
  /** Palm-side direction (the way the curled fingers loop). Guard: palms
   *  down-inward-slightly-back => knuckles/dorsal face the camera, the
   *  classic boxing-guard read in first person. Strike: palm down. */
  FIST_PALM_GUARD_DIR: [0.45, -0.85, 0.0],
  FIST_PALM_STRIKE_DIR: [0.10, -1.0, 0.0],
  /** Jab depth: how far the servo target thrusts toward the eye axis (m). */
  PUNCH_HAND_THRUST: 0.22,
  /** Lateral cross of the jab toward the centreline, per side (m). */
  PUNCH_JAB_LATERAL: 0.08,
  /** Vertical lift of the jab at peak (m). */
  PUNCH_JAB_LIFT: 0.04,
  /** Skin meshes with fewer verts than this ratio of the largest skin mesh
   *  are treated as export junk (floating shards) and hidden. */
  HANDS_JUNK_MESH_RATIO: 0.1,
  /** Exponential smoothing rate for pose blends (1/s). */
  POSE_SMOOTH: 22,
  /** Hands root offset inside the viewmodel rig (camera-local metres). */
  /** Where the skinned hands should sit in viewmodel (camera-local) space.
   *  The HandsRig servo steers the imported rig here regardless of its
   *  authored unit/axis quirks. */
  HANDS_VIEW_TARGET: { x: 0, y: -0.12, z: -0.34 },
  /** The imported rig's node chain carries a ~100x unit scale; cancel it. */
  HANDS_SCALE: 0.01,
} as const;

/** Retarget map: bone ROLE -> regex matched against node names of whatever
 *  hand rig is loaded (Blender-style suffixes stripped by the patterns).
 *  A different hand model only needs new patterns here, never code changes. */
export const HANDS_BONE_ROLES = {
  handR: '^handR_', handL: '^handL_',
  indexR: ['^f_index01R_\\d', '^f_index02R_\\d', '^f_index03R_\\d'],
  middleR: ['^f_middle01R_\\d', '^f_middle02R_\\d', '^f_middle03R_\\d'],
  ringR: ['^f_ring01R_\\d', '^f_ring02R_\\d', '^f_ring03R_\\d'],
  pinkyR: ['^f_pinky01R_\\d', '^f_pinky02R_\\d', '^f_pinky03R_\\d'],
  thumbR: ['^thumb01R_\\d', '^thumb02R_\\d', '^thumb03R_\\d'],
  indexL: ['^f_index01L_\\d', '^f_index02L_\\d', '^f_index03L_\\d'],
  middleL: ['^f_middle01L_\\d', '^f_middle02L_\\d', '^f_middle03L_\\d'],
  ringL: ['^f_ring01L_\\d', '^f_ring02L_\\d', '^f_ring03L_\\d'],
  pinkyL: ['^f_pinky01L_\\d', '^f_pinky02L_\\d', '^f_pinky03L_\\d'],
  thumbL: ['^thumb01L_\\d', '^thumb02L_\\d', '^thumb03L_\\d'],
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

/** Viewmodel animation blending (Document 3 §14). */
export const ANIMATION = {
  CROSSFADE_DEFAULT_SECONDS: 0.15,
  CROSSFADE_FAST_SECONDS: 0.08,
  /** `fire` one-shot keeps priority this long after the shot, then the base
   *  locomotion clip resumes (auto weapons re-trigger it every shot). */
  FIRE_HOLD_SECONDS: 0.12,
  /** Additive ADS aim-pose delta (degrees) synthesized at runtime. */
  ADS_POSE_PITCH_DEG: -3.5,
  ADS_POSE_YAW_DEG: 1,
  ADS_POSE_ROLL_DEG: 1.5,
  /** Floor weight so the additive action stays resident on the mixer. */
  ADDITIVE_MIN_WEIGHT: 0.0001,
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
