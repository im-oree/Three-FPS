#!/usr/bin/env node
/**
 * generateExplosionTextures.js — Document G: real texture files for the shared
 * explosion system, plus the rotor-blur disc Document I's aircraft need.
 *
 *   node tools/generateExplosionTextures.js
 *
 * Standing asset policy: real static files produced by a /tools script, never
 * canvases built at runtime inside /src.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './weapongen/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const FX = path.join(ROOT, 'assets', 'textures', 'effects');
mkdirSync(FX, { recursive: true });

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

function write(name, size, shade) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = shade(x, y, size);
      const i = (y * size + x) * 4;
      rgba[i] = clamp255(r); rgba[i + 1] = clamp255(g);
      rgba[i + 2] = clamp255(b); rgba[i + 3] = clamp255(a);
    }
  }
  const png = encodePNG(size, size, rgba);
  writeFileSync(path.join(FX, name), png);
  console.log(`[generateExplosionTextures] ${name} (${size}x${size}, ${png.length} bytes)`);
}

/** Deterministic value noise so runs reproduce byte-for-byte. */
function hash(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

const radial = (x, y, size) => {
  const cx = (size - 1) / 2;
  const dx = (x - cx) / cx;
  const dy = (y - cx) / cx;
  return Math.hypot(dx, dy);
};

// --- fireball: hot white core -> orange -> deep red, soft edge --------------
write('explosion_fireball.png', 128, (x, y, size) => {
  const d = radial(x, y, size);
  if (d > 1) return [0, 0, 0, 0];
  const core = Math.max(0, 1 - d * 1.9);
  const mid = Math.max(0, 1 - d * 1.25);
  const outer = Math.max(0, 1 - d);
  // Blotchy edge so the ball is not a perfect mathematical circle.
  const n = 0.82 + hash(x >> 2, y >> 2, 3) * 0.36;
  const r = 255 * (core * 0.55 + mid * 0.45 + outer * 0.35);
  const g = 255 * (core * 0.52 + mid * 0.30 + outer * 0.06);
  const b = 255 * (core * 0.48 + mid * 0.06);
  const a = 255 * Math.pow(outer, 1.5) * n;
  return [r, g, b, a];
});

// --- shockwave ring: thin bright annulus, transparent inside and out -------
write('explosion_shockwave.png', 128, (x, y, size) => {
  const d = radial(x, y, size);
  const ring = Math.exp(-Math.pow((d - 0.82) / 0.085, 2));
  if (ring < 0.01) return [0, 0, 0, 0];
  return [255 * ring, 240 * ring, 215 * ring, 235 * ring];
});

// --- smoke puff: soft grey blob, alpha-blended (must OCCLUDE, not glow) ----
write('smoke_puff.png', 128, (x, y, size) => {
  const d = radial(x, y, size);
  if (d > 1) return [0, 0, 0, 0];
  const body = Math.pow(Math.max(0, 1 - d), 1.8);
  // Two octaves of noise so puffs look cloudy rather than like grey circles.
  const n = 0.6
    + hash(x >> 3, y >> 3, 11) * 0.28
    + hash(x >> 1, y >> 1, 29) * 0.12;
  const v = 150 * n;
  return [v, v * 1.01, v * 1.04, 220 * body * n];
});

// --- ground scorch decal: dark irregular splat ------------------------------
write('scorch_decal.png', 128, (x, y, size) => {
  const d = radial(x, y, size);
  // Irregular radius so scorches are not perfect discs.
  const wobble = 0.78 + hash(Math.round(Math.atan2(y - 64, x - 64) * 12), 0, 7) * 0.2;
  if (d > wobble) return [0, 0, 0, 0];
  const edge = Math.pow(1 - d / wobble, 0.8);
  const n = 0.7 + hash(x >> 2, y >> 2, 17) * 0.3;
  return [18 * n, 16 * n, 14 * n, 205 * edge * n];
});

// --- rotor blur disc (Document I §5.1): radial streaks, mostly transparent --
write('rotor_blur.png', 256, (x, y, size) => {
  const d = radial(x, y, size);
  if (d > 1 || d < 0.06) return [0, 0, 0, 0];
  const theta = Math.atan2(y - (size - 1) / 2, x - (size - 1) / 2);
  // Streaks: a few angular lobes, so it reads as blades smeared by rotation.
  const streak = 0.45 + 0.55 * Math.abs(Math.sin(theta * 4));
  // Denser toward the tips, like a real blurred rotor disc.
  const radialFade = Math.pow(d, 0.7) * Math.pow(Math.max(0, 1 - d), 0.35);
  const a = 150 * streak * radialFade;
  const v = 40;
  return [v, v, v + 4, a];
});

console.log('[generateExplosionTextures] 5 textures written');
