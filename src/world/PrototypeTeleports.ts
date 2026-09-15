/**
 * PrototypeTeleports.ts — destination table for the prototype map's pads.
 *
 * Kept apart from TeleportPadSystem (which is generic) and from the shell
 * generator (which owns pad POSITIONS). This file owns only where each pad
 * can SEND you, because that is the part gameplay tunes.
 *
 * Landing coordinates are chosen to put the player on a flat, walkable spot
 * facing INTO the section — arriving looking at a wall is disorienting and
 * makes a working teleport feel broken.
 *
 * Yaw convention: forward is (-sin(yaw), 0, -cos(yaw)) — see
 * COORDINATE_CONVENTIONS.md. So yaw 0 faces -Z (north) and yaw PI faces +Z.
 *
 * Every yaw below is DERIVED, not guessed:
 *     yaw = atan2(-(targetX - posX), -(targetZ - posZ))
 * Eyeballing these got three of them backwards on the first pass — the
 * airfield, driving and helipad landings all faced away from the very thing
 * they were meant to show, which the tour screenshots caught immediately.
 */
import type { TeleportDestination } from './TeleportPadSystem';

const HUB: TeleportDestination = {
  id: 'hub', label: 'HUB', blurb: 'central spawn and pad ring',
  position: [0, 0.2, 20], yaw: 0,
};

const AIRFIELD: TeleportDestination = {
  id: 'airfield', label: 'AIRFIELD', blurb: 'runway, hangars, control tower',
  // On the open apron looking at the gap between the two hangars, with the
  // control tower off to the right and the runway beyond.
  //
  // The previous spot, (24, -50), was INSIDE hangar 2 (x 21..55, z -56..-30):
  // the teleport worked perfectly and delivered the player face-first into a
  // concrete wall. Landing spots are checked against building footprints now,
  // not just eyeballed on the map.
  // Hangar openings face north, so a viewer approaching from the hub only
  // ever sees their blank back walls. Stand on the apron BEYOND them and
  // look back south-east: open fronts, control tower, apron underfoot.
  position: [5, 0.2, -78], yaw: -2.278,
} ;

const RUNWAY: TeleportDestination = {
  id: 'runway', label: 'RUNWAY THRESHOLD', blurb: 'south end, 260 m of tarmac ahead',
  // On the centreline at the south threshold, looking straight up the runway.
  position: [-60, 0.2, -12], yaw: 0,      // -> straight up the centreline
};

const HELIPADS: TeleportDestination = {
  id: 'helipads', label: 'HELIPADS', blurb: 'three pads and the ops shack',
  // East of the pad cluster looking west across all three.
  position: [-46, 0.2, -24], yaw: 1.571,  // -> west across all three pads
};

const DRIVING: TeleportDestination = {
  id: 'driving', label: 'DRIVING COURSE', blurb: 'skidpad, ramps, banked curve',
  // West edge of the pad looking east over the skidpad and ramps.
  position: [38, 0.2, 55], yaw: -1.693,   // -> east over skidpad + ramps
};

const WEAPONS: TeleportDestination = {
  id: 'weapons', label: 'WEAPONS RANGE', blurb: 'firing line and target berms',
  // Behind the firing line looking north down the range at the berms.
  position: [-105, 0.2, 100], yaw: 0,     // -> down range at the berms
};

const HARBOUR: TeleportDestination = {
  id: 'harbour', label: 'HARBOUR', blurb: 'quay, jetties, open water',
  // Standing ON the quay (which spans z 101..115 at x 5..75) looking south
  // down a jetty and out over the lake. The first attempt put the player
  // 20 m short of the quay on open grass, with the whole harbour reduced to
  // a thin strip on the horizon.
  position: [40, 0.2, 112], yaw: Math.PI, // -> out over the jetties
};

const HILLS: TeleportDestination = {
  id: 'hills', label: 'HILLS', blurb: 'off-road terrain, steep grades',
  // Approach slope, looking up at the high ground.
  position: [105, 0.2, -55], yaw: -0.91,  // -> up at the high ground
};

/**
 * Which destinations each pad offers.
 *
 * Every pad can reach the hub, and the hub can reach everywhere: that keeps
 * the map one hop from anywhere without listing all eight on all six pads.
 */
export const PROTOTYPE_TELEPORTS: ReadonlyArray<{
  id: string;
  destinations: ReadonlyArray<TeleportDestination>;
}> = [
  { id: 'hub', destinations: [AIRFIELD, HELIPADS, DRIVING, WEAPONS, HARBOUR, HILLS] },
  { id: 'airfield', destinations: [AIRFIELD, RUNWAY, HUB] },
  { id: 'helipads', destinations: [HELIPADS, HUB] },
  { id: 'driving', destinations: [DRIVING, HILLS, HUB] },
  { id: 'weapons', destinations: [WEAPONS, HUB] },
  { id: 'harbour', destinations: [HARBOUR, HUB] },
];

export default PROTOTYPE_TELEPORTS;
