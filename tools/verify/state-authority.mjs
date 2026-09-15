#!/usr/bin/env node
/**
 * state-authority.mjs — ENFORCES the CharacterStateSystem contract.
 *
 * Run:  node tools/verify/state-authority.mjs   (also wired to `npm run verify`)
 *
 * This is a STATIC source audit, deliberately not a runtime test: the point is
 * to fail the build the moment somebody adds character behaviour that bypasses
 * the state authority, including in a future session by a different author who
 * never read CharacterStateSystem.ts. The rules it enforces are the ones
 * written at the top of that file.
 *
 * Exit code 1 on any violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const SRC = path.join(root, 'src');
const AUTHORITY = path.join(SRC, 'character', 'CharacterStateSystem.ts');

let failures = 0;
let checks = 0;
function check(name, ok, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const rel = (f) => path.relative(root, f);
const authoritySrc = readFileSync(AUTHORITY, 'utf8');

// --- 1. the authority exists and exposes exactly one mutation entry point ---
check('CharacterStateSystem is the only mutation entry point',
  /\brequest\(req: StateRequest\): boolean/.test(authoritySrc)
  && !/\bset(Locomotion|WeaponAction|Aim|Carry|Traversal)\s*\(/.test(authoritySrc),
  'no public per-channel setters');

// --- 2. every channel enum member is declared in TRANSITIONS ---------------
// A state that exists but has no declared transitions is unreachable, which is
// the trap rule 3 is meant to spring. Verify the tables actually cover them.
const enumBlocks = [...authoritySrc.matchAll(
  /export const (\w+) = Object\.freeze\(\{([\s\S]*?)\}\s*as const\);/g,
)];
const channelOfEnum = {
  Locomotion: 'locomotion', Traversal: 'traversal',
  WeaponAction: 'weaponAction', Aim: 'aim', Carry: 'carry',
};
const transitionsBlock = authoritySrc.slice(
  authoritySrc.indexOf('const TRANSITIONS'),
  authoritySrc.indexOf('/** A rejected request'),
);
let undeclared = [];
for (const [, enumName, body] of enumBlocks) {
  const channel = channelOfEnum[enumName];
  if (!channel) continue;
  const members = [...body.matchAll(/^\s*(\w+):\s*'(\w+)'/gm)].map((m) => m[2]);
  const chanTable = transitionsBlock.slice(
    transitionsBlock.indexOf(`${channel}: {`),
  );
  const chanEnd = chanTable.indexOf('\n  },');
  const table = chanTable.slice(0, chanEnd === -1 ? undefined : chanEnd);
  for (const m of members) {
    if (!new RegExp(`^\\s*${m}:\\s*\\[`, 'm').test(table)) {
      undeclared.push(`${enumName}.${m}`);
    }
  }
}
check('every declared state has transition rules',
  undeclared.length === 0,
  undeclared.length ? `undeclared: ${undeclared.join(', ')}` : 'all states reachable');

// --- 3. no subsystem keeps a private duplicate of authority state ----------
// These are the exact shadow-flag patterns that previously caused tac sprint
// and reload to silently disagree with the rest of the game.
const SHADOW_PATTERNS = [
  { re: /^\s*(private\s+)?isReloading\s*=/m, why: 'shadow copy of weaponAction RELOADING' },
  { re: /^\s*(private\s+)?isMantling\s*=/m, why: 'shadow copy of traversal MANTLE' },
  { re: /^\s*(private\s+)?isVaulting\s*=\s*(true|false)/m, why: 'shadow copy of traversal VAULT' },
];
const shadows = [];
for (const f of files) {
  if (f === AUTHORITY) continue;
  const src = readFileSync(f, 'utf8');
  for (const { re, why } of SHADOW_PATTERNS) {
    if (re.test(src)) shadows.push(`${rel(f)}: ${why}`);
  }
}
check('no subsystem shadows authority state',
  shadows.length === 0,
  shadows.length ? shadows.join('; ') : 'no shadow flags found');

// --- 4. the gameplay systems that OWN a channel route through the authority -
// Each of these must import the authority and call request(). If a future
// change rips the call out, this fails.
const MUST_ROUTE = [
  ['src/player/PlayerController.ts', 'locomotion + traversal'],
  ['src/player/PlayerMovement.ts', 'tactical sprint promotion'],
  ['src/weapons/ReloadSystem.ts', 'reload'],
  ['src/weapons/WeaponManager.ts', 'switch + ADS'],
];
const notRouted = [];
for (const [file, what] of MUST_ROUTE) {
  const full = path.join(root, file);
  let src = '';
  try { src = readFileSync(full, 'utf8'); } catch { notRouted.push(`${file} (missing)`); continue; }
  const imports = /from '.*CharacterStateSystem'/.test(src);
  const calls = /characterState\.request\(/.test(src);
  if (!imports || !calls) notRouted.push(`${file} (${what})`);
}
check('channel owners route through characterState.request()',
  notRouted.length === 0,
  notRouted.length ? `not routed: ${notRouted.join(', ')}` : `${MUST_ROUTE.length} systems routed`);

// --- 5. traversal must not auto-trigger ------------------------------------
// The mantle is jump-gated now; guard against a regression back to "walk into
// a wall and climb it automatically".
const controllerSrc = readFileSync(path.join(root, 'src/player/PlayerController.ts'), 'utf8');
const traversalCall = controllerSrc.slice(
  Math.max(0, controllerSrc.indexOf('this.vault.tryStart(') - 900),
  controllerSrc.indexOf('this.vault.tryStart(') + 80,
);
check('traversal is jump-gated, not automatic',
  /jumpPressedThisFrame/.test(traversalCall) && /canTraverse\(\)/.test(traversalCall),
  'tryStart is guarded by a jump press and the authority');

// --- 6. the traversal animations exist as real committed assets ------------
const animDir = path.join(root, 'assets', 'animations');
const present = readdirSync(animDir);
const needed = ['mantle_climb.json', 'vault_over.json'];
const missing = needed.filter((n) => !present.includes(n));
check('traversal clips are committed static assets',
  missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : needed.join(', '));

// --- 7. the mantle clip is genuinely two-handed and detailed ---------------
let mantleOk = false; let mantleDetail = 'unreadable';
try {
  const clip = JSON.parse(readFileSync(path.join(animDir, 'mantle_climb.json'), 'utf8'));
  const nodes = clip.tracks.map((t) => t.node);
  const hasBothArms = ['Shoulder_R', 'Shoulder_L', 'ElbowPivot_R', 'ElbowPivot_L',
    'WristPivot_R', 'WristPivot_L'].every((n) => nodes.includes(n));
  const keys = Math.min(...clip.tracks.map((t) => t.times.length));
  // Document A: fingers are never individually animated.
  const noFingers = !nodes.some((n) => /Thumb|Index|Middle|Ring|Pinky|Finger/.test(n));
  mantleOk = clip.ownsIK === 'both' && hasBothArms && keys >= 5 && noFingers;
  mantleDetail = `ownsIK=${clip.ownsIK}, ${clip.tracks.length} tracks, ${keys} keys/track, fingers=${!noFingers}`;
} catch (e) { mantleDetail = String(e); }
check('mantle clip is two-handed, multi-phase, finger-free', mantleOk, mantleDetail);

// --- 8. every channel has at least one consumer ---------------------------
// A channel nobody reads is a lie: the state would say STOWED while the gun
// stayed in frame. Require each channel to be observed somewhere in /src.
const allSrc = files.filter((f) => f !== AUTHORITY)
  .map((f) => readFileSync(f, 'utf8')).join('\n');
const unread = ['locomotion', 'traversal', 'weaponAction', 'aim', 'carry']
  .filter((c) => !new RegExp(`characterState\\.${c}\\b|'${c}'`).test(allSrc));
check('every channel has a consumer in /src',
  unread.length === 0,
  unread.length ? `unread channels: ${unread.join(', ')}` : 'all 5 channels observed');

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
