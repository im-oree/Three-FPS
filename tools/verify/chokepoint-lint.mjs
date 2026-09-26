/**
 * chokepoint-lint.mjs — prove the two chokepoints are the only way through.
 *
 * The replay architecture rests on a claim that no test of behaviour can
 * check: that EVERY way to lose health goes through DamageSystem, and every
 * notable happening goes through EventLog. Behaviour tests can only prove
 * that the paths which exist today are covered. They cannot stop someone
 * adding a fourth path next month that quietly writes `player.health -= 10`
 * and is therefore invisible to killcams, the killfeed and the scoreboard
 * forever.
 *
 * So this reads the source instead. It is a structural check, not a
 * behavioural one, and it is the only kind of test that can fail on code
 * that has not been written yet.
 *
 * ALLOWLIST, NOT A BLANKET BAN
 * ----------------------------
 * Health is legitimately written outside the damage system at lifecycle
 * boundaries: a spawning entity gets full health, a dead player is pinned to
 * zero, a respawning player is restored. Those are not damage. Each one is
 * listed below with a reason, and anything NOT on the list fails. The list
 * is deliberately awkward to extend: adding to it should feel like a
 * decision, because it is one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, 'src/server');

/**
 * Writes to health that are NOT damage, each with the reason it is allowed.
 * Keyed by `file:line-content` so moving a line does not silently re-approve
 * a different one.
 */
const ALLOWED = [
  {
    file: 'src/server/ServerWorld.ts',
    match: 'entity.health = 1; entity.maxHealth = 1; entity.alive = true;',
    why: 'spawn initialisation — a fresh entity starts at full health',
  },
  {
    file: 'src/server/systems/MatchSystem.ts',
    match: 'victim.health = 0;',
    why: 'death bookkeeping — pins an already-dead player to zero, does not cause the death',
  },
  {
    file: 'src/server/systems/MatchSystem.ts',
    match: 'player.health = player.maxHealth;',
    why: 'respawn — restores a new life',
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const files = walk(SERVER_DIR);

console.log('[1] All damage flows through DamageSystem');
{
  // Any assignment or compound assignment to a `.health` property.
  const WRITE = /(?:^|[^\w.])([\w.]*\.health)\s*(?:=(?!=)|[-+*/]=)/;
  const violations = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (rel.endsWith('systems/DamageSystem.ts')) continue; // the chokepoint itself

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.split('//')[0];
      if (!WRITE.test(code)) return;
      const trimmed = line.trim();
      const allowed = ALLOWED.some((a) => a.file === rel && trimmed.includes(a.match));
      if (!allowed) violations.push(`${rel}:${i + 1}  ${trimmed}`);
    });
  }

  check('no health is written outside the damage chokepoint',
    violations.length === 0,
    violations.length ? `\n        ${violations.join('\n        ')}` : `${files.length} server files scanned`);

  // A reduction is damage by definition and can NEVER be allowlisted.
  const REDUCE = /\.health\s*-=|\.health\s*=\s*[\w.]*\.health\s*-/;
  const reductions = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (rel.endsWith('systems/DamageSystem.ts')) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (REDUCE.test(line.split('//')[0])) reductions.push(`${rel}:${i + 1}`);
    });
  }
  check('nothing subtracts from health directly', reductions.length === 0,
    reductions.join(', ') || 'none');
}

console.log('\n[2] The allowlist is honest');
{
  // Every entry must still correspond to real code. A stale entry is worse
  // than no entry: it silently pre-approves whatever moves into its place.
  const stale = [];
  for (const entry of ALLOWED) {
    const full = path.join(ROOT, entry.file);
    const source = readFileSync(full, 'utf8');
    if (!source.includes(entry.match)) stale.push(`${entry.file}: "${entry.match}"`);
  }
  check('every allowlisted exception still exists', stale.length === 0,
    stale.join(', ') || `${ALLOWED.length} exceptions, all live`);
  check('every exception carries a reason',
    ALLOWED.every((a) => a.why && a.why.length > 20), `${ALLOWED.length} documented`);
}

console.log('\n[3] Deaths cannot bypass the match');
{
  // registerDeath is how a death becomes score + respawn + a death camera.
  // It must be reachable from the damage chokepoint, not only from the
  // bullet path -- the bug that left explosion kills dead forever.
  const gameServer = readFileSync(path.join(ROOT, 'src/server/GameServer.ts'), 'utf8');
  const onDeathBlock = gameServer.slice(
    gameServer.indexOf('this.damage.onDeath('),
    gameServer.indexOf('this.addSystem(this.killstreaks)'),
  );
  check('the damage chokepoint reports deaths to the match',
    onDeathBlock.includes('registerDeath'),
    'damage.onDeath -> match.registerDeath');
  check('and passes the killer through so credit is not lost',
    onDeathBlock.includes('shooter'), 'carries a shooter');
}

console.log('\n[4] The event log is fed by the chokepoint');
{
  const damage = readFileSync(path.join(ROOT, 'src/server/systems/DamageSystem.ts'), 'utf8');
  check('DamageSystem records damage events', damage.includes("type: 'damage'"));
  check('DamageSystem records kill events', damage.includes("type: 'kill'"));
  check('self-inflicted is decided once, at the chokepoint',
    damage.includes('selfInflicted'), 'computed in apply()');

  // Nothing else may DERIVE what self-inflicted means, or two features will
  // disagree about whether a rocket you fired at your own feet was suicide.
  //
  // Reading it back off a recorded payload is fine and expected -- that is
  // the chokepoint's answer being consumed. What is banned is recomputing it
  // from a source/target comparison somewhere else.
  const DERIVES = /selfInflicted\s*[:=][^;,\n]*(===|!==|==|!=|\?|&&|\|\|)/;
  const others = [];
  for (const file of files) {
    if (file.endsWith('systems/DamageSystem.ts')) continue;
    const source = readFileSync(file, 'utf8');
    source.split('\n').forEach((line, i) => {
      const code = line.split('//')[0];
      if (DERIVES.test(code)) others.push(`${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
  check('no other server file derives it', others.length === 0,
    others.join(', ') || 'only DamageSystem computes it');
}

console.log('\n[5] The camera never branches on what an ability is');
{
  // Strip comments before scanning: this file DOCUMENTS the rule it follows
  // ("there is no `if (capabilityId === ...)` anywhere in this file"), and a
  // lint that trips over the prose describing it is a lint nobody trusts.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/.*/g, '');

  const director = stripComments(
    readFileSync(path.join(ROOT, 'src/server/CameraDirector.ts'), 'utf8'),
  );
  // The whole point of a registry is that there is no if-chain over ids.
  const branches = director.match(/capabilityId\s*[=!]==?\s*['"`]/g) ?? [];
  check('CameraDirector has no hardcoded capability comparisons',
    branches.length === 0, `${branches.length} found`);

  // Nor may it switch on one.
  check('and does not switch on a capability id',
    !/switch\s*\(\s*[\w.]*capabilityId/.test(director));

  const clientFiles = walk(path.join(ROOT, 'src/replay'));
  const clientBranches = [];
  for (const file of clientFiles) {
    const source = stripComments(readFileSync(file, 'utf8'));
    if (/capabilityId\s*[=!]==?\s*['"`]/.test(source)) {
      clientBranches.push(path.relative(ROOT, file));
    }
    // A camera that names a weapon or a killstreak has hardcoded a feature.
    for (const word of ['grenade', 'rocket', 'airstrike', 'helicopter', 'missile']) {
      const re = new RegExp(`['"\`][^'"\`]*\\b${word}\\b[^'"\`]*['"\`]`, 'i');
      if (re.test(source)) clientBranches.push(`${path.relative(ROOT, file)} mentions ${word}`);
    }
  }
  check('playback code names no specific ability',
    clientBranches.length === 0, clientBranches.join(', ') || `${clientFiles.length} files clean`);
}

console.log(`\nCHOKEPOINT LINT: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
