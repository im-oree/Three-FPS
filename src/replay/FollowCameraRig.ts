/**
 * FollowCameraRig.ts — point a camera at a thing that is moving.
 *
 * The thing is identified by id. Not by type. This rig has no idea whether
 * it is watching a player, a grenade, a rocket, a drone or a helicopter, and
 * that ignorance is the feature: a new projectile is filmable the day it
 * exists, because filming it was never a matter of teaching the camera about
 * it. Ask for an id, get a shot.
 *
 * FRAMING
 * -------
 * Distance scales with speed. A body standing still wants a close, readable
 * shot; a rocket at 60 m/s pulled in that close is an unreadable blur, and
 * the eye needs the surroundings to perceive motion at all. So the rig pulls
 * back as the subject accelerates.
 *
 * Orientation blends velocity with facing. Following pure velocity whips the
 * camera around whenever a subject strafes; following pure facing loses a
 * fast mover's direction of travel. Fast things are framed by where they are
 * going, slow things by where they are looking, and the blend is continuous
 * so there is no visible switch.
 *
 * A PAIR is framed differently: the camera sits off the axis between two
 * subjects and looks at the midpoint, which is the only way to get both the
 * killer and the victim in one shot without a wide lens.
 */
import * as THREE from 'three';

export interface FollowTarget {
  /** Where the subject is, this instant. */
  readonly position: THREE.Vector3;
  /** How fast it is moving, m/s. Drives the framing distance. */
  readonly speed: number;
  /** Direction of travel, if moving. Null when effectively stationary. */
  readonly heading: number | null;
  /** Where it is looking. Used when it is not moving much. */
  readonly facing: number;
}

export interface ShotComposition {
  readonly position: THREE.Vector3;
  readonly lookAt: THREE.Vector3;
  readonly fov: number;
}

const FRAMING = {
  /** Distance at a standstill. Close enough to read a body. */
  NEAR: 3.2,
  /** Distance for anything moving fast. */
  FAR: 9.5,
  /** Speed, m/s, at which the far distance is reached. */
  FAST: 22,
  /** Camera height above the subject's origin. */
  HEIGHT_NEAR: 2.2,
  HEIGHT_FAR: 3.6,
  /** Aim point above the subject's origin — chest, not feet. */
  LOOK_HEIGHT: 1.1,
  /** Speed above which travel direction fully wins over facing. */
  HEADING_WINS: 8,
  FOV_NEAR: 60,
  FOV_FAR: 72,
} as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const blendAngle = (a: number, b: number, t: number): number => {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
};

/**
 * Third-person framing for one subject.
 *
 * Pure: the same target always composes the same shot. Smoothing belongs to
 * the caller, which already owns a camera controller that does it.
 */
export function frameSubject(target: FollowTarget, orbit = 0): ShotComposition {
  const speedT = clamp01(target.speed / FRAMING.FAST);
  const distance = FRAMING.NEAR + (FRAMING.FAR - FRAMING.NEAR) * speedT;
  const height = FRAMING.HEIGHT_NEAR + (FRAMING.HEIGHT_FAR - FRAMING.HEIGHT_NEAR) * speedT;
  const fov = FRAMING.FOV_NEAR + (FRAMING.FOV_FAR - FRAMING.FOV_NEAR) * speedT;

  // Which way is "behind"? Travel direction for a fast mover, facing for a
  // slow one, smoothly blended between so strafing does not whip the camera.
  const headingWeight = target.heading === null
    ? 0
    : clamp01(target.speed / FRAMING.HEADING_WINS);
  const axis = target.heading === null
    ? target.facing
    : blendAngle(target.facing, target.heading, headingWeight);

  const angle = axis + Math.PI + orbit;
  const position = new THREE.Vector3(
    target.position.x + Math.sin(angle) * distance,
    target.position.y + height,
    target.position.z + Math.cos(angle) * distance,
  );
  const lookAt = new THREE.Vector3(
    target.position.x, target.position.y + FRAMING.LOOK_HEIGHT, target.position.z,
  );
  return { position, lookAt, fov };
}

/**
 * Frame two subjects at once — the killer and their victim.
 *
 * Sits perpendicular to the line between them and backs off far enough that
 * both fit, so the shot reads as a confrontation rather than as one person
 * with something happening off screen.
 */
export function framePair(
  a: THREE.Vector3, b: THREE.Vector3, orbit = 0,
): ShotComposition {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const separation = a.distanceTo(b);
  // Back off proportionally to how far apart they are, with a floor so a
  // point-blank kill is not filmed from inside someone's head.
  const distance = Math.max(4.5, separation * 0.85);
  const axis = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2 + orbit;
  return {
    position: new THREE.Vector3(
      mid.x + Math.sin(axis) * distance,
      mid.y + 2.4 + separation * 0.18,
      mid.z + Math.cos(axis) * distance,
    ),
    lookAt: new THREE.Vector3(mid.x, mid.y + 1.1, mid.z),
    fov: separation > 25 ? 70 : 62,
  };
}

/**
 * First-person: sit in the subject's head looking where they looked.
 *
 * Used by killer-POV profiles, which is what a COD killcam actually shows.
 */
export function frameFirstPerson(
  position: THREE.Vector3, yaw: number, pitch: number,
): ShotComposition {
  const eye = new THREE.Vector3(position.x, position.y + 1.62, position.z);
  const forward = new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch),
  );
  return {
    position: eye,
    lookAt: eye.clone().add(forward.multiplyScalar(10)),
    fov: 65,
  };
}
