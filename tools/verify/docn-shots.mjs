#!/usr/bin/env node
/**
 * docn-shots.mjs — Firing Range reference screenshots.
 *
 *   node tools/verify/docn-shots.mjs --url http://localhost:5174 --from 0 --to 4
 *
 * Separate from acceptance-docn.mjs on purpose. Under SwiftShader a single
 * 1280x720 capture of this map costs ~60 s, and the renderer occasionally
 * loses its context partway through a long run; keeping the capture pass out
 * of the assertion pass means a dead tab costs screenshots, not verification.
 * --from/--to render a slice so a batch stays inside one browser lifetime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import { enterMatch } from './enterMatch.mjs';

const args = { url: 'http://localhost:5174', shots: 'tools/verify/shots/docn', from: 0, to: 99 };
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
  if (process.argv[i] === '--shots') args.shots = process.argv[++i];
  if (process.argv[i] === '--from') args.from = Number(process.argv[++i]);
  if (process.argv[i] === '--to') args.to = Number(process.argv[++i]);
}
fs.mkdirSync(args.shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await enterMatch(page, { levelIndex: 4 });
await sleep(2000);


const VIEWS = [
  ['01-spawn-west', -27.5, 1.7, 17.5, -1.06, 0],
  ['02-mid-tower', -10, 2.0, 10, 0.75, -0.05],
  ['03-range-north', -3, 1.9, -14, 0.0, 0.02],
  ['04-tin-building', 30, 2.2, 14, -2.3, -0.05],
  ['05-armory', 33, 1.9, -2, 0.05, 0],
  ['06-jungle-south', 6, 2.0, 24, 0.5, 0.02],
  ['07-wood-building', -17, 1.9, 12, 0.02, 0],
  ['08-tower-loft', 2, 8.2, 8, 0.0, -0.12],
  ['09-overview', -46, 34, 44, -0.9, -0.55],
  ['10-warehouse-west', -30, 2.0, 0, -0.35, -0.02],
];
for (const [name, x, y, z, yaw, pitch] of VIEWS.slice(args.from, args.to)) {
  // Drive the REAL player, not the camera: PlayerCamera rewrites the camera
  // transform from simulation state every frame, so a camera poked directly
  // is overwritten before the next paint (which silently produced four
  // identical screenshots).
  await page.evaluate((v) => {
    const ops = window.__OPERATOR__;
    const pc = ops.playerController;
    pc.debugTeleport(v.x, v.y - 1.6, v.z);
    pc.debugLook(v.yaw, v.pitch);
  }, { x, y, z, yaw, pitch });
  await sleep(450);
  try {
    await page.screenshot({ path: path.join(args.shots, `${name}.png`) });
    console.log(`  shot ${name}`);
  } catch (err) {
    console.log(`  shot ${name} FAILED — ${String(err).slice(0, 120)}`);
  }
}


await browser.close();
console.log(`\nScreenshots -> ${args.shots}`);
