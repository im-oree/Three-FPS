/**
 * generateEnvironmentTexture.js — committed 128x64 equirectangular studio
 * environment for PBR reflections (Document 3: the weapon viewmodel's
 * metalness maps read pure black without an environment map — metals have no
 * diffuse term). Generated on disk like every other asset; PMREM-convolved at
 * runtime for the viewmodel scene only (world lighting stays Document 2's).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './weapongen/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(path.resolve(here, '..'), 'assets', 'textures', 'environment');
mkdirSync(DIR, { recursive: true });

const W = 128;
const H = 64;
const rgba = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y += 1) {
  const v = y / (H - 1); // 0 = zenith, 1 = nadir
  for (let x = 0; x < W; x += 1) {
    const u = x / (W - 1);
    // Sky-to-floor gradient ...
    let r = 40 + 120 * (1 - v);
    let g = 44 + 128 * (1 - v);
    let b = 52 + 140 * (1 - v);
    if (v > 0.5) { r *= 0.35; g *= 0.35; b *= 0.38; } // darker floor
    // ... plus three softbox bands so metals get directional highlights.
    const boxes = [
      { u0: 0.10, u1: 0.22, v0: 0.12, v1: 0.34, i: 3.2 },
      { u0: 0.55, u1: 0.68, v0: 0.08, v1: 0.30, i: 2.4 },
      { u0: 0.82, u1: 0.94, v0: 0.20, v1: 0.42, i: 1.8 },
    ];
    for (const box of boxes) {
      if (u >= box.u0 && u <= box.u1 && v >= box.v0 && v <= box.v1) {
        r += 200 * box.i; g += 200 * box.i; b += 210 * box.i;
      }
    }
    const i = (y * W + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
}
writeFileSync(path.join(DIR, 'studio_equirect.png'), encodePNG(W, H, rgba));
console.log('[generateEnvironmentTexture] wrote assets/textures/environment/studio_equirect.png');
