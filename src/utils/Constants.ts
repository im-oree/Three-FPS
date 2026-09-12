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
  crouch: 'ControlLeft',
  reload: 'KeyR',
  fire: 'Mouse0',
  ads: 'Mouse2',
  debugToggle: 'F3',
  pause: 'Escape',
} as const;

/** Shape of the rebindable binding map (action name -> code). */
export type KeyBindingMap = Record<string, string>;

// TEMPORARY — pipeline verification only (Document 1, Section 6.2).
// Remove/replace in Document 2 (movement testing arena) and Document 4 (levels).
export const TEMP_SCENE = {
  AMBIENT_COLOR: 0x404050,
  AMBIENT_INTENSITY: 0.4,
  SUN_COLOR: 0xfff2e0,
  SUN_INTENSITY: 1.3,
  SUN_POSITION: { x: 10, y: 20, z: 10 },
  SHADOW_MAP_SIZE: 2048,
  /** Tight shadow-camera frustum fitted to the ~20x20 unit test area. */
  SHADOW_BOUNDS: { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 },
  GROUND_SIZE: 50,
  GROUND_COLOR: 0x8a8a8a,
  CUBE_SIZE: 1,
  CUBE_HEIGHT: 1.5,
  CUBE_COLOR: 0xb4552d,
  /** Radians per second of cube yaw/pitch — driven through delta time. */
  CUBE_SPIN_RAD_PER_SEC: 0.9,
} as const;
