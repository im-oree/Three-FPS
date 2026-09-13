/**
 * generateEffectTextures.js — committed VFX textures for Document 3 pools
 * (muzzle flash star, tracer streak, impact dust). Real PNGs on disk per the
 * standing asset policy; pools sample these, never procedural canvases.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, noise01 } from './weapongen/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(path.resolve(here, '..'), 'assets', 'textures', 'effects');
mkdirSync(DIR, { recursive: true });
const SIZE = 64;

function radial(size, fn) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x / (size - 1)) * 2 - 1;
      const dy = (y / (size - 1)) * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dy));
      const [cr, cg, cb, a] = fn(r, dx, dy, x, y);
      const i = (y * size + x) * 4;
      rgba[i] = cr; rgba[i + 1] = cg; rgba[i + 2] = cb; rgba[i + 3] = a;
    }
  }
  return encodePNG(size, size, rgba);
}

// Muzzle flash: hot core + 4-point star falloff.
writeFileSync(path.join(DIR, 'muzzle_flash.png'), radial(SIZE, (r, dx, dy) => {
  const star = Math.max(Math.abs(dx), Math.abs(dy)) * 0.6 + r * 0.7;
  const glow = Math.max(0, 1 - star * 1.15);
  const core = Math.max(0, 1 - r * 2.4);
  const v = Math.min(1, glow * 0.85 + core);
  return [255, 190 + 60 * core, 90 * glow + 140 * core, 255 * v];
}));

// Tracer: horizontal streak (stretched along travel by the mesh UV).
writeFileSync(path.join(DIR, 'tracer.png'), radial(SIZE, (r, dx, dy) => {
  const streak = Math.max(0, 1 - Math.abs(dy) * 5) * Math.max(0, 1 - Math.abs(dx) * 1.1);
  return [255, 210, 120, 255 * streak];
}));

// Impact dust: soft noisy puff.
writeFileSync(path.join(DIR, 'impact_dust.png'), radial(SIZE, (r, dx, dy, x, y) => {
  const n = noise01(x, y, 7) * 0.5 + 0.5;
  const puff = Math.max(0, 1 - r) * n;
  return [200, 190, 175, 255 * puff * 0.9];
}));

// Impact spark (dummy variant): tighter, warmer burst.
writeFileSync(path.join(DIR, 'impact_spark.png'), radial(SIZE, (r, dx, dy, x, y) => {
  const n = noise01(x, y, 11);
  const burst = Math.max(0, 1 - r * 1.4) * (0.4 + n * 0.6);
  return [255, 120 + 80 * n, 90, 255 * burst];
}));

console.log('[generateEffectTextures] wrote muzzle_flash, tracer, impact_dust, impact_spark PNGs');
