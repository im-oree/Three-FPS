/**
 * ai-telemetry.mjs — measure how the AI actually plays, before tuning it.
 *
 * Tuning by feel is how you get bots that are frustrating in ways nobody can
 * name. This runs real matches headlessly and reports the numbers that decide
 * whether a bot reads as a person:
 *
 *   - kills per bot per minute, and the SPREAD across bots. A real lobby has
 *     a best player and a worst player; if every bot scores the same they are
 *     one bot wearing eight names.
 *   - what they spend their time doing (capability occupancy). A bot that
 *     spends 80% of a match walking is a bot that never fights.
 *   - how much ground they cover, and how often they stand still.
 *
 * This is a MEASUREMENT tool, not a pass/fail suite — it prints a table so a
 * tuning change can be judged against every tier at once instead of the one
 * that happened to be tested. acceptance-ai.mjs holds the assertions.
 *
 *   node tools/verify/ai-telemetry.mjs [--minutes 3] [--level killhouse]
 */
import { buildServerBundle, diskLevelFetcher } from './server-harness.mjs';

const { GameServer } = await buildServerBundle();

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const MINUTES = Number(arg('--minutes', 2));
const LEVEL = arg('--level', 'killhouse');
const BOTS = Number(arg('--bots', 8));
const TICK = 1 / 60;

/** Run one match where every bot is the SAME tier, and watch it. */
async function runMatch({ tier, seconds, levelId, bots }) {
  // fillLobby is OFF: this harness adds its own bots so every one of them is
  // the tier under test, rather than the random spread a real lobby gets.
  const server = new GameServer({ levelFetcher: diskLevelFetcher() });
  server.startMatch(levelId, 'ffa');
  await server.whenLevelReady();

  for (let i = 0; i < bots; i += 1) server.addBot(undefined, { tier });

  server.match.beginLive();

  const world = server.world;
  const stats = new Map();
  for (const id of server.ai.agentIds) {
    stats.set(id, {
      id,
      ticks: 0,
      deadTicks: 0,
      stationaryTicks: 0,
      distance: 0,
      lastPos: null,
      capTicks: new Map(),
      shotsSeen: 0,
    });
  }

  const totalTicks = Math.round(seconds / TICK);
  for (let i = 0; i < totalTicks; i += 1) {
    server.update(TICK);

    for (const [id, s] of stats) {
      const p = world.getPlayer(id);
      if (!p) continue;
      // Count only LIVE ticks. A dead bot waiting to respawn is not
      // "standing still" or "idle" -- folding respawn time into those
      // figures made the deadliest tiers look the most passive, because
      // they die more often in a lobby of their own kind.
      if (!p.alive) { s.deadTicks += 1; continue; }
      s.ticks += 1;

      if (s.lastPos) {
        const d = Math.hypot(p.px - s.lastPos[0], p.pz - s.lastPos[2]);
        s.distance += d;
        // A tick that moves less than ~0.25 m/s is standing still.
        if (d < 0.004) s.stationaryTicks += 1;
      }
      s.lastPos = [p.px, p.py, p.pz];

      const agent = server.ai.getAgent(id);
      const cap = agent?.currentCapabilityId ?? 'idle';
      s.capTicks.set(cap, (s.capTicks.get(cap) ?? 0) + 1);
    }
  }

  const rows = [...stats.values()].filter((s) => s.ticks > 0).map((s) => {
    const score = server.match.scoreOf(s.id);
    return { ...s, kills: score?.kills ?? 0, deaths: score?.deaths ?? 0 };
  });
  server.shutdown();
  return rows;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

function summarise(rows, seconds) {
  const mins = seconds / 60;
  const kpm = rows.map((r) => r.kills / mins);
  const totalTicks = rows.reduce((n, r) => n + r.ticks, 0);
  const caps = new Map();
  for (const r of rows) {
    for (const [name, n] of r.capTicks) caps.set(name, (caps.get(name) ?? 0) + n);
  }
  return {
    bots: rows.length,
    totalKills: rows.reduce((n, r) => n + r.kills, 0),
    kpmMean: mean(kpm),
    kpmSd: sd(kpm),
    kpmMin: Math.min(...kpm),
    kpmMax: Math.max(...kpm),
    stationary: mean(rows.map((r) => r.stationaryTicks / Math.max(1, r.ticks))),
    dead: mean(rows.map((r) => r.deadTicks / Math.max(1, r.deadTicks + r.ticks))),
    metresPerMin: mean(rows.map((r) => r.distance / mins)),
    occupancy: [...caps.entries()]
      .map(([name, n]) => [name, n / Math.max(1, totalTicks)])
      .sort((a, b) => b[1] - a[1]),
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const n2 = (x) => x.toFixed(2);

console.log(`\nAI TELEMETRY — ${LEVEL}, ${BOTS} bots, ${MINUTES} min per tier`);
console.log('kpm = kills per bot per minute; spread matters as much as the mean\n');

for (const tier of ['recruit', 'regular', 'hardened', 'veteran', 'pro']) {
  const rows = await runMatch({
    tier, seconds: MINUTES * 60, levelId: LEVEL, bots: BOTS,
  });
  const s = summarise(rows, MINUTES * 60);
  console.log(`${tier.toUpperCase().padEnd(9)} kills=${String(s.totalKills).padStart(3)}  `
    + `kpm ${n2(s.kpmMean)} ±${n2(s.kpmSd)} [${n2(s.kpmMin)}..${n2(s.kpmMax)}]  `
    + `still=${pct(s.stationary).padStart(6)}  dead=${pct(s.dead).padStart(6)}  `
    + `m/min=${String(Math.round(s.metresPerMin)).padStart(4)}`);
  console.log(`          ${s.occupancy.slice(0, 6).map(([k, v]) => `${k} ${pct(v)}`).join('  ')}`);
}
console.log('');
