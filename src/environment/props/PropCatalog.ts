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

/** Local rotation quaternion [x, y, z, w] within the parent body. Document N
 *  §3.3: buildings assembled from rotated kit panels need oriented boxes —
 *  an axis-aligned approximation of a 30-degree wall is a metre of invisible
 *  wall in the wrong place. Omitted means identity. */
export type ColliderRotation = readonly [number, number, number, number];

export type ColliderShape =
  | { readonly type: 'cuboid'; readonly halfExtents: readonly [number, number, number]; readonly offset?: readonly [number, number, number]; readonly rotation?: ColliderRotation }
  | { readonly type: 'cylinder'; readonly halfHeight: number; readonly radius: number; readonly offset?: readonly [number, number, number]; readonly rotation?: ColliderRotation }
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
  /**
   * Document N §4: the entry's compound collider lives in a sidecar JSON at
   * /assets/environment-meta/collider_data/<key>.json, derived at BUILD time
   * from the building's assembled kit panels. Firing Range's 14 structures
   * carry ~250 collider boxes between them; inlining those arrays would
   * quadruple this file for data no human will ever read or edit by hand.
   * resolvePropDefinition() substitutes the loaded shapes in.
   */
  readonly colliderDataKey?: string;
  /**
   * Foliage marker. Vegetation is architecturally just instanced static
   * props, but it needs one behavioural difference: no collision at all
   * (you walk through bushes and grass), and palms collide only on the
   * trunk, which their catalog entry states explicitly.
   */
  readonly foliage?: boolean;
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

  // =========================================================================
  // FIRING RANGE (Document N) — purely ADDITIVE; nothing above changes.
  //
  // BUILDINGS. Each is assembled from BuildingKit panels by a recipe in
  // tools/lib/BuildingRecipes.js, and its compound collider is DERIVED from
  // that assembly at build time into a sidecar JSON — so door, window and
  // frame openings are passable by construction rather than by hand-authored
  // collider boxes. `collider` here is an empty compound placeholder that
  // resolvePropDefinition() fills from the sidecar.
  // =========================================================================
  bldg_wood_unfinished: {
    modelPath: '/assets/models/props/bldg_wood_unfinished.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_wood_unfinished',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  bldg_tin: {
    modelPath: '/assets/models/props/bldg_tin.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_tin',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },
  bldg_watchtower: {
    modelPath: '/assets/models/props/bldg_watchtower.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_watchtower',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },
  bldg_range_shack: {
    modelPath: '/assets/models/props/bldg_range_shack.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_range_shack',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  bldg_white_warehouse: {
    modelPath: '/assets/models/props/bldg_white_warehouse.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_white_warehouse',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'concrete', castShadow: T, receiveShadow: T,
  },
  bldg_armory_bunker: {
    modelPath: '/assets/models/props/bldg_armory_bunker.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_armory_bunker',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'concrete', castShadow: T, receiveShadow: T,
  },
  bldg_red_locker_hut: {
    modelPath: '/assets/models/props/bldg_red_locker_hut.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_red_locker_hut',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  bldg_yellow_shop: {
    modelPath: '/assets/models/props/bldg_yellow_shop.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_yellow_shop',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  bldg_toilets: {
    modelPath: '/assets/models/props/bldg_toilets.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_toilets',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'concrete', castShadow: T, receiveShadow: T,
  },
  bldg_storage_shed: {
    modelPath: '/assets/models/props/bldg_storage_shed.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_storage_shed',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },
  bldg_guard_post: {
    modelPath: '/assets/models/props/bldg_guard_post.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_guard_post',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  bldg_concrete_platform: {
    modelPath: '/assets/models/props/bldg_concrete_platform.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_concrete_platform',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'concrete', castShadow: T, receiveShadow: T,
  },
  bldg_plywood_barricade: {
    modelPath: '/assets/models/props/bldg_plywood_barricade.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_plywood_barricade',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 120,
  },
  bldg_awning_shelter: {
    modelPath: '/assets/models/props/bldg_awning_shelter.glb',
    collider: { type: 'compound', shapes: [] }, colliderDataKey: 'bldg_awning_shelter',
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 120,
  },

  // ---------------- FIRING RANGE SET DRESSING ----------------
  jeep_military: {
    modelPath: '/assets/models/props/jeep_military.glb',
    collider: {
      type: 'compound', shapes: [
        { type: 'cuboid', halfExtents: [0.9, 0.62, 1.78], offset: [0, 0.62, 0] },
        { type: 'cuboid', halfExtents: [0.8, 0.45, 0.1], offset: [0, 1.6, 0.42] },
        { type: 'cuboid', halfExtents: [0.78, 0.1, 0.1], offset: [0, 1.95, -1.2] },
      ],
    },
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
    cullDistance: 140,
  },
  tire_stack: {
    modelPath: '/assets/models/props/tire_stack.glb',
    collider: { type: 'cylinder', halfHeight: 0.76, radius: 0.58 },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'concrete', castShadow: T, receiveShadow: T,
    cullDistance: 110,
  },
  tunnel_culvert: {
    // Hollow: a floor plus two walls, NOT a solid box — players run through it.
    modelPath: '/assets/models/props/tunnel_culvert.glb',
    collider: {
      type: 'compound', shapes: [
        { type: 'cuboid', halfExtents: [1.5, 0.12, 3.7], offset: [0, 0.12, 0] },
        { type: 'cuboid', halfExtents: [0.18, 1.5, 3.7], offset: [-1.5, 1.5, 0] },
        { type: 'cuboid', halfExtents: [0.18, 1.5, 3.7], offset: [1.5, 1.5, 0] },
        { type: 'cuboid', halfExtents: [1.5, 0.18, 3.7], offset: [0, 3.0, 0] },
      ],
    },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },
  trailer_flatbed: {
    modelPath: '/assets/models/props/trailer_flatbed.glb',
    collider: {
      type: 'compound', shapes: [
        { type: 'cuboid', halfExtents: [1.15, 0.35, 3.2], offset: [0, 0.95, 0] },
        { type: 'cuboid', halfExtents: [0.1, 0.3, 3.2], offset: [-1.1, 1.45, 0] },
        { type: 'cuboid', halfExtents: [0.1, 0.3, 3.2], offset: [1.1, 1.45, 0] },
      ],
    },
    physicsBehavior: 'static', instancingEligible: false,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 140,
  },
  target_silhouette: {
    modelPath: '/assets/models/props/target_silhouette.glb',
    collider: { type: 'cuboid', halfExtents: [0.38, 0.85, 0.08], offset: [0, 0.85, 0] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 100,
  },
  ammo_crate_stack: {
    modelPath: '/assets/models/props/ammo_crate_stack.glb',
    collider: {
      type: 'compound', shapes: [
        { type: 'cuboid', halfExtents: [0.55, 0.22, 0.32], offset: [0, 0.22, 0] },
        { type: 'cuboid', halfExtents: [0.55, 0.22, 0.32], offset: [0.06, 0.66, 0.04] },
        { type: 'cuboid', halfExtents: [0.55, 0.22, 0.32], offset: [-0.05, 1.1, -0.06] },
      ],
    },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
    cullDistance: 110,
  },
  fuel_drum_cluster: {
    modelPath: '/assets/models/props/fuel_drum_cluster.glb',
    collider: {
      type: 'compound', shapes: [
        { type: 'cylinder', halfHeight: 0.44, radius: 0.3, offset: [0, 0.44, 0] },
        { type: 'cylinder', halfHeight: 0.44, radius: 0.3, offset: [0.66, 0.44, 0.14] },
        { type: 'cylinder', halfHeight: 0.44, radius: 0.3, offset: [0.3, 0.44, 0.72] },
        { type: 'cylinder', halfHeight: 0.44, radius: 0.3, offset: [0.32, 1.34, 0.3] },
      ],
    },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
    cullDistance: 120,
  },
  sandbag_nest: {
    modelPath: '/assets/models/props/sandbag_nest.glb',
    collider: { type: 'cuboid', halfExtents: [1.45, 0.48, 0.42], offset: [0, 0.48, 0.04] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'concrete', castShadow: T, receiveShadow: T,
    cullDistance: 110,
  },
  beam_walk: {
    modelPath: '/assets/models/props/beam_walk.glb',
    collider: { type: 'cuboid', halfExtents: [0.26, 0.11, 3.0], offset: [0, 0.09, 0] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  range_flag: {
    modelPath: '/assets/models/props/range_flag.glb',
    collider: { type: 'cylinder', halfHeight: 2.1, radius: 0.1, offset: [0, 2.1, 0] },
    physicsBehavior: 'static', instancingEligible: T,
    surfaceTag: 'metal_container', castShadow: T, receiveShadow: T,
  },

  // ---------------- VEGETATION ----------------
  // Palms collide on the TRUNK only: a capsule stopped by a frond 6 m up
  // reads as an invisible wall. Bushes and grass do not collide at all.
  palm_tree_a: {
    modelPath: '/assets/models/props/palm_tree_a.glb',
    collider: { type: 'cylinder', halfHeight: 3.7, radius: 0.26, offset: [0, 3.7, 0] },
    // NOT instanced: Document N requires palms to sway INDIVIDUALLY, and an
    // InstancedMesh shares one geometry across every instance. Cloned-static
    // gives each palm its own crown node for WindSwayAnimator to rotate.
    physicsBehavior: 'static', instancingEligible: false, foliage: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  palm_tree_b: {
    modelPath: '/assets/models/props/palm_tree_b.glb',
    collider: { type: 'cylinder', halfHeight: 3.1, radius: 0.26, offset: [0, 3.1, 0] },
    // NOT instanced: Document N requires palms to sway INDIVIDUALLY, and an
    // InstancedMesh shares one geometry across every instance. Cloned-static
    // gives each palm its own crown node for WindSwayAnimator to rotate.
    physicsBehavior: 'static', instancingEligible: false, foliage: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  palm_tree_c: {
    modelPath: '/assets/models/props/palm_tree_c.glb',
    collider: { type: 'cylinder', halfHeight: 4.3, radius: 0.26, offset: [0, 4.3, 0] },
    // NOT instanced: Document N requires palms to sway INDIVIDUALLY, and an
    // InstancedMesh shares one geometry across every instance. Cloned-static
    // gives each palm its own crown node for WindSwayAnimator to rotate.
    physicsBehavior: 'static', instancingEligible: false, foliage: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  jungle_tree_a: {
    modelPath: '/assets/models/props/jungle_tree_a.glb',
    collider: { type: 'cylinder', halfHeight: 2.2, radius: 0.32, offset: [0, 2.2, 0] },
    physicsBehavior: 'static', instancingEligible: T, foliage: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  jungle_tree_b: {
    modelPath: '/assets/models/props/jungle_tree_b.glb',
    collider: { type: 'cylinder', halfHeight: 2.2, radius: 0.32, offset: [0, 2.2, 0] },
    physicsBehavior: 'static', instancingEligible: T, foliage: T,
    surfaceTag: 'wood_pallet', castShadow: T, receiveShadow: T,
  },
  jungle_bush: {
    modelPath: '/assets/models/props/jungle_bush.glb',
    collider: { type: 'compound', shapes: [] }, // walk-through
    physicsBehavior: 'static', instancingEligible: T, foliage: T,
    surfaceTag: 'dirt', castShadow: T, receiveShadow: T,
    cullDistance: 85,
  },
  grass_tuft: {
    modelPath: '/assets/models/props/grass_tuft.glb',
    collider: { type: 'compound', shapes: [] }, // walk-through
    physicsBehavior: 'static', instancingEligible: T, foliage: T,
    surfaceTag: 'dirt', castShadow: false, receiveShadow: T,
    cullDistance: 55,
  },
};

// ---------------------------------------------------------------------------
// Sidecar collider data (Document N §4)
// ---------------------------------------------------------------------------

const colliderDataCache = new Map<string, ColliderShape[]>();

/**
 * Preload every sidecar collider file a manifest's prop types need. Called by
 * MapBuilder before placement, because collider resolution itself is
 * synchronous (PropPool places instances inside a tight loop) — fetching
 * lazily from there would mean placing props before their collision exists.
 */
export async function preloadColliderData(propTypeIds: Iterable<string>): Promise<void> {
  const pending: Promise<void>[] = [];
  const seen = new Set<string>();
  for (const id of propTypeIds) {
    const entry = PropCatalog[id];
    const key = entry?.colliderDataKey;
    if (!key || seen.has(key) || colliderDataCache.has(key)) continue;
    seen.add(key);
    pending.push(
      fetch(`/assets/environment-meta/collider_data/${key}.json`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((shapes: ColliderShape[]) => { colliderDataCache.set(key, shapes); })
        .catch((err) => {
          // A building with no collision is worse than a loud failure: it
          // looks solid and players fall through it. Log hard, keep going.
          console.error(`PropCatalog: collider sidecar '${key}' failed to load —`, err);
          colliderDataCache.set(key, []);
        }),
    );
  }
  await Promise.all(pending);
}

export function isColliderDataLoaded(key: string): boolean {
  return colliderDataCache.has(key);
}

/** Substitute a sidecar-loaded compound collider, if the entry uses one. */
function withColliderData(def: PropDefinition): PropDefinition {
  if (!def.colliderDataKey) return def;
  const shapes = colliderDataCache.get(def.colliderDataKey);
  if (!shapes) {
    console.warn(
      `PropCatalog: collider data '${def.colliderDataKey}' not preloaded — `
      + 'prop will be placed WITHOUT collision. Call preloadColliderData() first.',
    );
    return def;
  }
  return { ...def, collider: { type: 'compound', shapes } };
}

/** Merge `extends` chains into a flat, fully-populated definition. */
export function resolvePropDefinition(id: string): PropDefinition {
  const entry = PropCatalog[id];
  if (!entry) throw new Error(`PropCatalog: unknown propType '${id}'`);
  if (!entry.extends) return withColliderData(entry);
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
  return withColliderData(merged as unknown as PropDefinition);
}

export default PropCatalog;
