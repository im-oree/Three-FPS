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
import inputContexts from '../core/InputContextStack';
import cameraShake from '../camera/CameraShakeController';
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
  // Document C §6: the camera recoil layer is ADDITIVE-ONLY (render offsets,
  // never sim mutation). Per shot: an impulse into a damped punch spring that
  // settles on the accumulated climb baseline; the baseline itself unwinds
  // after the cease-fire grace period. Ballistics read the FINAL camera
  // transform, so the punched view still steers shots (learnable patterns).
  private pendingKickPitch = 0;
  private pendingKickYaw = 0;
  private pendingKickShots = 0;
  private climbPitch = 0;
  private climbYaw = 0;
  private punchPitch = 0;
  private punchYaw = 0;
  private punchVelPitch = 0;
  private punchVelYaw = 0;
  private jitterPitch = 0;
  private jitterYaw = 0;
  private jitterSeed = Math.random() * 1000;
  private timeSinceKick = Infinity;
  /** 0..1 ADS blend — WeaponManager pushes it; scales the punch (§6.4). */
  private adsWeight = 0;
  // Document C §6 / D §6.5: scope breath sway. Like recoil it is ADDITIVE
  // ONLY — it must never touch the stored sim aim, or it would compound with
  // mouse input and fight the player.
  /**
   * Document 5 §7.4: the user-chosen base FOV. Seeded from SettingsStore so a
   * saved preference applies at boot, and settable live from the menu — the
   * FOV modifier stack resolves against THIS rather than the constant.
   */
  private baseFov: number = settingsStore.get<number>('baseFOV', CAMERA.DEFAULT_FOV);
  private scopeSwayPitch = 0;
  private scopeSwayYaw = 0;
  private clockNow = 0;
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
  /** Live FOV preference from the Settings menu. */
  setBaseFOV(fov: number): void {
    this.baseFov = fov;
  }

  getBaseFOV(): number {
    return this.baseFov;
  }

  /** ScopeSystem pushes its per-frame drift here (additive, never sim). */
  setScopeSway(yaw: number, pitch: number): void {
    this.scopeSwayYaw = yaw;
    this.scopeSwayPitch = pitch;
  }

  /** TEST seam support: drop queued kicks + the whole additive layer. */
  clearRecoil(): void {
    this.scopeSwayPitch = 0;
    this.scopeSwayYaw = 0;
    this.pendingKickPitch = 0;
    this.pendingKickYaw = 0;
    this.pendingKickShots = 0;
    this.climbPitch = 0;
    this.climbYaw = 0;
    this.punchPitch = 0;
    this.punchYaw = 0;
    this.punchVelPitch = 0;
    this.punchVelYaw = 0;
    this.jitterPitch = 0;
    this.jitterYaw = 0;
    this.timeSinceKick = Infinity;
  }

  /**
   * Document C §6: queue a per-shot punch. `pitchDeg/yawDeg` are the RAW
   * pattern step; the camera applies step × RECOIL.CAMERA_RECOIL_RATIO,
   * damped by the current ADS blend. `consecutiveShots` drives the sustained
   * jitter ramp. Purely additive — stored yaw/pitch are never touched.
   */
  applyRecoilKick(pitchDeg: number, yawDeg: number, consecutiveShots = 0): void {
    const damping = 1 + (RECOIL.ADS_RECOIL_DAMPING - 1) * this.adsWeight;
    const punch = RECOIL.CAMERA_RECOIL_RATIO * damping;
    this.pendingKickPitch += degToRad(pitchDeg) * punch;
    this.pendingKickYaw += degToRad(yawDeg) * punch;
    this.pendingKickShots = Math.max(0, consecutiveShots);
  }

  /** WeaponManager feeds the ADS blend so the punch tightens while aiming. */
  setAdsWeight(weight: number): void {
    this.adsWeight = weight;
  }


  /** TEST seam: the live mouse sensitivity (acceptance reads it post-reload). */
  sensitivityForTest(): number {
    return this.sensitivity;
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
    //
    // INPUT CONTEXT GUARD (Document I §6.5): while another system owns input
    // — steering the guided missile, driving the tablet cursor — the camera
    // must NOT consume the mouse delta, or the two fight over it and the
    // missile receives nothing. One guard line; no internals refactored.
    const delta = inputContexts.gameplayOwnsInput
      ? this.input.getMouseDelta()
      : { x: 0, y: 0 };
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
    // 1b) Document C §6 additive recoil layer (NEVER touches sim yaw/pitch):
    // consume queued kicks -> climb baseline + punch-spring impulse; step the
    // punch oscillator toward the baseline; sustain jitter while firing.
    this.timeSinceKick += dt;
    if (this.pendingKickPitch !== 0 || this.pendingKickYaw !== 0) {
      this.climbPitch += this.pendingKickPitch;
      this.climbYaw += this.pendingKickYaw;
      this.punchVelPitch += this.pendingKickPitch * RECOIL.CAMERA_PUNCH_STIFFNESS * 0.06;
      this.punchVelYaw += this.pendingKickYaw * RECOIL.CAMERA_PUNCH_STIFFNESS * 0.06;
      this.pendingKickPitch = 0;
      this.pendingKickYaw = 0;
      this.timeSinceKick = 0;
    }
    // punch spring toward zero offset from the climb baseline (implicit in the
    // composition: offset = climb + punch, so the spring target is 0 punch).
    // Explicit Euler with stiffness 260 is unstable past dt≈0.12 s (headless
    // 8 fps frames) — integrate in ≤8 ms substeps and hard-clamp the offset.
    const stiff = RECOIL.CAMERA_PUNCH_STIFFNESS;
    const dampC = RECOIL.CAMERA_PUNCH_DAMPING;
    const sub = Math.min(16, Math.max(1, Math.ceil(dt / 0.008)));
    const h = dt / sub;
    for (let i = 0; i < sub; i += 1) {
      this.punchVelPitch += (-stiff * this.punchPitch - dampC * this.punchVelPitch) * h;
      this.punchVelYaw += (-stiff * this.punchYaw - dampC * this.punchVelYaw) * h;
      this.punchPitch += this.punchVelPitch * h;
      this.punchYaw += this.punchVelYaw * h;
    }
    if (this.punchPitch > 0.6) { this.punchPitch = 0.6; this.punchVelPitch = Math.min(0, this.punchVelPitch); }
    if (this.punchPitch < -0.6) { this.punchPitch = -0.6; this.punchVelPitch = Math.max(0, this.punchVelPitch); }
    this.punchYaw = THREE.MathUtils.clamp(this.punchYaw, -0.6, 0.6);
    if (this.timeSinceKick > WEAPON.PATTERN_RESET_GRACE_SECONDS) {
      const decay = Math.exp(-dt * RECOIL.CAMERA_CLIMB_RECOVER);
      this.climbPitch *= decay;
      this.climbYaw *= decay;
      // sustained jitter decays INSTANTLY on cease (§6.2) — no tail.
      this.jitterPitch = 0;
      this.jitterYaw = 0;
    } else if (RECOIL.CAMERA_JITTER_RAMP_SHOTS > 0) {
      const ramp = Math.min(1, this.pendingKickShots / RECOIL.CAMERA_JITTER_RAMP_SHOTS) * RECOIL.CAMERA_JITTER_MAX_RAD;
      const t = this.jitterSeed + this.clockNow;
      const targetY = (Math.sin(t * 13.7) + Math.sin(t * 7.3) * 0.6) * ramp;
      const targetP = (Math.sin(t * 11.1 + 1.7) + Math.sin(t * 5.9) * 0.6) * ramp * 0.6;
      const k = Math.min(1, dt * RECOIL.CAMERA_JITTER_SMOOTH);
      this.jitterYaw = lerp(this.jitterYaw, targetY, k);
      this.jitterPitch = lerp(this.jitterPitch, targetP, k);
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
    // Document E §1: the trauma engine composes at the SAME additive seam as
    // the legacy impulse shakes, head-bob, landing dip and recoil. One more
    // contributor to the existing "sum everything, apply once" step — no new
    // composition code.
    cameraShake.update(dt);
    shakeX += cameraShake.output.position.x;
    shakeY += cameraShake.output.position.y;
    shakeRoll += cameraShake.output.rotation.z;
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
    // Orientation: yaw -> pitch -> roll ('YXZ', COORDINATE_CONVENTIONS.md).
    // The additive recoil layer (climb + punch + jitter) composes AFTER the
    // look angles; sim state stays pristine for physics and networking.
    const recoilOn = RECOIL.CAMERA_ENABLED;
    this.clockNow += dt;
    const camPitch = sim.pitch
      + (recoilOn ? this.climbPitch + this.punchPitch + this.jitterPitch : 0)
      + this.scopeSwayPitch
      + cameraShake.output.rotation.x;
    const camYaw = sim.yaw
      + (recoilOn ? this.climbYaw + this.punchYaw + this.jitterYaw : 0)
      + this.scopeSwayYaw
      + cameraShake.output.rotation.y;
    this.camera.rotation.set(camPitch, camYaw, this.slideTiltRad + shakeRoll, 'YXZ');

    // 3) FOV: highest-priority active modifier wins; smooth blend, never snap.
    let target: number = this.baseFov;
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
