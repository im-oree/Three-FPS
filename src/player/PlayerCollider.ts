/**
 * PlayerCollider.ts — capsule-vs-static-geometry queries for movement.
 *
 * INTEGRATION CONTRACT (Document 2 §13.1, honoured for Document 4): this class
 * knows NOTHING about where collision data comes from. It consumes a plain
 * list of axis-aligned boxes injected via the constructor. Document 4 will
 * replace the TestArena's hardcoded box list with a CollisionWorld populated
 * from loaded level geometry by changing ONLY what is passed here —
 * PlayerMovement and PlayerController calling code stays untouched.
 *
 * Queries exposed:
 *   raycastDown(origin, maxDistance)            -> ground hit or null
 *   raycastUp(origin, distance)                 -> headroom hit or null
 *   resolveHorizontalCollision(pos, delta, r, h)-> corrected delta (per-axis)
 */
import * as THREE from 'three';
import { PLAYER } from '../utils/Constants';

export interface CollisionHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

export class PlayerCollider {
  private readonly boxes: THREE.Box3[];

  constructor(boxes: THREE.Box3[]) {
    this.boxes = boxes;
  }

  /** Downward probe from `origin` (capsule centre-ish) for ground detection.
   *  Boxes are expanded by PLAYER.RADIUS in XZ so the probe represents the
   *  whole capsule footprint (same Minkowski convention as solidAt) — without
   *  it, ground/ceiling checks near box rims disagree with horizontal
   *  collision and can deadlock (e.g. standing up while the capsule rim still
   *  overlaps a low slab blocks walking forever). */
  raycastDown(origin: THREE.Vector3, maxDistance: number): CollisionHit | null {
    let best: CollisionHit | null = null;
    const r = PLAYER.CAPSULE_RADIUS;
    for (const box of this.boxes) {
      if (origin.x < box.min.x - r || origin.x > box.max.x + r) continue;
      if (origin.z < box.min.z - r || origin.z > box.max.z + r) continue;
      if (box.max.y > origin.y + 1e-4) continue; // surface above origin: not ground
      const distance = origin.y - box.max.y;
      if (distance < 0 || distance > maxDistance) continue;
      if (!best || distance < best.distance) {
        best = { point: new THREE.Vector3(origin.x, box.max.y, origin.z), normal: new THREE.Vector3(0, 1, 0), distance };
      }
    }
    return best;
  }

  /** Upward probe for stand-up headroom checks (crouch/slide exit).
   *  Radius-expanded in XZ like raycastDown: headroom must be clear for the
   *  whole capsule column, not just its centre line. */
  raycastUp(origin: THREE.Vector3, distance: number): CollisionHit | null {
    let best: CollisionHit | null = null;
    const r = PLAYER.CAPSULE_RADIUS;
    for (const box of this.boxes) {
      if (origin.x < box.min.x - r || origin.x > box.max.x + r) continue;
      if (origin.z < box.min.z - r || origin.z > box.max.z + r) continue;
      if (box.min.y < origin.y - 1e-4) continue; // surface below origin: not ceiling
      const gap = box.min.y - origin.y;
      if (gap < 0 || gap > distance) continue;
      if (!best || gap < best.distance) {
        best = { point: new THREE.Vector3(origin.x, box.min.y, origin.z), normal: new THREE.Vector3(0, -1, 0), distance: gap };
      }
    }
    return best;
  }

  /**
   * Slide the capsule's horizontal move per-axis against solid boxes.
   * Obstacles whose top is within PLAYER.MAX_STEP_HEIGHT are NOT walls: they
   * are step-up candidates and ground snapping (PlayerMovement) handles them.
   * Returns the corrected horizontal delta.
   */
  resolveHorizontalCollision(
    position: THREE.Vector3,
    desiredDelta: THREE.Vector3,
    capsuleRadius: number,
    capsuleHeight: number,
  ): THREE.Vector3 {
    const corrected = new THREE.Vector3(desiredDelta.x, 0, desiredDelta.z);
    const probe = new THREE.Vector3();

    probe.set(position.x + corrected.x, position.y, position.z);
    if (this.solidAt(probe, capsuleRadius, capsuleHeight)) corrected.x = 0;
    probe.set(position.x + corrected.x, position.y, position.z + corrected.z);
    if (this.solidAt(probe, capsuleRadius, capsuleHeight)) corrected.z = 0;
    return corrected;
  }

  /** Point-vs-boxes test with the capsule approximated as a radius-expanded column. */
  private solidAt(point: THREE.Vector3, radius: number, capsuleHeight: number): boolean {
    for (const box of this.boxes) {
      // Step-up passable surfaces are not horizontal blockers.
      if (box.max.y <= point.y + PLAYER.MAX_STEP_HEIGHT) continue;
      // Vertical overlap with the capsule column.
      if (box.min.y >= point.y + capsuleHeight) continue;
      if (
        point.x > box.min.x - radius && point.x < box.max.x + radius &&
        point.z > box.min.z - radius && point.z < box.max.z + radius
      ) {
        return true;
      }
    }
    return false;
  }
}

export default PlayerCollider;
