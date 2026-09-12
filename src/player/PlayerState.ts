/**
 * PlayerState.ts — PURE movement state machine. No Three.js objects, no
 * InputManager, no Clock: PlayerController gathers snapshots each fixed step
 * and calls resolveNextState(). This is the module Document 3's
 * AnimationStateMachine will read to pick animation clips.
 *
 * Transition rules encoded explicitly (Document 2, Section 7):
 *  - SLIDE is reachable ONLY from SPRINT via an edge-triggered crouch press.
 *  - JUMP/AIR from any grounded state on a valid jump trigger (coyote-time
 *    aware), including as a slide-cancel from SLIDE.
 *  - LANDING is short-lived and auto-expires, then resolves by current input.
 *  - CROUCH_WALK vs CROUCH_IDLE = movement input while crouched.
 *  - Sprint can never be entered while crouched; crouching while sprinting
 *    either slides (edge press) or drops into crouch states.
 */
import { LANDING } from '../utils/Constants';

export const PlayerState = Object.freeze({
  IDLE: 'IDLE',
  WALK: 'WALK',
  SPRINT: 'SPRINT',
  CROUCH_IDLE: 'CROUCH_IDLE',
  CROUCH_WALK: 'CROUCH_WALK',
  SLIDE: 'SLIDE',
  JUMP: 'JUMP',
  AIR: 'AIR',
  LANDING: 'LANDING',
} as const);

export type PlayerStateValue = (typeof PlayerState)[keyof typeof PlayerState];

export interface InputSnapshot {
  hasMoveInput: boolean;
  sprintHeld: boolean;
  /** Controller-computed: stamina + forward-angle + ADS-flag all satisfied. */
  sprintEligible: boolean;
  crouchHeld: boolean;
  crouchPressedThisFrame: boolean;
  jumpPressedThisFrame: boolean;
}

export interface PhysicsSnapshot {
  isGrounded: boolean;
  justLanded: boolean;
  horizontalSpeed: number;
  verticalVelocity: number;
  timeInState: number;
  slideActive: boolean;
  coyoteActive: boolean;
}

const AIRBORNE_STATES: readonly PlayerStateValue[] = [PlayerState.JUMP, PlayerState.AIR, PlayerState.SLIDE];

function resolveGroundedLocomotion(input: InputSnapshot): PlayerStateValue {
  if (input.crouchHeld) return input.hasMoveInput ? PlayerState.CROUCH_WALK : PlayerState.CROUCH_IDLE;
  if (input.sprintHeld && input.sprintEligible && input.hasMoveInput) return PlayerState.SPRINT;
  return input.hasMoveInput ? PlayerState.WALK : PlayerState.IDLE;
}

export function resolveNextState(
  current: PlayerStateValue,
  input: InputSnapshot,
  physics: PhysicsSnapshot,
): PlayerStateValue {
  // --- airborne -------------------------------------------------------------
  if (!physics.isGrounded) {
    // Coyote forgiveness: a fresh jump press right after leaving a ledge.
    if (input.jumpPressedThisFrame && physics.coyoteActive && !AIRBORNE_STATES.includes(current)) {
      return PlayerState.JUMP;
    }
    return PlayerState.AIR;
  }

  // --- grounded -------------------------------------------------------------
  // Jump (also the slide-cancel tech: SLIDE + jump = jump with momentum).
  if (input.jumpPressedThisFrame && (physics.isGrounded || physics.coyoteActive)) return PlayerState.JUMP;

  // Touchdown: brief LANDING state, then resolve by input once expired.
  if (physics.justLanded && current !== PlayerState.LANDING) return PlayerState.LANDING;
  if (current === PlayerState.LANDING) {
    if (physics.timeInState < LANDING.STATE_DURATION_SECONDS) return PlayerState.LANDING;
    return resolveGroundedLocomotion(input);
  }

  // Slide lifecycle exits (timeout / min-speed / crouch-release handled by the
  // movement sim, surfaced as slideActive === false).
  if (current === PlayerState.SLIDE) {
    if (physics.slideActive) return PlayerState.SLIDE;
    return resolveGroundedLocomotion(input);
  }

  // Slide trigger: ONLY from SPRINT, edge-triggered crouch press. Attempting
  // this from WALK/IDLE/CROUCH is a no-op (falls through to normal resolve).
  if (current === PlayerState.SPRINT && input.crouchPressedThisFrame) return PlayerState.SLIDE;

  return resolveGroundedLocomotion(input);
}
