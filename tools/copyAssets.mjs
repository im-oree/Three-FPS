#!/usr/bin/env node
/**
 * copyAssets.mjs — post-build step (`npm run build` runs it after `vite build`).
 *
 * The source-of-truth asset tree lives at the repository root (/assets) per the
 * master specification, but Vite only copies /public into dist/. This script
 * mirrors /assets -> dist/assets so `npm run preview` (and any static host
 * serving dist/) resolves the exact same absolute URLs (/assets/...) that the
 * dev server resolves from the project root. Without it, dev and production
 * would disagree about where game assets live.
 *
 * Skips VCS placeholder files (.gitkeep). Idempotent: safe to re-run.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(repoRoot, 'assets');
const dest = path.join(repoRoot, 'dist', 'assets');

if (!existsSync(src)) {
  console.error('[copyAssets] no /assets directory at repo root — nothing to copy.');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, {
  recursive: true,
  filter: (source) => path.basename(source) !== '.gitkeep',
});

let files = 0;
let bytes = 0n;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      files += 1;
      bytes += BigInt(statSync(full).size);
    }
  }
};
walk(dest);
console.log(`[copyAssets] /assets -> dist/assets: ${files} file(s), ${bytes / 1024n} KiB`);
