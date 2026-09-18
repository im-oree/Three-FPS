/**
 * KillcamDirector.ts — execute a shot list against a recording.
 *
 * The split that matters: `CameraDirector` on the server decides WHAT to
 * film (a pure function of the kill facts), and this decides WHERE THE LENS
 * GOES for that decision. Neither knows what a grenade is. The plan names an
 * id and a kind of shot; this looks the id up in the recorded frames and
 * composes.
 *
 * Because the plan is rebuilt from raw facts every time a clip is watched, a
 * recording made today is filmed by whatever camera logic exists at the
 * moment of playback. Improve `frameSubject` and every clip ever recorded
 * improves — that is the retroactive-upgrade property the spec asks for, and
 * it only holds because nothing about framing is ever written to disk.
 *
 * SUBJECT RESOLUTION IS ALLOWED TO FAIL
 * -------------------------------------
 * A shot may name something that is not in the frames: a grenade that
 * detonated and despawned, a player who left. Resolution returns null and
 * the director falls back to the victim, who is by definition present at the
 * moment of death. A killcam must never show the inside of the skybox
 * because an actor went missing.
 */
import * as THREE from 'three';
import type { CameraShot, KillcamPlan } from '../server/CameraDirector';
import type { ClipPlayer, PlaybackFrame } from './ClipPlayer';
import {
  frameFirstPerson, framePair, frameSubject, type ShotComposition,
} from './FollowCameraRig';

/** Resolved state of whatever a shot is pointed at. */
interface SubjectState {
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly speed: number;
  /** Where it is looking — what FollowCameraRig frames a slow subject by. */
  readonly facing: number;
  readonly heading: number | null;
}

function subjectFrom(frame: PlaybackFrame, id: string | null): SubjectState | null {
  if (!id) return null;

  const player = frame.players.find((p) => p.id === id);
  if (player) {
    return {
      position: new THREE.Vector3(...player.pos),
      yaw: player.yaw,
      pitch: player.pitch,
      facing: player.yaw,
      // Player states carry no velocity on the wire, so speed comes from the
      // entity path only. Zero here means "frame it close", which is right
      // for a person.
      speed: 0,
      heading: null,
    };
  }

  const entity = frame.entities.find((e) => e.id === id);
  if (entity) {
    // `vel` is optional on the wire -- a static prop never sends one -- so a
    // missing velocity means "stationary", not "crash".
    const [vx, , vz] = entity.vel ?? [0, 0, 0];
    const speed = Math.hypot(vx, vz);
    const heading = Math.atan2(-vx, vz);
    return {
      position: new THREE.Vector3(...entity.pos),
      yaw: heading,
      pitch: 0,
      speed,
      facing: heading,
      // Below a walking pace a velocity vector is mostly noise and would
      // make the camera jitter around a nearly-stationary object.
      heading: speed > 0.5 ? heading : null,
    };
  }

  return null;
}

export class KillcamDirector {
  private plan: KillcamPlan | null = null;
  private orbit = 0;
  /** Which shot was live last frame, so a cut can be detected. */
  private lastShotIndex = -1;

  load(plan: KillcamPlan | null): void {
    this.plan = plan;
    this.orbit = 0;
    this.lastShotIndex = -1;
  }

  get loaded(): boolean { return this.plan !== null; }

  /** True on the frame the director switched shots — the camera should cut. */
  get justCut(): boolean { return this.cutThisFrame; }
  private cutThisFrame = false;

  /**
   * Playback rate for the current moment.
   *
   * Slow motion is applied around the impact tick only, so the run-up plays
   * at speed and the kill itself is legible. Returning it from here rather
   * than baking it into the clip keeps the recording raw.
   */
  rateAt(tick: number, ticksPerSecond = 60): number {
    if (!this.plan) return 1;
    const window = ticksPerSecond * 0.45;
    const distance = Math.abs(tick - this.plan.impactTick);
    if (distance > window) return 1;
    // Ease into slow motion rather than stepping into it: an instantaneous
    // rate change reads as a stutter, not as a deliberate effect.
    const t = 1 - distance / window;
    return 1 + (this.plan.slowMoAtImpact - 1) * (t * t);
  }

  /** Which shot covers this tick. The last shot wins past the end. */
  shotAt(tick: number): CameraShot | null {
    if (!this.plan || !this.plan.shots.length) return null;
    for (const shot of this.plan.shots) {
      if (tick >= shot.fromTick && tick <= shot.toTick) return shot;
    }
    return tick < this.plan.shots[0].fromTick
      ? this.plan.shots[0]
      : this.plan.shots[this.plan.shots.length - 1];
  }

  /**
   * Compose the camera for the current cursor.
   *
   * Returns null when there is nothing to film, which the caller should treat
   * as "leave the camera where it is" rather than as an error.
   */
  compose(player: ClipPlayer, dt: number): ShotComposition | null {
    const frame = player.sample();
    if (!frame || !this.plan) return null;

    this.orbit += dt * 0.18;

    const shot = this.shotAt(frame.tick);
    if (!shot) return null;

    const index = this.plan.shots.indexOf(shot);
    this.cutThisFrame = index !== this.lastShotIndex && this.lastShotIndex !== -1;
    this.lastShotIndex = index;

    // Fall back to the victim when the named subject is gone: a despawned
    // grenade must not leave the camera pointing at the origin.
    const subject = subjectFrom(frame, shot.subject)
      ?? subjectFrom(frame, this.victimId());
    if (!subject) return null;

    if (shot.kind === 'pair-orbit') {
      const other = subjectFrom(frame, shot.other ?? null);
      if (other) return framePair(subject.position, other.position, this.orbit);
      // One half of the pair is missing; a single-subject shot still reads.
      return frameSubject(subject, this.orbit);
    }

    if (shot.firstPerson) {
      return frameFirstPerson(subject.position, subject.yaw, subject.pitch);
    }

    if (shot.kind === 'impact-hold') {
      // Hold still and let the action move through frame: an impact shot
      // that keeps orbiting fights the explosion for attention.
      return frameSubject(subject, 0);
    }

    return frameSubject(subject, this.orbit);
  }

  private victimId(): string | null {
    // The victim is the subject of the reaction shot if the plan has one,
    // and otherwise of its final shot — either way, someone who was present.
    if (!this.plan) return null;
    const reaction = this.plan.shots.find((s) => s.kind === 'victim-reaction');
    if (reaction) return reaction.subject;
    const last = this.plan.shots[this.plan.shots.length - 1];
    return last?.subject ?? null;
  }

  reset(): void {
    this.plan = null;
    this.orbit = 0;
    this.lastShotIndex = -1;
    this.cutThisFrame = false;
  }
}

export default KillcamDirector;
