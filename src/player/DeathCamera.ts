/**
 * DeathCamera.ts — what you watch between dying and respawning.
 *
 * This replaces the old behaviour, which was simply wrong: `player:died` ran
 * `endMatch('You Died')` and tore the whole session down. Dying is not the end
 * of a match, it is a three-second interruption, and this module owns those
 * three seconds.
 *
 * WHAT IT DOES
 * ------------
 * On death the camera detaches from the player rig and pulls back to an
 * external shot of the body, then slowly orbits while a countdown runs. The
 * shot is composed, not arbitrary:
 *
 *   - it sits BEHIND the body relative to the killer, so the killer's
 *     direction is on screen — you can see where it came from;
 *   - it is raised and angled down, so the body reads against the ground
 *     rather than being lost in level geometry;
 *   - it eases outward rather than cutting, because a hard cut at the moment
 *     of death reads as a bug;
 *   - it orbits slowly, which keeps the frame alive during the wait.
 *
 * KILLCAM READINESS
 * -----------------
 * The user's requirement was that the death screen is a placeholder for a
 * future killcam and that everything should be ready for it. The seam is
 * `DeathCameraTarget`: this class does not know where the body is, it is
 * TOLD each frame. A killcam is the same camera driven from a recorded
 * trajectory of the KILLER instead of a static body position, so it plugs in
 * by supplying a different target — no change to death handling, the
 * countdown, the input lock or the respawn path.
 *
 * The server already sends the other half (`DeathWire` carries the killer,
 * the weapon, the distance, the headshot flag and both positions), so the
 * data a killcam needs is arriving today; only the replay buffer is missing.
 *
 * WHY THE CAMERA WORK LIVES HERE AND NOT IN main.ts
 * -------------------------------------------------
 * It reuses CinematicCameraController's manual mode, which already solves the
 * hard part: detaching the camera safely, anti-clipping it out of walls and
 * keeping it above the floor. A death cam that clips inside the wall you died
 * against is worse than no death cam, and that logic should exist once.
 */
import * as THREE from 'three';
import type { CinematicCameraController } from '../camera/CinematicCameraController';

/** Where the camera should be looking. A killcam swaps this out. */
export interface DeathCameraTarget {
  /** World position of the subject (the body, today). */
  readonly subject: THREE.Vector3;
  /**
   * Where the killing shot came from, if known. Used to orient the shot so
   * the killer's direction is visible. Null falls back to the victim's own
   * facing, which is still a sensible framing.
   */
  readonly from: THREE.Vector3 | null;
  /** Victim's facing at death, the fallback when `from` is null. */
  readonly victimYaw: number;
}

/** Shot composition. Tuned to read like COD's post-death pull-back. */
const SHOT = {
  /** How far behind the body the camera settles. */
  DISTANCE: 3.4,
  /**
   * How high above the body's feet.
   *
   * High enough to look DOWN on the body: a corpse framed from eye level
   * reads as a standing character, and the whole point of the shot is that
   * the player is on the floor.
   */
  HEIGHT: 3.1,
  /** Where the camera aims — the body itself, which is now lying down. */
  LOOK_HEIGHT: 0.35,
  /** Radians per second of slow orbit. Small: motion, not a carousel. */
  ORBIT_RATE: 0.22,
  /** Seconds to ease from the eye position out to the shot. */
  EASE_SECONDS: 0.75,
  /** Start of the pull-back: just above where the head was. */
  START_HEIGHT: 1.55,
  START_DISTANCE: 0.6,
  FOV: 58,
} as const;

const _desiredPos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _offset = new THREE.Vector3();

export class DeathCamera {
  private active = false;
  private elapsed = 0;
  private orbit = 0;
  private target: DeathCameraTarget | null = null;

  constructor(private readonly cinematic: CinematicCameraController) {}

  get isActive(): boolean { return this.active; }

  /** Seconds since the death cam started — drives the countdown display. */
  get runningFor(): number { return this.elapsed; }

  /**
   * Begin the shot.
   *
   * Idempotent: a second death before the first cam ended (possible if a
   * server correction and a local prediction disagree) re-aims rather than
   * stacking two detached cameras, which is unrecoverable without a reload.
   */
  begin(target: DeathCameraTarget): void {
    this.target = target;
    this.orbit = 0;
    this.elapsed = 0;
    if (this.active) return;
    this.active = true;
    this.cinematic.beginManual();
  }

  /** Re-aim an already-running shot (the body settled, a killcam took over). */
  retarget(target: DeathCameraTarget): void {
    if (this.active) this.target = target;
  }

  /**
   * Hand the camera back to the player rig.
   *
   * Safe to call when not running, because the respawn path should not have
   * to remember whether the death cam actually started.
   */
  end(): void {
    if (!this.active) return;
    this.active = false;
    this.target = null;
    this.elapsed = 0;
    this.cinematic.cancel();
  }

  update(dt: number): void {
    if (!this.active || !this.target) return;
    this.elapsed += dt;
    this.orbit += dt * SHOT.ORBIT_RATE;

    const { subject, from, victimYaw } = this.target;

    // Face the direction the shot came from, so the killer is on screen.
    // Falling back to the victim's own facing keeps the framing sensible for
    // deaths with no killer (fall damage, the map's own explosions).
    let toKiller: number;
    if (from) {
      toKiller = Math.atan2(from.x - subject.x, from.z - subject.z);
    } else {
      toKiller = victimYaw;
    }

    // The camera sits OPPOSITE the killer: behind the body, looking past it
    // toward whoever did it.
    const angle = toKiller + Math.PI + this.orbit;

    // Ease from roughly where the eyes were out to the full shot, so death
    // reads as a pull-back rather than a cut.
    const t = Math.min(1, this.elapsed / SHOT.EASE_SECONDS);
    const eased = 1 - (1 - t) * (1 - t) * (1 - t); // cubic ease-out
    const distance = SHOT.START_DISTANCE + (SHOT.DISTANCE - SHOT.START_DISTANCE) * eased;
    const height = SHOT.START_HEIGHT + (SHOT.HEIGHT - SHOT.START_HEIGHT) * eased;

    _offset.set(Math.sin(angle) * distance, height, Math.cos(angle) * distance);
    _desiredPos.copy(subject).add(_offset);
    _lookAt.copy(subject);
    _lookAt.y += SHOT.LOOK_HEIGHT;

    // followSmoothing < 1 so the orbit glides. The controller's anti-clipping
    // and ground clearance run inside this call, which is the entire reason
    // the death cam is expressed as a manual cinematic shot rather than by
    // moving the camera directly.
    this.cinematic.setDesiredTransform(_desiredPos, _lookAt, {
      fov: SHOT.FOV,
      followSmoothing: 0.18,
    });
  }
}

export default DeathCamera;
