/**
 * PlayerMovement.ts — the authoritative player simulation (Document 2 §6).
 *
 * Simulation/render separation: everything here is plain data updated inside
 * Clock.stepFixed() chunks. No cosmetic offsets (head bob, landing dip, slide
 * tilt) live in this state — PlayerCamera layers those on visually.
 *
 * Position convention: `position` is the capsule BASE (feet). Eye height is
 * derived: position.y + capsuleHeight - PLAYER.EYE_OFFSET_FROM_TOP.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { JUMP, MOVEMENT, PLAYER, SLIDE, TAC_SPRINT } from '../utils/Constants';
import { clamp, easeOutQuad, lerp } from '../utils/MathUtils';
import type PlayerCharacterController from '../physics/PlayerCharacterController';
import { PlayerState, type PlayerStateValue } from './PlayerState';

export interface PlayerSimState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  capsuleHeight: number;
  isGrounded: boolean;
  groundNormal: THREE.Vector3;
  timeSinceLastGrounded: number;
}

export interface MovementIntent {
  moveLocal: THREE.Vector2;
  state: PlayerStateValue;
  sprintActive: boolean;
  crouchActive: boolean;
  jumpQueued: boolean;
  slideTriggered: boolean;
  adsSpeedMultiplier: number;
  /** Document 2.5 §4.3: double-tap/dedicated-bind promotion request (latched
   *  by the controller on the sprint press edge). */
  tacSprintRequested: boolean;
  canStandUp: () => boolean;
}

/** Downward probe origin height above the feet, and grounded tolerance. */
const GROUND_PROBE_OFFSET = 0.15;
const GROUNDED_EPSILON = 0.03;
/** Airtime required before a touchdown counts as a landing (stops step-snap spam). */
const AIRTIME_FOR_LANDING = 0.05;

export class PlayerMovement {
  readonly state: PlayerSimState = {
    position: new THREE.Vector3(0, 0, 10),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    capsuleHeight: PLAYER.STAND_HEIGHT,
    isGrounded: false,
    groundNormal: new THREE.Vector3(0, 1, 0),
    timeSinceLastGrounded: 0,
  };

  slideActive = false;
  justLanded = false;
  impactVelocity = 0;
  /**
   * Document 2.5 §4.1/§4.3: the orthogonal Tactical Sprint flag — tracked
   * ALONGSIDE (not replacing) the SPRINT state. Strictly faster, drains
   * stamina harder, and gates fire/ADS at the WeaponManager layer.
   */
  isTacticalSprinting = false;

  private slideTimer = 0;
  private slideCooldown = 0;
  private slideStartSpeed = 0;
  private wallStallTimer = 0;
  private landingImpactPending = 0;
  private readonly lastMoveLocal = new THREE.Vector2(0, -1);
  private readonly slideDir = new THREE.Vector2(0, -1);
  private readonly desiredDir = new THREE.Vector3();

  constructor(private readonly collider: PlayerCharacterController) {}

  get coyoteActive(): boolean {
    return !this.state.isGrounded && this.state.timeSinceLastGrounded <= JUMP.COYOTE_TIME_SECONDS;
  }

  consumeJustLanded(): boolean {
    const value = this.justLanded;
    this.justLanded = false;
    return value;
  }

  /**
   * Document 2.5 §4.6: one-shot landing impact for the viewmodel settle kick
   * (separate from the state machine's justLanded latch, which feeds LANDING).
   */
  consumeLandingImpact(): number {
    const value = this.landingImpactPending;
    this.landingImpactPending = 0;
    return value;
  }

  /** Document 2.5 §4.3: promotion (double-tap or dedicated bind), validated. */
  requestTacticalSprint(): boolean {
    if (!this.state.isGrounded) return false;
    // moveLocal is +y FORWARD (see PlayerController.moveLocal). This used to
    // negate it, so holding W produced forwardInput = -1, which never cleared
    // MIN_FORWARD_INPUT — the second half of why tac sprint never engaged.
    const forwardInput = this.lastMoveLocal.y;
    if (forwardInput < TAC_SPRINT.MIN_FORWARD_INPUT) return false;
    if (!this.isTacticalSprinting) {
      this.isTacticalSprinting = true;
      this.wallStallTimer = 0;
      eventBus.emit('player:tacSprintStart', {});
    }
    return true;
  }

  /** Immediate end (fire/ads-cancel path, §4.3 two-step rule). */
  endTacticalSprint(reason: 'released' | 'stamina' | 'wall' | 'cancel' | 'input'): void {
    if (!this.isTacticalSprinting) return;
    this.isTacticalSprinting = false;
    this.wallStallTimer = 0;
    eventBus.emit('player:tacSprintEnd', { reason });
  }

  private probe(tag: string, vz: number, dz?: number, cz?: number): void {
    const probe = (window as unknown as { __stepProbe?: unknown[] }).__stepProbe;
    if (probe !== undefined && probe.length < 60) {
      probe.push([tag, vz.toFixed(3), dz?.toFixed(4) ?? '', cz?.toFixed(4) ?? '']);
    }
  }

  step(dt: number, intent: MovementIntent): void {
    this.lastMoveLocal.copy(intent.moveLocal);
    this.updateTacticalSprint(dt, intent);
    this.updateSlide(dt, intent);
    this.updateHorizontal(dt, intent);
    this.updateVertical(dt, intent);
    this.integrateAndCollide(dt, intent);
    this.updateGrounding(dt);
    this.updateCrouchHeight(dt, intent);
  }

  // --- tactical sprint lifecycle (Document 2.5 §4.3) --------------------------
  private updateTacticalSprint(dt: number, intent: MovementIntent): void {
    // Promotion is evaluated FIRST. It used to sit behind the
    // `if (!this.isTacticalSprinting) return` guard below, which meant a
    // request could only ever be honoured while tac-sprint was ALREADY
    // running — so it could never start at all.
    if (intent.tacSprintRequested) this.requestTacticalSprint();
    if (!this.isTacticalSprinting) return;
    // Exit conditions (§4.3): release, input angle, stamina, obstacle stall.
    const forwardInput = this.lastMoveLocal.y;
    const sprintReleased = !intent.sprintActive;
    const inputTooWide = forwardInput < TAC_SPRINT.MIN_FORWARD_INPUT;
    if (sprintReleased || inputTooWide) {
      this.endTacticalSprint(sprintReleased ? 'released' : 'input');
      return;
    }
    // Obstacle exit: collision-stalled well below the tac-sprint target speed.
    const targetSpeed = MOVEMENT.WALK_SPEED * MOVEMENT.TAC_SPRINT_SPEED_MULTIPLIER;
    const stalled = this.horizontalSpeed() < targetSpeed * TAC_SPRINT.WALL_STALL_SPEED_FRACTION;
    this.wallStallTimer = stalled ? this.wallStallTimer + dt : 0;
    if (this.wallStallTimer >= TAC_SPRINT.WALL_STALL_SECONDS) this.endTacticalSprint('wall');
  }

  // --- slide lifecycle (§6.6) ------------------------------------------------
  private updateSlide(dt: number, intent: MovementIntent): void {
    if (this.slideCooldown > 0) this.slideCooldown -= dt;

    if (!this.slideActive && intent.slideTriggered && this.slideCooldown <= 0 && this.state.isGrounded) {
      this.slideActive = true;
      this.slideTimer = 0;
      const horizontal = this.horizontalSpeed();
      const dir = horizontal > 0.01
        ? this.slideDir.set(this.state.velocity.x, this.state.velocity.z).normalize()
        : this.slideDir.set(-Math.sin(this.state.yaw), -Math.cos(this.state.yaw));
      this.slideDir.copy(dir);
      this.slideStartSpeed = Math.min(horizontal * SLIDE.BOOST_MULTIPLIER, SLIDE.MAX_SPEED);
      this.state.velocity.x = this.slideDir.x * this.slideStartSpeed;
      this.state.velocity.z = this.slideDir.y * this.slideStartSpeed;
      return;
    }
    if (!this.slideActive) return;

    // Early exits: crouch released, or jump-cancel (momentum carries over).
    const endedByRelease = !intent.crouchActive;
    const endedByJump = intent.jumpQueued;
    this.slideTimer += dt;
    const t = this.slideTimer / SLIDE.DURATION_SECONDS;

    if (!endedByRelease && !endedByJump && t < 1) {
      // Ease-out decay toward crouch-walk speed (or zero with no input).
      const endSpeed = intent.moveLocal.lengthSq() > 0 ? MOVEMENT.WALK_SPEED * MOVEMENT.CROUCH_SPEED_MULTIPLIER : 0;
      const speed = lerp(this.slideStartSpeed, endSpeed, easeOutQuad(t));
      // Limited steering: blend current input into the locked slide direction.
      if (intent.moveLocal.lengthSq() > 0) {
        const inputWorld = this.localToWorld(intent.moveLocal);
        this.slideDir
          .set(
            lerp(this.slideDir.x, inputWorld.x, SLIDE.STEER_INFLUENCE * dt * 10),
            lerp(this.slideDir.y, inputWorld.y, SLIDE.STEER_INFLUENCE * dt * 10),
          )
          .normalize();
      }
      this.state.velocity.x = this.slideDir.x * speed;
      this.state.velocity.z = this.slideDir.y * speed;
      if (speed < SLIDE.MIN_SPEED && endSpeed === 0) this.endSlide();
      return;
    }
    this.endSlide();
  }

  private endSlide(): void {
    this.slideActive = false;
    this.slideCooldown = SLIDE.COOLDOWN_SECONDS;
  }

  // --- horizontal accel / friction (§6.2) ------------------------------------
  private updateHorizontal(dt: number, intent: MovementIntent): void {
    if (this.slideActive) return; // slide owns horizontal velocity entirely
    const sim = this.state;
    const maxSpeed = this.maxSpeedFor(intent);
    this.desiredDir.set(0, 0, 0);
    if (intent.moveLocal.lengthSq() > 0) {
      const world = this.localToWorld(intent.moveLocal.clone().normalize());
      this.desiredDir.set(world.x, 0, world.y).normalize().multiplyScalar(maxSpeed);
    }

    const accel = sim.isGrounded ? MOVEMENT.GROUND_ACCELERATION : MOVEMENT.AIR_ACCELERATION;
    if (this.desiredDir.lengthSq() > 0) {
      sim.velocity.x = approach(sim.velocity.x, this.desiredDir.x, accel * dt);
      sim.velocity.z = approach(sim.velocity.z, this.desiredDir.z, accel * dt);
      this.probe('postApproach', sim.velocity.z);
    } else if (sim.isGrounded) {
      const decay = Math.max(0, 1 - MOVEMENT.GROUND_FRICTION * dt);
      sim.velocity.x *= decay;
      sim.velocity.z *= decay;
    }
  }

  private maxSpeedFor(intent: MovementIntent): number {
    let base: number;
    switch (intent.state) {
      case PlayerState.SPRINT:
        // Document 2.5 §4.3: tac sprint is a strictly faster multiplier.
        base = this.isTacticalSprinting
          ? MOVEMENT.WALK_SPEED * MOVEMENT.TAC_SPRINT_SPEED_MULTIPLIER
          : MOVEMENT.WALK_SPEED * MOVEMENT.SPRINT_SPEED_MULTIPLIER;
        break;
      case PlayerState.CROUCH_IDLE:
      case PlayerState.CROUCH_WALK:
        base = MOVEMENT.WALK_SPEED * MOVEMENT.CROUCH_SPEED_MULTIPLIER;
        break;
      case PlayerState.SLIDE:
        base = SLIDE.MAX_SPEED;
        break;
      default:
        base = MOVEMENT.WALK_SPEED;
        break;
    }
    // ADS slows movement by the equipped weapon's multiplier (Document 3).
    return base * intent.adsSpeedMultiplier;
  }

  // --- gravity / jump (§6.4) ---------------------------------------------------
  private updateVertical(dt: number, intent: MovementIntent): void {
    const sim = this.state;
    if (intent.jumpQueued && (sim.isGrounded || this.coyoteActive)) {
      // Derived impulse: v = sqrt(2 * g * h) — tuning DESIRED_JUMP_HEIGHT in
      // Constants.js changes the actual arc predictably.
      sim.velocity.y = Math.sqrt(2 * JUMP.GRAVITY * JUMP.DESIRED_JUMP_HEIGHT);
      sim.isGrounded = false;
      sim.timeSinceLastGrounded = 1e-4;
    }
    if (!sim.isGrounded) {
      sim.velocity.y = Math.max(sim.velocity.y - JUMP.GRAVITY * dt, -JUMP.TERMINAL_VELOCITY);
    }
  }

  // --- integration + collision + step-up (§6.7) --------------------------------
  private integrateAndCollide(dt: number, intent: MovementIntent): void {
    const sim = this.state;
    // Substep the horizontal resolve when a single frame would move further
    // than the capsule radius: a >radius jump can tunnel the sweep past the
    // KCC's contact margin and lock the sim inside a wall (seen at ~10 fps
    // headless: 0.54 m/frame vs 0.35 m radius). Max 4 substeps bounds cost.
    const frameDeltaX = sim.velocity.x * dt;
    const frameDeltaZ = sim.velocity.z * dt;
    const steps = Math.min(16, Math.max(1, Math.ceil(Math.hypot(frameDeltaX, frameDeltaZ) / (PLAYER.CAPSULE_RADIUS * 0.25))));
    let blockedX = false;
    let blockedZ = false;
    for (let i = 0; i < steps; i += 1) {
      const delta = new THREE.Vector3(frameDeltaX / steps, 0, frameDeltaZ / steps);
      const corrected = this.collider.resolveHorizontalCollision(sim.position, delta, PLAYER.CAPSULE_RADIUS, sim.capsuleHeight);
      // Obstruction = correction meaningfully shorter than desired (the KCC
      // shaves its offset skin by sub-mm on every free slide — an exact `<`
      // would zero velocity every frame and permanently stall acceleration).
      if (Math.abs(corrected.x) < Math.abs(delta.x) - PLAYER.CORRECTION_EPSILON) blockedX = true;
      if (Math.abs(corrected.z) < Math.abs(delta.z) - PLAYER.CORRECTION_EPSILON) blockedZ = true;
      sim.position.x += corrected.x;
      sim.position.z += corrected.z;
    }
    if (blockedX) sim.velocity.x = 0;
    if (blockedZ) sim.velocity.z = 0;
    sim.position.y += sim.velocity.y * dt;
    void intent;
  }

  private updateGrounding(dt: number): void {
    const sim = this.state;
    const wasGrounded = sim.isGrounded;
    // Probe origin must sit ABOVE the tallest step lip we can mount, or a
    // 0.4 m step surface is above the ray origin and can never be found.
    const probeOrigin = PLAYER.MAX_STEP_HEIGHT + GROUND_PROBE_OFFSET;
    const origin = sim.position.clone().add(new THREE.Vector3(0, probeOrigin, 0));
    const hit = this.collider.raycastDown(origin, probeOrigin + GROUNDED_EPSILON);
    const fallingOrLevel = sim.velocity.y <= 0.001;

    if (hit && fallingOrLevel) {
      const gap = hit.point.y - sim.position.y;
      if (gap <= GROUND_PROBE_OFFSET + PLAYER.MAX_STEP_HEIGHT && gap >= -GROUNDED_EPSILON) {
        // Rest on the surface, or snap up onto a step lip. Snapping counts as
        // grounded immediately so step-ups never flicker into AIR (which used
        // to spam player:landed and launch the capsule).
        const snap = gap > GROUNDED_EPSILON ? Math.min(1, dt * 30) : 1;
        sim.position.y = lerp(sim.position.y, hit.point.y, snap);
        if (!wasGrounded && sim.timeSinceLastGrounded > AIRTIME_FOR_LANDING) this.registerLanding();
        sim.isGrounded = true;
        sim.groundNormal.copy(hit.normal);
        sim.velocity.y = 0;
        sim.timeSinceLastGrounded = 0;
        return;
      }
    }
    sim.isGrounded = false;
    sim.timeSinceLastGrounded += dt;
  }

  private registerLanding(): void {
    this.justLanded = true;
    this.impactVelocity = Math.abs(this.state.velocity.y);
    this.landingImpactPending = this.impactVelocity;
    eventBus.emit('player:landed', { impactVelocity: this.impactVelocity });
  }

  // --- crouch/slide capsule height (§6.5/§6.6) ---------------------------------
  private updateCrouchHeight(dt: number, intent: MovementIntent): void {
    const sim = this.state;
    const target = this.slideActive
      ? PLAYER.SLIDE_HEIGHT
      : intent.crouchActive
        ? PLAYER.CROUCH_HEIGHT
        : PLAYER.STAND_HEIGHT;
    const rising = target > sim.capsuleHeight;
    if (rising && !intent.canStandUp()) return; // stay low until headroom clears
    const rate = (PLAYER.STAND_HEIGHT - PLAYER.CROUCH_HEIGHT) / PLAYER.CROUCH_LERP_SECONDS;
    const step = rate * dt;
    sim.capsuleHeight = rising
      ? Math.min(target, sim.capsuleHeight + step)
      : Math.max(target, sim.capsuleHeight - step);
  }

  horizontalSpeed(): number {
    return Math.hypot(this.state.velocity.x, this.state.velocity.z);
  }

  /** Local (yaw-relative, pitch-ignored) input direction -> world XZ. */
  private localToWorld(local: THREE.Vector2): THREE.Vector2 {
    const sin = Math.sin(this.state.yaw);
    const cos = Math.cos(this.state.yaw);
    // Forward is -Z at yaw 0; right is +X at yaw 0.
    return new THREE.Vector2(
      local.x * cos - local.y * sin,
      -local.y * cos - local.x * sin,
    );
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  return clamp(target - current, -maxDelta, maxDelta) + current;
}

export default PlayerMovement;
