/**
 * FiringRangeLayout.js — THE single source of truth for Firing Range's plan.
 *
 * Every consumer reads this one file: the shell generator (terrain pads, path
 * flattening, perimeter), the prop manifest generator (building placement),
 * the callout JSON, the foliage zones, the minimap bake and the acceptance
 * audit. That is deliberate — the failure mode on a map this size is a
 * building at one coordinate, its terrain pad at another and its callout
 * polygon at a third, and the only structural cure is refusing to write the
 * numbers down twice.
 *
 * LAYOUT SOURCE: the CoD Black Ops / CoD Mobile "Firing Range" references —
 * the top-down tac-map and in-game screenshots. Reading that plan:
 *
 *      -Z (north) .................. range shack + targets downrange
 *       |
 *       |   [White Warehouse]      [Range Shack]        [Armory]
 *       |         \                     |                 /
 *       |   [Wood Building] --- [ TOWER / MID ] --- [Tin Building]
 *       |         /              jeep + sandbags        \
 *       |   [Toilets/Spawn A]     [Trailer]        [Spawn B / Tyres]
 *       |                         [Jungle band, south-east]
 *      +Z (south)
 *
 * Both team spawns sit at opposite corners (west and east), all three lanes
 * converge on the central tower, and the jungle band wraps the south-east.
 * The compound silhouette is an irregular polygon, not a rectangle.
 *
 * Units are metres, world XZ, y-up, matching COORDINATE_CONVENTIONS.md.
 */

// --------------------------------------------------------------- extents ---

export const MAP = {
  /** Terrain mesh extent (wider than the playspace: hills read beyond it). */
  terrainWidth: 150,
  terrainDepth: 150,
  /** Heightmap image driving the landform. */
  heightmapPath: 'assets/textures/environment/firingrange_heightmap.png',
  /** Value in the heightmap that maps to world y = 0 (the compound plateau). */
  heightmapReference: 0.545,
  heightmapAmplitude: 17,
  /** Minimap / tactical-view bounds. */
  minimapBounds: { minXZ: [-50, -46], maxXZ: [50, 50] },
};

/**
 * The compound silhouette — an irregular closed polygon, wound clockwise in
 * screen terms (+X right, +Z down). Traced from the tac-map outline: notched
 * at the north-west, stepped out at the east for the armoury/spawn, and
 * bulged south-east around the jungle.
 */
export const BOUNDARY = [
  [-40, -30], [-24, -36], [-6, -38], [10, -36], [22, -30],
  [34, -26], [42, -16], [44, -2], [40, 10], [44, 22],
  [42, 36], [30, 44], [12, 46], [-4, 42], [-18, 44],
  [-32, 38], [-40, 26], [-44, 10], [-46, -6], [-44, -20],
];

// ------------------------------------------------------------- structures ---

/**
 * Every building: its catalog key, world position, yaw, and the terrain pad
 * that must be flattened beneath it. `pad.halfExtents` are in the building's
 * LOCAL frame; the pad flattener applies the yaw, so a rotated building still
 * gets a correctly-oriented flat base.
 */
export const BUILDINGS = [
  // --- centre: the tower that defines the map ------------------------------
  { key: 'bldg_watchtower', pos: [2, 0, 2], yaw: -0.18, pad: [4.2, 4.2], zone: 'Tower' },

  // --- west lane: wood building + white warehouse --------------------------
  { key: 'bldg_wood_unfinished', pos: [-17, 0, 1], yaw: 0.12, pad: [6.4, 5.6], zone: 'Wood Building' },
  { key: 'bldg_white_warehouse', pos: [-30, 0, -13], yaw: 0.22, pad: [7.6, 6.2], zone: 'White Warehouse' },
  { key: 'bldg_toilets', pos: [-36, 0, 20], yaw: -0.35, pad: [3.6, 2.6], zone: 'Toilets' },
  { key: 'bldg_red_locker_hut', pos: [-27, 0, 27], yaw: 0.5, pad: [2.9, 2.6], zone: 'Attacking Spawn' },

  // --- north: the range itself ---------------------------------------------
  { key: 'bldg_range_shack', pos: [-3, 0, -24], yaw: 0.04, pad: [10.2, 4.2], zone: 'Range' },
  { key: 'bldg_storage_shed', pos: [-21, 0, -25], yaw: -0.4, pad: [2.6, 2.4], zone: 'A Long' },
  { key: 'bldg_guard_post', pos: [17, 0, -27], yaw: 0.35, pad: [2.4, 2.4], zone: 'Range' },

  // --- east lane: tin building, armoury, shop ------------------------------
  { key: 'bldg_tin', pos: [20, 0, 5], yaw: -0.28, pad: [5.0, 4.8], zone: 'Tin Building' },
  { key: 'bldg_armory_bunker', pos: [33, 0, -12], yaw: 0.45, pad: [5.6, 4.6], zone: 'Armory' },
  { key: 'bldg_yellow_shop', pos: [31, 0, 16], yaw: -0.55, pad: [5.6, 4.6], zone: 'Defending Spawn' },
  { key: 'bldg_storage_shed', pos: [34, 0, 30], yaw: 0.7, pad: [2.6, 2.4], zone: 'Defending Spawn' },

  // --- south: trailer yard, platform, jungle edge --------------------------
  { key: 'bldg_concrete_platform', pos: [13, 0, 20], yaw: -0.12, pad: [5.2, 3.6], zone: 'Loft' },
  { key: 'bldg_awning_shelter', pos: [-8, 0, 22], yaw: 0.3, pad: [2.4, 2.2], zone: 'Trailer' },
  { key: 'bldg_guard_post', pos: [-33, 0, -3], yaw: 1.4, pad: [2.4, 2.4], zone: 'White Warehouse' },

  // --- freestanding shooting-lane barricades (cover furniture) -------------
  { key: 'bldg_plywood_barricade', pos: [-9, 0, -10], yaw: 0.9, pad: [2.4, 1.2] },
  { key: 'bldg_plywood_barricade', pos: [8, 0, -12], yaw: -0.5, pad: [2.4, 1.2] },
  { key: 'bldg_plywood_barricade', pos: [-4, 0, 12], yaw: 1.7, pad: [2.4, 1.2] },
  { key: 'bldg_plywood_barricade', pos: [24, 0, -3], yaw: 0.25, pad: [2.4, 1.2] },
  { key: 'bldg_plywood_barricade', pos: [-22, 0, 12], yaw: -1.2, pad: [2.4, 1.2] },
];

// ------------------------------------------------------------- dirt roads ---

/**
 * The worn routes between structures. The terrain flattens and darkens along
 * these, which is what produces the visible dirt-road network in the
 * reference screenshots without any texture splatting.
 */
export const PATHS = [
  // Attacking spawn (west) -> mid -> defending spawn (east): the main road.
  { points: [[-36, 24], [-26, 16], [-14, 8], [-2, 4], [10, 4], [22, 8], [32, 15]], flattenRadius: 5.0 },
  // A Long: north-west flank down the range frontage into mid.
  { points: [[-34, -14], [-22, -18], [-10, -18], [2, -14], [6, -4]], flattenRadius: 4.0 },
  // Mid -> range shack (the north spur).
  { points: [[1, 2], [-1, -10], [-3, -19]], flattenRadius: 3.6 },
  // East lane: tin building down past the armoury.
  { points: [[19, 1], [26, -4], [32, -9]], flattenRadius: 3.4 },
  // South loop: trailer yard round the jungle edge to the east spawn.
  { points: [[-24, 26], [-10, 27], [4, 26], [16, 24], [28, 26]], flattenRadius: 4.0 },
  // Tunnel/culvert connector between mid and the south loop.
  { points: [[6, 10], [8, 18], [10, 24]], flattenRadius: 3.0 },
];

// ------------------------------------------------------------ foliage -------

/**
 * Jungle zones. The dense band wraps the south-east exactly as in the
 * reference, plus treelines outside the boundary that seal the skyline.
 */
export const FOLIAGE_ZONES = [
  {
    type: 'palm_tree',
    polygon: [[8, 28], [30, 30], [34, 44], [10, 46], [-2, 38]],
    count: 16, minSpacing: 4.5, seed: 4211,
  },
  {
    type: 'palm_tree',
    polygon: [[-46, -34], [-30, -40], [-10, -44], [14, -42], [34, -34], [48, -20],
      [52, 6], [50, 30], [40, 50], [10, 54], [-20, 52], [-42, 42], [-52, 12], [-54, -14]],
    count: 34, minSpacing: 6.0, seed: 991, outside: true,
  },
  {
    type: 'jungle_tree',
    polygon: [[-52, -40], [16, -48], [54, -26], [58, 20], [30, 56], [-26, 56], [-58, 20]],
    count: 46, minSpacing: 7.5, seed: 7331, outside: true,
  },
  {
    type: 'jungle_bush',
    polygon: [[2, 24], [32, 26], [36, 46], [6, 48], [-8, 36]],
    count: 74, minSpacing: 1.5, seed: 5507,
  },
  {
    type: 'jungle_bush',
    polygon: [[-46, -32], [-24, -38], [10, -40], [40, -28], [46, 4], [40, 40],
      [0, 48], [-38, 40], [-48, 6]],
    count: 120, minSpacing: 2.4, seed: 8821, ring: true,
  },
  {
    type: 'grass_tuft',
    polygon: BOUNDARY,
    count: 260, minSpacing: 1.1, seed: 3313, avoidPaths: 2.6,
  },
];

// ------------------------------------------------------------- callouts -----

/**
 * The 22 named regions from the reference callout map. Polygons are authored
 * to tile the playspace without overlap where it matters; CalloutZoneRegistry
 * resolves first-match, so the list order is the tie-break for the few places
 * where zones legitimately abut.
 */
export const CALLOUTS = [
  // Tower is listed FIRST and is deliberately small: it sits inside Mid's
  // footprint, and first-match ordering is what makes the more specific
  // callout win. Reversing these two would make "Tower" unreachable.
  { name: 'Tower', polygon: [[-2.5, -2.5], [6.5, -2.5], [6.5, 6.5], [-2.5, 6.5]] },
  { name: 'Attacking Spawn', polygon: [[-44, 18], [-30, 20], [-28, 36], [-40, 38]] },
  { name: 'Toilets', polygon: [[-44, 8], [-30, 8], [-30, 18], [-44, 18]] },
  { name: 'White Warehouse', polygon: [[-40, -22], [-20, -22], [-20, -4], [-40, -4]] },
  { name: 'A Long', polygon: [[-38, -32], [-12, -32], [-12, -22], [-40, -22]] },
  { name: 'Range', polygon: [[-12, -34], [16, -34], [16, -18], [-12, -18]] },
  { name: 'A Site', polygon: [[16, -34], [38, -26], [40, -16], [16, -18]] },
  { name: 'Armory', polygon: [[26, -20], [42, -18], [42, -4], [26, -4]] },
  { name: 'Wood Building', polygon: [[-24, -6], [-10, -6], [-10, 8], [-24, 8]] },
  { name: 'A-Domination', polygon: [[-40, -4], [-24, -4], [-24, 8], [-40, 8]] },
  { name: 'Mid', polygon: [[-10, -8], [12, -8], [12, 10], [-10, 10]] },
  { name: 'Mid Sandbags', polygon: [[-4, 6], [8, 6], [8, 14], [-4, 14]] },
  { name: 'Mid Truck', polygon: [[-10, 10], [-2, 10], [-2, 18], [-10, 18]] },
  { name: 'Sniper', polygon: [[-10, -18], [2, -18], [2, -8], [-10, -8]] },
  { name: 'Alley', polygon: [[12, -8], [24, -8], [24, 2], [12, 2]] },
  { name: 'Tin Building', polygon: [[14, 2], [26, 2], [26, 12], [14, 12]] },
  { name: 'C-Domination', polygon: [[24, -6], [36, -6], [36, 2], [24, 2]] },
  { name: 'Tunnel', polygon: [[2, 14], [12, 14], [12, 22], [2, 22]] },
  { name: 'Loft', polygon: [[8, 16], [20, 16], [20, 26], [8, 26]] },
  { name: 'Tyres', polygon: [[26, 8], [38, 8], [38, 18], [26, 18]] },
  { name: 'Defending Spawn', polygon: [[26, 18], [42, 20], [40, 38], [24, 36]] },
  { name: 'Trailer', polygon: [[-16, 14], [-2, 14], [-2, 26], [-16, 26]] },
  { name: 'Jungle', polygon: [[-2, 26], [24, 26], [26, 44], [-4, 42]] },
  { name: 'B Site', polygon: [[-28, 20], [-4, 26], [-6, 42], [-30, 38]] },
];

// ---------------------------------------------------------------- spawns ----

// Spawns sit in OPEN ground facing the compound. The first pass put the west
// spawn 3.3 m from the perimeter wall, which filled a third of the player's
// opening view with a grey slab; both are now >8 m clear of the boundary and
// of any building, looking down their lane rather than into cover.
export const SPAWNS = [
  { position: [-27.5, 0, 17.5], yaw: -1.06, team: 'attackers' },
  { position: [23.5, 0, 28], yaw: 0.73, team: 'defenders' },
];

// ------------------------------------------------------------------ misc ----

/** Perimeter openings, authored per boundary EDGE index. */
export const PERIMETER_OPENINGS = [
  { edgeIndex: 4, startFraction: 0.35, endFraction: 0.68 },   // north-east range gap
  { edgeIndex: 12, startFraction: 0.3, endFraction: 0.62 },   // south jungle exit
  { edgeIndex: 18, startFraction: 0.25, endFraction: 0.55 },  // west spawn road
];

/**
 * Per-edge wall treatment. Berms where jungle hillside seals the map (south
 * and east), concrete+wire elsewhere — matching the reference, where the
 * compound is fenced on the approach sides and banked into terrain behind.
 */
export const PERIMETER_WALL_KINDS = (() => {
  const kinds = {};
  for (let i = 0; i < BOUNDARY.length; i += 1) kinds[i] = 'concrete';
  for (const i of [9, 10, 11, 12, 13, 14]) kinds[i] = 'berm';
  return kinds;
})();

/** Terrain pads, derived from BUILDINGS — never authored twice. */
export function buildingFlatZones(extraMargin = 1.1) {
  return BUILDINGS.map((b) => ({
    shape: 'box',
    centerXZ: [b.pos[0], b.pos[2]],
    halfExtents: [b.pad[0] + extraMargin, b.pad[1] + extraMargin],
    yaw: b.yaw,
    padHeight: 0,
    feather: 2.4,
  }));
}

export default {
  MAP, BOUNDARY, BUILDINGS, PATHS, FOLIAGE_ZONES, CALLOUTS, SPAWNS,
  PERIMETER_OPENINGS, PERIMETER_WALL_KINDS, buildingFlatZones,
};
