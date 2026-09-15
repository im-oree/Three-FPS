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

const serverFiles = walk(SERVER_DIR);
if (serverFiles.length === 0) {
  console.log('  FAIL no files found in src/server — is the path right?');
  failures += 1;
}

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

const checked = serverFiles.length + walk(NET_DIR).length;
if (failures) {
  console.log(`\nSERVER PURITY: ${failures} violation(s) across ${checked} files`);
  process.exit(1);
}
console.log(`SERVER PURITY: clean — ${checked} files, no renderer/DOM/client dependencies`);
