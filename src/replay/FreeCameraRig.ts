/**
 * FreeCameraRig.ts — fly the camera anywhere in a recorded world.
 *
 * A director camera, not a player camera. It has no collision, no gravity and
 * no stamina: it goes through walls on purpose, because the shot you want is
 * frequently from inside one. The live game's camera must never behave this
 * way, which is why this is a separate rig rather than a mode on the player's.
 *
 * IT OWNS ITS OWN KEYS
 * --------------------
 * The game's InputManager maps ACTIONS ("fire", "jump"), which is right for
 * gameplay and wrong here: a replay theatre needs raw WASD plus number keys
 * for camera slots, and binding those as game actions would make them
 * reachable during play. So this listens directly while it is enabled, and
 * detaches completely when it is not.
 *
 * Bindings, from the spec:
 *   WASD          move
 *   Space / Ctrl  up / down
 *   Shift         faster
 *   Mouse drag    look
 *   Wheel         adjust speed
 *   Tab           cycle which player to watch
 *   1-9           jump to a saved camera position
 *   Home          reset
 */
import * as THREE from 'three';

export interface FreeCameraState {
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly speed: number;
}

const SPEED = {
  BASE: 12,
  MIN: 1.5,
  MAX: 90,
  /** Multiplier while shift is held. */
  BOOST: 3.2,
  /** Wheel notches change speed multiplicatively, so it feels even at both ends. */
  WHEEL_STEP: 1.18,
} as const;

/** Just under a right angle, so the camera can never flip over the top. */
const PITCH_LIMIT = Math.PI / 2 - 0.02;
const LOOK_SENSITIVITY = 0.0026;

export class FreeCameraRig {
  private readonly position = new THREE.Vector3(0, 6, 12);
  private yaw = 0;
  private pitch = -0.25;
  private speed: number = SPEED.BASE;

  private readonly held = new Set<string>();
  private dragging = false;
  private enabled = false;
  private element: HTMLElement | null = null;

  /** Saved camera positions, addressed by the 1-9 keys. */
  private readonly slots = new Map<number, FreeCameraState>();
  private home: FreeCameraState | null = null;

  /** Raised when Tab is pressed, so the host can cycle its follow target. */
  onCycleTarget: (() => void) | null = null;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;

    // Number keys address camera slots. Shift+N stores, N recalls: two
    // bindings on one key because a director has no spare hand.
    if (/^Digit[1-9]$/.test(event.code)) {
      const slot = Number(event.code.slice(5));
      if (event.shiftKey) this.store(slot); else this.recall(slot);
      event.preventDefault();
      return;
    }
    if (event.code === 'Home') { this.reset(); event.preventDefault(); return; }
    if (event.code === 'Tab') {
      this.onCycleTarget?.();
      // Tab moves focus by default, which would take the keyboard away from
      // the theatre entirely.
      event.preventDefault();
      return;
    }

    this.held.add(event.code);
    // Space scrolls the page; the arrow keys scroll the timeline's container.
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled || event.button !== 0) return;
    this.dragging = true;
  };

  private readonly onMouseUp = (): void => { this.dragging = false; };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.dragging) return;
    this.yaw -= event.movementX * LOOK_SENSITIVITY;
    this.pitch = Math.max(
      -PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - event.movementY * LOOK_SENSITIVITY),
    );
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    const factor = event.deltaY < 0 ? SPEED.WHEEL_STEP : 1 / SPEED.WHEEL_STEP;
    this.speed = Math.max(SPEED.MIN, Math.min(SPEED.MAX, this.speed * factor));
    event.preventDefault();
  };

  /**
   * Start listening.
   *
   * Key events go on the window because the theatre's canvas is not
   * focusable, but mouse events go on the given element so dragging a
   * timeline scrubber does not also swing the camera.
   */
  attach(element: HTMLElement): void {
    if (this.element) this.detach();
    this.element = element;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    element.addEventListener('mousedown', this.onMouseDown);
    element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.element?.removeEventListener('mousedown', this.onMouseDown);
    this.element?.removeEventListener('wheel', this.onWheel);
    this.element = null;
    this.held.clear();
    this.dragging = false;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) { this.held.clear(); this.dragging = false; }
  }

  get isEnabled(): boolean { return this.enabled; }

  /** Drop the camera somewhere and look at something. */
  placeAt(position: THREE.Vector3, lookAt?: THREE.Vector3): void {
    this.position.copy(position);
    if (lookAt) {
      const dx = lookAt.x - position.x;
      const dy = lookAt.y - position.y;
      const dz = lookAt.z - position.z;
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT,
        Math.atan2(dy, Math.hypot(dx, dz))));
    }
    if (!this.home) this.home = this.state();
  }

  /** Remember this position as Home. */
  markHome(): void { this.home = this.state(); }

  store(slot: number): void { this.slots.set(slot, this.state()); }

  recall(slot: number): boolean {
    const saved = this.slots.get(slot);
    if (!saved) return false;
    this.applyState(saved);
    return true;
  }

  get savedSlots(): readonly number[] { return [...this.slots.keys()].sort((a, b) => a - b); }

  reset(): void { if (this.home) this.applyState(this.home); }

  private applyState(state: FreeCameraState): void {
    this.position.copy(state.position);
    this.yaw = state.yaw;
    this.pitch = state.pitch;
    this.speed = state.speed;
  }

  state(): FreeCameraState {
    return {
      position: this.position.clone(),
      yaw: this.yaw,
      pitch: this.pitch,
      speed: this.speed,
    };
  }

  /**
   * Move for one frame.
   *
   * `dt` is REAL time, deliberately: the camera must keep responding at the
   * same rate when playback is paused or running at 0.25x. A director
   * scrubbing frame by frame still needs to fly around.
   */
  update(dt: number): void {
    if (!this.enabled) return;

    let forward = 0;
    let strafe = 0;
    let lift = 0;
    if (this.held.has('KeyW')) forward += 1;
    if (this.held.has('KeyS')) forward -= 1;
    if (this.held.has('KeyD')) strafe += 1;
    if (this.held.has('KeyA')) strafe -= 1;
    if (this.held.has('Space')) lift += 1;
    if (this.held.has('ControlLeft') || this.held.has('ControlRight')) lift -= 1;

    if (forward === 0 && strafe === 0 && lift === 0) return;

    const boost = (this.held.has('ShiftLeft') || this.held.has('ShiftRight'))
      ? SPEED.BOOST : 1;
    const distance = this.speed * boost * dt;

    // Movement follows the LOOK direction including pitch, so flying toward
    // something you are looking down at actually descends -- the alternative
    // (ground-plane movement) means constantly fighting the up/down keys.
    const cosPitch = Math.cos(this.pitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Normalise so diagonal movement is not faster than straight.
    const move = new THREE.Vector3()
      .addScaledVector(dir, forward)
      .addScaledVector(right, strafe);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(distance);
    move.y += lift * distance;

    this.position.add(move);
  }

  /** Where to put the camera and what to point it at, this frame. */
  composition(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    const cosPitch = Math.cos(this.pitch);
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );
    return {
      position: this.position.clone(),
      lookAt: this.position.clone().add(forward.multiplyScalar(10)),
    };
  }
}

export default FreeCameraRig;
