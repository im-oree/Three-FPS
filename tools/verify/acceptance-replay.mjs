/**
 * acceptance-replay.mjs — the event log, the recorder and the camera director.
 *
 * The architecture's central claim is that a feature which has never heard of
 * the replay system is still fully recorded and still films correctly. That
 * claim is worth nothing unless it is tested with a capability the system has
 * genuinely never seen, so several checks below invent one.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import {
  buildServerBundle, buildReplayBundle, buildFormatBundle, diskLevelFetcher,
} from './server-harness.mjs';

const {
  GameServer, EventLog, ReplayRecorder,
  CameraDirectorRegistry, buildKillcamPlan, DEFAULT_PROFILE,
  registerBuiltinCameraProfiles,
} = await buildServerBundle();

const { ClipPlayer, KillcamDirector, frameSubject, framePair } = await buildReplayBundle();
const {
  encodeClip, decodeClip, packQuaternion, unpackQuaternion, FORMAT_VERSION,
} = await buildFormatBundle();

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const TICK = 1 / 60;

/**
 * A running match with real bots fighting in it.
 *
 * Bots are added explicitly rather than relying on `fillLobby`, which only
 * fills once a client joins -- a headless harness has no client, so the
 * lobby would stay empty and every behavioural check would vacuously pass.
 */
async function liveServer(levelId = 'killhouse', bots = 8) {
  const server = new GameServer({ levelFetcher: diskLevelFetcher() });
  server.startMatch(levelId, 'ffa');
  await server.whenLevelReady();
  for (let i = 0; i < bots; i += 1) server.addBot();
  server.match.beginLive();
  return server;
}

// --- [1] the log is a generic sink ------------------------------------------
console.log('\n[1] The event log stores anything, without being taught about it');
{
  const log = new EventLog();
  const seen = [];
  const off = log.onRecord((e) => seen.push(e.type));

  // A type this codebase has never heard of, with a payload shape to match.
  log.record({
    type: 'emp_pulse',
    tick: 10,
    time: 0.16,
    actors: ['p1'],
    payload: { radiusMeters: 12, disabledOptics: true },
  });

  check('an unknown event type is stored verbatim',
    log.count === 1 && log.all[0].type === 'emp_pulse');
  check('its free-form payload survives intact',
    log.all[0].payload.radiusMeters === 12 && log.all[0].payload.disabledOptics === true,
    JSON.stringify(log.all[0].payload));
  check('listeners are notified synchronously', seen.length === 1 && seen[0] === 'emp_pulse');

  off();
  log.record({ type: 'emp_pulse', tick: 11, time: 0.18, payload: {} });
  check('unsubscribing actually detaches', seen.length === 1, `${seen.length} deliveries`);

  check('a tick window can be sliced', log.slice(11, 11).length === 1);
  check('events can be found by type', log.ofType('emp_pulse').length === 2);

  log.reset();
  check('a new match starts with an empty log', log.count === 0);
}

// --- [2] the damage chokepoint records everything ---------------------------
console.log('\n[2] Nothing that can hurt you escapes the recording');
{
  const server = await liveServer();
  for (let i = 0; i < 90 * 60; i += 1) server.update(TICK);

  const damage = server.events.ofType('damage');
  const kills = server.events.ofType('kill');
  check('bot gunfights produce damage events', damage.length > 20, `${damage.length}`);
  check('bot gunfights produce kill events', kills.length > 0, `${kills.length}`);

  const sample = kills[0];
  check('a kill names its victim', typeof sample?.payload?.victim === 'string',
    sample?.payload?.victim ?? '-');
  check('a kill carries the capability that caused it',
    typeof sample?.payload?.capabilityId === 'string',
    sample?.payload?.capabilityId ?? 'null');
  check('a kill carries the weapon', typeof sample?.payload?.weaponId === 'string',
    sample?.payload?.weaponId ?? 'null');
  check('a kill records whether it was self-inflicted',
    typeof sample?.payload?.selfInflicted === 'boolean');
  check('kills are positioned in the world', Array.isArray(sample?.at), JSON.stringify(sample?.at));

  // Every kill must correspond to a death the match also saw. A divergence
  // means one of the two paths is being bypassed.
  const matchDeaths = server.match.standings().reduce((n, s) => n + s.deaths, 0);
  check('the log agrees with the scoreboard on how many died',
    Math.abs(kills.length - matchDeaths) <= 1,
    `${kills.length} logged vs ${matchDeaths} on the scoreboard`);

  server.shutdown();
}

// --- [3] self-inflicted deaths are decided in one place ---------------------
console.log('\n[3] Self-inflicted deaths need no special detection');
{
  const server = await liveServer();
  const world = server.world;
  const id = server.addBot();
  const victim = world.getPlayer(id);

  // Fall damage: source is null, which is the definition of nobody's fault.
  server.damage.apply(world, {
    target: victim, targetKind: 'player', amount: 500,
    type: 'fall', source: null, ignoreTeams: true, capabilityId: 'Fall',
  });

  const kill = server.events.ofType('kill').at(-1);
  check('a fall produces a kill event', kill?.payload?.victim === id);
  check('it is flagged self-inflicted', kill?.payload?.selfInflicted === true);
  check('with no killer credited', kill?.payload?.killer === null);
  server.shutdown();
}

// --- [4] the recorder keeps a bounded window --------------------------------
console.log('\n[4] The rolling recorder is bounded and continuous');
{
  const flushed = [];
  const rec = new ReplayRecorder({
    windowSeconds: 1, tickHz: 60, onFlush: (f) => flushed.push(...f),
  });
  for (let t = 0; t < 300; t += 1) {
    rec.append({ tick: t, time: t / 60, snapshot: { tick: t, time: t / 60, ackSeq: 0, entities: [] } });
  }
  check('the window stays bounded', rec.frameCount <= 61, `${rec.frameCount} frames held`);
  check('nothing is silently dropped', rec.flushedCount + rec.frameCount === 300,
    `${rec.flushedCount} flushed + ${rec.frameCount} held`);
  check('evicted frames reach the sink in order',
    flushed.length > 0 && flushed[0].tick === 0
      && flushed[flushed.length - 1].tick === flushed.length - 1,
    `${flushed.length} flushed, first ${flushed[0]?.tick}`);

  const win = rec.window(280, 290);
  check('a window can be sliced out of memory', win.length === 11, `${win.length} frames`);
  check('a window beyond the buffer returns empty, not an error',
    rec.window(0, 5).length === 0);
}

// --- [5] the live server records what it broadcasts -------------------------
console.log('\n[5] The server archives the frames it sends');
{
  const server = await liveServer();
  for (let i = 0; i < 120; i += 1) server.update(TICK);

  check('frames accumulate as the match runs', server.replay.frameCount > 100,
    `${server.replay.frameCount}`);
  const latest = server.replay.window(server.replay.newestTick, server.replay.newestTick)[0];
  check('a recorded frame carries the entity list',
    Array.isArray(latest?.snapshot?.entities));
  // Players are not entities on this server, so a frame that omitted them
  // would replay an empty map -- the failure this check exists to prevent.
  check('a recorded frame carries the players',
    (latest?.players?.length ?? 0) === 8, `${latest?.players?.length} players`);
  check('recorded players have a position and facing',
    Array.isArray(latest?.players?.[0]?.pos)
      && typeof latest?.players?.[0]?.yaw === 'number');
  check('a recorded frame is timestamped',
    typeof latest?.time === 'number' && latest.time > 0, `${latest?.time?.toFixed(2)}s`);
  server.shutdown();
}

// --- [6] the director never fails on an unknown ability ---------------------
console.log('\n[6] An ability the director has never seen still films');
{
  registerBuiltinCameraProfiles();
  const unknown = CameraDirectorRegistry.resolve('ClusterGrenade_v2_NotRegistered');
  check('an unregistered capability resolves to the default profile',
    unknown === DEFAULT_PROFILE || unknown.style === DEFAULT_PROFILE.style,
    unknown.style);

  const plan = buildKillcamPlan({
    tick: 600, victim: 'p2', killer: 'p1', causer: 'grenade_77',
    capabilityId: 'ClusterGrenade_v2_NotRegistered', selfInflicted: false,
  }, 60);
  check('it still produces a valid plan', plan.shots.length > 0, `${plan.shots.length} shots`);
  check('the plan names the fallback it used', plan.profileKey === 'default', plan.profileKey);
  check('every shot has a subject and a tick range',
    plan.shots.every((s) => s.subject && s.toTick > s.fromTick));
  check('the window brackets the kill',
    plan.fromTick < 600 && plan.toTick > 600, `${plan.fromTick}..${plan.toTick}`);
}

// --- [7] registering a profile upgrades the shot, retroactively -------------
console.log('\n[7] Camera logic can be improved after the fact');
{
  const facts = {
    tick: 900, victim: 'p2', killer: 'p1', causer: 'cluster_9',
    capabilityId: 'ClusterGrenade', selfInflicted: false,
  };

  const before = buildKillcamPlan(facts, 60);
  check('before registration it gets the generic shot',
    before.shots[0].kind === 'pair-orbit', before.shots[0].kind);

  // Exactly the two lines the spec promises are needed for a new ability.
  CameraDirectorRegistry.register('ClusterGrenade', {
    travelPath: 'projectile', style: 'follow-instrument', follow: 'causer',
    leadSeconds: 3, tailSeconds: 2.5, slowMoAtImpact: 0.3,
  });

  const after = buildKillcamPlan(facts, 60);
  check('after registration the SAME kill films differently',
    after.shots[0].kind === 'follow' && after.shots[0].subject === 'cluster_9',
    `${after.shots[0].kind} on ${after.shots[0].subject}`);
  check('it now rides the causer, then holds on the impact',
    after.shots.length === 2 && after.shots[1].kind === 'impact-hold');
  check('and applies its own slow motion', after.slowMoAtImpact === 0.3,
    `${after.slowMoAtImpact}`);
  check('the lead time comes from the profile', after.fromTick === 900 - 180,
    `${after.fromTick}`);
}

// --- [8] the standard shots are right ---------------------------------------
console.log('\n[8] Each kind of death gets an appropriate shot');
{
  const shoot = buildKillcamPlan({
    tick: 600, victim: 'p2', killer: 'p1', causer: null,
    capabilityId: 'Shoot', selfInflicted: false,
  }, 60);
  check('a gunfight films over the killer', shoot.shots[0].subject === 'p1'
    && shoot.shots[0].firstPerson === true, shoot.shots[0].kind);
  check('then cuts to the victim', shoot.shots[1].kind === 'victim-reaction');

  const fall = buildKillcamPlan({
    tick: 600, victim: 'p2', killer: null, causer: null,
    capabilityId: 'Fall', selfInflicted: true,
  }, 60);
  check('a fall films the victim', fall.shots[0].subject === 'p2',
    fall.shots[0].kind);
  check('with a long lead so the run-up is visible',
    600 - fall.fromTick >= 180, `${((600 - fall.fromTick) / 60).toFixed(1)}s of lead`);

  // A self-inflicted death by a WEAPON still uses the self-inflicted profile,
  // because that decision was made at the damage chokepoint, not here.
  const ownGrenade = buildKillcamPlan({
    tick: 600, victim: 'p1', killer: 'p1', causer: 'nade_3',
    capabilityId: 'Killstreak_airstrike', selfInflicted: true,
  }, 60);
  check('killing yourself overrides the weapon profile',
    ownGrenade.profileKey === '__self__', ownGrenade.profileKey);
}

// --- [9] a real death produces a real, playable clip ------------------------
console.log('\n[9] A death in a live match yields a clip from the recording');
{
  const server = await liveServer();
  // Run long enough that the window has a full lead-in behind any death.
  for (let i = 0; i < 20 * 60; i += 1) server.update(TICK);

  const kill = server.events.ofType('kill').at(-1);
  check('somebody died', Boolean(kill), kill ? `${kill.payload.victim}` : 'nobody');

  const clip = kill ? server.buildKillcam(kill.payload.victim) : null;
  check('a clip is produced for the victim', clip !== null);
  if (clip) {
    check('it contains real recorded frames', clip.frames.length > 30,
      `${clip.frames.length} frames`);
    check('the frames bracket the moment of death',
      clip.fromTick <= kill.tick && clip.toTick >= kill.tick,
      `${clip.fromTick}..${clip.toTick} around ${kill.tick}`);
    check('it carries the events from that window',
      clip.events.some((e) => e.type === 'kill'), `${clip.events.length} events`);
    check('it carries a camera plan', clip.plan.shots.length > 0,
      `${clip.plan.shots.length} shots via ${clip.plan.profileKey}`);
    // A clip whose frames are all identical is a screenshot, not a replay.
    const first = clip.frames[0];
    const last = clip.frames[clip.frames.length - 1];
    const moved = first.players.some((a) => {
      const b = last.players.find((p) => p.id === a.id);
      return b && (Math.abs(a.pos[0] - b.pos[0]) + Math.abs(a.pos[2] - b.pos[2])) > 0.5;
    });
    check('the clip shows a moving world, not a freeze', moved);
    check('the victim is present in the clip',
      first.players.some((p) => p.id === kill.payload.victim));
  }
  server.shutdown();
}

// --- [10] a new match does not inherit the last one's history ---------------
console.log('\n[10] Ending a match clears the recording');
{
  const server = await liveServer();
  for (let i = 0; i < 10 * 60; i += 1) server.update(TICK);
  const hadEvents = server.events.count > 0;
  const hadFrames = server.replay.frameCount > 0;

  server.stopMatch('test');
  check('the match had something recorded', hadEvents && hadFrames);
  check('stopping the match clears the event log', server.events.count === 0,
    `${server.events.count} left`);
  check('stopping the match clears the recorder', server.replay.frameCount === 0,
    `${server.replay.frameCount} left`);
  server.shutdown();
}

// --- [11] every kind of death reaches the match -----------------------------
console.log('\n[11] A death by any cause respawns and scores');
{
  // The bug this guards: the match learned about deaths by scanning
  // CombatSystem's resolved-shot list, so anything that was not a bullet --
  // an explosion, a killstreak, a future ability -- left the player dead
  // forever with no score, no respawn and no death camera.
  for (const [label, type, capability] of [
    ['an explosion', 'explosive', 'Killstreak_airstrike'],
    ['fall damage', 'fall', 'Fall'],
    ['an ability nobody has written yet', 'plasma_lance', 'PlasmaLance_v3'],
  ]) {
    const server = await liveServer('killhouse', 4);
    for (let i = 0; i < 120; i += 1) server.update(TICK);

    const id = server.ai.agentIds[0];
    const victim = server.world.getPlayer(id);
    const deathsBefore = server.match.scoreOf(id).deaths;

    server.damage.apply(server.world, {
      target: victim, targetKind: 'player', amount: 500,
      type, source: null, ignoreTeams: true, capabilityId: capability,
    });
    check(`${label} kills the player`, victim.alive === false);

    // Well past the respawn delay.
    for (let i = 0; i < 600; i += 1) server.update(TICK);
    const after = server.world.getPlayer(id);
    check(`${label} respawns them`, after.alive === true && after.health > 0,
      `alive=${after.alive} hp=${after.health}`);
    check(`${label} is counted on the scoreboard`,
      server.match.scoreOf(id).deaths === deathsBefore + 1,
      `${deathsBefore} -> ${server.match.scoreOf(id).deaths}`);
    server.shutdown();
  }
}

// --- [11b] credit survives the non-bullet path ------------------------------
console.log('\n[11b] A non-bullet kill still credits the killer');
{
  // Routing deaths through the damage chokepoint once lost the killer, and
  // the match booked every explosion kill as "fell out of the world".
  const server = await liveServer('killhouse', 4);
  for (let i = 0; i < 120; i += 1) server.update(TICK);

  const [killerId, victimId] = server.ai.agentIds;
  const victim = server.world.getPlayer(victimId);
  const killsBefore = server.match.scoreOf(killerId).kills;

  server.damage.apply(server.world, {
    target: victim, targetKind: 'player', amount: 500, type: 'explosive',
    source: killerId, ignoreTeams: true, capabilityId: 'Killstreak_airstrike',
  });
  server.update(TICK);

  check('the killer is credited with the kill',
    server.match.scoreOf(killerId).kills === killsBefore + 1,
    `${killsBefore} -> ${server.match.scoreOf(killerId).kills}`);

  const record = server.match.deathLog[server.match.deathLog.length - 1];
  check('the death log names the killer, not the void',
    record.victim === victimId && record.killer === killerId,
    `${record.killer ?? 'nobody'} killed ${record.victim}`);
  server.shutdown();
}

// --- [12] the log never double-counts ---------------------------------------
console.log('\n[12] One death is one death');
{
  const server = await liveServer('killhouse', 8);
  for (let i = 0; i < 60 * 60; i += 1) server.update(TICK);

  const scoreboard = server.match.standings().reduce((n, s2) => n + s2.deaths, 0);
  const logged = server.events.ofType('kill').length;
  check('the event log matches the scoreboard exactly', scoreboard === logged,
    `${logged} events vs ${scoreboard} deaths`);

  // Both the damage chokepoint and the bullet path can reach registerDeath
  // for the same death; it must stay idempotent per life.
  const seen = new Set();
  let dupes = 0;
  for (const d of server.match.deathLog) {
    const key = `${d.victim}@${d.at.toFixed(3)}`;
    if (seen.has(key)) dupes += 1;
    seen.add(key);
  }
  check('no death is recorded twice', dupes === 0, `${dupes} duplicates`);
  server.shutdown();
}

// --- [13] playback is decode-and-interpolate, never simulation --------------
console.log('\n[13] Playback interpolates rather than juddering');
{
  const server = await liveServer('killhouse', 8);
  for (let i = 0; i < 20 * 60; i += 1) server.update(TICK);
  const frames = server.replay.window(server.replay.oldestTick, server.replay.newestTick);

  const clip = new ClipPlayer();
  clip.load(frames);
  check('a clip loads its frames', clip.loaded && clip.frameCount === frames.length,
    `${clip.frameCount} frames`);
  check('it reports a duration', clip.duration > 5, `${clip.duration.toFixed(1)}s`);

  // Sample BETWEEN two recorded ticks. If playback were nearest-frame the
  // sample would equal one endpoint exactly; interpolation must land strictly
  // between them.
  const a = frames[10];
  const b = frames[11];
  const moving = a.players.find((p) => {
    const later = b.players.find((q) => q.id === p.id);
    return later && Math.abs(later.pos[0] - p.pos[0]) > 0.01;
  });
  if (moving) {
    clip.seek((a.time - frames[0].time) + (b.time - a.time) * 0.5);
    const mid = clip.sample().players.find((p) => p.id === moving.id);
    const later = b.players.find((q) => q.id === moving.id);
    const between = (mid.pos[0] > Math.min(moving.pos[0], later.pos[0]))
      && (mid.pos[0] < Math.max(moving.pos[0], later.pos[0]));
    check('a sample between two ticks is genuinely between them', between,
      `${moving.pos[0].toFixed(3)} < ${mid.pos[0].toFixed(3)} < ${later.pos[0].toFixed(3)}`);
  } else {
    check('a sample between two ticks is genuinely between them', false, 'nobody moved');
  }

  // Yaw must take the short way round the wrap, or a player turning to face
  // their killer spins almost 360 degrees on one frame.
  const wrapped = new ClipPlayer();
  const base = frames[0];
  const mk = (tick, yaw) => ({
    tick, time: tick / 60,
    players: [{ ...base.players[0], id: 'w', pos: [0, 0, 0], yaw, pitch: 0 }],
    snapshot: { tick, time: tick / 60, ackSeq: 0, entities: [] },
  });
  wrapped.load([mk(0, Math.PI - 0.05), mk(1, -Math.PI + 0.05)]);
  wrapped.seek(0.5 / 60);
  const midYaw = wrapped.sample().players[0].yaw;
  check('yaw interpolation takes the short way round the wrap',
    Math.abs(midYaw) > Math.PI - 0.06, `${midYaw.toFixed(3)} rad`);

  server.shutdown();
}

// --- [14] scrub stress ------------------------------------------------------
console.log('\n[14] Scrubbing is stable and cheap');
{
  const server = await liveServer('killhouse', 8);
  for (let i = 0; i < 30 * 60; i += 1) server.update(TICK);
  const frames = server.replay.window(server.replay.oldestTick, server.replay.newestTick);
  const clip = new ClipPlayer();
  clip.load(frames);

  // Ten thousand random seeks. Binary search means this stays fast even when
  // the buffer holds a whole session; a linear scan would crawl.
  let bad = 0;
  const started = Date.now();
  for (let i = 0; i < 10000; i += 1) {
    clip.seekFraction(Math.random());
    const frame = clip.sample();
    if (!frame || !Number.isFinite(frame.time) || !frame.players.length) bad += 1;
  }
  const elapsed = Date.now() - started;
  check('10k random scrubs all sample cleanly', bad === 0, `${bad} bad samples`);
  check('scrubbing stays fast', elapsed < 3000, `${elapsed}ms for 10k seeks`);

  // Seeking outside the clip must clamp, not read off the end.
  clip.seek(-999);
  check('seeking before the start clamps', clip.sample() !== null && clip.position === 0);
  clip.seek(1e9);
  check('seeking past the end clamps', clip.sample() !== null
    && Math.abs(clip.position - clip.duration) < 1e-6);

  server.shutdown();
}

// --- [15] an actor that vanishes mid-shot -----------------------------------
console.log('\n[15] Something despawning mid-shot does not break the camera');
{
  // A grenade detonates and is removed. The camera was following it. This
  // must degrade to a sensible shot, not point at the world origin.
  const mkFrame = (tick, withGrenade) => ({
    tick, time: tick / 60,
    players: [
      { id: 'victim', name: 'V', operatorId: 'ghost', health: 100, maxHealth: 100,
        alive: true, pos: [10, 0, 10], yaw: 0, pitch: 0, team: 'FFA' },
      { id: 'killer', name: 'K', operatorId: 'ghost', health: 100, maxHealth: 100,
        alive: true, pos: [20, 0, 20], yaw: 1, pitch: 0, team: 'FFA' },
    ],
    snapshot: {
      tick, time: tick / 60, ackSeq: 0,
      entities: withGrenade
        ? [{ id: 'nade', kind: 'grenade', pos: [12, 1, 12], rot: [0, 0, 0, 1], vel: [5, 0, 5] }]
        : [],
    },
  });

  const frames = [];
  for (let t = 0; t < 30; t += 1) frames.push(mkFrame(t, t < 15));

  const clip = new ClipPlayer();
  clip.load(frames);
  const director = new KillcamDirector();
  director.load(buildKillcamPlan({
    tick: 20, victim: 'victim', killer: 'killer', causer: 'nade',
    capabilityId: 'MysteryNade', selfInflicted: false,
  }, 60));

  let nulls = 0;
  let finite = 0;
  for (let t = 0; t < 30; t += 1) {
    clip.seek(t / 60);
    const shot = director.compose(clip, 1 / 60);
    if (!shot) { nulls += 1; continue; }
    if (Number.isFinite(shot.position.x) && Number.isFinite(shot.lookAt.x)) finite += 1;
  }
  check('the camera composes a shot on every frame', nulls === 0, `${nulls} null frames`);
  check('every composed shot is a real position', finite === 30, `${finite}/30 finite`);

  // After the grenade is gone the camera must be looking at someone who
  // still exists, not at (0,0,0).
  clip.seek(25 / 60);
  const after = director.compose(clip, 1 / 60);
  const distToOrigin = Math.hypot(after.lookAt.x, after.lookAt.z);
  check('after the despawn it falls back to a real actor, not the origin',
    distToOrigin > 5, `looking at ${after.lookAt.x.toFixed(1)}, ${after.lookAt.z.toFixed(1)}`);
}

// --- [16] framing responds to the subject, not to its type ------------------
console.log('\n[16] Framing is driven by motion, not by what the thing is');
{
  const V = (x, y, z) => ({ x, y, z,
    distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });

  const still = frameSubject({
    position: V(0, 0, 0), speed: 0, heading: null, facing: 0,
  });
  const fast = frameSubject({
    position: V(0, 0, 0), speed: 40, heading: 0, facing: 0,
  });
  const dStill = Math.hypot(still.position.x, still.position.z);
  const dFast = Math.hypot(fast.position.x, fast.position.z);
  check('a fast subject is framed from further back', dFast > dStill + 3,
    `${dStill.toFixed(1)}m still vs ${dFast.toFixed(1)}m fast`);
  check('and through a wider lens', fast.fov > still.fov,
    `${still.fov} -> ${fast.fov}`);
  check('the camera is above the subject', still.position.y > 1);

  // The same call frames a rocket and a person. Nothing type-specific exists.
  const pair = framePair(V(0, 0, 0), V(30, 0, 0));
  check('a pair shot looks at the midpoint between them',
    Math.abs(pair.lookAt.x - 15) < 0.001, `x=${pair.lookAt.x}`);
  check('a distant pair is framed from further back',
    Math.hypot(pair.position.x - 15, pair.position.z) > 20);
}

// --- [17] slow motion is applied at playback, never recorded ----------------
console.log('\n[17] Slow motion belongs to the camera, not the recording');
{
  const director = new KillcamDirector();
  director.load(buildKillcamPlan({
    tick: 600, victim: 'v', killer: 'k', causer: null,
    capabilityId: 'Shoot', selfInflicted: false,
  }, 60));

  const atImpact = director.rateAt(600, 60);
  const wellBefore = director.rateAt(400, 60);
  check('playback slows at the moment of impact', atImpact < 0.9,
    `${atImpact.toFixed(2)}x`);
  check('and runs at normal speed before it', Math.abs(wellBefore - 1) < 0.001,
    `${wellBefore.toFixed(2)}x`);

  // Easing, not a step: a rate that jumps reads as a stutter. Sample HALFWAY
  // into the slow-motion window -- at the very edge the eased value rounds to
  // 1.00x and the check would pass on a step function too.
  const half = director.rateAt(600 - 13, 60);
  check('it eases in rather than stepping', half > atImpact + 0.05 && half < 0.995,
    `${half.toFixed(2)}x halfway in, between ${atImpact.toFixed(2)} and 1.00`);
}

// --- [18] the binary format -------------------------------------------------
console.log('\n[18] Recordings pack down to something worth keeping');
{
  const server = await liveServer('prototype', 20);
  const captured = [];
  server.replay.append = (frame) => { captured.push(frame); };
  for (let i = 0; i < 60 * 60; i += 1) server.update(TICK);

  const json = Buffer.byteLength(JSON.stringify(captured));
  const binary = encodeClip(captured);
  check('the binary form is far smaller than JSON',
    binary.byteLength * 10 < json,
    `${(json / 1048576).toFixed(1)} MB -> ${(binary.byteLength / 1024).toFixed(0)} KB`);

  // Archive at 20 Hz: playback interpolates, so storing every tick is paying
  // for frames no one can distinguish.
  const archive = captured.filter((_, i) => i % 3 === 0);
  const packed = deflateSync(Buffer.from(encodeClip(archive)), { level: 9 });
  const tenMinuteKB = packed.byteLength * 10 / 1024;
  check('a 10-minute 20-player match fits in about a megabyte',
    tenMinuteKB < 1200, `${tenMinuteKB.toFixed(0)} KB`);

  // Deflate must be doing real work, or the format is wasting entropy.
  check('deflate roughly halves it',
    packed.byteLength < encodeClip(archive).byteLength * 0.75,
    `${(encodeClip(archive).byteLength / 1024).toFixed(0)} KB -> ${(packed.byteLength / 1024).toFixed(0)} KB`);

  server.shutdown();
}

console.log('\n[19] Nothing you can see is lost in the packing');
{
  const server = await liveServer('killhouse', 12);
  const captured = [];
  server.replay.append = (frame) => { captured.push(frame); };
  for (let i = 0; i < 20 * 60; i += 1) server.update(TICK);

  const round = decodeClip(encodeClip(captured));
  check('every frame survives the round trip',
    round.frames.length === captured.length,
    `${captured.length} -> ${round.frames.length}`);
  check('the header reports the format version',
    round.header.version === FORMAT_VERSION, `v${round.header.version}`);

  let worst = 0;
  let worstYaw = 0;
  let compared = 0;
  for (let i = 0; i < captured.length; i += 1) {
    for (const truth of captured[i].players) {
      const got = round.frames[i].players.find((p) => p.id === truth.id);
      if (!got) continue;
      compared += 1;
      worst = Math.max(worst, Math.hypot(
        truth.pos[0] - got.pos[0], truth.pos[1] - got.pos[1], truth.pos[2] - got.pos[2],
      ));
      let dy = Math.abs(truth.yaw - got.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy = Math.PI * 2 - dy;
      worstYaw = Math.max(worstYaw, dy);
    }
  }
  check('positions come back within a centimetre', worst < 0.02,
    `worst ${(worst * 100).toFixed(2)} cm over ${compared} player-frames`);
  check('facing comes back within a tenth of a degree',
    worstYaw < 0.002, `worst ${(worstYaw * 180 / Math.PI).toFixed(4)} deg`);

  // Identity is dictionary-encoded; a name that came back wrong would put
  // the wrong player on the killfeed of a replay.
  const first = captured[0].players[0];
  const decodedFirst = round.frames[0].players.find((p) => p.id === first.id);
  check('names and operators survive',
    decodedFirst?.name === first.name && decodedFirst?.operatorId === first.operatorId,
    `${decodedFirst?.name}`);
  check('liveness survives',
    round.frames.every((f, i) => f.players.every((p) => {
      const truth = captured[i].players.find((q) => q.id === p.id);
      return !truth || truth.alive === p.alive;
    })), 'alive flags match');

  server.shutdown();
}

console.log('\n[20] Quaternions pack to a quarter of the size');
{
  // Smallest-three: store three components in 10 bits each plus 2 bits
  // naming the one that was dropped.
  let worst = 0;
  for (let i = 0; i < 2000; i += 1) {
    const q = [Math.random() * 2 - 1, Math.random() * 2 - 1,
      Math.random() * 2 - 1, Math.random() * 2 - 1];
    const len = Math.hypot(...q);
    const unit = q.map((v) => v / len);
    const back = unpackQuaternion(packQuaternion(unit));
    // q and -q are the same rotation, so compare the closer of the two.
    const straight = Math.hypot(...unit.map((v, j) => v - back[j]));
    const flipped = Math.hypot(...unit.map((v, j) => v + back[j]));
    worst = Math.max(worst, Math.min(straight, flipped));
  }
  check('rotations round-trip accurately', worst < 0.005,
    `worst component error ${worst.toFixed(5)}`);
  check('a packed quaternion is 32 bits',
    packQuaternion([0, 0, 0, 1]) <= 0xffffffff);
}

console.log('\n[21] A corrupt or future recording is refused, not misread');
{
  const server = await liveServer('shipment', 6);
  const captured = [];
  server.replay.append = (frame) => { captured.push(frame); };
  for (let i = 0; i < 120; i += 1) server.update(TICK);
  const good = encodeClip(captured);

  const notAReplay = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  let rejected = false;
  try { decodeClip(notAReplay); } catch { rejected = true; }
  check('random bytes are rejected', rejected);

  // A recording from a future build must fail loudly rather than decode to
  // nonsense -- silent misreading is how a replay viewer shows a match that
  // never happened.
  const future = good.slice();
  future[4] = FORMAT_VERSION + 1;
  let versionRejected = false;
  let message = '';
  try { decodeClip(future); } catch (error) { versionRejected = true; message = String(error.message); }
  check('a newer format version is refused', versionRejected);
  check('and says so usefully', message.includes(String(FORMAT_VERSION + 1)), message);

  // Deflate round trip, since that is how it will be stored.
  const restored = decodeClip(new Uint8Array(inflateSync(Buffer.from(deflateSync(Buffer.from(good))))));
  check('it survives compression and decompression',
    restored.frames.length === captured.length);

  server.shutdown();
}

console.log('\n[22] A teleport is cut, not flown');
{
  // A respawn moves a player across the map in one frame. Interpolating that
  // glides a body hundreds of metres through walls -- measured at 248 m
  // against a live match before this was fixed.
  const mk = (tick, x) => ({
    tick, time: tick / 60,
    players: [{
      id: 'v', name: 'V', operatorId: 'ghost', health: 100, maxHealth: 100,
      alive: true, pos: [x, 0, 0], yaw: 0, pitch: 0, team: 'FFA',
    }],
    snapshot: { tick, time: tick / 60, ackSeq: 0, entities: [] },
  });

  const player = new ClipPlayer();
  player.load([mk(0, 0), mk(1, 250)]);
  player.seek(0.5 / 60);
  const mid = player.sample().players[0].pos[0];
  check('a respawn jump does not interpolate', mid === 0 || mid === 250,
    `x=${mid}`);

  // Ordinary movement must still interpolate, or everything judders.
  const walker = new ClipPlayer();
  walker.load([mk(0, 0), mk(1, 0.2)]);
  walker.seek(0.5 / 60);
  const walked = walker.sample().players[0].pos[0];
  check('but a normal stride still does', walked > 0 && walked < 0.2,
    `x=${walked.toFixed(3)}`);
}

console.log(`\nREPLAY / KILLCAM: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
