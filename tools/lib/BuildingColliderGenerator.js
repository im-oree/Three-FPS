/**
 * BuildingColliderGenerator.js — Document N §3.3: compound collision derived
 * from an assembled panel recipe, at BUILD TIME.
 *
 * Walks a building's hierarchy and emits a list of oriented-box collider
 * shapes in the PropCatalog `{ type: 'compound', shapes }` format that
 * ColliderShapeBuilder already consumes (Document K §2.3) — so ~14 distinct
 * structures get correct, opening-aware collision with zero hand-authored
 * collider boxes and zero new runtime collider code.
 *
 * Two details that make the result actually correct rather than approximately
 * correct:
 *
 *   1. It reads BuildingKit's userData.collision tags ('solid' | 'floor' |
 *      'skip'). A naive "one AABB per mesh" walk would wrap ladder rungs,
 *      corrugation ribs, camo netting and railing posts in solid boxes and
 *      seal the doorways shut. Door/window panels are already built as
 *      separate pillar/lintel/sill meshes, so real, passable openings fall out
 *      of the tagged walk for free.
 *
 *   2. It emits ROTATED boxes, not world-axis-aligned ones. A wall panel
 *      rotated 30 degrees has a world AABB far thicker than the wall — and on
 *      a map whose buildings sit at arbitrary yaw, AABB-only collision is what
 *      produces invisible walls a metre off the geometry. Each shape carries a
 *      quaternion taken from the mesh's local-to-building matrix, and
 *      ColliderShapeBuilder applies it to the Rapier collider desc.
 *
 * Output is written to a sidecar JSON (assets/environment-meta/collider_data/)
 * that PropCatalog lazy-loads, keeping the runtime catalog free of giant
 * inlined shape arrays while staying fully data-driven.
 */
import * as THREE from 'three';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();

const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * @param {THREE.Object3D} buildingRoot assembled recipe output
 * @param {object} opts
 * @param {number} opts.minVolume  drop slivers below this (m^3) — collision
 *                                 noise costs query time and buys nothing.
 * @returns {Array} PropCatalog-compatible collider shapes
 */
export function generateBuildingCompoundCollider(buildingRoot, { minVolume = 0.004 } = {}) {
  buildingRoot.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(buildingRoot.matrixWorld).invert();
  const shapes = [];

  buildingRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    const tag = obj.userData?.collision;
    // Untagged meshes default to SOLID: a new panel author forgetting a tag
    // gets over-collision (obvious, reported by the audit) rather than a
    // player falling through a floor (subtle, ships).
    if (tag === 'skip') return;

    const geometry = obj.geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return;

    // Local-space size and centre of this mesh's own geometry...
    const size = new THREE.Vector3();
    bb.getSize(size);
    const center = new THREE.Vector3();
    bb.getCenter(center);

    // ...transformed into the BUILDING's space, preserving rotation.
    _mat.multiplyMatrices(rootInverse, obj.matrixWorld);
    _mat.decompose(_pos, _quat, _scale);
    center.applyMatrix4(_mat);
    const half = [
      Math.abs(size.x * _scale.x) / 2,
      Math.abs(size.y * _scale.y) / 2,
      Math.abs(size.z * _scale.z) / 2,
    ];
    // Rapier rejects degenerate colliders; give paper-thin panels a floor.
    const halfExtents = half.map((h) => Math.max(h, 0.012));
    // The sliver filter exists to discard incidental decorative geometry that
    // was never tagged. An EXPLICIT 'solid'/'floor' tag is author intent and
    // always survives it — ladder rungs are 0.0034 m^3 each and were being
    // silently culled, which left the watchtower's only access route
    // non-collidable while every visual check still looked correct.
    const explicit = tag === 'solid' || tag === 'floor';
    if (!explicit && halfExtents[0] * halfExtents[1] * halfExtents[2] * 8 < minVolume) return;

    const shape = {
      type: 'cuboid',
      halfExtents: halfExtents.map(r3),
      offset: [r3(center.x), r3(center.y), r3(center.z)],
    };
    // Only carry a rotation when there IS one — keeps the JSON readable and
    // lets the runtime take the cheaper axis-aligned path for most panels.
    if (Math.abs(_quat.x) > 1e-4 || Math.abs(_quat.y) > 1e-4
      || Math.abs(_quat.z) > 1e-4 || _quat.w < 0.9999) {
      shape.rotation = [r4(_quat.x), r4(_quat.y), r4(_quat.z), r4(_quat.w)];
    }
    shapes.push(shape);
  });

  return shapes;
}

/** Union AABB of the generated shapes — used for culling bounds + audits. */
export function colliderBounds(shapes) {
  const box = new THREE.Box3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const s of shapes) {
    if (s.rotation) q.set(...s.rotation); else q.identity();
    m.makeRotationFromQuaternion(q).setPosition(s.offset[0], s.offset[1], s.offset[2]);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          v.set(s.halfExtents[0] * sx, s.halfExtents[1] * sy, s.halfExtents[2] * sz)
            .applyMatrix4(m);
          box.expandByPoint(v);
        }
      }
    }
  }
  return box;
}

export default { generateBuildingCompoundCollider, colliderBounds };
