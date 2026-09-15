/**
 * LevelDefinition.ts — Document 4/5: a level is DATA.
 *
 * Every level is described as boxes with surface tags, spawn points, light
 * settings and an ambience key. LevelLoader turns one of these into real
 * meshes + Rapier colliders and can tear it all down again, so adding a level
 * is authoring a definition, never writing loader code.
 *
 * Surface tags feed both footstep audio and impact effects, so any tag used
 * here must have matching entries in SoundLibrary.
 */

export interface LevelBox {
  /** Min corner. */
  min: readonly [number, number, number];
  /** Max corner. */
  max: readonly [number, number, number];
  /** Footstep/impact surface tag. */
  surface: string;
  /** Base colour; the loader derives a material from it. */
  color: number;
  /** Optional label, purely for debugging/readability. */
  name?: string;
}

export interface LevelDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** Loop played for the whole match (SoundLibrary key). */
  readonly ambientSoundKey: string;
  /** Scene background/fog colour. */
  readonly skyColor: number;
  readonly fogDensity: number;
  readonly hemiIntensity: number;
  readonly sunIntensity: number;
  /** Where the player starts, and which way they face (radians). */
  readonly spawn: readonly [number, number, number];
  readonly spawnYaw: number;
  /** Ground plane extent (metres, half-size) and its surface tag. */
  readonly groundHalfSize: number;
  readonly groundSurface: string;
  readonly groundColor: number;
  readonly boxes: readonly LevelBox[];
  /** Training-dummy positions. */
  readonly dummies: readonly (readonly [number, number, number])[];
  /**
   * World-space surface bounds for the top-down tactical views (tablet
   * designation map / future static minimap). Required so the whole map
   * shows at correct proportions instead of a player-centred crop.
   * Defaults to a square of groundHalfSize centred on origin when omitted.
   */
  readonly worldExtents?: {
    readonly centerX: number;
    readonly centerZ: number;
    readonly halfWidth: number;
    readonly halfHeight: number;
  };
  /**
   * Airspace for vehicle-flown killstreak cinematics (Document M): the jet
   * path spline is authored inside this volume. Optional — the path builder
   * derives a sensible default from worldExtents/groundHalfSize and
   * MISSILE.LAUNCH_ALTITUDE; levels only override it when geometry demands
   * (a taller structure, an off-centre playable area).
   */
  readonly killstreakAirspace?: {
    readonly centerXZ: readonly [number, number];
    readonly radius: number;
    /** Weapon-release altitude (cruise/egress are offset above this). The
     *  guided-missile handoff also starts here — this is its steering room. */
    readonly arrivalAltitude: number;
    /** UAV drone orbit height override (defaults to UAV_KILLSTREAK.ORBIT_HEIGHT). */
    readonly uavOrbitHeight?: number;
  };
  /**
   * Document L: prop-built level shell — a real .glb (ground + perimeter +
   * out-of-bounds + background dressing) with `COL_`-prefixed collision
   * nodes. When present it REPLACES boxes[]/ground (which become dressing
   * hints only for truly extra geometry).
   */
  readonly shellFile?: string;
  /** Document K §3.2: data-driven prop placement manifest (URL to JSON). */
  readonly propManifest?: string;
  /** Document K §2.4: dynamic prop worst-case pool budgets for this level. */
  readonly propPoolSizes?: Record<string, number>;
  /** Document K §5: equirect HDRI (background + IBL) for prop-built levels. */
  readonly hdri?: string;
  /** IBL gain for the HDRI (scene.environmentIntensity); defaults to 1.0. */
  readonly hdriIntensity?: number;
  /**
   * Document L §4.3: player reset threshold. If the player's Y ever falls
   * below this (bug, exploit, collision gap), they're teleported to spawn.
   */
  readonly killPlaneY?: number;
  /**
   * Document N §2.4: heightfield terrain collision, built at LOAD time from
   * baked sample data rather than from the shell .glb's triangles.
   *
   * A 240x240 terrain mesh is ~115k triangles; a trimesh collider over that
   * is an enormous physics asset for ground a capsule only ever touches the
   * top of. A Rapier heightfield at 128x128 is a fraction of the memory with
   * exact, closed-form ray queries — and unlike a trimesh it cannot have
   * gaps. The same authored height function produced both, so collision and
   * visuals agree by construction.
   */
  readonly terrainCollision?: string;
  /**
   * Document N §7: named callout regions (JSON polygon list). Loaded into
   * CalloutZoneRegistry, consumed by the minimap and position readouts.
   */
  readonly calloutZonesFile?: string;
  /**
   * Document N §5.3: prop types whose instances sway in the wind (palms).
   * Named here rather than inferred so a level can opt out cheaply.
   */
  readonly windSwayPropTypes?: readonly string[];
}

/** A rectangular room: four walls, open top, built from eight numbers. */
function room(
  x0: number, z0: number, x1: number, z1: number,
  height: number, thickness: number, surface: string, color: number,
): LevelBox[] {
  return [
    { min: [x0, 0, z0 - thickness], max: [x1, height, z0], surface, color, name: 'wall_n' },
    { min: [x0, 0, z1], max: [x1, height, z1 + thickness], surface, color, name: 'wall_s' },
    { min: [x0 - thickness, 0, z0], max: [x0, height, z1], surface, color, name: 'wall_w' },
    { min: [x1, 0, z0], max: [x1 + thickness, height, z1], surface, color, name: 'wall_e' },
  ];
}

/** A staircase climbing +x, for testing step-offset handling. */
function stairs(
  x: number, z: number, steps: number, rise: number, run: number,
  width: number, surface: string, color: number,
): LevelBox[] {
  const out: LevelBox[] = [];
  for (let i = 0; i < steps; i += 1) {
    out.push({
      min: [x + i * run, 0, z],
      max: [x + (i + 1) * run, (i + 1) * rise, z + width],
      surface, color, name: `step_${i}`,
    });
  }
  return out;
}

// --- WAREHOUSE: crates, catwalk supports, mantle-height stacks --------------
const WAREHOUSE: LevelDefinition = {
  id: 'warehouse',
  displayName: 'Warehouse',
  description: 'Tight crate corridors and stacked cover. Close-quarters.',
  ambientSoundKey: 'ambient_warehouse',
  skyColor: 0x2a3240,
  fogDensity: 0.008,
  hemiIntensity: 1.45,
  sunIntensity: 2.2,
  spawn: [0, 0, 22],
  spawnYaw: 0,
  groundHalfSize: 34,
  worldExtents: { centerX: 0, centerZ: 0, halfWidth: 31, halfHeight: 31 },
  groundSurface: 'concrete',
  groundColor: 0x7d776e,
  boxes: [
    ...room(-30, -30, 30, 30, 8, 1, 'metal', 0x5a6068),
    // Crate rows, deliberately at vault (0.9) and mantle (1.8) heights.
    { min: [-14, 0, -6], max: [-11, 0.9, -3], surface: 'wood', color: 0x6b4a2a, name: 'crate_low_a' },
    { min: [-8, 0, -6], max: [-5, 1.4, -3], surface: 'wood', color: 0x6b4a2a, name: 'crate_mid_a' },
    { min: [-2, 0, -6], max: [1, 1.8, -3], surface: 'wood', color: 0x6b4a2a, name: 'crate_tall_a' },
    { min: [5, 0, -6], max: [8, 2.4, -3], surface: 'wood', color: 0x5c3f24, name: 'crate_high_a' },
    { min: [-14, 0, 6], max: [-9, 1.1, 10], surface: 'wood', color: 0x6b4a2a, name: 'crate_low_b' },
    { min: [8, 0, 6], max: [13, 2.0, 11], surface: 'wood', color: 0x5c3f24, name: 'crate_high_b' },
    // Steel shelving columns.
    { min: [16, 0, -14], max: [17, 6, -13], surface: 'metal', color: 0x3a3f47, name: 'column_a' },
    { min: [16, 0, 4], max: [17, 6, 5], surface: 'metal', color: 0x3a3f47, name: 'column_b' },
    { min: [-18, 0, -14], max: [-17, 6, -13], surface: 'metal', color: 0x3a3f47, name: 'column_c' },
    ...stairs(20, -4, 8, 0.25, 0.55, 4, 'metal', 0x44484f),
    { min: [24.4, 0, -4], max: [29, 2.0, 0], surface: 'metal', color: 0x4a4f57, name: 'platform' },
  ],
  dummies: [[20, 0, 18], [-20, 0, 0], [4, 0, -22]],
};

// --- FACILITY: clean corridors, low tunnels, long sightlines ---------------
const FACILITY: LevelDefinition = {
  id: 'facility',
  displayName: 'Facility',
  description: 'Clean corridors, crouch tunnels and long sightlines.',
  ambientSoundKey: 'ambient_facility',
  skyColor: 0x28303a,
  fogDensity: 0.011,
  hemiIntensity: 1.6,
  sunIntensity: 1.9,
  spawn: [0, 0, 24],
  spawnYaw: 0,
  groundHalfSize: 30,
  worldExtents: { centerX: 0, centerZ: 0, halfWidth: 27, halfHeight: 27 },
  groundSurface: 'metal',
  groundColor: 0x7f858d,
  boxes: [
    ...room(-26, -26, 26, 26, 6, 1, 'metal', 0x555d67),
    // Central spine wall with two doorways.
    { min: [-1, 0, -18], max: [1, 4, -6], surface: 'metal', color: 0x353b43, name: 'spine_a' },
    { min: [-1, 0, 2], max: [1, 4, 14], surface: 'metal', color: 0x353b43, name: 'spine_b' },
    // Crouch tunnel: a slab you must go under.
    { min: [-7, 1.15, 6], max: [7, 4.0, 11], surface: 'metal', color: 0x3f4650, name: 'tunnel_roof' },
    { min: [-7, 0, 6], max: [-6, 1.15, 11], surface: 'metal', color: 0x3f4650, name: 'tunnel_w' },
    { min: [6, 0, 6], max: [7, 1.15, 11], surface: 'metal', color: 0x3f4650, name: 'tunnel_e' },
    // Waist-high cover pods.
    { min: [-16, 0, -4], max: [-13, 1.0, -1], surface: 'metal', color: 0x474d55, name: 'pod_a' },
    { min: [13, 0, -4], max: [16, 1.0, -1], surface: 'metal', color: 0x474d55, name: 'pod_b' },
    { min: [-16, 0, 14], max: [-13, 1.8, 17], surface: 'metal', color: 0x424850, name: 'pod_c' },
    { min: [13, 0, 14], max: [16, 1.8, 17], surface: 'metal', color: 0x424850, name: 'pod_d' },
    ...stairs(-24, -22, 7, 0.28, 0.6, 5, 'metal', 0x4b5158),
    { min: [-19.8, 0, -22], max: [-14, 1.96, -17], surface: 'metal', color: 0x4b5158, name: 'balcony' },
  ],
  dummies: [[-18, 0, -8], [18, 0, -12], [0, 0, -24]],
};

// --- TRAINING RANGE: open, flat, a distance ladder -------------------------
const TRAINING_RANGE: LevelDefinition = {
  id: 'training_range',
  displayName: 'Training Range',
  description: 'Open ground, a target ladder and every traversal height.',
  ambientSoundKey: 'ambient_range',
  skyColor: 0x36404f,
  fogDensity: 0.004,
  hemiIntensity: 1.7,
  sunIntensity: 2.4,
  spawn: [0, 0, 25],
  spawnYaw: 0,
  groundHalfSize: 40,
  worldExtents: { centerX: 0, centerZ: 0, halfWidth: 46, halfHeight: 46 },
  groundSurface: 'dirt',
  groundColor: 0x8a8071,
  boxes: [
    ...room(-34, -34, 34, 34, 7, 1, 'concrete', 0x6b7280),
    // Traversal gallery: every height the vault/mantle solver cares about.
    { min: [-22, 0, -22], max: [-19, 0.9, -19], surface: 'concrete', color: 0x6a6558, name: 'ledge_0_9' },
    { min: [-17, 0, -22], max: [-14, 1.4, -19], surface: 'concrete', color: 0x6a6558, name: 'ledge_1_4' },
    { min: [-12, 0, -22], max: [-9, 1.8, -19], surface: 'concrete', color: 0x6a6558, name: 'ledge_1_8' },
    { min: [-7, 0, -22], max: [-4, 2.0, -19], surface: 'concrete', color: 0x6a6558, name: 'ledge_2_0' },
    { min: [-2, 0, -22], max: [1, 2.6, -19], surface: 'concrete', color: 0x55505f, name: 'ledge_2_6' },
    // Shooting bays.
    { min: [-12, 0, 18], max: [-11, 1.1, 24], surface: 'wood', color: 0x6b4a2a, name: 'bay_a' },
    { min: [-4, 0, 18], max: [-3, 1.1, 24], surface: 'wood', color: 0x6b4a2a, name: 'bay_b' },
    { min: [4, 0, 18], max: [5, 1.1, 24], surface: 'wood', color: 0x6b4a2a, name: 'bay_c' },
    { min: [12, 0, 18], max: [13, 1.1, 24], surface: 'wood', color: 0x6b4a2a, name: 'bay_d' },
    // A gravel mound, for surface-tag variety underfoot.
    { min: [18, 0, -6], max: [26, 0.6, 2], surface: 'gravel', color: 0x6d6a60, name: 'mound' },
    ...stairs(20, 8, 6, 0.3, 0.6, 4, 'wood', 0x6b4a2a),
  ],
  // The classic 5 m / 25 m / 50 m distance ladder from the firing line.
  dummies: [[0, 0, 20], [0, 0, 0], [0, 0, -25], [8, 0, -10], [-8, 0, -10]],
};

// --- SHIPMENT (Document K/L): the classic COD map, built 1:1 through the
// prop-pool + shell pipeline. CoD4-accurate geometry authored from the
// canonical minimap references: fully fenced 55 m square, central
// cross-intersection of 8 containers (4 bases + 4 stacked), two leaning
// containers per N/S side with a straight choker between them, slightly
// askew pairs on E/W corners, corner debris, forklift landmark by the SE
// groups' outer corner, barrel clusters, stack colours per reference. ------
const SHIPMENT: LevelDefinition = {
  id: 'shipment',
  displayName: 'Shipment',
  description: 'Fenced dockyard container square. Chaotic close-quarters. 1:1 recreation of the classic.',
  ambientSoundKey: 'ambient_warehouse',
  skyColor: 0x5f686f,
  fogDensity: 0.005,
  hemiIntensity: 0.8,
  sunIntensity: 1.6,
  // CoD4 spawn ring: corners/edges all rush the intersection; the mock
  // single-spawn contract places the player on the SW corner diagonal.
  spawn: [-20, 0, 20],
  spawnYaw: -Math.PI / 4,
  groundHalfSize: 28,
  worldExtents: { centerX: 0, centerZ: 0, halfWidth: 28, halfHeight: 28 },
  groundSurface: 'asphalt',
  groundColor: 0x3c3f41,
  boxes: [],
  dummies: [[0, 0, 0], [-14, 0, 14], [14, 0, -14]],
  killstreakAirspace: { centerXZ: [0, 0], radius: 85, arrivalAltitude: 140, uavOrbitHeight: 55 },
  shellFile: '/assets/models/environment/shipment_shell.glb',
  propManifest: '/assets/environment-meta/shipment_props.json',
  propPoolSizes: { oil_barrel: 24, oil_barrel_explosive: 8 },
  hdri: '/assets/hdri/overcast_dockyard.hdr',
  // Neutral albedos blew out under ambient+hemi+sun+full IBL; retuned so
  // asphalt/concrete stay dockyard-dark while painted containers still pop.
  hdriIntensity: 0.65,
  killPlaneY: -25,
};

// --- FIRING RANGE (Document N): the Black Ops classic. Unlike every level
// above it, the ground is a real heightfield (authored greyscale heightmap +
// noise, flattened under buildings and along worn paths) and the perimeter is
// an irregular polygon rather than a square. All ~20 structures come from the
// shared modular building kit, and their collision is derived from the kit
// panels at build time so doors and windows are passable by construction.
// Layout is authored in tools/lib/FiringRangeLayout.js and baked from there:
// terrain, props, callouts and minimap bounds all read the same plan. --------
const FIRING_RANGE: LevelDefinition = {
  id: 'firingrange',
  displayName: 'Firing Range',
  description: 'Tropical military training compound. Three lanes converge on the central tower.',
  ambientSoundKey: 'ambient_village_dusty_loop',
  skyColor: 0x7fa3c4,
  fogDensity: 0.0022,
  hemiIntensity: 0.65,
  sunIntensity: 2.3,
  // West course entrance: on the main road, >5 m clear of every building and
  // 14 m inside the perimeter, looking east down the lane toward the tower.
  // (Yaw convention: forward is -Z at yaw 0 — see COORDINATE_CONVENTIONS.md.)
  spawn: [-27.5, 0, 17.5],
  spawnYaw: -1.06,
  groundHalfSize: 75,
  worldExtents: { centerX: 0, centerZ: 2, halfWidth: 50, halfHeight: 48 },
  groundSurface: 'dirt',
  groundColor: 0x8a6f45,
  boxes: [],
  dummies: [[-3, 0, -30.5], [2.2, 0, -30.5], [7.4, 0, -30.5]],
  killstreakAirspace: { centerXZ: [0, 2], radius: 110, arrivalAltitude: 150, uavOrbitHeight: 62 },
  shellFile: '/assets/models/environment/firingrange_shell.glb',
  propManifest: '/assets/environment-meta/firingrange_props.json',
  terrainCollision: '/assets/environment-meta/firingrange_terrain.json',
  calloutZonesFile: '/assets/environment-meta/firingrange_callouts.json',
  windSwayPropTypes: ['palm_tree_a', 'palm_tree_b', 'palm_tree_c'],
  propPoolSizes: { oil_barrel: 16, oil_barrel_explosive: 6 },
  hdri: '/assets/hdri/tropical_firingrange.hdr',
  // Harsh tropical sun: the HDRI is far brighter than Shipment's overcast, so
  // the IBL gain is pulled down harder to keep dirt and plywood from tone-
  // mapping to white (the Document L white-out failure mode).
  hdriIntensity: 0.42,
  killPlaneY: -33,
};

export const LEVELS: readonly LevelDefinition[] = [
  WAREHOUSE, FACILITY, TRAINING_RANGE, SHIPMENT, FIRING_RANGE,
];

export function getLevel(id: string): LevelDefinition {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

export default LEVELS;
