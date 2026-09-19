/**
 * ClipPlayer.ts — play back recorded frames. No simulation.
 *
 * This is the whole of playback: find the two frames bracketing a time,
 * interpolate between them, hand the result to whatever draws players. There
 * is no physics step, no AI tick, no weapon logic. A player watching a
 * killcam is running strictly LESS work than a player who is alive, which is
 * the property that makes a killcam affordable at the exact moment the
 * renderer is also doing a death overlay.
 *
 * WHY INTERPOLATE AT ALL
 * ----------------------
 * Frames were recorded at the server's tick rate, which is not the display
 * rate and never will be. Playing them by nearest-frame makes a 60 Hz
 * recording judder on a 144 Hz screen and makes slow motion a slideshow.
 * Interpolating means playback speed is continuous: 0.25x is smooth, 4x is
 * smooth, and a scrub to an arbitrary time lands between frames cleanly.
 *
 * WHAT IT DELIBERATELY DOES NOT KNOW
 * ----------------------------------
 * Anything about killcams, cameras, grenades or abilities. It answers one
 * question — "what did the world look like at time T" — and the camera layer
 * asks it. Keeping those apart is what lets the camera improve without
 * touching playback, and lets playback serve a full replay viewer later with
 * no changes.
 */
import type { RecordedFrame } from '../server/ReplayRecorder';
import type { EntityState, PlayerPublicState, Vec3 } from '../net/Protocol';

/** The world at one instant, already blended. What a renderer consumes. */
export interface PlaybackFrame {
  readonly tick: number;
  readonly time: number;
  readonly players: readonly PlayerPublicState[];
  readonly entities: readonly EntityState[];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Shortest-arc angle blend.
 *
 * Yaw is periodic, so a naive lerp from +179 to -179 degrees spins the body
 * almost all the way round instead of nudging it two degrees across the
 * wrap. That shows up as a violent spin on exactly the frame a player turns
 * to face their killer, which is the frame a killcam exists to show.
 */
const lerpAngle = (a: number, b: number, t: number): number => {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
};

const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t),
];

/**
 * Blend two recorded player states.
 *
 * Positions and angles are continuous so they interpolate. Everything else
 * (alive, operator, name) is discrete and takes the EARLIER frame's value
 * until the later frame is actually reached: a player must not flicker to
 * "dead" halfway through the tick they were shot on.
 */
/**
 * Distance, squared, beyond which two positions cannot be the same motion.
 *
 * A respawn moves a player across the map between one recorded frame and the
 * next. Interpolating that produces a body gliding hundreds of metres
 * through walls -- which measured as a 248 m error against the live match
 * and would read as the single most obviously broken thing in a replay.
 *
 * 8 m in one archived frame is far beyond a sprint (13 cm at 60 Hz, 80 cm
 * even at a coarse 10 Hz archive rate) and far below a respawn, so anything
 * above it is a teleport and must CUT rather than glide.
 */
const TELEPORT_SQ = 8 * 8;

function blendPlayer(a: PlayerPublicState, b: PlayerPublicState, t: number): PlayerPublicState {
  const dx = b.pos[0] - a.pos[0];
  const dy = b.pos[1] - a.pos[1];
  const dz = b.pos[2] - a.pos[2];
  if (dx * dx + dy * dy + dz * dz > TELEPORT_SQ) {
    // Hold the old position until the new one is actually reached, so the
    // body vanishes and reappears rather than flying.
    return t < 1 ? a : b;
  }
  return {
    ...a,
    pos: lerpVec3(a.pos, b.pos, t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
  };
}

function blendEntity(a: EntityState, b: EntityState, t: number): EntityState {
  // `rot` and `vel` are optional on the wire: a static prop sends neither.
  // Blend them only when BOTH frames have them, and otherwise carry the
  // later frame's value through untouched rather than inventing an identity
  // quaternion, which would snap a rotated object flat for one frame.
  const rot = a.rot && b.rot
    ? ([
      lerp(a.rot[0], b.rot[0], t), lerp(a.rot[1], b.rot[1], t),
      lerp(a.rot[2], b.rot[2], t), lerp(a.rot[3], b.rot[3], t),
    ] as const)
    : (b.rot ?? a.rot);
  const vel = a.vel && b.vel ? lerpVec3(a.vel, b.vel, t) : (b.vel ?? a.vel);

  return {
    ...b,
    pos: lerpVec3(a.pos, b.pos, t),
    // Quaternions are nlerp'd rather than slerp'd: across a single tick the
    // arc is tiny, the error is invisible, and nlerp has no trig in it.
    ...(rot ? { rot } : {}),
    ...(vel ? { vel } : {}),
  };
}

export class ClipPlayer {
  private frames: readonly RecordedFrame[] = [];
  /** Seconds into the clip. Authoritative; everything else derives from it. */
  private cursor = 0;
  private playing = false;
  private rate = 1;

  /** Load a clip. Resets the cursor to the start. */
  load(frames: readonly RecordedFrame[]): void {
    this.frames = frames;
    this.cursor = 0;
    this.playing = frames.length > 0;
  }

  get loaded(): boolean { return this.frames.length > 0; }
  get isPlaying(): boolean { return this.playing; }
  get frameCount(): number { return this.frames.length; }
  get speed(): number { return this.rate; }
  set speed(value: number) { this.rate = Math.max(0.05, Math.min(8, value)); }

  /** Clip length in seconds. Zero for an empty or single-frame clip. */
  get duration(): number {
    if (this.frames.length < 2) return 0;
    return this.frames[this.frames.length - 1].time - this.frames[0].time;
  }

  /** Where the cursor is, in seconds from the clip start. */
  get position(): number { return this.cursor; }

  /** 0..1 through the clip. Drives a scrub bar. */
  get progress(): number {
    const d = this.duration;
    return d > 0 ? Math.min(1, this.cursor / d) : 1;
  }

  get finished(): boolean { return this.duration > 0 && this.cursor >= this.duration; }

  play(): void { if (this.loaded) this.playing = true; }
  pause(): void { this.playing = false; }

  /** Jump to a time in seconds, clamped into the clip. */
  seek(seconds: number): void {
    this.cursor = Math.max(0, Math.min(this.duration, seconds));
  }

  /** Jump to a fraction of the clip. What a timeline drag calls. */
  seekFraction(fraction: number): void {
    this.seek(this.duration * Math.max(0, Math.min(1, fraction)));
  }

  /**
   * Advance the cursor. `dt` is REAL seconds; speed is applied here so the
   * caller never has to know the playback rate.
   *
   * Stops at the end rather than wrapping: a killcam that silently looped
   * would leave the player unsure whether the respawn was stuck.
   */
  advance(dt: number): void {
    if (!this.playing || !this.loaded) return;
    this.cursor += dt * this.rate;
    const end = this.duration;
    if (this.cursor >= end) {
      this.cursor = end;
      this.playing = false;
    }
  }

  /**
   * The world at the cursor.
   *
   * Returns null only for an empty clip, so callers can treat a non-null
   * clip as always renderable.
   */
  sample(): PlaybackFrame | null {
    if (!this.frames.length) return null;
    if (this.frames.length === 1) {
      const only = this.frames[0];
      return {
        tick: only.tick, time: only.time,
        players: only.players, entities: only.snapshot.entities,
      };
    }

    const target = this.frames[0].time + this.cursor;
    const index = this.indexBefore(target);
    const a = this.frames[index];
    const b = this.frames[Math.min(index + 1, this.frames.length - 1)];
    const span = b.time - a.time;
    const t = span > 1e-6 ? Math.max(0, Math.min(1, (target - a.time) / span)) : 0;

    // Iterate the LATER frame's actors, matching back into the earlier one.
    //
    // This is the despawn rule, and it has to be this way round. Something
    // that existed at `a` but not at `b` -- a grenade that just detonated, a
    // player who disconnected mid-clip -- must disappear, not freeze in the
    // air. Iterating `b` gets that for free, and anything with no partner in
    // `a` simply pops in at its own position rather than sliding in from a
    // place it never was.
    const players: PlayerPublicState[] = [];
    for (const later of b.players) {
      const earlier = a.players.find((p) => p.id === later.id);
      players.push(earlier ? blendPlayer(earlier, later, t) : later);
    }

    const entities: EntityState[] = [];
    for (const later of b.snapshot.entities) {
      const earlier = a.snapshot.entities.find((e) => e.id === later.id);
      entities.push(earlier ? blendEntity(earlier, later, t) : later);
    }

    return { tick: a.tick, time: target, players, entities };
  }

  /** Where something is at the cursor, players first then entities. */
  positionOf(id: string): Vec3 | null {
    const frame = this.sample();
    if (!frame) return null;
    const player = frame.players.find((p) => p.id === id);
    if (player) return player.pos;
    const entity = frame.entities.find((e) => e.id === id);
    return entity ? entity.pos : null;
  }

  /**
   * Index of the last frame at or before `time`, by binary search.
   *
   * Linear scanning is fine at 60 fps playback but not under a scrub, where
   * the cursor jumps arbitrarily many times per second across a buffer that
   * may hold a full session.
   */
  private indexBefore(time: number): number {
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].time <= time) lo = mid; else hi = mid - 1;
    }
    return Math.min(lo, this.frames.length - 2);
  }

  reset(): void {
    this.frames = [];
    this.cursor = 0;
    this.playing = false;
    this.rate = 1;
  }
}

export default ClipPlayer;
