/**
 * AntiClipSolver.ts — find an angle that can actually see the subject.
 *
 * The live cinematic camera already pulls back along the view ray when
 * something is in the way, which is the right cheap fix and handles most
 * cases. It has one failure mode: when the camera is behind a wall, pulling
 * back along that ray just slides it up against the wall, and the shot ends
 * up pressed into brickwork half a metre from the subject's face.
 *
 * A replay can afford better, because it is not running physics or AI. So
 * when the preferred angle is blocked this samples a ring of alternatives
 * and picks the best one that can see the subject.
 *
 * THE SCORE IS NOT "FIRST CLEAR ANGLE"
 * ------------------------------------
 * Taking the first unobstructed candidate makes the camera teleport to
 * whatever arbitrary side happened to be sampled first, and jump again the
 * moment the subject moves. Candidates are scored on how far they are from
 * the angle the director actually asked for, so the shot stays as close to
 * the intended composition as the geometry allows and moves smoothly as the
 * obstruction changes.
 */
import * as THREE from 'three';

/** Whatever can answer "is there world between these two points". */
export interface RayProbe {
  /**
   * Cast against static geometry only. Returns distance to the first hit, or
   * null for a clear line. Dynamic bodies are excluded deliberately: a
   * camera that flinched every time a player walked through frame would be
   * unusable, and a body briefly occluding a shot is fine.
   */
  castStatic(
    from: THREE.Vector3, direction: THREE.Vector3, maxDistance: number,
  ): { toi: number } | null;
}

export interface SolveRequest {
  /** Where the director wants the camera. */
  readonly desired: THREE.Vector3;
  /** What it must be able to see. */
  readonly target: THREE.Vector3;
  /** Never sit closer than this to the subject. */
  readonly minDistance?: number;
  /** Clearance kept between the camera and whatever it hit. */
  readonly margin?: number;
  /** Hard floor, so a shot never ends up under the map. */
  readonly minHeight?: number;
}

export interface SolveResult {
  readonly position: THREE.Vector3;
  /** How the answer was reached — for tests and for debugging a bad shot. */
  readonly method: 'clear' | 'pulled-back' | 'reangled' | 'fallback';
  /** Radians between the chosen angle and the one asked for. */
  readonly deviation: number;
}

const DEFAULTS = {
  MIN_DISTANCE: 1.2,
  MARGIN: 0.35,
  MIN_HEIGHT: 0.4,
  /** How far round the ring to look, each side of the desired angle. */
  CONE_HALF_ANGLE: Math.PI * 0.75,
  /** Candidate angles per side. More is smoother and costs more rays. */
  CONE_SAMPLES: 7,
  /** Vertical variants tried at each angle: level, raised, lowered. */
  HEIGHT_OFFSETS: [0, 1.6, -0.8],
} as const;

const _dir = new THREE.Vector3();

/** Is the straight line from `from` to `to` free of static geometry? */
function clearLine(probe: RayProbe, from: THREE.Vector3, to: THREE.Vector3): boolean {
  _dir.subVectors(from, to);
  const distance = _dir.length();
  if (distance < 1e-4) return true;
  _dir.divideScalar(distance);
  const hit = probe.castStatic(to, _dir, distance);
  return !hit || hit.toi >= distance - 1e-3;
}

/**
 * Choose a camera position that can see the target.
 *
 * With no probe (no physics loaded yet, or a headless test) the desired
 * position is returned unchanged rather than guessing -- a solver that
 * invents obstructions it cannot see would be worse than none.
 */
export function solveCameraPosition(
  probe: RayProbe | null, request: SolveRequest,
): SolveResult {
  const {
    desired, target,
    minDistance = DEFAULTS.MIN_DISTANCE,
    margin = DEFAULTS.MARGIN,
    minHeight = DEFAULTS.MIN_HEIGHT,
  } = request;

  if (!probe) return { position: desired.clone(), method: 'clear', deviation: 0 };

  // 1. The easy case.
  if (clearLine(probe, desired, target)) {
    const position = desired.clone();
    position.y = Math.max(position.y, minHeight);
    return { position, method: 'clear', deviation: 0 };
  }

  const offset = new THREE.Vector3().subVectors(desired, target);
  const distance = offset.length();
  const desiredAngle = Math.atan2(offset.x, offset.z);
  const height = offset.y;

  // 2. Pull back along the same ray. Cheap, and preserves the composition
  //    exactly -- so it is always preferred to moving the camera sideways.
  _dir.copy(offset).divideScalar(distance || 1);
  const hit = probe.castStatic(target, _dir, distance);
  if (hit) {
    const pulled = Math.max(minDistance, hit.toi - margin);
    // Only accept it if it bought enough room to be a shot rather than a
    // close-up of someone's shoulder.
    if (pulled > minDistance + 0.3) {
      const position = target.clone().addScaledVector(_dir, pulled);
      position.y = Math.max(position.y, minHeight);
      return { position, method: 'pulled-back', deviation: 0 };
    }
  }

  // 3. Look for a different angle at the same distance. Candidates are
  //    generated outward from the desired angle, so the first acceptable
  //    one found at a given deviation is also the closest to the intent.
  let bestPosition: THREE.Vector3 | null = null;
  let bestDeviation = Infinity;

  for (let i = 1; i <= DEFAULTS.CONE_SAMPLES; i += 1) {
    const spread = (i / DEFAULTS.CONE_SAMPLES) * DEFAULTS.CONE_HALF_ANGLE;
    for (const sign of [1, -1]) {
      const angle = desiredAngle + spread * sign;
      for (const lift of DEFAULTS.HEIGHT_OFFSETS) {
        const candidate = new THREE.Vector3(
          target.x + Math.sin(angle) * distance,
          Math.max(minHeight, target.y + height + lift),
          target.z + Math.cos(angle) * distance,
        );
        if (!clearLine(probe, candidate, target)) continue;
        // Deviation counts the vertical dodge too, so a level shot is
        // preferred to a raised one at the same bearing.
        const deviation = spread + Math.abs(lift) * 0.15;
        if (deviation < bestDeviation) {
          bestDeviation = deviation;
          bestPosition = candidate;
        }
      }
    }
    // Found something at this spread; nothing further out can be closer to
    // the desired angle, so stop rather than casting the remaining rings.
    if (bestPosition) break;
  }

  if (bestPosition) {
    return { position: bestPosition, method: 'reangled', deviation: bestDeviation };
  }

  // 4. Nothing worked -- the subject is inside geometry, or in a sealed
  //    room smaller than the minimum distance. Sit at the minimum distance
  //    along the desired direction: a tight shot beats a shot of a wall.
  const position = target.clone().addScaledVector(_dir, minDistance);
  position.y = Math.max(position.y, minHeight);
  return { position, method: 'fallback', deviation: 0 };
}

/**
 * Adapter from the game's physics world to the probe interface.
 *
 * Kept as a function rather than importing PhysicsWorld so this file has no
 * dependency on Rapier and stays testable with a handful of fake boxes.
 */
export function rayProbeFrom(
  physics: {
    castRayStatic(
      origin: THREE.Vector3, dir: THREE.Vector3, max: number,
    ): { toi: number } | null;
  } | null,
): RayProbe | null {
  if (!physics) return null;
  return {
    castStatic: (from, direction, maxDistance) => physics.castRayStatic(from, direction, maxDistance),
  };
}
