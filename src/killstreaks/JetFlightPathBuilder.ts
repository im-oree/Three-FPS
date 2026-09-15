/**
 * JetFlightPathBuilder.ts — Document M §3.
 *
 * Authors the jet's launch-cinematic flight path as a Catmull-Rom spline of
 * four control points: cruise entry -> bank apex -> release (directly above
 * target) -> climbing egress. A spline, not a straight flyby (Document J's
 * airstrike approach): a camera-followed hero moment needs the banking arc,
 * and the arc falls out of control-point placement rather than easing math.
 *
 * Heights are deliberately DIFFERENT per segment (§3.2/§5.3): the jet banks
 * DOWN from cruise to release altitude and climbs back out on egress, so the
 * dive reads as intentional weapon employment.
 */
import * as THREE from 'three';
import { JET_CINEMATIC, MISSILE } from '../utils/Constants';
import type { LevelDefinition } from '../environment/LevelDefinition';

export interface JetFlightPath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly entryPoint: THREE.Vector3;
  readonly bankApex: THREE.Vector3;
  readonly releasePoint: THREE.Vector3;
  readonly egressPoint: THREE.Vector3;
  /** Arc length / FLIGHT_DURATION — the jet's true speed along the curve. */
  readonly cruiseSpeed: number;
  /** §8.1 clip-check sphere (mirrors the GLB's authored bounding radius). */
  readonly jetBoundingRadius: number;
  readonly airspace: {
    readonly centerXZ: readonly [number, number];
    readonly radius: number;
    readonly arrivalAltitude: number;
  };
}

/** Level override, or a default derived from the level's own extents. */
export function airspaceFor(level: LevelDefinition | null): {
  centerXZ: readonly [number, number]; radius: number; arrivalAltitude: number;
} {
  if (level?.killstreakAirspace) return level.killstreakAirspace;
  const ex = level?.worldExtents;
  const cx = ex?.centerX ?? 0;
  const cz = ex?.centerZ ?? 0;
  const radius = ex
    ? Math.max(ex.halfWidth, ex.halfHeight) * 1.15
    : (level?.groundHalfSize ?? 34) * 1.15;
  return { centerXZ: [cx, cz], radius, arrivalAltitude: MISSILE.LAUNCH_ALTITUDE };
}

const _up = new THREE.Vector3(0, 1, 0);

export function buildJetFlightPath(
  level: LevelDefinition | null,
  targetPoint: THREE.Vector3,
  playerPosition: THREE.Vector3,
): JetFlightPath {
  const airspace = airspaceFor(level);
  const center = new THREE.Vector3(airspace.centerXZ[0], 0, airspace.centerXZ[1]);
  const releaseY = airspace.arrivalAltitude;

  // Entry: on the far side of the airspace, rotated a bit off the direct
  // line so the jet is SEEN approaching on a diagonal rather than appearing
  // overhead with no warning.
  const awayFromTarget = new THREE.Vector3()
    .subVectors(playerPosition, targetPoint).setY(0);
  if (awayFromTarget.lengthSq() < 1e-4) awayFromTarget.set(0, 0, 1);
  awayFromTarget.normalize();
  const entryDir = awayFromTarget.clone()
    .applyAxisAngle(_up, THREE.MathUtils.degToRad(35));
  const entryPoint = center.clone()
    .addScaledVector(entryDir, airspace.radius * JET_CINEMATIC.PAD_RADIUS_FACTOR);
  entryPoint.y = releaseY + JET_CINEMATIC.CRUISE_ABOVE_RELEASE; // cruise

  // Bank apex: part-way in, still descending — the first visible turn-in.
  const bankApex = new THREE.Vector3().lerpVectors(entryPoint, targetPoint, 0.35);
  bankApex.y = releaseY + JET_CINEMATIC.CRUISE_ABOVE_RELEASE * 0.45;

  // Release: directly above the designated point, distinctly LOWER than
  // cruise — the visible bank-down.
  const releasePoint = targetPoint.clone();
  releasePoint.y = releaseY;

  // Egress: continue past the target on a curved exit (no sharp reversal —
  // the bank continues), climbing back toward cruise.
  const egressDir = new THREE.Vector3()
    .subVectors(releasePoint, entryPoint).setY(0).normalize()
    .applyAxisAngle(_up, THREE.MathUtils.degToRad(20));
  const egressPoint = releasePoint.clone()
    .addScaledVector(egressDir, airspace.radius * 0.9);
  egressPoint.y = releaseY + JET_CINEMATIC.EGRESS_ABOVE_RELEASE;

  // Tension 0.4: soft arcs, no overshoot past control points.
  const curve = new THREE.CatmullRomCurve3(
    [entryPoint, bankApex, releasePoint, egressPoint], false, 'catmullrom', 0.4,
  );
  const cruiseSpeed = curve.getLength() / JET_CINEMATIC.FLIGHT_DURATION;

  return {
    curve, entryPoint, bankApex, releasePoint, egressPoint,
    cruiseSpeed, airspace, jetBoundingRadius: JET_CINEMATIC.BOUNDING_RADIUS,
  };
}

export default buildJetFlightPath;
