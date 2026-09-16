/**
 * server-harness.mjs — shared plumbing for the headless server suites.
 *
 * Compiling the TypeScript on the fly (rather than checking in a build) means
 * these tests always run against current source; there is no artifact that can
 * pass while the real code is broken.
 */
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let cached = null;

/** Compile and import the server + net layer. Memoised per process. */
export async function buildServerBundle() {
  if (cached) return cached;

  const src = (p) => path.join(process.cwd(), p).replace(/\\/g, '/');
  const entry = `
export { GameServer } from '${src('src/server/GameServer.ts')}';
export { ServerWorld } from '${src('src/server/ServerWorld.ts')}';
export { CollisionWorld } from '${src('src/server/CollisionWorld.ts')}';
export { LevelStore } from '${src('src/server/LevelStore.ts')}';
export { RoomManager } from '${src('src/server/RoomManager.ts')}';
export { MovementSystem } from '${src('src/server/systems/MovementSystem.ts')}';
export { AISystem } from '${src('src/server/systems/AISystem.ts')}';
export { getNavGrid } from '${src('src/server/ai/NavContext.ts')}';
export { KillstreakSystem } from '${src('src/server/systems/KillstreakSystem.ts')}';
export { SERVER_KILLSTREAKS, DEFAULT_KILLSTREAK_IDS, blastDamageAt } from '${src('src/server/KillstreakStats.ts')}';
export { SquadBlackboard } from '${src('src/server/ai/SquadBlackboard.ts')}';
export { NavGrid, findPath } from '${src('src/server/ai/Navigation.ts')}';
export { CapabilityRegistry } from '${src('src/server/ai/Capability.ts')}';
export { registerBuiltinCapabilities } from '${src('src/server/ai/registerCapabilities.ts')}';
export { approachAngle, SeededRandom, getDifficulty } from '${src('src/server/ai/Difficulty.ts')}';
export { perceive, Beliefs } from '${src('src/server/ai/Perception.ts')}';
export { plan } from '${src('src/server/ai/Planner.ts')}';
export { MatchSystem } from '${src('src/server/systems/MatchSystem.ts')}';
export {
  createBotProfile, createSkillProfile, createPersonality, pickTier,
  maybeMistake, hashString,
} from '${src('src/server/ai/BotProfile.ts')}';
export { SpawnSelector } from '${src('src/server/SpawnSelector.ts')}';
export {
  FREE_FOR_ALL, TEAM_DEATHMATCH, GAME_MODES, getGameMode, customise,
} from '${src('src/server/GameModes.ts')}';
export {
  NameAuthority, NameRandom, IdentityRegistry,
} from '${src('src/server/Identity.ts')}';
export { AgentController } from '${src('src/server/ai/AgentController.ts')}';
export { createLocalTransportPair } from '${src('src/net/LocalTransport.ts')}';
export { GameClient } from '${src('src/net/GameClient.ts')}';
export * as Protocol from '${src('src/net/Protocol.ts')}';
`;
  const dir = mkdtempSync(path.join(tmpdir(), 'serverbundle-'));
  const entryFile = path.join(dir, 'entry.ts');
  writeFileSync(entryFile, entry);
  const outFile = path.join(dir, 'bundle.mjs');
  await build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    absWorkingDir: process.cwd(),
    logLevel: 'silent',
  });
  cached = await import(`file://${outFile}`);
  return cached;
}

/** Read a baked collision file the way the browser would fetch it. */
export function diskLevelFetcher() {
  return async (levelId) => {
    const file = path.join(process.cwd(), 'assets/collision', `${levelId}.json`);
    return JSON.parse(readFileSync(file, 'utf8'));
  };
}

/** A pass/fail recorder with a consistent report line. */
export function makeCheck() {
  let passed = 0;
  let failed = 0;
  return {
    check(name, ok, detail = '') {
      if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
      else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
    },
    report(label) {
      console.log(`\n${label}: ${passed}/${passed + failed} checks passed`);
      process.exit(failed ? 1 : 0);
    },
  };
}

export const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
