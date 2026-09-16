/**
 * generateWeaponIcons.mjs — the weapon silhouettes the killfeed draws.
 *
 * Call of Duty's killfeed does not write "Submachine Gun" between the two
 * names; it draws the weapon. Text rows are wider, slower to read and stop
 * looking like COD the moment a weapon has a long name.
 *
 * These are produced as real files by this script (project asset policy: no
 * hand-placed binaries). They are SVG because a killfeed icon is a flat
 * silhouette at one colour -- exactly what SVG is for -- and because it stays
 * crisp at any HUD scale without shipping three bitmap sizes.
 *
 * Each silhouette is drawn to a 64x20 viewBox with the barrel pointing LEFT,
 * matching COD's convention of killer-on-the-left shooting victim-on-the-right.
 *
 *   node tools/generateWeaponIcons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/ui/weapons');

/**
 * Silhouette paths.
 *
 * Deliberately blocky: the rest of the game is untextured low-poly, so a
 * photoreal gun icon would look pasted in from another product.
 */
const SHAPES = {
  // Assault rifle: long barrel, carry handle, angled magazine, stock.
  rifle: [
    'M2 9h20v2H2z',                        // barrel
    'M22 7h18v6H22z',                      // receiver
    'M26 6h10v1.5H26z',                    // top rail
    'M28 13h5l1.5 6h-5z',                  // magazine
    'M40 8h6v5h-6z',                       // grip housing
    'M46 9.5h14v3.5H46z',                  // stock
    'M38 13h3v4h-3z',                      // pistol grip
  ],
  // SMG: short barrel, boxy body, long straight magazine.
  smg: [
    'M6 9h14v2H6z',
    'M20 7h16v6H20z',
    'M24 13h4l1 7h-5z',
    'M36 8h5v5h-5z',
    'M41 9.5h10v3.5H41z',
    'M34 13h3v4h-3z',
  ],
  // Pump shotgun: wide bore, pump under the barrel, thick stock.
  shotgun: [
    'M2 8.5h24v3H2z',
    'M8 12h10v2.5H8z',                     // pump
    'M26 7h14v6H26z',
    'M40 8h5v5h-5z',
    'M45 9h15v4H45z',
    'M38 13h3v4h-3z',
  ],
  // Bolt sniper: very long barrel, scope on top, long stock.
  sniper: [
    'M1 9.5h26v2H1z',
    'M27 7.5h14v5H27z',
    'M28 3.5h14v3H28z',                    // scope tube
    'M31 6.5h2v1h-2z',                     // scope mount
    'M39 6.5h2v1h-2z',
    'M30 12.5h4l1 6h-5z',
    'M41 8h5v5h-5z',
    'M46 9h15v4H46z',
    'M39 12.5h3v4h-3z',
  ],
  // Sidearm: short slide, no stock.
  pistol: [
    'M18 8h22v4H18z',                      // slide
    'M20 12h6v2h-6z',                      // frame
    'M34 12h5l2 8h-6z',                    // grip
  ],
  // Rocket launcher: fat tube, shoulder rest.
  rocket_launcher: [
    'M2 7h44v6H2z',
    'M0 6h4v8H0z',                         // muzzle flare
    'M46 8h8v4h-8z',
    'M22 13h5v4h-5z',                      // grip
    'M30 4h10v3H30z',                      // sight
  ],
  // Melee, and the fallback for anything with no icon yet.
  knife: [
    'M6 9h26l6 2-6 2H6z',                  // blade
    'M38 8h4v6h-4z',                       // guard
    'M42 9.5h12v3h-12z',                   // handle
  ],
  // Killstreaks and world damage.
  explosive: [
    'M32 3l3 7 7-3-3 7 7 3-7 3 3 7-7-3-3 7-3-7-7 3 3-7-7-3 7-3-3-7 7 3z',
  ],
};

fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const [id, paths] of Object.entries(SHAPES)) {
  // currentColor, so one file serves the enemy-red, friendly-blue and
  // your-kill-white variants instead of shipping three copies of each gun.
  const body = paths
    .map((d) => `  <path d="${d}" fill="currentColor"/>`)
    .join('\n');
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 20" width="64" height="20">',
    body,
    '</svg>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, `${id}.svg`), svg);
  written += 1;
}

console.log(`[weapon-icons] wrote ${written} silhouettes -> assets/ui/weapons/`);
