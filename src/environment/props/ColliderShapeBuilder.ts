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
        offset: { x: def.offset?.[0] ?? 0, y: def.offset?.[1] ?? 0, z: def.offset?.[2] ?? 0 },
      }];
    case 'cylinder':
      return [{
        desc: RAPIER.ColliderDesc.cylinder(
          def.halfHeight * scale, def.radius * scale,
        ),
        offset: { x: def.offset?.[0] ?? 0, y: def.offset?.[1] ?? 0, z: def.offset?.[2] ?? 0 },
      }];
    case 'compound':
      return def.shapes.flatMap((shape) => buildColliderDescs(shape, scale));
    default:
      throw new Error(`Unknown collider shape: ${JSON.stringify(def)}`);
  }
}

/** Approximate top of the shape stack, for step-exemption metadata. */
export function colliderTopY(def: ColliderShape, scale = 1): number {
  if (def.type === 'compound') {
    return Math.max(...def.shapes.map((s) => colliderTopY(s, scale)));
  }
  const half = def.type === 'cuboid' ? def.halfExtents[1] : def.halfHeight;
  return (def.offset?.[1] ?? 0) * 1 + half * scale;
}

export default { buildColliderDescs, colliderTopY };
