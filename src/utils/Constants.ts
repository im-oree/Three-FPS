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
  weaponSlot3: 'Digit3',
  weaponSlot4: 'Digit4',
  weaponSlot5: 'Digit5',
  weaponSlot6: 'Digit6',
  /** Melee-only stance (fists), the way every shooter exposes it. */
  weaponSlot7: 'Digit7',
  // Document 2.5 §5: future-reserved melee bind (edge-triggered pattern only).
  melee: 'KeyV',
  // Document 2.5 §8: cosmetic inspect one-shot, idle-only.
  inspect: 'KeyF',
  // FPS/TPS Spec §1: 1PS <-> 3PS perspective toggle.
  togglePerspective: 'KeyP',
  /**
   * Killstreak slots (Document H §1.3). Digits 1-7 are weapon slots, so these
   * sit on the left-hand cluster where they can be hit without leaving WASD.
   */
  /**
   * Throwables (Document F §3), Call-of-Duty convention: ONE key per slot
   * rather than a cycle, so muscle memory maps a key to a specific device.
   *   G = tactical (smoke / stun / flash — whichever the loadout equips)
   *   Q = lethal   (reserved; a frag grenade drops in here identically)
   * Hold to cook, release to throw.
   */
  throwTactical: 'KeyG',
  throwLethal: 'KeyQ',
  killstreakSlot1: 'KeyZ',
  killstreakSlot2: 'KeyX',
  killstreakSlot3: 'KeyB',
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
  /**
   * Linear stopping force (m/s per second) applied alongside the exponential
   * friction when there is no movement input.
   *
   * WHY BOTH: exponential decay (v *= 1 - k*dt) is asymptotic — it approaches
   * zero but never reaches it, so releasing a strafe key left the player
   * gliding for ~0.4 m. That glide is invisible while you are moving, but the
   * moment you stop and shoot it reads as "the gun keeps drifting sideways on
   * its own". A constant linear term actually terminates the motion.
   */
  GROUND_STOP_DECELERATION: 34,
  /**
   * Below this speed (m/s) with no input, horizontal velocity is snapped to
   * exactly zero. Without a hard floor the residual millimetre-per-second
   * creep still animates sway and micro-bob forever.
   */
  STOP_EPSILON: 0.12,
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
  /**
   * Cap (m, camera space) on how far BEHIND the eye the ADS grip anchor may
   * sit. The stock belongs behind the eye at full ADS; this only stops sway
   * from dragging the receiver far enough back to sweep the near plane.
   */
  ADS_ANCHOR_MIN_FRONT: 0.1,
  /** Sway retained while braced in ADS (vs 1.0 at the hip). */
  ADS_SWAY_SCALE: 0.12,
  /** Extra damping on the longitudinal axis (near-plane safety). */
  ADS_SWAY_Z_SCALE: 0.35,
  /**
   * ADS framing drop (m, camera space). The weapon sits this far BELOW true
   * optical alignment so it stays visible and does not fill the screen or
   * sweep the near plane. Accuracy is preserved: the bore is counter-pitched
   * by atan(ADS_DROP_Y / ADS_CONVERGENCE_DISTANCE), so the muzzle line still
   * passes through the crosshair.
   */
  ADS_DROP_Y: 0.055,
  /** Small push forward with the drop, so the stock clears the eye. */
  ADS_DROP_Z: 0.03,
  /** Range (m) at which the counter-pitched bore re-converges on the reticle. */
  ADS_CONVERGENCE_DISTANCE: 30,
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
// Slot 3 is the melee-only (fists) stance, matching the standard shooter
// loadout of primary / secondary / melee.
/**
 * Document D: the full six-weapon roster plus the melee slot, bound to
 * Digit1..Digit7 in this order.
 */
export const BOOT_LOADOUT: readonly string[] = [
  'rifle', 'pistol', 'shotgun', 'smg', 'sniper', 'rocket_launcher', 'fists',
];

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
/**
 * Unarmed guard stance (Document B §3).
 *
 * MEASURED, NOT GUESSED. The previous values (shoulder ~-0.55 rad) left the
 * fists hanging at NDC y = -12, i.e. metres below the bottom of the screen —
 * which is why fists mode looked like it had no hands at all. These angles
 * come from an in-engine sweep projecting the wrist into NDC and selecting for
 * hands sitting just below centre frame (~x +/-0.30, y -0.30), shoulder-width
 * apart, the way a boxer's guard actually reads in first person:
 *
 *   shoulderX ~85 deg (1.48 rad)  raises the upper arm to chest height
 *   shoulderZ ~15 deg             abducts outward (right +Z, left -Z)
 *   elbowX    ~70-90 deg          folds the forearm up in front of the face
 *
 * Sign convention per COORDINATE_CONVENTIONS.md: a joint's local -Y runs down
 * the limb, so POSITIVE X rotation swings the segment forward and up.
 */
export const FISTS_GUARD = {
  // Slightly higher shoulder + deeper elbow fold than the raw sweep optimum,
  // and the wrists rolled inward, so the fists sit at cheek height angled
  // toward the centre line like a real boxing guard rather than two forearms
  // held out flat.
  SHOULDER_R: { x: 1.62, y: 0.20, z: 0.30 },
  ELBOW_R: { x: 1.62, y: 0, z: -0.18 },
  SHOULDER_L: { x: 1.62, y: -0.20, z: -0.30 },
  ELBOW_L: { x: 1.62, y: 0, z: 0.18 },
  /** Inward wrist roll so the knuckles face forward, not outward. */
  WRIST_R: { x: 0.10, y: 0.22, z: -0.30 },
  WRIST_L: { x: 0.10, y: -0.22, z: 0.30 },
  /** Extra fold applied on top while ADS/blocking — a tighter, closer guard. */
  ADS_ELBOW_BONUS: 0.22,
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
  /**
   * Document D §7.6: metres to push a projectile's spawn point forward along
   * the launch axis. The viewmodel muzzle is inside the player's own capsule,
   * so a rocket spawned exactly there hits the shooter immediately.
   */
  PROJECTILE_SPAWN_OFFSET: 1.2,
  MAX_RANGE_METERS: 300,
} as const;

// ===========================================================================
// FPS/TPS Unified Character Controller (Architectural Specification)
// ===========================================================================

/**
 * Perspective layers (§1). The world renders on layer 0, the first-person
 * viewmodel on VIEWMODEL.LAYER_INDEX (1). The third-person body owns layer 2
 * so the perspective toggle is a LAYER-MASK operation on the single camera —
 * no second camera, no material swapping, and shadow casting is unaffected
 * (the shadow pass tests object.layers against the LIGHT's camera, which we
 * leave on the default mask, so "hidden" parts still cast full-body shadows).
 */
export const PERSPECTIVE = {
  /** THREE.Layers index the whole third-person body subtree lives on. */
  BODY_LAYER_INDEX: 2,
  /** Which perspective the game boots in. */
  DEFAULT: 'FIRST' as 'FIRST' | 'THIRD',
  /** Camera-matrix S-curve blend duration between eye socket and boom (s). */
  BLEND_SECONDS: 0.38,
  /** Near-clip while in 1PS (tight, so the viewmodel never clips the eye). */
  NEAR_CLIP_FIRST: 0.02,
  /** Near-clip while in 3PS (normal — the body must not clip away). */
  NEAR_CLIP_THIRD: 0.1,
  /** 3PS spring-arm: boom length, shoulder offset and obstruction probe. */
  BOOM: {
    LENGTH: 2.6,
    /** Over-the-shoulder lateral + vertical offset (metres, camera space). */
    OFFSET_X: 0.55,
    OFFSET_Y: 0.18,
    /** Sphere radius the obstruction probe sweeps so the camera never clips. */
    PROBE_RADIUS: 0.2,
    /** Rate (1/s) the boom re-extends after an obstruction clears. */
    EXTEND_RATE: 4.0,
    /** Collapsing toward the head is instant-ish so walls never show through. */
    COLLAPSE_RATE: 30.0,
  },
  /**
   * Meshes hidden from the 1PS camera (the "camera inside the skull" set).
   * Hidden via LAYER REASSIGNMENT, never `visible = false`, so they keep
   * casting shadows (§1 "Shadows Only" requirement).
   */
  /**
   * Meshes excluded from the first-person camera.
   *
   * The camera sits inside the skull AND inside the chest cavity, so the head,
   * neck AND upper torso must all be dropped in first person — otherwise the
   * chest renders as a wall directly across the lens and intersects the near
   * plane every time the body leans or the aim offset pitches the spine. The
   * pelvis and both legs stay on the CHARACTER layer, which is what the player
   * sees when they look down.
   */
  HEAD_MESHES: ['Mesh_Head', 'Mesh_Helmet', 'Mesh_Neck', 'Mesh_Chest'] as readonly string[],
  /**
   * How many torso half-depths to push the body BEHIND the eye anchor.
   * 1.0 puts the chest's front face on the lens; values above that keep the
   * torso and thighs clear of the camera as the body leans and strides.
   */
  BODY_SETBACK_FACTOR: 1.9,
  /** Third-person body asset (code-generated by tools/generateBodyModel.js). */
  BODY_PATH: 'characters/body_standard.glb',
} as const;

/**
 * Aim Offset (§4): the 2D composite blend space replacing a 9-frame pose set.
 * Because the rig is rigid (no skinning), the "blend space" is evaluated
 * analytically: normalized pitch/yaw drive spine-bone rotations directly,
 * distributed across the spine chain so no single joint hinges unnaturally.
 */
export const AIM_OFFSET = {
  /** Fraction of total aim PITCH each spine joint absorbs (must sum to 1). */
  PITCH_DISTRIBUTION: { pelvis: 0.0, spine: 0.30, chest: 0.45, neck: 0.10, head: 0.15 },
  /** Fraction of the residual aim YAW (torso twist) per joint (sums to 1). */
  YAW_DISTRIBUTION: { pelvis: 0.0, spine: 0.35, chest: 0.40, neck: 0.10, head: 0.15 },
  /** Max torso twist before the legs are forced to re-plant (radians). */
  MAX_YAW_RAD: 1.48, // ~85°
  /** Max spine pitch either way (radians). */
  MAX_PITCH_RAD: 1.22, // ~70°
  /** Rate (1/s) the blend-space coordinates chase the controller rotation. */
  BLEND_RATE: 16,
  /** Yaw beyond this triggers a foot re-plant (the "turn in place" step). */
  REPLANT_YAW_RAD: 1.22,
  /** Rate (1/s) the body yaw snaps to the aim yaw during a re-plant. */
  REPLANT_RATE: 9,
} as const;

/** Third-person procedural locomotion (rigid rig — no baked leg clips). */
export const TPS_LOCOMOTION = {
  /** Stride frequency per m/s of horizontal speed (Hz per m/s). */
  STRIDE_HZ_PER_SPEED: 0.42,
  /**
   * Hip swing amplitude at the reference speed (radians).
   *
   * Kept modest: in first person the camera rides at the eyes and a large
   * forward swing throws the thigh across the lower half of the lens. This
   * value also sets the stride length (see LEG_LENGTH), so it is the single
   * knob controlling both how far the leg reaches and how fast it cycles.
   */
  HIP_SWING_RAD: 0.46,
  /**
   * Hip pivot to sole distance (m), measured on body_standard.glb. Used to
   * convert hip swing into real ground distance so stride cadence matches
   * travel speed and the feet do not slide.
   */
  LEG_LENGTH: 0.655,
  /** Knee bend amplitude (radians) — always flexes, never hyperextends. */
  KNEE_BEND_RAD: 0.85,
  /** Arm counter-swing amplitude when not gripping a weapon (radians). */
  ARM_SWING_RAD: 0.5,
  /** Reference speed the amplitudes are authored against (m/s). */
  SPEED_REF: 8.0,
  /** Pose blend rate toward crouch/slide/air targets (1/s). */
  POSE_RATE: 10,
  /** Crouch: pelvis drop and hip/knee pre-bend. */
  CROUCH: { PELVIS_DROP: 0.3, HIP_BEND: 0.75, KNEE_BEND: 1.2 },
  /** Slide: the trailing-leg tuck. */
  SLIDE: { PELVIS_DROP: 0.55, HIP_BEND: 1.15, KNEE_BEND: 1.7, LEAN_BACK: 0.35 },
  /** Airborne: legs tuck slightly, arms float. */
  AIR: { HIP_BEND: 0.35, KNEE_BEND: 0.6 },
} as const;

/** Two-bone foot IK: aligns the feet to uneven ground (§4 sync matrix). */
export const FOOT_IK = {
  /** Probe start height above the rest sole, and total probe length (m). */
  PROBE_UP: 0.55,
  PROBE_DOWN: 0.95,
  /** Maximum the pelvis drops so the lower foot can reach its surface (m). */
  MAX_PELVIS_DROP: 0.35,
  /** Rate (1/s) the IK offsets ease toward their solved targets. */
  BLEND_RATE: 12,
  /** Only correct offsets larger than this (avoids micro-jitter on flats). */
  DEADZONE: 0.01,
} as const;

/**
 * Vaulting / Mantling (§2). Trigger geometry is probed with real raycasts;
 * the traversal itself is a Bezier capsule path with physics suspended.
 */
export const VAULT = {
  /** Forward probe distance from the capsule centre (m). */
  PROBE_FORWARD: 0.95,
  // --- reach envelope, expressed as FRACTIONS OF PLAYER.STAND_HEIGHT -------
  // Deliberately not absolute heights: the climb limit must follow the
  // character's stature, so swapping in a taller or shorter character keeps
  // the rule "you can climb what you could physically reach" intact with no
  // retuning. VaultSystem multiplies these by PLAYER.STAND_HEIGHT at runtime.
  /** Below this (≈ knee) it is just a step, not a traversal. */
  MIN_LEDGE_FRACTION: 0.28,
  /** Up to roughly waist height is a running VAULT-over. */
  VAULT_MAX_FRACTION: 0.81,
  /**
   * Above the vault band and up to this is a MANTLE (pull-up). 1.15 ≈ full
   * overhead reach for human proportions (shoulder height + arm length):
   * the highest lip the character could actually grab. Anything taller is
   * correctly rejected, which is what stops the player scaling any wall.
   */
  MANTLE_MAX_FRACTION: 1.15,
  /** Extra downward search margin above the reach limit (m). */
  HEIGHT_SEARCH_MARGIN: 0.4,
  /** A mantle may be started from a near standstill; a vault may not. */
  ALLOW_STANDING_MANTLE: true,
  /** Minimum approach speed for a mantle (m/s) — allows walking into it. */
  /** @deprecated Traversal is jump-triggered; a standing mantle is normal. */
  MIN_MANTLE_SPEED: 0.2,
  /** A mantle ends standing ON the ledge, this far past the lip (m). */
  MANTLE_LANDING_INSET: 0.42,
  /** Extra duration at max mantle height, as a multiple of DURATION. */
  MANTLE_DURATION_SCALE: 1.1,

  /** @deprecated Superseded by the stature fractions above. */
  MAX_LEDGE_HEIGHT: 1.45,
  /** @deprecated Superseded by the stature fractions above. */
  MIN_LEDGE_HEIGHT: 0.5,
  /** Minimum forward speed required to initiate (m/s). */
  MIN_SPEED: 1.6,
  /** Depth of clear landing space required beyond the ledge lip (m). */
  LANDING_CLEARANCE: 0.55,
  /** Total traversal duration (s) — the "logical state timer" (§4). */
  DURATION: 0.62,
  /** Bezier apex clearance above the ledge (m). */
  APEX_CLEARANCE: 0.28,
  /** Cooldown before another vault may start (s). */
  COOLDOWN: 0.35,
  /** Hand-plant IK: the hand rides the ledge lip over this progress window. */
  HAND_PLANT_WINDOW: { start: 0.05, end: 0.62 },
  /** Exit velocity retained along the travel direction (fraction of entry). */
  EXIT_SPEED_FACTOR: 0.85,
} as const;

/**
 * Cross-perspective sync (§4 "Preventing Cross-Perspective Desync").
 * Gameplay owns a hard logical duration; every visual asset is time-scaled
 * to it via PlaybackRate = clipLength / logicalDuration.
 */
export const PERSPECTIVE_SYNC = {
  /** Below this rate difference, leave the mixer alone (avoids churn). */
  RATE_EPSILON: 0.001,
  /** Clamp so a wildly-mismatched clip can't play at a silly speed. */
  MIN_RATE: 0.25,
  MAX_RATE: 4.0,
} as const;

/**
 * Third-person weapon carry pose. Rotations applied to the BODY rig's arms so
 * the character visibly holds its weapon prop with both hands. Authored to
 * match the first-person viewmodel's hold, so the two perspectives agree.
 */
/**
 * Third-person weapon carry pose.
 *
 * SIGN CORRECTION (was a real bug): per COORDINATE_CONVENTIONS.md a joint's
 * local -Y runs down the limb, so a POSITIVE X rotation swings the segment
 * FORWARD. These upper-arm values were negative, which swung both arms
 * BACKWARD -- the hands ended up behind the chest and the rifle pointed up
 * over the shoulder, pointing away from the direction of travel. It read as
 * "the character is facing backwards" even though the body root was correct.
 *
 * Values below are MEASURED by an in-engine sweep (not guessed) that scored
 * wrist position against the chest and the weapon's own -Z against world
 * forward. At these angles the weapon's forward axis is [0.09, 0.10, -0.99],
 * i.e. essentially straight down the body's facing, with the hands 0.32 m
 * (right) and 0.48 m (left) in FRONT of the chest.
 */
export const TPS_CARRY = {
  RIGHT_UPPER: { x: 1.20, y: 0.0, z: 0.10 },
  RIGHT_ELBOW: { x: -1.10, y: 0.0, z: 0.0 },
  LEFT_UPPER: { x: 1.50, y: 0.55, z: 0.0 },
  LEFT_ELBOW: { x: -0.90, y: 0.0, z: 0.0 },
  /** Weapon grip offset in the right-wrist frame (metres). */
  GRIP_LOCAL: { x: 0.0, y: -0.07, z: 0.02 },
} as const;

/**
 * Procedural weapon shake — the "carrying weight" feel.
 *
 * Static sprint poses alone read as a mannequin holding a prop. These drive a
 * stride-synced figure-8 on the hands (sin on pitch, cos at half frequency on
 * yaw) plus a decaying kick per shot. All amplitudes are in radians and are
 * scaled by `speed / SPEED_REFERENCE`, so motion tapers off smoothly rather
 * than popping between discrete locomotion states.
 */
export const WEAPON_SHAKE = {
  /** Speed (m/s) at which locomotion shake reaches full amplitude. */
  SPEED_REFERENCE: 8.1,
  WALK: {
    FREQUENCY_HZ: 1.6, PITCH_RAD: 0.018, YAW_RAD: 0.012, ROLL_RAD: 0.010,
    ELBOW_SCALE: 0.6, WRIST_SCALE: 0.5,
  },
  SPRINT: {
    FREQUENCY_HZ: 2.5, PITCH_RAD: 0.055, YAW_RAD: 0.038, ROLL_RAD: 0.030,
    ELBOW_SCALE: 0.8, WRIST_SCALE: 0.7,
  },
  /** Gun raised and close to the chest: faster cadence, punchier jolt. */
  TAC_SPRINT: {
    FREQUENCY_HZ: 3.1, PITCH_RAD: 0.080, YAW_RAD: 0.052, ROLL_RAD: 0.045,
    ELBOW_SCALE: 1.0, WRIST_SCALE: 0.9,
  },
  /** Per-shot hand kick: a fast oscillation under a quadratic ease-out. */
  FIRE_DECAY_SECONDS: 0.18,
  FIRE_FREQUENCY_HZ: 14,
  FIRE_PITCH_RAD: 0.055,
  FIRE_YAW_RAD: 0.022,
  FIRE_WRIST_RAD: 0.070,
} as const;

/**
 * Magnified-optic behaviour (Document C §8.4/§8.5, Document D §6.5).
 * The scope tunnel itself is CSS (ScopeOverlay); these govern simulation.
 */
export const SCOPE = {
  /** Magnification change per wheel notch. */
  ZOOM_STEP: 0.5,
  /** Default breath-hold budget when a profile does not state one. */
  BREATH_HOLD_SECONDS: 4,
  /** Breath regenerated per second when not holding. */
  BREATH_REGEN_RATE: 0.5,
  /** Sway multiplier while the breath is held (near-still). */
  BREATH_HOLD_SWAY_SCALE: 0.15,
  /** Sway multiplier during the post-exhaustion penalty window. */
  POST_HOLD_SWAY_SCALE: 1.8,
  POST_HOLD_PENALTY_SECONDS: 1.5,
  /** Base sway half-amplitude in radians, at min magnification, standing. */
  BASE_SWAY_RAD: 0.0016,
  /** Speed (m/s) at which the movement sway penalty saturates. */
  MOVE_SWAY_SPEED_REF: 5,
  /** Extra sway multiplier at full movement speed. */
  MOVE_SWAY_MULTIPLIER: 3,
  // Incommensurate frequencies so the drift never visibly loops.
  SWAY_FREQ_A: 0.7,
  SWAY_FREQ_B: 1.9,
  SWAY_FREQ_C: 0.53,
  SWAY_FREQ_D: 1.31,
  /** Seconds for the tunnel mask to fade in/out. */
  OVERLAY_FADE_SECONDS: 0.12,
  /** ADS weight beyond which the scope tunnel engages and the rig hides. */
  ENGAGE_AT_ADS_WEIGHT: 0.86,
} as const;

/** Player health (Document 5 §8.1) — the minimal damageable-player concept. */
export const HEALTH = {
  MAX: 100,
  /** Seconds without taking damage before regeneration begins. */
  REGEN_DELAY_SECONDS: 4,
  REGEN_PER_SECOND: 12,
  /** Fraction below which the low-health vignette engages. */
  LOW_THRESHOLD: 0.3,
  /** Debug damage applied by the F6 test bind. */
  DEBUG_DAMAGE: 22,
} as const;

/** HUD timings (Document 5 §8). */
export const HUD = {
  HIT_MARKER_SECONDS: 0.18,
  KILL_MARKER_SECONDS: 0.34,
  DAMAGE_INDICATOR_SECONDS: 1.1,
  /** Crosshair gap in px at zero spread, and px-per-degree of real spread. */
  CROSSHAIR_BASE_GAP: 4,
  CROSSHAIR_PX_PER_DEGREE: 7,
} as const;

/**
 * Camera shake trauma model (Document E §1). Separate from RECOIL, which is
 * the deterministic learnable per-weapon pattern.
 */
export const CAMERA_SHAKE = {
  /** Trauma units bled off per second — linear decay. */
  DECAY_PER_SECOND: 1.4,
  MAX_OFFSET_POS: 0.03,
  MAX_OFFSET_ROT_DEG: 4.0,
  /** How fast we walk through the noise field. Higher = busier shake. */
  NOISE_FREQUENCY: 12,
  /** Continuous exertion waver while sprinting (per second). */
  SPRINT_TRAUMA_TRICKLE: 0.02,
  TAC_SPRINT_TRAUMA_TRICKLE: 0.04,
  /** One-shot pulses. */
  SLIDE_ENTRY_TRAUMA: 0.08,
  SLIDE_EXIT_TRAUMA: 0.04,
  /** Supplementary per-shot tick for AUTOMATIC weapons only. */
  AUTO_FIRE_SUPPLEMENTAL_TRAUMA: 0.015,
  /** Landing: scaled by impact speed, clamped to this band. */
  LANDING_TRAUMA_MIN: 0.05,
  LANDING_TRAUMA_MAX: 0.15,
  /** Damage: trauma per point of damage taken, clamped. */
  DAMAGE_TRAUMA_PER_POINT: 0.004,
  DAMAGE_TRAUMA_MAX: 0.35,
  /** Explosions shake well beyond their damage radius. */
  EXPLOSION_SHAKE_RADIUS_MULTIPLIER: 3.0,
  EXPLOSION_BASE_TRAUMA: 0.9,
} as const;

/**
 * Per-locomotion-state hand bob (Document E §2). Amplitudes are in radians of
 * wrist/elbow spring target, phase-locked to the footstep cadence so the
 * visual bob peak lands with the audible step.
 */
export const HAND_BOB = {
  WALK_AMPLITUDE: 0.008,
  SPRINT_AMPLITUDE: 0.018,
  TAC_SPRINT_AMPLITUDE: 0.026,
  CROUCH_AMPLITUDE: 0.004,
  /** Airborne micro-drift, so arms are not frozen mid-jump. */
  AIR_DRIFT_AMPLITUDE: 0.006,
  AIR_DRIFT_FREQUENCY: 0.7,
  /** Landing settle kick, scaled by impact speed. */
  LANDING_KICK_MAX: 0.09,
  /** Look-layer strength per state — a sprinter does not finely articulate. */
  LOOK_STRENGTH_DEFAULT: 1.0,
  LOOK_STRENGTH_SPRINT: 0.7,
  LOOK_STRENGTH_TAC_SPRINT: 0.4,
} as const;

/** Shared explosion timings (Document G). One system, scaled by preset. */
export const EXPLOSION_FX = {
  /** Point-light flash: a few frames only. */
  LIGHT_SECONDS: 0.09,
  LIGHT_INTENSITY_SCALE: 14,
  FIREBALL_SECONDS: 0.42,
  SHOCKWAVE_SECONDS: 0.32,
  SMOKE_SECONDS: 2.6,
  DECAL_SECONDS: 14,
  DEBRIS_LIFETIME: 4.5,
  /** After this, an instance is recycled once its debris have expired. */
  TOTAL_SECONDS: 2.8,
} as const;

/**
 * Killstreak availability + cooldown (Document H).
 *
 * THE EARNING PROBLEM: there are no enemies yet, so a strict kills-required
 * gate would make every killstreak permanently unreachable and untestable.
 * The availability RULE is therefore swappable — see KILLSTREAK.EARN_MODE.
 * Switching to 'kills' once AI exists is a one-line change and the rest of
 * the framework (HUD states, cooldowns, activation) is unaffected.
 */
export const KILLSTREAK = {
  /**
   * 'open'  — always available, unlimited uses, cooldown still enforced.
   *           The current mode: playable and testable with no enemies.
   * 'kills' — the shipping rule: gated behind killsRequired, consumed on use.
   */
  EARN_MODE: 'open' as 'open' | 'kills',
  /** Seconds after a streak ENDS before it can be called again. */
  DEFAULT_COOLDOWN_SECONDS: 20,
  /** Max simultaneously-active streaks (a UAV and a heli can coexist). */
  MAX_CONCURRENT: 2,
  /** Fired-and-forget streaks still block re-entry for this long. */
  MIN_ACTIVATION_GAP: 0.4,
} as const;

/** UAV recon orbit + radar ping cadence (Document I §4). */
export const UAV_KILLSTREAK = {
  ORBIT_RADIUS: 40,
  ORBIT_HEIGHT: 35,
  ORBIT_SPEED: 0.15,
  PING_INTERVAL: 1.0,
  /**
   * Short enough that contacts visibly refresh rather than lying about stale
   * positions, but comfortably MORE than double the ping interval. At 1.2 s
   * a single dropped frame let every contact lapse before the next sweep, so
   * the radar flickered empty between pings.
   */
  CONTACT_TTL: 2.6,
} as const;

/** Airstrike bombing run (Document H §2.2). */
export const AIRSTRIKE = {
  INBOUND_DELAY: 2.2,
  BOMB_COUNT: 4,
  BOMB_INTERVAL: 0.35,
  BOMB_SPACING: 11,
  BLAST_RADIUS: 10,
  BLAST_DAMAGE: 180,
} as const;

/** Attack helicopter patrol + engagement (Document I §5). */
export const HELICOPTER = {
  ENGAGE_ALTITUDE: 18,
  PATROL_SPEED: 11,
  PATROL_RADIUS: 34,
  TURN_RATE: 1.4,
  TARGET_SCAN_INTERVAL: 1.5,
  ENGAGE_RANGE: 70,
  ENGAGE_STANDOFF: 22,
  MINIGUN_FIRE_RATE_RPM: 1800,
  MINIGUN_DAMAGE: 9,
  HEALTH: 500,
} as const;

/** Throwables (Document F). Shared across all three tactical devices. */
export const THROWABLE = {
  /** Launch speed multiplier applied to the profile's throwForce. */
  THROW_SPEED_SCALE: 1.0,
  /** Upward bias on the throw so a flat look still arcs sensibly. */
  THROW_UP_BIAS: 0.22,
  /** Spawn clear of the player's own capsule, as with rockets. */
  SPAWN_OFFSET: 0.9,
  /** Release happens this far through the throw animation. */
  RELEASE_AT_PROGRESS: 0.7,
  THROW_CLIP_SECONDS: 0.55,
  /** Restitution/damping for bouncing devices. */
  BOUNCE_RESTITUTION: 0.38,
  LINEAR_DAMPING: 0.22,
  ANGULAR_DAMPING: 0.4,
  /** Below this impact speed we stop playing bounce sounds. */
  MIN_BOUNCE_SPEED: 1.6,
} as const;

/** Smoke volume behaviour (Document F §6.1). */
export const SMOKE = {
  PUFF_COUNT: 14,
  GROW_SECONDS: 1.5,
  LINGER_SECONDS: 15,
  DISPERSE_SECONDS: 4,
  /** Vision overlay ramps in across the volume boundary, never snaps. */
  VISION_FADE_MARGIN: 2.5,
} as const;

/** Concussion / flash effect tuning (Document F §6.2/§6.3). */
export const DISORIENT = {
  /** Low-pass cutoff at full effect, and the clean value to return to. */
  MUFFLE_CUTOFF_HZ: 380,
  NORMAL_CUTOFF_HZ: 20000,
  /** A flashbang behind cover still registers faintly. */
  OCCLUDED_STRENGTH: 0.12,
  /** Below this the effect is not worth applying at all. */
  MIN_STRENGTH: 0.05,
  /** Flash blind duration scales with strength, within this band. */
  FLASH_MIN_SECONDS: 0.6,
  FLASH_MAX_SECONDS: 4.5,
  /** Extra weapon spread while flashed, in degrees at full strength. */
  FLASH_SPREAD_PENALTY_DEG: 9,
} as const;

/** Minimap / radar HUD (Document I §3.2). */
export const MINIMAP = {
  /** World metres from the player to the edge of the dish. */
  RADIUS_METERS: 60,
  PIXEL_SIZE: 172,
} as const;
