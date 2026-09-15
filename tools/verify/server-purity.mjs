#!/usr/bin/env node
/**
 * server-purity.mjs — enforces the one rule that makes the server portable.
 *
 * src/server/ must be runnable unmodified inside a Node process on a hosted
 * backend. That is only true if it never touches the renderer, the DOM, or
 * any client module. Those dependencies are trivially easy to add by
 * accident — one `import * as THREE` for a Vector3, one `document` reference
 * in a debug line — and each one silently converts "plug in a dedicated
 * backend" from a configuration change into a rewrite.
 *
 * A comment cannot enforce this. This can, and it runs in CI.
 *
 * Also checks the reverse direction: the protocol must stay free of THREE
 * types, because anything in a message has to survive JSON.stringify.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, 'src/server');
const NET_DIR = path.join(ROOT, 'src/net');

/** Imports src/server/ may never make. */
const FORBIDDEN_IMPORTS = [
  { pattern: /from\s+['"]three['"]/, why: 'three.js is a renderer; the server must run headless' },
  { pattern: /from\s+['"].*\/core\//, why: 'src/core is client engine code' },
  { pattern: /from\s+['"].*\/ui\//, why: 'src/ui is DOM code' },
  { pattern: /from\s+['"].*\/vfx\//, why: 'src/vfx is rendering code' },
  { pattern: /from\s+['"].*\/audio\//, why: 'src/audio is a browser API consumer' },
  { pattern: /from\s+['"].*\/environment\//, why: 'src/environment loads THREE scenes' },
  { pattern: /from\s+['"].*\/animation/, why: 'animation drives THREE objects' },
  { pattern: /from\s+['"].*\/camera\//, why: 'cameras are a client concern' },
];

/** Globals src/server/ may never touch. */
const FORBIDDEN_GLOBALS = [
  { pattern: /\bdocument\./, why: 'DOM access' },
  { pattern: /\bwindow\./, why: 'browser global' },
  { pattern: /\bnavigator\./, why: 'browser global' },
  { pattern: /\blocalStorage\b/, why: 'browser storage' },
  { pattern: /\brequestAnimationFrame\b/, why: 'browser frame loop; the server owns its own clock' },
  { pattern: /\bWebGL/, why: 'graphics API' },
  { pattern: /\bHTMLCanvas/, why: 'DOM type' },
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Strip comments so a rule named in prose does not trip its own check. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

let failures = 0;
const report = (file, line, message) => {
  failures += 1;
  console.log(`  FAIL ${path.relative(ROOT, file)}:${line} — ${message}`);
};

/**
 * Resolve a relative import specifier to a real file on disk.
 * Returns null for bare package specifiers (handled by the import rules).
 */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Collect every file reachable from src/server by following imports.
 *
 * Checking only the files IN src/server would be a hole big enough to drive
 * the whole renderer through: the server legitimately shares pure data
 * (weapon stats, level layouts) with the client, and the day one of those
 * shared files grows an `import * as THREE` the server silently stops being
 * headless. Following the graph means a shared file is verified shared, not
 * assumed shared.
 */
function reachableFrom(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    // `import type { X } from './Y'` is erased at compile time -- the emitted
    // bundle contains nothing from Y. Following it would condemn the server
    // for a type it borrows from a client file while importing no code, which
    // is both legal and useful. Value imports are still followed.
    // Verified by the bundle-erasure check further down, so this is not taken
    // on trust.
    for (const match of code.matchAll(/(^|\n)\s*import\s+([\s\S]*?)from\s+['"]([^'"]+)['"]/g)) {
      const clause = match[2];
      if (/^\s*type\s/.test(clause)) continue;
      const resolved = resolveImport(file, match[3]);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

const serverRoots = walk(SERVER_DIR);
if (serverRoots.length === 0) {
  console.log('  FAIL no files found in src/server — is the path right?');
  failures += 1;
}
// Every file the server can reach, not just the ones that live next to it.
const serverFiles = reachableFrom(serverRoots);

for (const file of serverFiles) {
  const raw = fs.readFileSync(file, 'utf8');
  const code = stripComments(raw);
  const lines = code.split('\n');

  lines.forEach((text, index) => {
    for (const rule of FORBIDDEN_IMPORTS) {
      if (rule.pattern.test(text)) report(file, index + 1, `forbidden import — ${rule.why}`);
    }
    for (const rule of FORBIDDEN_GLOBALS) {
      if (rule.pattern.test(text)) report(file, index + 1, `forbidden global — ${rule.why}`);
    }
  });
}

// The protocol is shared by both sides, so it must be JSON-safe too.
for (const file of walk(NET_DIR)) {
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  if (/from\s+['"]three['"]/.test(code)) {
    report(file, 1, 'the wire protocol must not depend on three.js — payloads must be JSON');
  }
}

// --- the relay may only name input actions that actually exist -------------
// A typo here is invisible: isActionDown('interact') on an unbound action
// returns false forever, so the button silently never fires.
{
  const relayFile = path.join(NET_DIR, 'InputRelay.ts');
  const constantsFile = path.join(ROOT, 'src/utils/Constants.ts');
  if (fs.existsSync(relayFile) && fs.existsSync(constantsFile)) {
    const relay = stripComments(fs.readFileSync(relayFile, 'utf8'));
    const constants = fs.readFileSync(constantsFile, 'utf8');
    const bindingBlock = constants.slice(
      constants.indexOf('DEFAULT_KEY_BINDINGS'),
      constants.indexOf('} as const', constants.indexOf('DEFAULT_KEY_BINDINGS')),
    );
    const known = new Set(
      [...bindingBlock.matchAll(/^\s{2}([a-zA-Z0-9]+):/gm)].map((m) => m[1]),
    );
    for (const match of relay.matchAll(/down\(['"]([a-zA-Z0-9]+)['"]\)/g)) {
      if (!known.has(match[1])) {
        report(relayFile, 1, `input action "${match[1]}" is not in DEFAULT_KEY_BINDINGS`);
      }
    }
  }
}

// --- the compiled server bundle must contain no client code ----------------
// The import walk skips `import type`, on the grounds that it is erased. That
// is an assumption about the compiler, so verify it against a real bundle
// rather than trusting it: if a type-only import ever pulled code, these
// strings would appear in the output.
{
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [path.join(SERVER_DIR, 'GameServer.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    absWorkingDir: ROOT,
    logLevel: 'silent',
  });
  // Strip comments first: doc comments legitimately MENTION the banned names
  // (Constants.ts documents a "THREE.Layers index"), and flagging prose would
  // make the check unusable -- or worse, train people to delete the prose.
  const bundled = stripComments(result.outputFiles[0].text);
  const banned = [
    ['localStorage', 'browser storage reached the server bundle'],
    ['document.createElement', 'DOM construction reached the server bundle'],
    ['requestAnimationFrame', 'a browser frame loop reached the server bundle'],
    ['THREE.Vector3(', 'three.js reached the server bundle'],
    ['new Scene(', 'a three.js scene reached the server bundle'],
    ['WebGLRenderer', 'a renderer reached the server bundle'],
  ];
  for (const [needle, why] of banned) {
    if (bundled.includes(needle)) report(path.join(SERVER_DIR, 'GameServer.ts'), 1, why);
  }
}

const netFiles = walk(NET_DIR);
const checked = new Set([...serverFiles, ...netFiles]).size;
const shared = serverFiles.filter(
  (f) => !f.startsWith(SERVER_DIR) && !f.startsWith(NET_DIR),
).length;
if (failures) {
  console.log(`\nSERVER PURITY: ${failures} violation(s) across ${checked} files`);
  process.exit(1);
}
console.log(
  `SERVER PURITY: clean — ${checked} files reachable from the server `
  + `(${shared} shared with the client), no renderer/DOM/client dependencies`,
);
