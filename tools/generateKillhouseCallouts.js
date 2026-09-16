#!/usr/bin/env node
/**
 * generateKillhouseCallouts.js — writes killhouse_callouts.json from the
 * shared layout data, so the minimap labels and the layout cannot drift.
 *
 *   node tools/generateKillhouseCallouts.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { CALLOUTS } from './lib/KillhouseLayout.js';

const OUT = path.resolve('assets/environment-meta/killhouse_callouts.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(CALLOUTS));
console.log(`wrote ${OUT} (${CALLOUTS.length} zones)`);
for (const z of CALLOUTS) console.log(`  ${z.name}`);
