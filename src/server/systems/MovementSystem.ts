/**
 * MovementSystem.ts — the authoritative answer to "where is the player".
 *
 * Every input frame is applied here, against the shared MOVEMENT/PLAYER/JUMP
 * constants the client has always used. Sharing the numbers rather than
 * restating them is the point: a tuning change lands on both sides at once,
 * so client prediction and server truth cannot drift apart through a typo.
 *
 * The client still simulates locally for responsiveness — waiting for a round
 * trip before moving feels broken even at 20 ms. But this is the copy that
 * counts; the client's is a prediction that gets corrected.
 */
import type { ServerSystem } from '../ServerSystem';
import type { ServerWorld, ServerPlayer } from '../ServerWorld';
import type { CollisionWorld } from '../CollisionWorld';
import { Button, type InputFrame } from '../../net/Protocol';
import { MOVEMENT, PLAYER, JUMP, CLOCK } from '../../utils/Constants';

/** Derived once: the impulse that reaches DESIRED_JUMP_HEIGHT under GRAVITY. */
const JUMP_VELOCITY = Math.sqrt(2 * JUMP.GRAVITY * JUMP.DESIRED_JUMP_HEIGHT);

/** Grace period after leaving a ledge during which a jump still works. */
const COYOTE_SECONDS = 0.12;

/** Below this downward speed a landing is free; above it, it hurts. */
const FALL_DAMAGE_MIN_DROP = 4.5;
const FALL_DAMAGE_PER_METRE = 11;
const FALL_DAMAGE_LETHAL_DROP = 12;

/**
 * Inputs are clamped before use. A client controls what it SENDS, so every
 * number arriving from one is treated as hostile until bounded: an unclamped
 * dt is a speed hack, and an unclamped move vector is another.
 */
function sanitise(frame: InputFrame): InputFrame {
  const clampUnit = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  let moveX = clampUnit(frame.moveX);
  let moveZ = clampUnit(frame.moveZ);
  // Normalise diagonals: unclamped, holding two keys is 1.41x speed.
  const magnitude = Math.hypot(moveX, moveZ);
  if (magnitude > 1) { moveX /= magnitude; moveZ /= magnitude; }
  return {
    seq: frame.seq,
    dt: Number.isFinite(frame.dt) ? Math.max(0, Math.min(frame.dt, CLOCK.FIXED_DT * 4)) : 0,
    moveX,
    moveZ,
    yaw: Number.isFinite(frame.yaw) ? frame.yaw : 0,
    pitch: Number.isFinite(frame.pitch) ? Math.max(-1.5533, Math.min(1.5533, frame.pitch)) : 0,
    buttons: frame.buttons | 0,
  };
}

export class MovementSystem implements ServerSystem {
  readonly name = 'movement';

  constructor(private readonly collision: CollisionWorld) {}

  tick(dt: number, world: ServerWorld): void {
    for (const player of world.allPlayers) {
      if (!player.alive) continue;
      // A player in a vehicle is moved by the vehicle, not by their own feet.
      if (player.vehicleId !== null) { player.pendingInput.length = 0; continue; }

      if (player.pendingInput.length === 0) {
        // No input this tick (packet loss, or the player is idle): keep
        // simulating with the last known intent rather than freezing, or
        // gravity would pause mid-fall every time a packet went missing.
        this.step(player, null, dt);
        continue;
      }
      for (const raw of player.pendingInput) {
        const frame = sanitise(raw);
        this.step(player, frame, dt);
        player.lastProcessedSeq = frame.seq;
      }
      player.pendingInput.length = 0;
    }
  }

  private step(player: ServerPlayer, frame: InputFrame | null, dt: number): void {
    if (frame) {
      player.yaw = frame.yaw;
      player.pitch = frame.pitch;
      // Published for the systems that run after movement (combat reads the
      // trigger from here), so there is one canonical button mask per tick.
      player.lastButtons = frame.buttons;
    }

    const buttons = frame?.buttons ?? 0;
    const wantsCrouch = (buttons & Button.Crouch) !== 0;
    const wantsSprint = (buttons & Button.Sprint) !== 0;
    const wantsJump = (buttons & Button.Jump) !== 0;

    // --- stance ------------------------------------------------------------
    const targetHeight = wantsCrouch ? PLAYER.CROUCH_HEIGHT : PLAYER.STAND_HEIGHT;
    if (targetHeight > player.height) {
      // Standing up is only allowed if there is headroom; otherwise a player
      // could stand inside a ceiling and be ejected through it.
      if (this.collision.fits(
        player.px, player.py, player.pz, PLAYER.CAPSULE_RADIUS, targetHeight,
      )) {
        player.height = Math.min(
          targetHeight,
          player.height + (PLAYER.STAND_HEIGHT - PLAYER.CROUCH_HEIGHT) * dt / PLAYER.CROUCH_LERP_SECONDS,
        );
      }
    } else if (targetHeight < player.height) {
      player.height = Math.max(
        targetHeight,
        player.height - (PLAYER.STAND_HEIGHT - PLAYER.CROUCH_HEIGHT) * dt / PLAYER.CROUCH_LERP_SECONDS,
      );
    }
    player.crouching = player.height < (PLAYER.STAND_HEIGHT + PLAYER.CROUCH_HEIGHT) * 0.5;

    // --- desired horizontal velocity ---------------------------------------
    const moveX = frame?.moveX ?? 0;
    const moveZ = frame?.moveZ ?? 0;
    const moving = Math.hypot(moveX, moveZ) > 0.01;
    // Sprint is forward-only, as in the client: you cannot sprint backwards.
    player.sprinting = wantsSprint && moving && moveZ > 0.3 && !player.crouching;

    let speed = MOVEMENT.WALK_SPEED;
    if (player.crouching) speed *= MOVEMENT.CROUCH_SPEED_MULTIPLIER;
    else if (player.sprinting) speed *= MOVEMENT.SPRINT_SPEED_MULTIPLIER;

    // Rotate the input into world space by the player's yaw.
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const wishX = (moveX * cos - moveZ * sin) * speed;
    const wishZ = (moveX * sin + moveZ * cos) * speed;

    const acceleration = player.grounded
      ? MOVEMENT.GROUND_ACCELERATION
      : MOVEMENT.AIR_ACCELERATION;

    if (moving) {
      player.vx += (wishX - player.vx) * Math.min(1, acceleration * dt / speed);
      player.vz += (wishZ - player.vz) * Math.min(1, acceleration * dt / speed);
    } else if (player.grounded) {
      // Exponential friction plus a linear stop, for the reason documented on
      // GROUND_STOP_DECELERATION: decay alone never actually reaches zero.
      const decay = Math.max(0, 1 - MOVEMENT.GROUND_FRICTION * dt);
      player.vx *= decay;
      player.vz *= decay;
      const speedNow = Math.hypot(player.vx, player.vz);
      const stop = MOVEMENT.GROUND_STOP_DECELERATION * dt;
      if (speedNow <= stop) { player.vx = 0; player.vz = 0; }
      else if (speedNow > 0) {
        const scale = (speedNow - stop) / speedNow;
        player.vx *= scale;
        player.vz *= scale;
      }
    }

    // --- jump ---------------------------------------------------------------
    if (player.grounded) player.coyote = COYOTE_SECONDS;
    else player.coyote = Math.max(0, player.coyote - dt);

    if (wantsJump && !player.jumpHeld && player.coyote > 0) {
      player.vy = JUMP_VELOCITY;
      player.grounded = false;
      player.coyote = 0;
    }
    player.jumpHeld = wantsJump;

    // --- gravity ------------------------------------------------------------
    player.vy -= JUMP.GRAVITY * dt;

    // --- integrate through collision ---------------------------------------
    const before = player.py;
    const result = this.collision.moveCapsule(
      player.px, player.py, player.pz,
      PLAYER.CAPSULE_RADIUS, player.height,
      player.vx * dt, player.vy * dt, player.vz * dt,
      PLAYER.MAX_STEP_HEIGHT,
    );
    player.px = result.x;
    player.py = result.y;
    player.pz = result.z;

    // Kill sideways velocity into a wall, or the player accumulates speed
    // while pressed against it and shoots off when it ends.
    if (result.hitX) player.vx = 0;
    if (result.hitZ) player.vz = 0;

    const wasAirborne = !player.grounded;
    player.grounded = result.grounded;

    if (result.grounded) {
      if (wasAirborne) this.onLanded(player);
      player.vy = 0;
      player.fallPeakY = player.py;
    } else {
      if (result.hitY && player.vy > 0) player.vy = 0; // hit a ceiling
      player.fallPeakY = Math.max(player.fallPeakY, before);
    }
  }

  /** Fall damage, scaled by how far the player actually dropped. */
  private onLanded(player: ServerPlayer): void {
    const drop = player.fallPeakY - player.py;
    if (drop <= FALL_DAMAGE_MIN_DROP) return;
    const damage = drop >= FALL_DAMAGE_LETHAL_DROP
      ? player.maxHealth
      : Math.round((drop - FALL_DAMAGE_MIN_DROP) * FALL_DAMAGE_PER_METRE);
    if (damage <= 0) return;
    player.health = Math.max(0, player.health - damage);
    if (player.health === 0) player.alive = false;
  }
}
