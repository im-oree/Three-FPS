/**
 * PlayerController.ts — top-level player orchestrator (Document 2 §12).
 *
 * The ONLY /player file main.ts constructs. Registered via
 * engine.registerUpdatable(). Each update():
 *   - runs the fixed-timestep simulation (input snapshot -> PlayerState
 *     resolveNextState -> PlayerMovement physics -> stamina -> footsteps ->
 *     head bob),
 *   - then, once per render frame, runs PlayerCamera's visual update so look
 *     responsiveness is instant and frame-rate-smooth while physics stays
 *     deterministic.
 *
 * Pointer lock: TEMPORARY one-time canvas click listener below — Document 5's
 * "click to play" flow formally owns this later.
 */
import * as THREE from 'three';
import type Clock from '../core/Clock';
import type { InputManager } from '../core/InputManager';
import type { SceneManager } from '../core/SceneManager';
import settingsStore from '../core/SettingsStore';
import { CAMERA_FEEL, CLOCK, PLAYER, SETTINGS_KEYS, SLIDE, SPRINT } from '../utils/Constants';
import { degToRad } from '../utils/MathUtils';
import FootstepSystem from './FootstepSystem';
import HeadBob, { type BobGait } from './HeadBob';
import PlayerCamera from './PlayerCamera';
import type PlayerCollider from './PlayerCollider';
import PlayerMovement from './PlayerMovement';
import { PlayerState, resolveNextState, type InputSnapshot, type PhysicsSnapshot, type PlayerStateValue } from './PlayerState';
import StaminaSystem from './StaminaSystem';
import eventBus from '../core/EventBus';

export class PlayerController {
  readonly movement: PlayerMovement;
  readonly camera: PlayerCamera;
  readonly stamina = new StaminaSystem();
  /** Document 3 wires this via weapon:adsStart/adsStop events (see §6.3). */
  private adsActive = false;
  private adsSpeedMultiplier = 1;

  private readonly headBob = new HeadBob();
  private readonly footstep = new FootstepSystem();
  private readonly collider: PlayerCollider;
  private readonly canvas: HTMLCanvasElement;

  private state: PlayerStateValue = PlayerState.IDLE;

  // --- render-side interpolation of the fixed-step simulation --------------
  // The simulation (movement, bob phase, footsteps) advances at CLOCK.FIXED_DT
  // (60 Hz). On 120-144 Hz displays, feeding the camera the raw 60 Hz samples
  // stair-steps the world flow and reads as a fast slight vibration while a
  // gait is active. The camera instead renders a visual state interpolated
  // between the previous and current fixed-step snapshots with the clock's
  // accumulator alpha. Physics, events and audio stay on the fixed step —
  // this is presentation-only, and the bob phase itself remains strictly
  // stride-locked (Document 2 feel fix), only its DISPLAY is smoothed.
  private readonly prevVisualPos = new THREE.Vector3();
  private readonly currVisualPos = new THREE.Vector3();
  private readonly prevVisualBob = { x: 0, y: 0, z: 0 };
  private readonly currVisualBob = { x: 0, y: 0, z: 0 };
  private readonly renderPos = new THREE.Vector3();
  private readonly renderBob = { x: 0, y: 0, z: 0 };
  private visualSnapshotsInit = false;

  /** Document 3: AnimationStateMachine reads the movement state from here. */
  get currentState(): PlayerStateValue {
    return this.state;
  }
  private timeInState = 0;
  private previousCrouchDown = false;
  private previousJumpDown = false;
  private previousSprinting = false;
  private crouchLatched = false; // toggle-mode crouch (SettingsStore flag)

  /** TEMPORARY placeholder for Document 5's click-to-play flow. */
  private readonly onFirstClick = (): void => {
    this.input.requestPointerLock(this.canvas);
    this.canvas.removeEventListener('click', this.onFirstClick);
  };

  constructor(
    private readonly clock: Clock,
    private readonly input: InputManager,
    sceneManager: SceneManager,
    collider: PlayerCollider,
    canvas: HTMLCanvasElement,
  ) {
    this.collider = collider;
    this.canvas = canvas;
    this.movement = new PlayerMovement(collider);
    this.camera = new PlayerCamera(sceneManager.getCamera(), input);
    this.prevVisualPos.copy(this.movement.state.position);
    this.currVisualPos.copy(this.movement.state.position);
    this.canvas.addEventListener('click', this.onFirstClick);
    // Document 3 ADS wiring: the weapons layer owns ADS state; the player
    // layer only reacts (sprint gating + move-speed multiplier).
    eventBus.on('weapon:adsStart', (payload: { moveSpeedMultiplier?: number }) => {
      this.adsActive = true;
      this.adsSpeedMultiplier = payload?.moveSpeedMultiplier ?? 1;
    });
    eventBus.on('weapon:adsStop', () => {
      this.adsActive = false;
      this.adsSpeedMultiplier = 1;
    });
  }

  // --- read-only seams future systems (Doc 3 spread, HUD, AI) need -----------
  getPosition(): THREE.Vector3 {
    return this.movement.state.position;
  }

  getState(): PlayerStateValue {
    return this.state;
  }

  isGrounded(): boolean {
    return this.movement.state.isGrounded;
  }

  getStaminaValue(): number {
    return this.stamina.getCurrentValue();
  }

  getPitch(): number {
    return this.movement.state.pitch;
  }

  getYaw(): number {
    return this.movement.state.yaw;
  }

  isSliding(): boolean {
    return this.movement.slideActive;
  }

  get isADSActive(): boolean {
    return this.adsActive;
  }

  getAdsMoveSpeedMultiplier(): number {
    return this.adsSpeedMultiplier;
  }

  getHorizontalSpeed(): number {
    return this.movement.horizontalSpeed();
  }

  getCapsuleHeight(): number {
    return this.movement.state.capsuleHeight;
  }

  getVelocityY(): number {
    return this.movement.state.velocity.y;
  }

  /**
   * TEST-ONLY seam for the headless acceptance harness: relocate the capsule
   * and zero its velocity. Not used by any gameplay path.
   */
  debugTeleport(x: number, y: number, z: number): void {
    this.movement.state.position.set(x, y, z);
    this.movement.state.velocity.set(0, 0, 0);
    this.prevVisualPos.set(x, y, z);
    this.currVisualPos.set(x, y, z);
  }

  /** TEST-ONLY seam: set stamina directly for deterministic acceptance runs. */
  debugSetStamina(value: number): void {
    this.stamina.debugSet(value);
  }

  /** TEST-ONLY seam: reset look orientation for deterministic acceptance runs. */
  debugSetOrientation(yaw: number, pitch: number): void {
    // TEST seam: a deterministic aim reset also drops queued recoil kicks and
    // the spring-back accumulator, otherwise recovery steers the aim after
    // the reset (acceptance-harness determinism, Document 3).
    this.camera.clearRecoil();
    this.movement.state.yaw = yaw;
    this.movement.state.pitch = pitch;
  }

  update(dt: number): void {
    this.clock.stepFixed(CLOCK.FIXED_DT, (fixedDt) => {
      this.prevVisualPos.copy(this.currVisualPos);
      this.prevVisualBob.x = this.currVisualBob.x;
      this.prevVisualBob.y = this.currVisualBob.y;
      this.prevVisualBob.z = this.currVisualBob.z;
      this.fixedStep(fixedDt);
      this.currVisualPos.copy(this.movement.state.position);
      this.currVisualBob.x = this.headBob.offset.x;
      this.currVisualBob.y = this.headBob.offset.y;
      this.currVisualBob.z = this.headBob.offset.z;
      this.visualSnapshotsInit = true;
    });
    if (!this.visualSnapshotsInit) {
      this.currVisualPos.copy(this.movement.state.position);
    }
    const alpha = this.clock.getFixedAlpha(CLOCK.FIXED_DT);
    this.renderPos.lerpVectors(this.prevVisualPos, this.currVisualPos, alpha);
    this.renderBob.x = this.prevVisualBob.x + (this.currVisualBob.x - this.prevVisualBob.x) * alpha;
    this.renderBob.y = this.prevVisualBob.y + (this.currVisualBob.y - this.prevVisualBob.y) * alpha;
    this.renderBob.z = this.prevVisualBob.z + (this.currVisualBob.z - this.prevVisualBob.z) * alpha;

    // The camera keeps mutating the AUTHORITATIVE sim (yaw/pitch/recoil are
    // render-rate exact); only the position feed is interpolated.
    this.camera.update(dt, this.movement.state, {
      bob: this.renderBob,
      position: this.renderPos,
      slideTiltDeg: this.state === PlayerState.SLIDE ? SLIDE.CAMERA_TILT_DEG : 0,
    });
  }

  /** Interpolation alpha (TEST seam: proves the smooth path is live). */
  getInterpolationAlpha(): number {
    return this.clock.getFixedAlpha(CLOCK.FIXED_DT);
  }

  // --- fixed-timestep simulation step ----------------------------------------
  private fixedStep(dt: number): void {
    const snapshot = this.gatherSnapshot();
    const physics = this.gatherPhysicsSnapshot();
    const next = resolveNextState(this.state, snapshot, physics);
    if (next !== this.state) {
      this.state = next;
      this.timeInState = 0;
    } else {
      this.timeInState += dt;
    }

    const slideTriggered = this.state === PlayerState.SLIDE && !this.movement.slideActive;
    this.movement.step(dt, {
      moveLocal: this.moveLocal(),
      state: this.state,
      sprintActive: this.state === PlayerState.SPRINT,
      crouchActive: snapshot.crouchHeld,
      jumpQueued: snapshot.jumpPressedThisFrame,
      slideTriggered,
      adsSpeedMultiplier: this.adsSpeedMultiplier,
      canStandUp: () => this.hasHeadroom(),
    });

    const draining = this.state === PlayerState.SPRINT || this.movement.slideActive;
    this.stamina.update(dt, draining);
    const gait = this.currentGait();
    this.footstep.update(dt, this.movement.horizontalSpeed(), this.movement.state.isGrounded, gait);
    this.headBob.update(dt, this.movement.horizontalSpeed(), this.movement.state.isGrounded, gait, true);

    // Sprint FOV through the generic modifier stack (Doc 3 ADS adds its own).
    const sprinting = this.state === PlayerState.SPRINT;
    if (sprinting && !this.previousSprinting) {
      this.camera.applyFOVModifier('sprint', CAMERA_FEEL.SPRINT_FOV, CAMERA_FEEL.SPRINT_FOV_LERP_SPEED, 50);
    } else if (!sprinting && this.previousSprinting) {
      this.camera.clearFOVModifier('sprint');
    }
    this.previousSprinting = sprinting;

    this.previousCrouchDown = this.input.isActionDown('crouch');
    this.previousJumpDown = this.input.isActionDown('jump');
  }

  private gatherSnapshot(): InputSnapshot {
    const crouchDown = this.input.isActionDown('crouch');
    const jumpDown = this.input.isActionDown('jump');
    const crouchPressed = crouchDown && !this.previousCrouchDown;
    // Hold-vs-toggle crouch: underlying support now (Doc 5 wires the setting UI).
    const toggleMode = settingsStore.get<boolean>(SETTINGS_KEYS.CROUCH_TOGGLE, false);
    if (toggleMode && crouchPressed) this.crouchLatched = !this.crouchLatched;
    const crouchHeld = toggleMode ? this.crouchLatched : crouchDown;

    const move = this.moveLocal();
    const forwardness = move.lengthSq() > 0 ? move.y / move.length() : 0;
    const angleOk = move.lengthSq() === 0 || forwardness >= Math.cos(degToRad(SPRINT.MAX_INPUT_ANGLE_DEG));
    return {
      hasMoveInput: move.lengthSq() > 0,
      sprintHeld: this.input.isActionDown('sprint'),
      sprintEligible:
        this.stamina.hasStamina() && !this.isADSActive && angleOk && this.movement.state.isGrounded,
      crouchHeld,
      crouchPressedThisFrame: crouchPressed,
      jumpPressedThisFrame: jumpDown && !this.previousJumpDown,
    };
  }

  private gatherPhysicsSnapshot(): PhysicsSnapshot {
    return {
      isGrounded: this.movement.state.isGrounded,
      justLanded: this.movement.consumeJustLanded(),
      horizontalSpeed: this.movement.horizontalSpeed(),
      verticalVelocity: this.movement.state.velocity.y,
      timeInState: this.timeInState,
      slideActive: this.movement.slideActive,
      coyoteActive: this.movement.coyoteActive,
    };
  }

  /** Normalized local input: +y forward (W), +x right (D). Pitch ignored. */
  private moveLocal(): THREE.Vector2 {
    const x = (this.input.isActionDown('moveRight') ? 1 : 0) - (this.input.isActionDown('moveLeft') ? 1 : 0);
    const y = (this.input.isActionDown('moveForward') ? 1 : 0) - (this.input.isActionDown('moveBackward') ? 1 : 0);
    const vec = new THREE.Vector2(x, y);
    if (vec.lengthSq() > 1) vec.normalize();
    return vec;
  }

  /** Stand-up headroom check (§6.5): upward probe from the current head. */
  private hasHeadroom(): boolean {
    const sim = this.movement.state;
    const head = sim.position.clone().add(new THREE.Vector3(0, sim.capsuleHeight, 0));
    const needed = PLAYER.STAND_HEIGHT - sim.capsuleHeight + 0.05;
    return this.collider.raycastUp(head, needed) === null;
  }

  private currentGait(): BobGait {
    if (!this.movement.state.isGrounded) return 'NONE';
    switch (this.state) {
      case PlayerState.SPRINT:
      case PlayerState.SLIDE:
        return 'SPRINT';
      case PlayerState.CROUCH_IDLE:
      case PlayerState.CROUCH_WALK:
        return 'CROUCH';
      case PlayerState.IDLE:
      case PlayerState.LANDING:
        return this.movement.horizontalSpeed() > 0.4 ? 'WALK' : 'NONE';
      default:
        return 'WALK';
    }
  }
}

export default PlayerController;
