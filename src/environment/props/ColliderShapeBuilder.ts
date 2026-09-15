/**
 * ColliderShapeBuilder.ts — Document K §2.3: catalog collider data → Rapier
 * collider descriptors. Compound shapes return one desc per sub-shape with a
 * local offset; the caller attaches them all to a single rigid body (the
 * standard Rapier compound-collider pattern).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { ColliderShape } from './PropCatalog';

export interface BuiltCollider {
  desc: RAPIER.ColliderDesc;
  offset: { x: number; y: number; z: number };
  /** Local rotation within the parent body (Document N §3.3). */
  rotation?: { x: number; y: number; z: number; w: number };
}

export function buildColliderDescs(
  def: ColliderShape, scale = 1,
): BuiltCollider[] {
  switch (def.type) {
    case 'cuboid':
      return [{
        desc: RAPIER.ColliderDesc.cuboid(
          def.halfExtents[0] * scale,
          def.halfExtents[1] * scale,
          def.halfExtents[2] * scale,
        ),
        offset: {
          x: (def.offset?.[0] ?? 0) * scale,
          y: (def.offset?.[1] ?? 0) * scale,
          z: (def.offset?.[2] ?? 0) * scale,
        },
        ...(def.rotation ? {
          rotation: {
            x: def.rotation[0], y: def.rotation[1], z: def.rotation[2], w: def.rotation[3],
          },
        } : {}),
      }];
    case 'cylinder':
      return [{
        desc: RAPIER.ColliderDesc.cylinder(
          def.halfHeight * scale, def.radius * scale,
        ),
        offset: {
          x: (def.offset?.[0] ?? 0) * scale,
          y: (def.offset?.[1] ?? 0) * scale,
          z: (def.offset?.[2] ?? 0) * scale,
        },
        ...(def.rotation ? {
          rotation: {
            x: def.rotation[0], y: def.rotation[1], z: def.rotation[2], w: def.rotation[3],
          },
        } : {}),
      }];
    case 'compound':
      return def.shapes.flatMap((shape) => buildColliderDescs(shape, scale));
    default:
      throw new Error(`Unknown collider shape: ${JSON.stringify(def)}`);
  }
}

/**
 * Apply a BuiltCollider's local placement to its descriptor.
 *
 * Every call site used to do `desc.setTranslation(...)` inline, which silently
 * dropped the rotation the moment Document N introduced rotated sub-shapes
 * (Firing Range's panel-derived building colliders). Funnelling placement
 * through one helper means a rotated shape cannot be half-applied.
 */
export function applyLocalPlacement(built: BuiltCollider): RAPIER.ColliderDesc {
  const desc = built.desc.setTranslation(built.offset.x, built.offset.y, built.offset.z);
  if (built.rotation) desc.setRotation(built.rotation);
  return desc;
}

/** Approximate top of the shape stack, for step-exemption metadata. */
export function colliderTopY(def: ColliderShape, scale = 1): number {
  if (def.type === 'compound') {
    if (!def.shapes.length) return 0;
    return Math.max(...def.shapes.map((s) => colliderTopY(s, scale)));
  }
  const half = def.type === 'cuboid' ? def.halfExtents[1] : def.halfHeight;
  return ((def.offset?.[1] ?? 0) + half) * scale;
}

export default { buildColliderDescs, colliderTopY, applyLocalPlacement };
