#!/usr/bin/env node
/**
 * liftBuilderPalettes.js — raise the weapon builders' colour palettes into a
 * range that actually reads under PBR lighting.
 *
 *   node tools/liftBuilderPalettes.js --check    # report only
 *   node tools/liftBuilderPalettes.js --apply    # rewrite the builders
 *
 * WHY THIS EXISTS
 * ---------------
 * The renderer is sRGB-output PBR, so three.js converts every hex colour to
 * LINEAR space on export. A hex like 0x1c1c1c (28/255) becomes ~0.024 linear
 * — effectively black. The detailed new builders used a palette bottoming out
 * around luma 12, which rendered as a flat silhouette no matter how much light
 * was thrown at it.
 *
 * This maps luma through a curve that lifts the darks hard, leaves mid and
 * light tones nearly untouched, and PRESERVES EACH COLOUR'S HUE and the
 * relative ordering between parts — so the models keep exactly the shading
 * relationships their author intended, just in a visible band.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DIR = 'tools/builders';
const MODE = process.argv.includes('--apply') ? 'apply' : 'check';

/** Rec. 709 luma of an 8-bit triple. */
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Target luma curve. Anything below ~110 gets lifted onto a floor of 58 and
 * compressed toward it; above that the curve relaxes to identity so already
 * light parts (wood, tan polymer) are not washed out.
 */
function targetLuma(L) {
  const FLOOR = 58;
  const KNEE = 120;
  if (L >= KNEE) return L;
  // Map [0, KNEE] -> [FLOOR, KNEE] with a gentle gamma so near-blacks
  // separate from each other instead of all clamping to the floor.
  const t = L / KNEE;
  return FLOOR + (KNEE - FLOOR) * t ** 0.72;
}

function lift(hex) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const L = luma(r, g, b);
  if (L <= 0.5) {
    // Pure black carries no hue to preserve; give it a neutral dark grey.
    const v = Math.round(targetLuma(0));
    return (v << 16) | (v << 8) | v;
  }
  const scale = targetLuma(L) / L;
  const out = [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c * scale))));
  return (out[0] << 16) | (out[1] << 8) | out[2];
}

const hex6 = (n) => `0x${n.toString(16).padStart(6, '0')}`;

let changedFiles = 0;
let changedColours = 0;
const rows = [];

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
  const full = path.join(DIR, file);
  const src = readFileSync(full, 'utf8');
  const seen = new Map();

  const next = src.replace(/0x[0-9a-fA-F]{6}/g, (match) => {
    const value = parseInt(match, 16);
    const lifted = lift(value);
    if (lifted === value) return match;
    if (!seen.has(match)) {
      seen.set(match, hex6(lifted));
      const r = (value >> 16) & 255, g = (value >> 8) & 255, b = value & 255;
      const R = (lifted >> 16) & 255, G = (lifted >> 8) & 255, B = lifted & 255;
      rows.push([file, match, hex6(lifted),
        luma(r, g, b).toFixed(0), luma(R, G, B).toFixed(0)]);
    }
    changedColours += 1;
    return hex6(lifted);
  });

  if (next !== src) {
    changedFiles += 1;
    if (MODE === 'apply') writeFileSync(full, next);
  }
}

const uniq = new Map();
for (const r of rows) if (!uniq.has(r[0] + r[1])) uniq.set(r[0] + r[1], r);
for (const [, r] of uniq) {
  console.log(`${r[0].padEnd(26)} ${r[1]} -> ${r[2]}   luma ${String(r[3]).padStart(3)} -> ${r[4]}`);
}
console.log(`\n${MODE === 'apply' ? 'REWROTE' : 'would rewrite'} ${changedFiles} file(s), ` +
  `${uniq.size} distinct colours (${changedColours} occurrences)`);
if (MODE === 'check') console.log('Run with --apply to write the changes.');
