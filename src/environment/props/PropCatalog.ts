/**
 * PropCatalog.ts — Document K §2.1: the project-wide registry of every
 * placeable environment prop. Maps reference entries by id from their
 * placement manifests; entries are shared across every map the project loads
 * (nothing here is Shipment-specific).
 *
 * Colliders are data (ColliderShapeBuilder turns them into Rapier descs) and
 * always match the placement transform — a prop's collision IS its catalog
 * shape, so visual/collision divergence by construction cannot happen.
 */

export type ColliderShape =
  | { readonly type: 'cuboid'; readonly halfExtents: readonly [number, number, number]; readonly offset?: readonly [number, number, number] }
  | { readonly type: 'cylinder'; readonly halfHeight: number; readonly radius: number; readonly offset?: readonly [number, number, number] }
  | { readonly type: 'compound'; readonly shapes: readonly ColliderShape[] };

export type PhysicsBehavior = 'static' | 'dynamic';

export interface PropDefinition {
  /** Resolved path under /assets. */
  readonly modelPath: string;
  /** Paint slot color variant (MaterialVariantLibrary) — containers etc. */
  readonly materialVariant?: string;
  readonly collider: ColliderShape;
  readonly physicsBehavior: PhysicsBehavior;
  readonly instancingEligible: boolean;
  readonly surfaceTag: string;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  /** dynamic-only: mass / response tuning. */
  readonly mass?: number;
  readonly restitution?: number;
  readonly friction?: number;
  readonly health?: number;
  readonly explodesOnDestroy?: boolean;
  /** Explosion payload the prop detonates with (barrelPop preset). */
  readonly explosion?: {
    readonly presetId: string;
    readonly radius: number;
    readonly maxDamage: number;
  };
  /** 'sway' — CraneSwayAnimator gets attached to the placed clone. */
  readonly animated?: 'sway';
  /** FrustumCullingManager distance band (metres). Omit for large props that
   *  should only ever be frustum-culled (containers, towers, cranes). Small
   *  dressing declares a band so it stops existing past it. */
  readonly cullDistance?: number;
  /** A live point light spawned at the model's LampHead node. */
  readonly emissiveLight?: {
    readonly color: string;
    readonly intensity: number;
    readonly distance: number;
  };
  /** Declarative near-duplicate variants (color swaps etc.). */
  readonly extends?: string;
}

const T = true;

export const PropCatalog: Record<string, PropDefinition> = {
  // ---------------- SHIPPING CONTAINERS (real ISO 668 dims) ----------------
  container_40ft_red: {
    modelPath: '/assets/models/props/container_40ft.glb',
    materialVariant: 'red',
    collider: { type: 'cuboid', halfExtents: [1.22, 1.3, 6.1] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },
  container_40ft_blue: {
    modelPath: '/assets/models/props/container_40ft.glb',
    materialVariant: 'blue',
    collider: { type: 'cuboid', halfExtents: [1.22, 1.3, 6.1] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },
  container_40ft_green: {
    modelPath: '/assets/models/props/container_40ft.glb',
    materialVariant: 'green',
    collider: { type: 'cuboid', halfExtents: [1.22, 1.3, 6.1] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },
  container_40ft_rust: {
    modelPath: '/assets/models/props/container_40ft.glb',
    materialVariant: 'rust',
    collider: { type: 'cuboid', halfExtents: [1.22, 1.3, 6.1] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },
  container_20ft_teal: {
    modelPath: '/assets/models/props/container_20ft.glb',
    materialVariant: 'teal',
    collider: { type: 'cuboid', halfExtents: [1.22, 1.3, 3.05] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },

  // ---------------- PHYSICS-INTERACTIVE PROPS ----------------
  oil_barrel: {
    modelPath: '/assets/models/props/oil_barrel.glb',
    collider: { type: 'cylinder', halfHeight: 0.44, radius: 0.29 },
    physicsBehavior: 'dynamic', mass: 18, restitution: 0.15, friction: 0.6,
    instancingEligible: false,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
    health: 120, explodesOnDestroy: false,
  },
  oil_barrel_explosive: {
    modelPath: '/assets/models/props/oil_barrel.glb',
    materialVariant: 'hazard_red',
    collider: { type: 'cylinder', halfHeight: 0.44, radius: 0.29 },
    physicsBehavior: 'dynamic', mass: 18, restitution: 0.15, friction: 0.6,
    instancingEligible: false,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
    health: 40, explodesOnDestroy: true,
    explosion: { presetId: 'barrelPop', radius: 5, maxDamage: 60 },
  },
  wood_pallet: {
    modelPath: '/assets/models/props/wood_pallet.glb',
    collider: { type: 'cuboid', halfExtents: [0.6, 0.075, 0.6] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 90,
  },
  crate_wood_small: {
    modelPath: '/assets/models/props/crate_wood_small.glb',
    collider: { type: 'cuboid', halfExtents: [0.45, 0.45, 0.45] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 90,
  },
  crate_wood_stacked: {
    modelPath: '/assets/models/props/crate_wood_stacked.glb',
    collider: {
      type: 'compound', shapes: [
        { type: 'cuboid', halfExtents: [0.45, 0.45, 0.45], offset: [0, 0.45, 0] },
        { type: 'cuboid', halfExtents: [0.45, 0.45, 0.45], offset: [0.05, 1.35, 0] },
        { type: 'cuboid', halfExtents: [0.45, 0.45, 0.45], offset: [-0.08, 2.25, 0.05] },
      ],
    },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 100,
  },
  cable_spool: {
    modelPath: '/assets/models/props/cable_spool.glb',
    collider: { type: 'cuboid', halfExtents: [0.48, 0.78, 0.78] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 90,
  },
  sandbag_wall_short: {
    modelPath: '/assets/models/props/sandbag_wall.glb',
    collider: { type: 'cuboid', halfExtents: [0.85, 0.4, 0.35] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'concrete', castShadow: T, receiveShadow: T,
    cullDistance: 80,
  },

  // ---------------- VEHICLES / MACHINERY (set dressing) ----------------
  forklift: {
    modelPath: '/assets/models/props/forklift.glb',
    collider: {
      type: 'compound', shapes: [
        { type: 'cuboid', halfExtents: [0.6, 0.62, 1.15], offset: [0, 0.62, -0.1] },
        { type: 'cuboid', halfExtents: [0.06, 0.9, 0.06], offset: [0.42, 0.9, 1.12] },
        { type: 'cuboid', halfExtents: [0.06, 0.9, 0.06], offset: [-0.42, 0.9, 1.12] },
        { type: 'cuboid', halfExtents: [0.45, 0.12, 0.5], offset: [0, 0.34, 1.65] },
      ],
    },
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
    cullDistance: 120,
  },
  cargo_crane: {
    modelPath: '/assets/models/props/cargo_crane.glb',
    collider: {
      type: 'compound', shapes: [
        { type: 'cuboid', halfExtents: [0.55, 8, 0.55], offset: [3.4, 8, 2.6] },
        { type: 'cuboid', halfExtents: [0.55, 8, 0.55], offset: [-3.4, 8, 2.6] },
        { type: 'cuboid', halfExtents: [0.55, 8, 0.55], offset: [3.4, 8, -2.6] },
        { type: 'cuboid', halfExtents: [0.55, 8, 0.55], offset: [-3.4, 8, -2.6] },
      ],
    },
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
    animated: 'sway',
  },
  chainlink_fence_section: {
    modelPath: '/assets/models/props/chainlink_fence.glb',
    collider: { type: 'cuboid', halfExtents: [1.5, 1.0, 0.04] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container',
    // Thin mesh casting shadows reads badly at low-poly; deliberately off.
    castShadow: false, receiveShadow: T,
    cullDistance: 110,
  },
  shipping_yard_light: {
    modelPath: '/assets/models/props/light_tower.glb',
    collider: { type: 'cylinder', halfHeight: 3.5, radius: 0.15 },
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'concrete', castShadow: T, receiveShadow: T,
    emissiveLight: { color: '#ffe9c2', intensity: 2.2, distance: 18 },
  },
};

/** Merge `extends` chains into a flat, fully-populated definition. */
export function resolvePropDefinition(id: string): PropDefinition {
  const entry = PropCatalog[id];
  if (!entry) throw new Error(`PropCatalog: unknown propType '${id}'`);
  if (!entry.extends) return entry;
  const seen = new Set<string>([id]);
  let merged: Record<string, unknown> = {};
  let cursor = id;
  const chain: string[] = [];
  while (cursor) {
    if (seen.has(cursor) && cursor !== id) throw new Error(`PropCatalog: extends cycle at '${cursor}'`);
    seen.add(cursor);
    chain.push(cursor);
    const next = PropCatalog[cursor].extends;
    cursor = next ?? '';
  }
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    merged = { ...merged, ...PropCatalog[chain[i]] };
  }
  delete merged.extends;
  return merged as unknown as PropDefinition;
}

export default PropCatalog;
