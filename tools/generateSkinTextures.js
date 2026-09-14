/**
 * generateSkinTextures.js — Document 5 §7.3: real weapon skin textures.
 *
 *   node tools/generateSkinTextures.js
 *
 * Writes actual PNG files to /assets/textures/weapons/skins/. Per the
 * standing asset policy these are files on disk, not colours computed in
 * gameplay code — SkinManager only ever loads and assigns them.
 *
 * Three variants, each a 128x128 tiling base-colour map:
 *   standard — dark gunmetal with a faint machining grain
 *   desert   — tan/khaki blocks, a coarse arid camouflage
 *   urban    — grey/black digital camo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './weapongen/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(path.resolve(here, '..'), 'assets', 'textures', 'weapons', 'skins');
mkdirSync(DIR, { recursive: true });

const SIZE = 128;

/** Deterministic value noise so runs are reproducible. */
function hash(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

/** Blocky camo: quantize the plane into cells and pick a palette entry. */
function camo(x, y, cell, palette, seed) {
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  // Jitter the cell lookup so the blocks do not form a perfect grid.
  const j = hash(cx, cy, seed);
  const ox = Math.floor(j * 3) - 1;
  const n = hash(cx + ox, cy, seed + 7);
  return palette[Math.floor(n * palette.length) % palette.length];
}

function write(name, shade) {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b] = shade(x, y);
      const i = (y * SIZE + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  const png = encodePNG(SIZE, SIZE, rgba);
  const file = path.join(DIR, name);
  writeFileSync(file, png);
  console.log(`[generateSkinTextures] ${path.relative(process.cwd(), file)} (${png.length} bytes)`);
}

// Standard: gunmetal with horizontal machining grain.
write('weapon_skin_standard.png', (x, y) => {
  const grain = Math.sin(y * 1.7) * 3 + hash(x, y, 1) * 10;
  const v = 46 + grain;
  return [v, v + 2, v + 6];
});

// Desert: tan camo blocks, low contrast.
write('weapon_skin_desert.png', (x, y) => {
  const base = camo(x, y, 11, [
    [150, 128, 92], [124, 104, 74], [168, 146, 108], [104, 90, 66],
  ], 3);
  const n = hash(x, y, 11) * 12 - 6;
  return [base[0] + n, base[1] + n, base[2] + n];
});

// Urban: grey/black digital camo, higher contrast.
write('weapon_skin_urban.png', (x, y) => {
  const base = camo(x, y, 7, [
    [78, 82, 88], [44, 47, 52], [110, 115, 122], [28, 30, 34],
  ], 5);
  const n = hash(x, y, 23) * 10 - 5;
  return [base[0] + n, base[1] + n, base[2] + n];
});

console.log('[generateSkinTextures] 3 skins written');
