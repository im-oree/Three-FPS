#!/usr/bin/env node
/**
 * generateKillstreakIcons.js — Document J §1. Baked killstreak icon glyphs.
 *
 *   node tools/generateKillstreakIcons.js
 *
 * DESIGN: these are flat, high-contrast SILHOUETTES, not renders of the 3D
 * models. A 32-64 px HUD tile needs to read instantly; a flat-shaded low-poly
 * render at that size is mud. Same approach real killstreak icons use.
 *
 * ONE file per killstreak. Locked / ready / active states are expressed at
 * runtime via tint and overlay, never as extra baked variants — that would
 * triple the asset count for no visual gain.
 *
 * Written as white-on-transparent so the runtime can tint freely.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './weapongen/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(here, '..'), 'assets', 'ui', 'killstreak_icons');
mkdirSync(OUT, { recursive: true });

const SIZE = 128;

// --- tiny software rasteriser (no node-canvas dependency) -------------------
// The project has no DOM at build time and deliberately avoids native deps, so
// shapes are filled by testing coverage per pixel. At 128px with 2x2
// supersampling this is instant and produces clean antialiased edges.

function makeSurface() {
  return new Float32Array(SIZE * SIZE); // coverage 0..1
}

/** Fill a convex/concave polygon by even-odd crossing test, supersampled. */
function fillPolygon(surface, points) {
  const S = 2; // supersample factor per axis
  let minY = Infinity; let maxY = -Infinity;
  let minX = Infinity; let maxX = -Infinity;
  for (const [x, y] of points) {
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(SIZE - 1, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(SIZE - 1, Math.ceil(maxX));

  for (let py = y0; py <= y1; py += 1) {
    for (let px = x0; px <= x1; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < S; sy += 1) {
        const y = py + (sy + 0.5) / S;
        // Gather crossings on this scanline.
        const xs = [];
        for (let i = 0; i < points.length; i += 1) {
          const [ax, ay] = points[i];
          const [bx, by] = points[(i + 1) % points.length];
          if ((ay <= y && by > y) || (by <= y && ay > y)) {
            xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
          }
        }
        xs.sort((a, b) => a - b);
        for (let sx = 0; sx < S; sx += 1) {
          const x = px + (sx + 0.5) / S;
          let inside = false;
          for (let k = 0; k + 1 < xs.length; k += 2) {
            if (x >= xs[k] && x <= xs[k + 1]) { inside = true; break; }
          }
          if (inside) hits += 1;
        }
      }
      if (hits > 0) {
        const i = py * SIZE + px;
        surface[i] = Math.min(1, surface[i] + hits / (S * S));
      }
    }
  }
}

const rect = (s, x, y, w, h) => fillPolygon(s, [
  [x, y], [x + w, y], [x + w, y + h], [x, y + h],
]);

/** Stroked line segment as a quad, with round-ish caps from overlap. */
function line(s, x1, y1, x2, y2, width) {
  const dx = x2 - x1; const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  fillPolygon(s, [
    [x1 + nx, y1 + ny], [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny], [x1 - nx, y1 - ny],
  ]);
}

/** Ring outline, drawn as a many-sided annulus. */
function ring(s, cx, cy, radius, width, segments = 48) {
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    line(s,
      cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius,
      cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, width);
  }
}

function write(name, surface) {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const a = Math.min(1, surface[i]);
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  const png = encodePNG(SIZE, SIZE, rgba);
  writeFileSync(path.join(OUT, `${name}.png`), png);
  console.log(`[generateKillstreakIcons] ${name}.png (${png.length} bytes)`);
}

// --- UAV: top-down fixed-wing silhouette ------------------------------------
{
  const s = makeSurface();
  // fuselage
  fillPolygon(s, [[64, 14], [71, 38], [71, 92], [57, 92], [57, 38]]);
  // wings
  rect(s, 16, 54, 96, 11);
  // wing tips swept back slightly
  fillPolygon(s, [[16, 54], [28, 54], [24, 46], [16, 50]]);
  fillPolygon(s, [[112, 54], [100, 54], [104, 46], [112, 50]]);
  // V-tail
  fillPolygon(s, [[57, 92], [42, 110], [50, 112], [64, 98]]);
  fillPolygon(s, [[71, 92], [86, 110], [78, 112], [64, 98]]);
  // sensor pod
  ring(s, 64, 46, 7, 4);
  write('uav', s);
}

// --- Attack helicopter: side profile ----------------------------------------
{
  const s = makeSurface();
  // main rotor disc line + mast
  rect(s, 10, 24, 108, 5);
  rect(s, 60, 29, 6, 12);
  // cabin
  fillPolygon(s, [
    [34, 41], [78, 41], [90, 52], [90, 66], [74, 74], [40, 74], [30, 64], [30, 48],
  ]);
  // tail boom
  rect(s, 88, 52, 30, 8);
  // tail fin + rotor
  fillPolygon(s, [[112, 34], [122, 34], [120, 56], [112, 56]]);
  ring(s, 117, 42, 8, 3);
  // skids
  rect(s, 30, 84, 62, 5);
  rect(s, 42, 74, 5, 10);
  rect(s, 76, 74, 5, 10);
  write('attack_helicopter', s);
}

// --- Airstrike: reticle diamond over falling chevrons -----------------------
{
  const s = makeSurface();
  const d = [[64, 16], [112, 64], [64, 112], [16, 64]];
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = d[i];
    const [bx, by] = d[(i + 1) % 4];
    line(s, ax, ay, bx, by, 6);
  }
  // two falling chevrons inside
  for (const y of [48, 72]) {
    line(s, 48, y, 64, y + 16, 6);
    line(s, 80, y, 64, y + 16, 6);
  }
  write('airstrike', s);
}

// --- Guided missile: nose-up body with fins ---------------------------------
{
  const s = makeSurface();
  // body, nose at the top
  fillPolygon(s, [[64, 12], [74, 44], [74, 92], [54, 92], [54, 44]]);
  // forward canards
  fillPolygon(s, [[54, 56], [40, 68], [54, 68]]);
  fillPolygon(s, [[74, 56], [88, 68], [74, 68]]);
  // rear fins
  fillPolygon(s, [[54, 80], [34, 104], [54, 98]]);
  fillPolygon(s, [[74, 80], [94, 104], [74, 98]]);
  // exhaust bloom
  fillPolygon(s, [[57, 92], [71, 92], [66, 116], [62, 116]]);
  write('guided_missile', s);
}

console.log('[generateKillstreakIcons] 4 icons written');
