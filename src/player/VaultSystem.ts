/**
 * VaultSystem.ts — Vaulting / Mantling (FPS/TPS Spec §2).
 *
 * Trigger: a forward obstruction raycast finds geometry below head height and
 * above knee height while the player is moving forward.
 *
 * The Traversal Loop, implemented exactly as specified:
 *   Raycast 1 (Forward Obstacle)  → distance to the wall
 *   Raycast 2 (Height Finder)     → fired DOWN from above the wall to find the
 *                                   exact ledge height
 *   Raycast 3 (Landing Clearance) → refuses ledges with no space to land on
 *   Hand Placement IK             → hands ride the ledge lip (exposed as world
 *                                   targets; the rigs consume them)
 *   Lerp Control                  → player physics suspended; the capsule is
 *                                   driven along a pre-calculated quadratic
 *                                   Bezier (start → apex over the lip → landing
 *                                   pad). Physics restored on curve completion.
 *
 * This module owns NO collision geometry of its own: it probes through the
 * same query surface PlayerMovement uses, so it is automatically correct for
 * whatever CollisionWorld is active.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { PLAYER, VAULT } from '../utils/Constants';

export interface VaultProbes {
  /** Ray from `origin` along `dir`; returns distance to the first hit. */
  ray: (origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number) => number | null;
}

export interface VaultTriggerInput {
  /** Feet position (authoritative sim). */
  position: THREE.Vector3;
  /** Facing yaw used for the forward probe. */
  yaw: number;
  /** World-space horizontal velocity. */
  velocity: THREE.Vector3;
  isGrounded: boolean;
  capsuleHeight: number;
  /** Forward movement input present this frame (no accidental vaults). */
  forwardInput: boolean;
}

export interface VaultState {
  active: boolean;
  /** 0..1 progress along the Bezier. */
  progress: number;
  /** Current capsule position along the curve. */
  position: THREE.Vector3;
  /** World-space ledge lip, the hand-plant IK target. */
  handTarget: THREE.Vector3;
  /** 0..1 weight for the hand-plant (ramps in and out of the window). */
  handWeight: number;
}

const FORWARD = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const _probeOrigin = new THREE.Vector3();

/** Result of the pure geometry solve — enough to start a traversal. */
interface TraversalPlan {
  ledgeY: number;
  ledgeHeight: number;
  overshoot: number;
  isMantle: boolean;
  duration: number;
  horizontalSpeed: number;
}
const _tmp = new THREE.Vector3();

export class VaultSystem {
  private probes: VaultProbes | null = null;
  /** Logical duration of the CURRENT traversal (scales with climb height). */
  private duration: number = VAULT.DURATION;
  private active = false;
  private elapsed = 0;
  private cooldown = 0;

  private readonly start = new THREE.Vector3();
  private readonly control = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly ledge = new THREE.Vector3();
  private readonly travelDir = new THREE.Vector3();
  private entrySpeed = 0;

  readonly state: VaultState = {
    active: false,
    progress: 0,
    position: new THREE.Vector3(),
    handTarget: new THREE.Vector3(),
    handWeight: 0,
  };

  setProbes(probes: VaultProbes | null): void {
    this.probes = probes;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** TEST seam: the resolved ledge of the running/last traversal. */
  get lastLedge(): THREE.Vector3 {
    return this.ledge;
  }

  /**
   * Attempt to start a vault. Returns true if the traversal began — the
   * caller must then suspend normal movement integration until isActive
   * goes false (PlayerController does this).
   */
  /**
   * Probe only: report which traversal (if any) the ledge ahead supports,
   * WITHOUT starting it. Drives the on-screen prompt and lets
   * PlayerController gate the move behind a jump press.
   */
  probeOnly(input: VaultTriggerInput): 'vault' | 'mantle' | null {
    const plan = this.solve(input);
    return plan ? (plan.isMantle ? 'mantle' : 'vault') : null;
  }

  tryStart(input: VaultTriggerInput): boolean {
    const plan = this.solve(input);
    if (!plan) return false;
    return this.begin(input, plan);
  }

  /**
   * Pure geometry solve. Returns the traversal plan or null. No mutation, so
   * it is safe to call every frame for the prompt.
   */
  private solve(input: VaultTriggerInput): TraversalPlan | null {
    if (this.active || this.cooldown > 0 || !this.probes) return null;
    if (!input.isGrounded || !input.forwardInput) return null;

    // --- reach envelope, derived from the CHARACTER's own stature ----------
    // Nothing here is a hardcoded world height. Every limit is a fraction of
    // PLAYER.STAND_HEIGHT, so a taller or shorter character automatically gets
    // a proportionally taller or shorter climb, and a wall is climbable if and
    // only if the character could physically reach its lip.
    const stature = PLAYER.STAND_HEIGHT;
    const minLedge = stature * VAULT.MIN_LEDGE_FRACTION;
    const vaultMax = stature * VAULT.VAULT_MAX_FRACTION;
    // A mantle tops out at full overhead reach: shoulder height plus arm span,
    // which for human proportions is very close to 1.2x stature. Above this
    // the character simply cannot get their hands on the ledge.
    const mantleMax = stature * VAULT.MANTLE_MAX_FRACTION;

    const horizontalSpeed = Math.hypot(input.velocity.x, input.velocity.z);
    // A mantle is a standing pull-up; only the faster vault-over needs run-up.
    if (horizontalSpeed < VAULT.MIN_SPEED && !VAULT.ALLOW_STANDING_MANTLE) return null;

    FORWARD.set(-Math.sin(input.yaw), 0, -Math.cos(input.yaw)).normalize();

    // --- Raycast 1: forward obstacle, fired at mid-torso height -------------
    _probeOrigin.copy(input.position).addScaledVector(UP, minLedge * 0.9);
    const wallDistance = this.probes.ray(_probeOrigin, FORWARD, VAULT.PROBE_FORWARD);
    if (wallDistance === null) return null;

    // --- Raycast 2: height finder, straight DOWN from above the obstacle ----
    // Search from full overhead reach so tall walls are found too; whether the
    // result is a vault or a mantle is decided by the measured height below.
    const searchTop = mantleMax + VAULT.HEIGHT_SEARCH_MARGIN;
    const overshoot = wallDistance + PLAYER.CAPSULE_RADIUS + 0.12;
    _probeOrigin.copy(input.position)
      .addScaledVector(FORWARD, overshoot)
      .addScaledVector(UP, searchTop);
    const downDistance = this.probes.ray(_probeOrigin, DOWN, searchTop);
    if (downDistance === null) return null;

    const ledgeY = _probeOrigin.y - downDistance;
    const ledgeHeight = ledgeY - input.position.y;
    // Too low to be worth animating, or physically out of reach: refuse. This
    // single comparison is what stops the player climbing arbitrary walls.
    if (ledgeHeight < minLedge || ledgeHeight > mantleMax) return null;

    // Classify. A VAULT clears a low obstacle in one running motion; a MANTLE
    // is a slower pull-up onto a ledge above waist height.
    const isMantle = ledgeHeight > vaultMax;
    // NO speed requirement for a mantle. Traversal is jump-triggered now, and
    // the whole point is that you can walk up to a ledge, come to a stop, and
    // press jump. Requiring residual speed made the prompt vanish at exactly
    // the moment the player was in position to use it.

    // A running vault-over needs the head to be clear; a mantle explicitly
    // does not, because the wall continues upward past the character.
    if (!isMantle) {
      _probeOrigin.copy(input.position).addScaledVector(UP, vaultMax);
      const headBlocked = this.probes.ray(_probeOrigin, FORWARD, wallDistance + 0.15);
      if (headBlocked !== null) return null;
    }
    // Duration scales with how far the body has to be lifted, so a high
    // mantle reads as effortful rather than teleporting.
    const duration = VAULT.DURATION
      * (isMantle ? 1 + (ledgeHeight - vaultMax) / Math.max(0.01, mantleMax - vaultMax) * VAULT.MANTLE_DURATION_SCALE : 1);

    // --- Raycast 3: is there room to actually land beyond the lip? ----------
    // Probe the spot the traversal will actually END on, which differs by
    // kind: a vault carries the body clear past the obstacle, a mantle sets
    // it down on top of the ledge just past the lip. Using the vault distance
    // for a mantle tested a point beyond a narrow ledge and wrongly aborted.
    const landingReach = isMantle ? VAULT.MANTLE_LANDING_INSET : VAULT.LANDING_CLEARANCE;
    _probeOrigin.set(
      input.position.x + FORWARD.x * (overshoot + landingReach),
      ledgeY + input.capsuleHeight * 0.6,
      input.position.z + FORWARD.z * (overshoot + landingReach),
    );
    const landingBlocked = this.probes.ray(_probeOrigin, DOWN, 0.05);
    const headroom = this.probes.ray(_probeOrigin, UP, PLAYER.STAND_HEIGHT - input.capsuleHeight * 0.6);
    if (landingBlocked !== null || headroom !== null) return null;

    return { ledgeY, ledgeHeight, overshoot, isMantle, duration, horizontalSpeed };
  }

  /** Apply a solved plan: build the Bezier and enter the active traversal. */
  private begin(input: VaultTriggerInput, plan: TraversalPlan): boolean {
    const { ledgeY, ledgeHeight, overshoot, isMantle, duration, horizontalSpeed } = plan;
    FORWARD.set(-Math.sin(input.yaw), 0, -Math.cos(input.yaw)).normalize();
    this.duration = duration;
    this.travelDir.copy(FORWARD);
    this.entrySpeed = horizontalSpeed;
    this.start.copy(input.position);
    this.ledge.set(
      input.position.x + FORWARD.x * overshoot,
      ledgeY,
      input.position.z + FORWARD.z * overshoot,
    );
    // A mantle ends standing ON the ledge; a vault carries through past it.
    this.end.copy(this.ledge).addScaledVector(
      FORWARD, isMantle ? VAULT.MANTLE_LANDING_INSET : VAULT.LANDING_CLEARANCE,
    );
    // Apex sits over the lip, clear of the surface — the "up and over" arc.
    // Apex sits over the lip, clear of the surface. For a mantle the control
    // point is pulled BACK toward the wall as well as up, so the curve rises
    // close to the face (a pull-up) instead of arcing out into open air.
    this.control.copy(this.ledge);
    if (isMantle) this.control.addScaledVector(FORWARD, -VAULT.MANTLE_LANDING_INSET * 0.5);
    this.control.y = ledgeY + VAULT.APEX_CLEARANCE
      + (input.capsuleHeight - PLAYER.STAND_HEIGHT) * 0.5;

    this.active = true;
    this.elapsed = 0;
    this.state.active = true;
    this.state.progress = 0;
    this.state.position.copy(this.start);
    this.state.handTarget.copy(this.ledge);
    this.state.handWeight = 0;
    eventBus.emit('player:vaultStart', {
      ledgeHeight,
      duration,
      ledge: this.ledge.clone(),
      kind: isMantle ? 'mantle' : 'vault',
    });
    return true;
  }

  /**
   * Advance the traversal. While active the caller must apply
   * `state.position` to the simulation and skip gravity/input integration —
   * that is the spec's "temporary suspension of player physics control".
   */
  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.active) {
      this.state.handWeight = Math.max(0, this.state.handWeight - dt * 6);
      return;
    }

    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    this.state.progress = t;

    // Quadratic Bezier: (1−t)²·P0 + 2(1−t)t·C + t²·P1
    const inv = 1 - t;
    this.state.position
      .copy(this.start).multiplyScalar(inv * inv)
      .addScaledVector(this.control, 2 * inv * t)
      .addScaledVector(this.end, t * t);

    // Hand plant: the hands ride the lip through the specified window.
    const w = VAULT.HAND_PLANT_WINDOW;
    if (t >= w.start && t <= w.end) {
      const local = (t - w.start) / Math.max(1e-4, w.end - w.start);
      // Ramp in fast, hold, release — hands leave the ledge as the body clears.
      this.state.handWeight = Math.min(1, Math.min(local * 4, (1 - local) * 3 + 0.25));
      this.state.handTarget.copy(this.ledge);
    } else {
      this.state.handWeight = Math.max(0, this.state.handWeight - dt * 8);
    }

    if (t >= 1) this.finish();
  }

  private finish(): void {
    this.active = false;
    this.state.active = false;
    this.cooldown = VAULT.COOLDOWN;
    eventBus.emit('player:vaultEnd', {});
  }

  /** Velocity handed back to the sim on completion (momentum is preserved). */
  exitVelocity(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.travelDir).multiplyScalar(this.entrySpeed * VAULT.EXIT_SPEED_FACTOR);
  }

  /** Hard cancel (death, teleport, level swap). */
  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.state.active = false;
    this.state.handWeight = 0;
    this.cooldown = VAULT.COOLDOWN;
    eventBus.emit('player:vaultEnd', { cancelled: true });
  }
}

const UP = new THREE.Vector3(0, 1, 0);
void _tmp;

export default VaultSystem;
