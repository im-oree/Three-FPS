/**
 * KillhouseLayout.js — the Killhouse floor plan, as data.
 *
 * Source material (researched before building, per the project rule):
 *   - Activision, "Call of Duty: Mobile Map Snapshot: Killhouse" (2019-10)
 *   - COD4 Killhouse references and the CODM minimap
 *
 * What the references establish, and what this file therefore encodes:
 *
 *   - Killhouse is the F.N.G. tutorial warehouse on a UK SAS base, converted
 *     into a live-fire training course. It is INDOORS: a warehouse envelope
 *     with a roof, not an open yard.
 *   - Small and roughly symmetrical about its short axis, with very little
 *     cover. You can see the enemy spawn from your own.
 *   - A wooden WATCHTOWER stands at the centre. Ladder-only access, 360-degree
 *     view, the map's high ground and its biggest risk.
 *   - Cover is prefab brick and wooden walls, shipping containers, sandbags
 *     and ruined cars.
 *   - Each spawn has a small staircase up to an open PLATFORM.
 *   - The roof is "partially exposed… multiple giant windows allow natural
 *     light and air to flow freely", and Activision's own scorestreak advice
 *     is that aerial streaks must be flown THROUGH those openings. The roof
 *     bays below are that feature, not an invention.
 *
 * Coordinates: X is the short axis, Z the long axis, Y up. The map is
 * portrait-oriented like the reference minimap, spawns at +Z and -Z.
 */

/** Playable interior, in metres. Small — this is a close-quarters map. */
export const KILLHOUSE = {
  WIDTH: 44,
  DEPTH: 62,
  /** Eaves height of the warehouse envelope. */
  WALL_HEIGHT: 11,
  /** Underside of the roof structure. */
  ROOF_Y: 10.4,
  WALL_THICKNESS: 0.5,
};

const HALF_W = KILLHOUSE.WIDTH / 2;
const HALF_D = KILLHOUSE.DEPTH / 2;

/**
 * Roof bays — the open panels aerial killstreaks must be flown through.
 *
 * Laid out as a regular clerestory run down both sides of the ridge, the way
 * a real industrial roof is glazed, plus two larger openings where panels
 * have failed. The gaps are wide enough to fly a missile through with intent
 * but not so wide that the roof stops reading as a roof: together they are
 * about a third of the roof area.
 *
 * `damaged` marks the ones dressed as collapsed/missing panels rather than
 * clean glazing bars, so the art can differ while the hole behaves the same.
 */
export const ROOF_BAYS = (() => {
  const bays = [];
  const bayDepth = 6.2;
  const gap = 2.6;
  const bayWidth = 7.0;
  const offsetX = 9.5;          // two runs either side of the ridge
  let z = -HALF_D + 7;
  let index = 0;
  while (z + bayDepth < HALF_D - 7) {
    for (const sign of [-1, 1]) {
      bays.push({
        minX: sign * offsetX - bayWidth / 2,
        maxX: sign * offsetX + bayWidth / 2,
        minZ: z,
        maxZ: z + bayDepth,
        damaged: false,
        name: `bay_${index}_${sign < 0 ? 'w' : 'e'}`,
      });
    }
    z += bayDepth + gap;
    index += 1;
  }
  // Two failed sections over the centre: the obvious strike lane, and the
  // reason a good player can still be punished for standing in the open.
  bays.push({
    minX: -5.5, maxX: 5.5, minZ: -9, maxZ: 3, damaged: true, name: 'bay_centre_collapsed',
  });
  bays.push({
    minX: -3.0, maxX: 4.0, minZ: 13, maxZ: 20, damaged: true, name: 'bay_north_collapsed',
  });
  return bays;
})();

/**
 * Interior cover, from the reference layout.
 *
 * Heights are deliberate and follow the project's existing vault/mantle
 * language: 0.9 vaultable, 1.4 crouch cover, 1.8 mantle, 2.4+ blocking.
 */
export const COVER = [
  // --- south half: prefab room shells -------------------------------------
  { min: [-16, 0, 16], max: [-6.5, 2.8, 16.6], kind: 'brick', name: 'south_room_w_back' },
  { min: [-16, 0, 16.6], max: [-15.4, 2.8, 23], kind: 'brick', name: 'south_room_w_side' },
  { min: [-9.5, 0, 16.6], max: [-8.9, 2.8, 21], kind: 'brick', name: 'south_room_w_inner' },
  { min: [6.5, 0, 16], max: [16, 2.8, 16.6], kind: 'brick', name: 'south_room_e_back' },
  { min: [15.4, 0, 16.6], max: [16, 2.8, 23], kind: 'brick', name: 'south_room_e_side' },
  { min: [8.9, 0, 16.6], max: [9.5, 2.8, 21], kind: 'brick', name: 'south_room_e_inner' },

  // --- north half: mirrored, deliberately not identical -------------------
  { min: [-16, 0, -16.6], max: [-6.5, 2.8, -16], kind: 'brick', name: 'north_room_w_back' },
  { min: [-16, 0, -23], max: [-15.4, 2.8, -16.6], kind: 'brick', name: 'north_room_w_side' },
  { min: [-9.5, 0, -22], max: [-8.9, 2.8, -16.6], kind: 'brick', name: 'north_room_w_inner' },
  { min: [6.5, 0, -16.6], max: [16, 2.8, -16], kind: 'brick', name: 'north_room_e_back' },
  { min: [15.4, 0, -23], max: [16, 2.8, -16.6], kind: 'brick', name: 'north_room_e_side' },
  { min: [8.9, 0, -21], max: [9.5, 2.8, -16.6], kind: 'brick', name: 'north_room_e_inner' },

  // --- mid-map angled walls (the diagonals on the reference minimap) ------
  { min: [-11, 0, -3], max: [-4, 1.8, -2.4], kind: 'wood', name: 'mid_w_angle_a' },
  { min: [-11, 0, 2.4], max: [-4, 1.8, 3], kind: 'wood', name: 'mid_w_angle_b' },
  { min: [4, 0, -3], max: [11, 1.8, -2.4], kind: 'wood', name: 'mid_e_angle_a' },
  { min: [4, 0, 2.4], max: [11, 1.8, 3], kind: 'wood', name: 'mid_e_angle_b' },

  // --- shipping containers ------------------------------------------------
  { min: [-20, 0, -8], max: [-14, 2.6, -2], kind: 'container', name: 'container_w' },
  { min: [14, 0, 2], max: [20, 2.6, 8], kind: 'container', name: 'container_e' },
  { min: [-7, 0, 24], max: [-1, 2.6, 30], kind: 'container', name: 'container_s' },
  { min: [1, 0, -30], max: [7, 2.6, -24], kind: 'container', name: 'container_n' },

  // --- low cover: sandbags and crates -------------------------------------
  { min: [-4, 0, 8], max: [-1, 0.9, 11], kind: 'sandbag', name: 'sandbag_a' },
  { min: [1, 0, -11], max: [4, 0.9, -8], kind: 'sandbag', name: 'sandbag_b' },
  { min: [-19, 0, 9], max: [-16, 1.4, 12], kind: 'crate', name: 'crate_w' },
  { min: [16, 0, -12], max: [19, 1.4, -9], kind: 'crate', name: 'crate_e' },
  { min: [-2.5, 0, -19], max: [0.5, 1.4, -16], kind: 'crate', name: 'crate_n' },
  { min: [-0.5, 0, 16], max: [2.5, 1.4, 19], kind: 'crate', name: 'crate_s' },

  // --- ruined cars --------------------------------------------------------
  { min: [8, 0, -7], max: [12.4, 1.5, -2.6], kind: 'car', name: 'car_e' },
  { min: [-12.4, 0, 5], max: [-8, 1.5, 9.4], kind: 'car', name: 'car_w' },
];

/**
 * The central watchtower.
 *
 * Ladder-only, exactly as the reference describes: the deck is the high
 * ground and the climb is the price. Legs are thin so it reads as a wooden
 * frame and does not become a solid block of cover at ground level.
 */
export const TOWER = {
  centre: [0, 0, 0],
  legInset: 1.9,
  legThickness: 0.28,
  deckY: 4.6,
  deckHalf: 2.4,
  railHeight: 1.0,
  roofY: 7.2,
  ladderSide: 'south',
};

/**
 * Spawn platforms: a short flight of stairs to a raised deck at each end.
 * Both spawns can see each other across the map, per the reference.
 */
export const PLATFORMS = [
  {
    name: 'south', deckY: 2.2,
    deck: { min: [-8, 2.2, 26], max: [8, 2.5, 30.5] },
    stair: { x: -8, z: 26, dir: 'west', steps: 6, rise: 0.37, run: 0.42 },
  },
  {
    name: 'north', deckY: 2.2,
    deck: { min: [-8, 2.2, -30.5], max: [8, 2.5, -26] },
    stair: { x: 8, z: -26, dir: 'east', steps: 6, rise: 0.37, run: 0.42 },
  },
];

/** Spawn points, on the deck at each end, looking down the long axis. */
export const SPAWNS = {
  south: { pos: [0, 2.5, 28], yaw: Math.PI },
  north: { pos: [0, 2.5, -28], yaw: 0 },
};

/**
 * Callout zones, named from the reference material.
 * Polygons are [x, z] pairs in world space.
 */
export const CALLOUTS = [
  { name: 'Tower', polygon: rect(-4, -4, 4, 4) },
  { name: 'South Spawn', polygon: rect(-HALF_W, 24, HALF_W, HALF_D) },
  { name: 'North Spawn', polygon: rect(-HALF_W, -HALF_D, HALF_W, -24) },
  { name: 'West Rooms', polygon: rect(-HALF_W, 14, -6, 24) },
  { name: 'East Rooms', polygon: rect(6, 14, HALF_W, 24) },
  { name: 'North West Rooms', polygon: rect(-HALF_W, -24, -6, -14) },
  { name: 'North East Rooms', polygon: rect(6, -24, HALF_W, -14) },
  { name: 'West Lane', polygon: rect(-HALF_W, -14, -12, 14) },
  { name: 'East Lane', polygon: rect(12, -14, HALF_W, 14) },
  { name: 'Centre', polygon: rect(-12, -14, 12, 14) },
  { name: 'Containers', polygon: rect(-21, -9, -13, -1) },
  { name: 'Catwalk', polygon: rect(-HALF_W, -6, -18, 6) },
];

function rect(x1, z1, x2, z2) {
  return [[x1, z1], [x2, z1], [x2, z2], [x1, z2]];
}

export const BOUNDS = { HALF_W, HALF_D };
