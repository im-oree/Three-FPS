/**
 * PlayerCamera.ts — owns first-person camera FEEL (Document 2 §8).
 *
 * Receives (never constructs) the single PerspectiveCamera from SceneManager.
 * Each render frame it:
 *   1. consumes raw mouse delta -> adds into the SIMULATION's yaw/pitch
 *      (pitch clamped to ±MOUSE.MAX_PITCH_DEG; sensitivity + invert-Y read from
 *      SettingsStore so Document 5's sliders work with zero changes here),
 *   2. applies the simulation pose to the camera,
 *   3. layers purely cosmetic additive offsets in order: head bob, landing
 *      dip, slide tilt, shake — each isolated so Document 3 can add recoil /
 *      ADS layers without touching this file's internals.
 *
 * Generic APIs finalised here for later documents:
 *   applyFOVModifier(id, targetFOV, lerpSpeed, priority?) / clearFOVModifier(id)
 *   shake(intensity, duration)
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import settingsStore from '../core/SettingsStore';
import type { InputManager } from '../core/InputManager';
import { CAMERA, CAMERA_FEEL, LANDING, MOUSE, PLAYER, RECOIL, SETTINGS_KEYS, WEAPON } from '../utils/Constants';
import { clamp, degToRad, lerp } from '../utils/MathUtils';
import type { PlayerSimState } from './PlayerMovement';

interface FovModifier {
  targetFOV: number;
  lerpSpeed: number;
  priority: number;
}

interface ShakeInstance {
  intensity: number;
  duration: number;
  elapsed: number;
}

export interface CameraVisuals {
  bob: { x: number; y: number; z: number };
  slideTiltDeg: number;
  /**
   * Render-interpolated position between fixed-step snapshots. Omitted means
   * sim.position. Presentation-only: orientation/recoil still read and MUTATE
   * the authoritative sim, so physics and aim stay exact at render rate.
   */
  position?: THREE.Vector3;
}

export class PlayerCamera {
  private sensitivity: number;
  private invertY: boolean;
  private readonly fovModifiers = new Map<string, FovModifier>();
  private readonly shakes: ShakeInstance[] = [];
  private slideTiltRad = 0;
  private landingDip = 0;
  // Recoil (Document 3 §10.2): directional punch-then-spring-back, distinct
  // from the generic random-tremor shake(). Kicks move the TRUE simulation
  // aim (so patterns are learnable and affect hit registration), accumulate
  // here, and unwind smoothly once firing stops.
  private recoilPitch = 0;
  private recoilYaw = 0;
  private pendingKickPitch = 0;
  private pendingKickYaw = 0;
  private timeSinceKick = Infinity;
  /** Raw look delta consumed this frame (read-only mirror for WeaponSway). */
  readonly lastMouseDelta: { x: number; y: number } = { x: 0, y: 0 };
  private readonly unsubscribeLanded: () => void;

  /** Document 3: BallisticsSystem rays must leave from the FINAL camera
   *  transform (recoil/bob/shake included), so the wrapped camera is exposed. */
  get threeCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
  ) {
    this.sensitivity = settingsStore.get<number>(SETTINGS_KEYS.MOUSE_SENSITIVITY, MOUSE.DEFAULT_SENSITIVITY);
    this.invertY = settingsStore.get<boolean>(SETTINGS_KEYS.INVERT_Y, MOUSE.DEFAULT_INVERT_Y);
    // Re-read settings whenever the player re-engages (covers manual
    // localStorage edits between sessions and Doc 5's future settings UI).
    eventBus.on('input:pointerlock:acquired', () => this.refreshSettings());
    this.unsubscribeLanded = eventBus.on<{ impactVelocity: number }>('player:landed', ({ impactVelocity }) => {
      if (impactVelocity < LANDING.HARD_LANDING_VELOCITY_THRESHOLD) return;
      this.landingDip = Math.min(LANDING.CAMERA_DIP_METERS, impactVelocity * 0.012);
    });
  }

  /**
   * Document 3 recoil contract: directional camera kick consumed per shot.
   * Distinct from shake() — recoil punches the true aim and springs back to
   * center after firing stops; shake() is nondirectional tremor for impacts.
   */
  /** TEST seam support: drop queued kicks + spring-back accumulator. */
  clearRecoil(): void {
    this.pendingKickPitch = 0;
    this.pendingKickYaw = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.timeSinceKick = Infinity;
  }

  applyRecoilKick(pitchDeg: number, yawDeg: number): void {
    this.pendingKickPitch += degToRad(pitchDeg);
    this.pendingKickYaw += degToRad(yawDeg);
  }


  refreshSettings(): void {
    this.sensitivity = settingsStore.get<number>(SETTINGS_KEYS.MOUSE_SENSITIVITY, MOUSE.DEFAULT_SENSITIVITY);
    this.invertY = settingsStore.get<boolean>(SETTINGS_KEYS.INVERT_Y, MOUSE.DEFAULT_INVERT_Y);
  }

  // --- generic FOV modifier stack (sprint now, ADS in Document 3) -------------
  applyFOVModifier(id: string, targetFOV: number, lerpSpeed: number, priority = 50): void {
    this.fovModifiers.set(id, { targetFOV, lerpSpeed, priority });
  }

  clearFOVModifier(id: string): void {
    this.fovModifiers.delete(id);
  }

  /** Decaying random-offset shake — Document 3 recoil/damage will call this. */
  shake(intensity: number, duration: number): void {
    this.shakes.push({ intensity, duration, elapsed: 0 });
  }

  /** Per-render-frame visual update (called once per frame, NOT fixed-step). */
  update(dt: number, sim: PlayerSimState, visuals: CameraVisuals): void {
    // 1) look: raw delta -> simulation yaw/pitch (instant, frame-rate smooth).
    const delta = this.input.getMouseDelta();
    // Document 3: WeaponSway needs the same per-frame delta; InputManager's
    // getter consumes, so mirror it here after PlayerCamera has read it.
    this.lastMouseDelta.x = delta.x;
    this.lastMouseDelta.y = delta.y;
    sim.yaw -= delta.x * this.sensitivity;
    sim.pitch = clamp(
      sim.pitch - delta.y * this.sensitivity * (this.invertY ? -1 : 1),
      -degToRad(MOUSE.MAX_PITCH_DEG),
      degToRad(MOUSE.MAX_PITCH_DEG),
    );

    // 2) cosmetic offsets.
    this.landingDip *= Math.exp(-dt * (3 / LANDING.CAMERA_DIP_RECOVER_SECONDS));
    // 1b) recoil: apply queued kick to true aim, or spring accumulated recoil
    // back toward zero after the grace period (ride-out-then-settle feel).
    this.timeSinceKick += dt;
    if (this.pendingKickPitch !== 0 || this.pendingKickYaw !== 0) {
      sim.pitch += this.pendingKickPitch;
      sim.yaw += this.pendingKickYaw;
      this.recoilPitch += this.pendingKickPitch;
      this.recoilYaw += this.pendingKickYaw;
      this.pendingKickPitch = 0;
      this.pendingKickYaw = 0;
      this.timeSinceKick = 0;
      sim.pitch = clamp(sim.pitch, -degToRad(MOUSE.MAX_PITCH_DEG), degToRad(MOUSE.MAX_PITCH_DEG));
    } else if (this.timeSinceKick > WEAPON.PATTERN_RESET_GRACE_SECONDS && (this.recoilPitch !== 0 || this.recoilYaw !== 0)) {
      const f = Math.min(1, dt * RECOIL.RECOVERY_SPEED);
      sim.pitch -= this.recoilPitch * f;
      sim.yaw -= this.recoilYaw * f;
      this.recoilPitch *= 1 - f;
      this.recoilYaw *= 1 - f;
      if (Math.abs(this.recoilPitch) < 1e-5) this.recoilPitch = 0;
      if (Math.abs(this.recoilYaw) < 1e-5) this.recoilYaw = 0;
    }

    this.slideTiltRad = lerp(this.slideTiltRad, degToRad(visuals.slideTiltDeg), Math.min(1, dt * CAMERA_FEEL.SLIDE_TILT_LERP_SPEED));
    for (let i = this.shakes.length - 1; i >= 0; i -= 1) {
      this.shakes[i].elapsed += dt;
      if (this.shakes[i].elapsed >= this.shakes[i].duration) this.shakes.splice(i, 1);
    }

    const sin = Math.sin(sim.yaw);
    const cos = Math.cos(sim.yaw);
    const right = new THREE.Vector3(cos, 0, -sin);
    const pos = visuals.position ?? sim.position;
    const eyeHeight = pos.y + sim.capsuleHeight - CAMERA_EYE_OFFSET;
    let shakeX = 0;
    let shakeY = 0;
    let shakeRoll = 0;
    for (const s of this.shakes) {
      const remaining = 1 - s.elapsed / s.duration;
      const decay = Math.pow(remaining, CAMERA_FEEL.SHAKE_DECAY_EXPONENT);
      shakeX += (Math.random() * 2 - 1) * s.intensity * decay;
      shakeY += (Math.random() * 2 - 1) * s.intensity * decay;
      shakeRoll += (Math.random() * 2 - 1) * s.intensity * decay * 0.5;
    }

    this.camera.position.set(
      pos.x + right.x * (visuals.bob.x + shakeX),
      eyeHeight + visuals.bob.y - this.landingDip + shakeY,
      pos.z + right.z * (visuals.bob.x + shakeX),
    );
    this.camera.rotation.set(sim.pitch, sim.yaw, this.slideTiltRad + shakeRoll);

    // 3) FOV: highest-priority active modifier wins; smooth blend, never snap.
    let target: number = CAMERA.DEFAULT_FOV;
    let speed: number = CAMERA_FEEL.SPRINT_FOV_LERP_SPEED;
    let bestPriority = -1;
    for (const modifier of this.fovModifiers.values()) {
      if (modifier.priority > bestPriority) {
        bestPriority = modifier.priority;
        target = modifier.targetFOV;
        speed = modifier.lerpSpeed;
      }
    }
    if (Math.abs(this.camera.fov - target) > 1e-3) {
      // Frame-rate-independent exponential approach (1 - e^(-speed·dt)): at
      // low/headless frame rates the old min(1, dt·speed) factor snapped to
      // 1 and popped the FOV in a single frame.
      const k = 1 - Math.exp(-speed * dt);
      this.camera.fov = lerp(this.camera.fov, target, k);
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.unsubscribeLanded();
  }
}

const CAMERA_EYE_OFFSET = PLAYER.EYE_OFFSET_FROM_TOP;

export default PlayerCamera;
