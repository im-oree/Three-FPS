#!/usr/bin/env node
/**
 * generateFiringRangeManifest.js — Document N §9.3: bakes the full prop
 * placement manifest (buildings + set dressing + scattered vegetation).
 *
 *   node tools/generateFiringRangeManifest.js
 *
 * Why this is GENERATED rather than hand-written JSON like Shipment's:
 * Firing Range's terrain is not flat, so every prop's Y must be sampled from
 * the real height function or props float and sink. Hand-authoring ~300 Y
 * values against a heightmap is exactly the kind of thing that rots the
 * instant the terrain is retuned. Here the authored data is the XZ plan in
 * FiringRangeLayout.js; Y is always derived.
 *
 * Vegetation goes through the same path: FoliageScatter produces transforms at
 * build time and they land in this manifest as ordinary entries, so foliage is
 * architecturally just more instanced static props — no new placement code in
 * MapBuilder or PropPool.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildTerrainHeightfield } from './lib/TerrainHeightfieldBuilder.js';
import { scatterFoliage } from './lib/FoliageScatter.js';
import {
  MAP, BOUNDARY, BUILDINGS, PATHS, FOLIAGE_ZONES, buildingFlatZones,
} from './lib/FiringRangeLayout.js';

const META_DIR = path.resolve('assets/environment-meta');
fs.mkdirSync(META_DIR, { recursive: true });

const terrain = buildTerrainHeightfield({
  width: MAP.terrainWidth,
  depth: MAP.terrainDepth,
  segments: 240,
  heightmapPath: path.resolve(MAP.heightmapPath),
  reference: MAP.heightmapReference,
  amplitude: MAP.heightmapAmplitude,
  boundaryPolygon: BOUNDARY,
  interiorFlatten: 0.1,
  interiorFalloff: 11,
  rimBerm: 3.1,
  rimFalloff: 18,
  pathSplines: PATHS,
  flatZones: buildingFlatZones(),
});
const heightAt = (x, z) => terrain.heightAt(x, z);
const r2 = (v) => Math.round(v * 100) / 100;

const manifest = [];
const add = (propType, x, z, yaw, { scale, yOffset = 0 } = {}) => {
  const entry = {
    propType,
    position: [r2(x), r2(heightAt(x, z) + yOffset), r2(z)],
    rotation: [0, Math.round(yaw * 1000) / 1000, 0],
  };
  if (scale && scale !== 1) entry.scale = scale;
  manifest.push(entry);
};

// ---------------------------------------------------------------------------
// 1. BUILDINGS — straight from the layout plan.
// ---------------------------------------------------------------------------
for (const b of BUILDINGS) add(b.key, b.pos[0], b.pos[2], b.yaw);
const buildingCount = manifest.length;

// ---------------------------------------------------------------------------
// 2. SET DRESSING — authored per callout region, matching the references.
// ---------------------------------------------------------------------------

// --- MID: the jeep in its sandbag nest, the map's centrepiece --------------
add('jeep_military', -3.4, 6.2, 1.85);
add('sandbag_nest', -1.6, 8.4, 0.25);
add('sandbag_nest', -5.6, 4.6, 1.85);
add('sandbag_nest', 5.2, 6.8, -0.5);
add('fuel_drum_cluster', 7.4, -2.2, 0.4);
add('sandbag_nest', 6.4, -4.4, 2.6);

// --- RANGE: the firing line, targets downrange, flag -----------------------
for (let i = 0; i < 7; i += 1) {
  add('target_silhouette', -11 + i * 2.6, -30.5 - (i % 2) * 0.6, 0.02 + (i % 3) * 0.05);
}
for (let i = 0; i < 4; i += 1) {
  add('target_silhouette', 5 + i * 2.4, -33.2, 0.1);
}
add('range_flag', 8.5, -21.5, 0);
add('ammo_crate_stack', -8.5, -21.8, 0.3);
add('ammo_crate_stack', 2.2, -22.4, -0.4);
add('fuel_drum_cluster', -14.5, -22.5, 0.9);
add('sandbag_nest', -6.5, -19.5, 0.05);
add('sandbag_nest', 3.5, -19.2, 0.05);

// --- WOOD BUILDING surrounds ----------------------------------------------
add('fuel_drum_cluster', -22.5, -3.5, 0.6);
add('ammo_crate_stack', -12.5, 6.5, -0.5);
add('sandbag_nest', -17, 7.5, 0.1);
add('tire_stack', -21.5, 4.5, 0);
add('target_silhouette', -13.5, -8.5, 2.9);
add('target_silhouette', -11.8, -9.0, 2.9);

// --- WHITE WAREHOUSE / A LONG ---------------------------------------------
add('fuel_drum_cluster', -36.5, -8.5, 0.2);
add('ammo_crate_stack', -33.5, -20.5, 0.7);
add('trailer_flatbed', -27.5, -24.5, 1.42);
add('tire_stack', -24.5, -20, 0);
add('sandbag_nest', -30.5, -5.5, 1.6);
add('fuel_drum_cluster', -21.5, -26.5, 1.1);

// --- TRAILER / south-west --------------------------------------------------
add('trailer_flatbed', -11.5, 19.5, 0.28);
add('fuel_drum_cluster', -15.5, 23.5, 0.5);
add('tire_stack', -6.5, 18.5, 0);
add('ammo_crate_stack', -18.5, 18.2, -0.3);
add('sandbag_nest', -8.5, 15.5, 0.9);

// --- TUNNEL: the culvert connecting mid to the south loop ------------------
add('tunnel_culvert', 7.8, 17.5, 0.12);
add('sandbag_nest', 5.2, 13.2, 0.2);
add('fuel_drum_cluster', 11.5, 13.5, 0.8);

// --- LOFT / concrete platform + the beam walk ------------------------------
add('beam_walk', 17.6, 14.2, 0.62);
add('ammo_crate_stack', 11.5, 22.5, 0.2);
add('sandbag_nest', 15.5, 23.8, 3.1);

// --- TIN BUILDING / ALLEY --------------------------------------------------
add('tire_stack', 24.2, 8.4, 0);
add('tire_stack', 25.4, 9.6, 0);
add('fuel_drum_cluster', 16.5, -1.5, 0.3);
add('ammo_crate_stack', 24.5, 3.5, -0.6);
add('sandbag_nest', 14.5, -4.5, 0.4);

// --- TYRES: the callout landmark stack cluster -----------------------------
for (const [tx, tz] of [[30.5, 11.5], [31.9, 12.6], [30.2, 13.8], [32.8, 14.4], [29.4, 15.6]]) {
  add('tire_stack', tx, tz, 0);
}
add('trailer_flatbed', 35.5, 9.5, 1.1);

// --- ARMORY / C-DOMINATION -------------------------------------------------
add('ammo_crate_stack', 37.5, -8.5, 0.4);
add('ammo_crate_stack', 36.2, -6.2, -0.2);
add('fuel_drum_cluster', 29.5, -9.5, 0.9);
add('sandbag_nest', 27.5, -4.5, 1.4);
add('tunnel_culvert', 26.5, -15.5, 1.42);

// --- DEFENDING SPAWN (east) ------------------------------------------------
add('jeep_military', 36.5, 21.5, -1.1);
add('fuel_drum_cluster', 27.5, 24.5, 0.3);
add('ammo_crate_stack', 33.5, 26.5, 0.8);
add('tire_stack', 38.5, 27.5, 0);

// --- ATTACKING SPAWN (west) ------------------------------------------------
add('jeep_military', -35.5, 30.5, 1.9);
add('fuel_drum_cluster', -31.5, 22.5, 0.7);
add('ammo_crate_stack', -38.5, 24.5, -0.4);
add('sandbag_nest', -30.5, 28.5, 0.6);
add('tire_stack', -24.5, 30.5, 0);

// --- B SITE / jungle approach ---------------------------------------------
add('ammo_crate_stack', -14.5, 32.5, 0.5);
add('fuel_drum_cluster', -20.5, 35.5, 0.2);
add('sandbag_nest', -8.5, 33.5, 2.9);
add('trailer_flatbed', -21.5, 29.5, 0.5);
add('target_silhouette', 0.5, 31.5, 3.3);
add('target_silhouette', 2.3, 32.1, 3.3);

const dressingCount = manifest.length - buildingCount;

// ---------------------------------------------------------------------------
// 3. VEGETATION — scattered at build time, emitted as ordinary manifest rows.
// ---------------------------------------------------------------------------
const exclusions = BUILDINGS.map((b) => ({
  centerXZ: [b.pos[0], b.pos[2]],
  halfExtents: b.pad,
  yaw: b.yaw,
  margin: 1.6,
}));
// Keep plants off the props too, so nothing grows through a jeep.
for (const entry of manifest.slice(buildingCount)) {
  exclusions.push({
    centerXZ: [entry.position[0], entry.position[2]],
    halfExtents: [2.0, 2.0],
    margin: 0,
  });
}

// Palm and jungle-tree variants cycle so a treeline isn't one clone repeated.
const VARIANTS = {
  palm_tree: ['palm_tree_a', 'palm_tree_b', 'palm_tree_c'],
  jungle_tree: ['jungle_tree_a', 'jungle_tree_b'],
  jungle_bush: ['jungle_bush'],
  grass_tuft: ['grass_tuft'],
};

let foliageCount = 0;
for (const zone of FOLIAGE_ZONES) {
  const placements = scatterFoliage({
    polygon: zone.polygon,
    count: zone.count,
    minSpacing: zone.minSpacing,
    heightAt,
    seed: zone.seed,
    exclusions: zone.outside ? [] : exclusions,
    paths: PATHS,
    avoidPaths: zone.avoidPaths ?? (zone.outside ? 0 : 1.2),
    boundary: BOUNDARY,
    outside: !!zone.outside,
    ring: !!zone.ring,
    scaleRange: zone.type === 'grass_tuft' ? [0.7, 1.5] : [0.8, 1.3],
    maxSlope: zone.type === 'grass_tuft' ? 1.2 : 0.8,
  });
  const variants = VARIANTS[zone.type];
  placements.forEach((p, i) => {
    manifest.push({
      propType: variants[i % variants.length],
      position: p.position,
      rotation: p.rotation,
      ...(p.scale !== 1 ? { scale: p.scale } : {}),
    });
  });
  foliageCount += placements.length;
  console.log(`  ${zone.type.padEnd(13)} requested ${String(zone.count).padStart(4)} -> placed ${String(placements.length).padStart(4)}`);
}

// ---------------------------------------------------------------------------
const outPath = path.join(META_DIR, 'firingrange_props.json');
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 1)}\n`);

const byType = new Map();
for (const e of manifest) byType.set(e.propType, (byType.get(e.propType) ?? 0) + 1);
console.log(`\nwrote ${outPath}`);
console.log(`  buildings ${buildingCount} | dressing ${dressingCount} | foliage ${foliageCount} | TOTAL ${manifest.length}`);
console.log(`  ${byType.size} distinct prop types`);
