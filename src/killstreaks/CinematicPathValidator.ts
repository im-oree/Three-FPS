/**
 * CinematicPathValidator.ts — Document M §8.1.
 *
 * Deterministic offline clip check for a candidate jet path: samples the
 * spline at fixed density and probes the PHYSICS world (not the render
 * mesh), so it catches both failure modes the document calls out:
 *   GROUND_CLEARANCE  — the jet dips within its bounding radius of terrain
 *                       BETWEEN two safe authored control points,
 *   STRUCTURE_OVERLAP — the bounding sphere reaches into a static prop
 *                       (cranes, walls) — probed with radial rays.
 *
 * Runs at launch-authoring time in the controller (cheap: ~120 samples × 9
 * rays, a few milliseconds once per designation) and from
 * tools/verify/validate-cinematics.mjs as the repeatable QA gate. A real
 * launch never depends on it — the runtime anti-clipping layer remains the
 * in-flight safety net.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export interface CinematicPathIssue {
  readonly t: number;
  readonly type: 'GROUND_CLEARANCE' | 'STRUCTURE_OVERLAP';
  readonly detail: string;
}

const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const RADIAL_RAYS = 8;
const DOWN_PROBE_LENGTH = 500;

export function validateCinematicPath(
  curve: THREE.CatmullRomCurve3,
  physics: PhysicsWorld,
  boundingRadius: number,
  samples = 120,
): CinematicPathIssue[] {
  const issues: CinematicPathIssue[] = [];
  // A radial hit is only meaningful as an OVERLAP if the surface sits well
  // INSIDE the sphere's skin; grazing tangents on the same structure the
  // ground probe covers would double-report otherwise.
  const overlapProbe = boundingRadius * 0.85;

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    curve.getPointAt(t, _p);

    // 1) Ground clearance under this exact sample.
    const groundToi = physics.castRayDistance(_p, DOWN, DOWN_PROBE_LENGTH);
    if (groundToi !== null) {
      const clearance = groundToi; // straight down: toi == vertical distance
      if (clearance < boundingRadius) {
        issues.push({
          t, type: 'GROUND_CLEARANCE',
          detail: `jet within ${clearance.toFixed(1)}m of ground at t=${t.toFixed(2)} (needs ${boundingRadius.toFixed(1)}m)`,
        });
        continue; // already buried: radial probes are redundant here
      }
    }

    // 2) Static structure inside the bounding sphere (radial sweep).
    for (let r = 0; r < RADIAL_RAYS; r += 1) {
      const a = (r / RADIAL_RAYS) * Math.PI * 2;
      _dir.set(Math.cos(a), 0, Math.sin(a));
      const toi = physics.castRayDistance(_p, _dir, overlapProbe);
      if (toi !== null) {
        issues.push({
          t, type: 'STRUCTURE_OVERLAP',
          detail: `structure ${toi.toFixed(1)}m from jet center at t=${t.toFixed(2)}, bearing ${Math.round(THREE.MathUtils.radToDeg(a))}°`,
        });
        break; // one report per sample is enough
      }
    }
  }
  return issues;
}

export default validateCinematicPath;
