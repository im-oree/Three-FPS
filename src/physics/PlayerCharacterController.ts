/**
 * PlayerCharacterController.ts — Rapier's KinematicCharacterController as a
 * DROP-IN replacement for the hand-rolled PlayerCollider (Document C §4.2).
 *
 * Same three-method contract PlayerMovement already consumes (zero movement
 * simulation changes — the acceleration/friction/jump math is untouched):
 *   raycastDown(origin, maxDistance)              → ground hit or null
 *   raycastUp(origin, distance)                   → headroom hit or null
 *   resolveHorizontalCollision(pos, delta, r, h)  → corrected delta
 *
 * Semantics preserved from the original implementation:
 *   - Step-up pass-through: colliders whose top is within PLAYER.MAX_STEP_HEIGHT
 *     of the feet are EXCLUDED from the horizontal query (filterPredicate) —
 *     ground snapping (PlayerMovement, unchanged) does the climbing.
 *   - Ground/ceiling probes are capsule-footprint samples (centre + rim rays)
 *     so probe results near box rims match the capsule footprint, matching the
 *     original radius-expanded Minkowski convention.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PLAYER } from '../utils/Constants';
import type { PhysicsWorld } from './PhysicsWorld';
import type { ColliderFactory } from './ColliderFactory';

export interface CollisionHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

const RIM_EPSILON = 0.85; // rim rays sit at this × capsule radius
/** Hits closer than this are origins inside geometry, not surfaces. */
const INSIDE_EPSILON = 0.002;
/** Phantom lift (m) keeping the query capsule clear of the floor contact. */
const KCC_LIFT = 0.15;

export class PlayerCharacterController {
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private collider: RAPIER.Collider;
  private builtHeight = -1;
  private builtRadius = -1;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly factory: ColliderFactory,
    spawnFeet: THREE.Vector3,
  ) {
    const center = spawnFeet.clone();
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z),
    );
    this.controller = physics.world.createCharacterController(0.01);
    // Slope handling (Document C §4.2): walkable slopes climb, steep slides
    // slide; step CLIMBING stays with PlayerMovement's snap (see predicate).
    this.controller.setMaxSlopeClimbAngle(50 * (Math.PI / 180));
    this.controller.setMinSlopeSlideAngle(55 * (Math.PI / 180));
    this.collider = this.buildCapsule(PLAYER.CAPSULE_RADIUS, PLAYER.STAND_HEIGHT);
    this.physics.ensureStepped();
  }

  /** (Re)build the capsule collider when crouch/slide changes the height. */
  private buildCapsule(radius: number, totalHeight: number): RAPIER.Collider {
    const halfHeight = Math.max(0.01, (totalHeight - 2 * radius) / 2);
    return this.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius),
      this.body,
    );
  }

  private syncCapsule(position: THREE.Vector3, radius: number, capsuleHeight: number): void {
    // position is the FEET (PlayerMovement convention); the Rapier capsule
    // origin is its centre. The body rides KCC_LIFT above the feet so the
    // capsule never rests IN CONTACT with the floor: contacts inside the
    // character offset cannot be predicate-filtered and would block every
    // horizontal slide (observed: full block on the floor top). Vertical
    // placement is PlayerMovement's business — this body is query-only.
    const halfHeight = Math.max(0.01, (capsuleHeight - 2 * radius) / 2);
    if (Math.abs(capsuleHeight - this.builtHeight) > 1e-3 || Math.abs(radius - this.builtRadius) > 1e-4) {
      this.physics.world.removeCollider(this.collider, false);
      this.collider = this.buildCapsule(radius, capsuleHeight);
      this.builtHeight = capsuleHeight;
      this.builtRadius = radius;
    }
    const centerY = position.y + halfHeight + radius + KCC_LIFT;
    this.body.setTranslation({ x: position.x, y: centerY, z: position.z }, true);
  }

  /**
   * Horizontal capsule slide against static colliders via the KCC. Vertical
   * motion is deliberately NOT part of this query (PlayerMovement integrates
   * gravity and does its own step snapping — unchanged feel).
   */
  resolveHorizontalCollision(
    position: THREE.Vector3,
    desiredDelta: THREE.Vector3,
    capsuleRadius: number,
    capsuleHeight: number,
  ): THREE.Vector3 {
    this.syncCapsule(position, capsuleRadius, capsuleHeight);
    this.physics.ensureStepped(); // applies the kinematic teleport NOW

    const desired = { x: desiredDelta.x, y: 0, z: desiredDelta.z };
    // Step-exemption predicate: colliders whose TOP is within the step budget
    // are NOT walls (PlayerMovement's snap climbs them). Top is read from the
    // collider's own transform/shape — the closure's collider wrapper may be
    // a temp over recycled wasm memory, so handle-keyed lookups are unsafe.
    const feetY = position.y;
    const exclude = (collider: RAPIER.Collider): boolean => {
      const t = collider.translation();
      const shape = collider.shape as unknown as { halfExtents?: { y: number } } | undefined;
      const halfY = shape?.halfExtents?.y;
      if (halfY === undefined) return false; // unknown shape → treat as solid
      return t.y + halfY <= feetY + PLAYER.MAX_STEP_HEIGHT;
    };
    this.controller.computeColliderMovement(this.collider, desired, undefined, undefined, exclude);
    const mv = this.controller.computedMovement();
    const corrected = new THREE.Vector3(mv.x, 0, mv.z);
    // Read collision identities SYNCHRONOUSLY (the record's wasm memory is
    // recycled by the next query — deferred reads see garbage).
    const colliderIds: { handle: number; topY: number }[] = [];
    for (let i = 0; i < this.controller.numComputedCollisions(); i += 1) {
      const c = this.controller.computedCollision(i)?.collider;
      if (c) colliderIds.push({ handle: c.handle, topY: this.factory.topYOf(c.handle) });
    }
    return corrected;
  }

  /** Downward capsule-footprint probe (centre + 4 rim rays), statics only.
   *  Hits with toi≈0 are origins INSIDE geometry (rim rays crossing a wall
   *  face): treating them as ground snap-laddered the player up walls. */
  raycastDown(origin: THREE.Vector3, maxDistance: number): CollisionHit | null {
    const down = new THREE.Vector3(0, -1, 0);
    let best: CollisionHit | null = null;
    for (const offset of this.footprint()) {
      const o = origin.clone().add(offset);
      const toi = this.physics.castRayDistance(o, down, maxDistance);
      if (toi !== null && toi > INSIDE_EPSILON && (!best || toi < best.distance)) {
        best = {
          point: new THREE.Vector3(o.x, origin.y - toi, o.z),
          normal: new THREE.Vector3(0, 1, 0),
          distance: toi,
        };
      }
    }
    return best;
  }

  /**
   * What surface is directly under the player (Document 4/5: footstep and
   * landing audio). Returns the ColliderFactory surface tag of whatever the
   * downward ray hits, or null when airborne.
   */
  groundSurfaceAt(origin: THREE.Vector3, maxDistance = 2.2): string | null {
    const hit = this.physics.castRayStatic(origin, new THREE.Vector3(0, -1, 0), maxDistance);
    if (!hit) return null;
    return this.factory.surfaceOf(hit.collider.handle);
  }

  /** Upward capsule-footprint probe (headroom for stand-up checks). */
  raycastUp(origin: THREE.Vector3, distance: number): CollisionHit | null {
    const up = new THREE.Vector3(0, 1, 0);
    let best: CollisionHit | null = null;
    for (const offset of this.footprint()) {
      const o = origin.clone().add(offset);
      const toi = this.physics.castRayDistance(o, up, distance);
      if (toi !== null && toi > INSIDE_EPSILON && (!best || toi < best.distance)) {
        best = {
          point: new THREE.Vector3(o.x, origin.y + toi, o.z),
          normal: new THREE.Vector3(0, -1, 0),
          distance: toi,
        };
      }
    }
    return best;
  }

  /**
   * Arbitrary-direction static probe (FPS/TPS Spec §2 vault raycasts).
   * Single ray, not a footprint sweep: the traversal probes deliberately
   * sample precise points (torso height, above the lip, the landing pad)
   * rather than a capsule envelope, so a footprint spread would smear the
   * exact ledge geometry the Bezier is built from.
   */
  raycastHorizontal(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): CollisionHit | null {
    const dir = direction.clone().normalize();
    const hit = this.physics.castRayStatic(origin, dir, maxDistance);
    if (!hit || hit.toi <= INSIDE_EPSILON) return null;
    return { point: hit.point, normal: hit.normal, distance: hit.toi };
  }

  /** Centre + rim sample points of the capsule footprint. */
  private footprint(): THREE.Vector3[] {
    const r = PLAYER.CAPSULE_RADIUS * RIM_EPSILON;
    return [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(r, 0, 0),
      new THREE.Vector3(-r, 0, 0),
      new THREE.Vector3(0, 0, r),
      new THREE.Vector3(0, 0, -r),
    ];
  }

  /** TEST seam: grounded flag from the last KCC evaluation. */
  get lastGrounded(): boolean {
    return this.controller.computedGrounded();
  }

  /** TEST seam: the live query-body pose (feet-equivalent Z). */
  debugBodyPose(): { x: number; y: number; z: number } {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** TEST seam: last horizontal query outcome (desired vs corrected). */
}

export default PlayerCharacterController;
