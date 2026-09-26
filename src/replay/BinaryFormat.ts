/**
 * BinaryFormat.ts — pack a recording into bytes worth keeping.
 *
 * A session recorded as JSON is roughly 1.5 KB per frame per twenty players,
 * which is about 65 MB for a ten-minute match: too big for IndexedDB, too
 * big to upload, too big to keep. The spec's target is 200-400 KB for that
 * same match, and reaching it is a matter of not storing what nobody can
 * perceive.
 *
 * WHAT IS THROWN AWAY, AND WHY IT DOES NOT MATTER
 * -----------------------------------------------
 * Positions become 16-bit integers at 1 cm resolution. A centimetre is well
 * under the width of the thinnest thing in the game and far below what a
 * replay camera can resolve; a float32 spends 32 bits to place a body to the
 * nearest nanometre, which no one will ever see.
 *
 * Rotations use smallest-three: a unit quaternion's largest component can be
 * reconstructed from the other three, so only three need storing, each in
 * 10 bits, plus 2 bits saying which was dropped. 32 bits total instead of
 * 128, with about a thousandth of a degree of error.
 *
 * ORIGIN-RELATIVE, NOT ABSOLUTE
 * -----------------------------
 * 16 bits at 1 cm covers +-327 m, and the largest map is +-265 m -- which
 * fits, but only just, and an aircraft flying in from off-map does not. So
 * positions are quantised RELATIVE to an origin stored once per clip as
 * float32. The span that must fit is then the size of the action in one
 * clip, never the size of the world, and the format stops caring how big
 * maps get.
 *
 * KEYFRAME + DELTA
 * ----------------
 * Most of what a frame contains is identical to the frame before it: a
 * player standing still, a prop that never moves. Each frame therefore
 * stores only the actors whose quantised state actually changed, with a full
 * keyframe every second so that seeking never has to decode from the start.
 */
import type { EntityState, PlayerPublicState, Vec3 } from '../net/Protocol';
import type { RecordedFrame } from '../server/ReplayRecorder';

/** Bump when the layout changes. A decoder must refuse what it cannot read. */
export const FORMAT_VERSION = 1;
const MAGIC = 0x4f505245; // 'OPRE'

/** Metres per quantisation step. 1 cm. */
const POSITION_STEP = 0.01;
/** Full keyframe cadence, in frames. */
const KEYFRAME_INTERVAL = 60;

const Q_MIN = -32768;
const Q_MAX = 32767;

/** Header describing one encoded clip. */
export interface ClipHeader {
  readonly version: number;
  readonly frameCount: number;
  readonly firstTick: number;
  readonly origin: Vec3;
}

// --- quaternion smallest-three ---------------------------------------------

const SQRT2_INV = Math.SQRT1_2;

/**
 * Pack a unit quaternion into 32 bits.
 *
 * The largest component is dropped and rebuilt on decode, which is only
 * valid if the quaternion is normalised -- so it is normalised here rather
 * than trusting the caller. The remaining three are in [-1/sqrt2, 1/sqrt2]
 * by construction, so they are scaled to use the full 10-bit range.
 */
export function packQuaternion(q: readonly [number, number, number, number]): number {
  let [x, y, z, w] = q;
  const length = Math.hypot(x, y, z, w) || 1;
  x /= length; y /= length; z /= length; w /= length;

  // Sign is not stored, so flip the whole quaternion to make the dropped
  // component positive. q and -q are the same rotation, so this is free.
  let largest = 0;
  let largestAbs = Math.abs(x);
  const comps = [x, y, z, w];
  for (let i = 1; i < 4; i += 1) {
    const a = Math.abs(comps[i]);
    if (a > largestAbs) { largestAbs = a; largest = i; }
  }
  if (comps[largest] < 0) for (let i = 0; i < 4; i += 1) comps[i] = -comps[i];

  const rest: number[] = [];
  for (let i = 0; i < 4; i += 1) if (i !== largest) rest.push(comps[i]);

  const enc = (v: number): number => {
    const scaled = Math.round((v * SQRT2_INV + 0.5) * 1023);
    return Math.max(0, Math.min(1023, scaled));
  };
  return ((largest & 3) << 30) | (enc(rest[0]) << 20) | (enc(rest[1]) << 10) | enc(rest[2]);
}

export function unpackQuaternion(packed: number): [number, number, number, number] {
  const largest = (packed >>> 30) & 3;
  const dec = (bits: number): number => ((bits / 1023) - 0.5) / SQRT2_INV;
  const a = dec((packed >>> 20) & 1023);
  const b = dec((packed >>> 10) & 1023);
  const c = dec(packed & 1023);

  const sum = a * a + b * b + c * c;
  const d = Math.sqrt(Math.max(0, 1 - sum));

  const out: [number, number, number, number] = [0, 0, 0, 0];
  const rest = [a, b, c];
  let j = 0;
  for (let i = 0; i < 4; i += 1) out[i] = i === largest ? d : rest[j++];
  return out;
}

// --- growable byte sink -----------------------------------------------------

class Writer {
  private buffer = new ArrayBuffer(1 << 16);
  private view = new DataView(this.buffer);
  private offset = 0;

  private ensure(bytes: number): void {
    if (this.offset + bytes <= this.buffer.byteLength) return;
    let size = this.buffer.byteLength * 2;
    while (size < this.offset + bytes) size *= 2;
    const grown = new ArrayBuffer(size);
    new Uint8Array(grown).set(new Uint8Array(this.buffer, 0, this.offset));
    this.buffer = grown;
    this.view = new DataView(grown);
  }

  u8(v: number): void { this.ensure(1); this.view.setUint8(this.offset, v); this.offset += 1; }
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.offset, v, true); this.offset += 2; }
  i16(v: number): void { this.ensure(2); this.view.setInt16(this.offset, v, true); this.offset += 2; }
  u32(v: number): void { this.ensure(4); this.view.setUint32(this.offset, v >>> 0, true); this.offset += 4; }
  i32(v: number): void { this.ensure(4); this.view.setInt32(this.offset, v, true); this.offset += 4; }
  f32(v: number): void { this.ensure(4); this.view.setFloat32(this.offset, v, true); this.offset += 4; }

  /**
   * Unsigned LEB128. Seven bits of payload per byte, high bit as "more".
   *
   * Nearly every number in a frame is small -- a slot index, a delta of a
   * few centimetres -- and a varint spends one byte on those while still
   * being able to express a large one when it has to.
   */
  varint(v: number): void {
    let value = v >>> 0;
    while (value >= 0x80) { this.u8((value & 0x7f) | 0x80); value >>>= 7; }
    this.u8(value);
  }

  /** Signed varint, zigzagged so -1 costs one byte rather than five. */
  svarint(v: number): void { this.varint(((v << 1) ^ (v >> 31)) >>> 0); }

  /** Length-prefixed UTF-8. Ids and names are short, so one byte of length. */
  str(value: string): void {
    const bytes = new TextEncoder().encode(value);
    const length = Math.min(255, bytes.length);
    this.u8(length);
    this.ensure(length);
    new Uint8Array(this.buffer).set(bytes.subarray(0, length), this.offset);
    this.offset += length;
  }

  finish(): Uint8Array { return new Uint8Array(this.buffer, 0, this.offset).slice(); }
  get length(): number { return this.offset; }
}

class Reader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i16(): number { const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  i32(): number { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  f32(): number { const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  svarint(): number {
    const v = this.varint();
    return (v >>> 1) ^ -(v & 1);
  }

  str(): string {
    const length = this.u8();
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(slice);
  }

  get done(): boolean { return this.offset >= this.bytes.byteLength; }
}

// --- encoding ---------------------------------------------------------------

/** Centre of everything in the clip, so offsets stay inside 16 bits. */
function clipOrigin(frames: readonly RecordedFrame[]): Vec3 {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  const see = (p: Vec3): void => {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
  };
  for (const frame of frames) {
    for (const p of frame.players) see(p.pos);
    for (const e of frame.snapshot.entities) see(e.pos);
  }
  if (!Number.isFinite(minX)) return [0, 0, 0];
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

const quantise = (value: number, origin: number): number => Math.max(
  Q_MIN, Math.min(Q_MAX, Math.round((value - origin) / POSITION_STEP)),
);

const dequantise = (q: number, origin: number): number => q * POSITION_STEP + origin;

/** Yaw/pitch to 16 bits. A full turn in 65536 steps is 0.0055 degrees. */
const packAngle = (radians: number): number => {
  const turns = radians / (Math.PI * 2);
  return Math.round((turns - Math.floor(turns)) * 65535) & 0xffff;
};
const unpackAngle = (packed: number): number => {
  const turns = packed / 65535;
  return turns > 0.5 ? (turns - 1) * Math.PI * 2 : turns * Math.PI * 2;
};

interface PlayerKey { pos: [number, number, number]; yaw: number; pitch: number; alive: boolean }

/** A player's state after quantisation — the units deltas are measured in. */
interface QuantisedPlayer { x: number; y: number; z: number; yaw: number; pitch: number }
interface QuantisedEntity { x: number; y: number; z: number; rot: number }

/**
 * Difference between two packed angles, taken the short way round.
 *
 * Packed angles are a 16-bit ring. A player turning from just under a full
 * turn to just over wraps 65535 -> 0, and a naive subtraction calls that a
 * delta of -65535: five bytes for a movement of one thousandth of a degree,
 * on the exact frame someone spins to face their killer.
 */
function shortestAngleDelta(now: number, before: number): number {
  let delta = (now - before) & 0xffff;
  if (delta > 32767) delta -= 65536;
  return delta;
}

/** Re-wrap a packed angle after adding a delta. */
const addAngle = (base: number, delta: number): number => (base + delta) & 0xffff;

/**
 * Encode frames into a single buffer.
 *
 * The id/name/operator of each player is written once into a dictionary and
 * referenced by index afterwards: repeating "GrimSniper007" sixty times a
 * second is most of what makes a naive recording large.
 */
export function encodeClip(frames: readonly RecordedFrame[]): Uint8Array {
  const w = new Writer();
  const origin = clipOrigin(frames);

  w.u32(MAGIC);
  w.u8(FORMAT_VERSION);
  w.u32(frames.length);
  w.i32(frames.length ? frames[0].tick : 0);
  w.f32(origin[0]); w.f32(origin[1]); w.f32(origin[2]);

  // --- dictionary of everyone who appears ---
  const players = new Map<string, number>();
  for (const frame of frames) {
    for (const p of frame.players) {
      if (!players.has(p.id)) players.set(p.id, players.size);
    }
  }
  w.u16(players.size);
  const firstSeen = new Map<string, PlayerPublicState>();
  for (const frame of frames) {
    for (const p of frame.players) if (!firstSeen.has(p.id)) firstSeen.set(p.id, p);
  }
  for (const [id] of players) {
    const p = firstSeen.get(id)!;
    w.str(p.id);
    w.str(p.name);
    w.str(p.operatorId);
    w.str(p.team ?? 'FFA');
    w.u16(p.maxHealth);
  }

  const previous = new Map<number, PlayerKey>();
  /** Last value ACTUALLY written per slot — what a delta is measured from. */
  const lastWritten = new Map<number, QuantisedPlayer>();
  const entitySeen = new Map<string, QuantisedEntity>();

  frames.forEach((frame, index) => {
    const keyframe = index % KEYFRAME_INTERVAL === 0;
    w.u8(keyframe ? 1 : 0);
    w.i32(frame.tick);
    w.f32(frame.time);

    // --- players ---
    const changed: Array<[number, PlayerPublicState]> = [];
    for (const p of frame.players) {
      const slot = players.get(p.id)!;
      const q: PlayerKey = {
        pos: [quantise(p.pos[0], origin[0]), quantise(p.pos[1], origin[1]), quantise(p.pos[2], origin[2])],
        yaw: packAngle(p.yaw),
        pitch: packAngle(p.pitch),
        alive: p.alive,
      };
      const was = previous.get(slot);
      const same = was
        && was.pos[0] === q.pos[0] && was.pos[1] === q.pos[1] && was.pos[2] === q.pos[2]
        && was.yaw === q.yaw && was.pitch === q.pitch && was.alive === q.alive;
      if (keyframe || !same) changed.push([slot, p]);
      previous.set(slot, q);
    }

    w.varint(changed.length);
    for (const [slot, p] of changed) {
      w.varint(slot);
      const q = {
        x: quantise(p.pos[0], origin[0]),
        y: quantise(p.pos[1], origin[1]),
        z: quantise(p.pos[2], origin[2]),
        yaw: packAngle(p.yaw),
        pitch: packAngle(p.pitch),
      };
      const base = keyframe ? null : (lastWritten.get(slot) ?? null);

      if (base) {
        // DELTA. At 60 Hz a sprinting player moves ~13 cm per tick, so the
        // difference is a handful of centimetres and a zigzag varint spends
        // one byte on it. Measured on a real match, 99.96% of deltas fit in
        // a single byte where an absolute i16 always costs two.
        w.svarint(q.x - base.x);
        w.svarint(q.y - base.y);
        w.svarint(q.z - base.z);
        // Angles wrap, so the delta is taken the short way round -- a player
        // turning through north must cost one byte, not five.
        w.svarint(shortestAngleDelta(q.yaw, base.yaw));
        w.svarint(shortestAngleDelta(q.pitch, base.pitch));
      } else {
        // KEYFRAME, or this actor's first appearance: absolute, so a seek
        // can start decoding here without replaying everything before it.
        w.i16(q.x); w.i16(q.y); w.i16(q.z);
        w.u16(q.yaw); w.u16(q.pitch);
      }
      w.u8((p.alive ? 1 : 0) | (Math.max(0, Math.min(127, Math.round(p.health))) << 1));
      lastWritten.set(slot, q);
    }

    // --- entities ---
    // Sent as "who is here now" so a despawn is implicit: an id absent from
    // the list is gone, which costs nothing to encode.
    const entities = frame.snapshot.entities;
    w.varint(entities.length);
    for (const e of entities) {
      const q: QuantisedEntity = {
        x: quantise(e.pos[0], origin[0]),
        y: quantise(e.pos[1], origin[1]),
        z: quantise(e.pos[2], origin[2]),
        rot: packQuaternion(e.rot ?? [0, 0, 0, 1]),
      };
      const seen = keyframe ? undefined : entitySeen.get(e.id);
      // The id and kind identify the actor and never change, so they are
      // written once when it first appears and never repeated.
      w.u8(seen ? 1 : 0);
      w.str(e.id);
      if (!seen) w.str(e.kind);

      if (seen) {
        w.svarint(q.x - seen.x);
        w.svarint(q.y - seen.y);
        w.svarint(q.z - seen.z);
      } else {
        w.i16(q.x); w.i16(q.y); w.i16(q.z);
      }
      w.u32(q.rot);
      entitySeen.set(e.id, q);
    }
  });

  return w.finish();
}

export interface DecodedClip {
  readonly header: ClipHeader;
  readonly frames: readonly RecordedFrame[];
}

export function decodeClip(bytes: Uint8Array): DecodedClip {
  const r = new Reader(bytes);
  const magic = r.u32();
  if (magic !== MAGIC) throw new Error('not an OPRE replay');
  const version = r.u8();
  if (version !== FORMAT_VERSION) {
    throw new Error(`replay version ${version} is not readable by this build (expects ${FORMAT_VERSION})`);
  }

  const frameCount = r.u32();
  const firstTick = r.i32();
  const origin: Vec3 = [r.f32(), r.f32(), r.f32()];

  const dictSize = r.u16();
  const dict: Array<{ id: string; name: string; operatorId: string; team: string; maxHealth: number }> = [];
  for (let i = 0; i < dictSize; i += 1) {
    dict.push({
      id: r.str(), name: r.str(), operatorId: r.str(), team: r.str(), maxHealth: r.u16(),
    });
  }

  const live = new Map<number, PlayerPublicState>();
  const lastRead = new Map<number, QuantisedPlayer>();
  const entityRead = new Map<string, QuantisedEntity>();
  const entityKinds = new Map<string, string>();
  const frames: RecordedFrame[] = [];

  for (let f = 0; f < frameCount; f += 1) {
    const keyframe = r.u8() === 1;
    const tick = r.i32();
    const time = r.f32();

    const changed = r.varint();
    for (let i = 0; i < changed; i += 1) {
      const slot = r.varint();
      const base = keyframe ? undefined : lastRead.get(slot);
      let q: QuantisedPlayer;
      if (base) {
        q = {
          x: base.x + r.svarint(),
          y: base.y + r.svarint(),
          z: base.z + r.svarint(),
          yaw: addAngle(base.yaw, r.svarint()),
          pitch: addAngle(base.pitch, r.svarint()),
        };
      } else {
        q = { x: r.i16(), y: r.i16(), z: r.i16(), yaw: r.u16(), pitch: r.u16() };
      }
      const packedHealth = r.u8();
      const meta = dict[slot];
      lastRead.set(slot, q);
      live.set(slot, {
        id: meta.id,
        name: meta.name,
        operatorId: meta.operatorId,
        team: meta.team as 'A' | 'B' | 'FFA',
        health: packedHealth >> 1,
        maxHealth: meta.maxHealth,
        alive: (packedHealth & 1) === 1,
        pos: [dequantise(q.x, origin[0]), dequantise(q.y, origin[1]), dequantise(q.z, origin[2])],
        yaw: unpackAngle(q.yaw),
        pitch: unpackAngle(q.pitch),
      });
    }

    const entityCount = r.varint();
    const entities: EntityState[] = [];
    for (let i = 0; i < entityCount; i += 1) {
      const isDelta = r.u8() === 1;
      const id = r.str();
      if (!isDelta) entityKinds.set(id, r.str());
      const previousQ = entityRead.get(id);
      const q: QuantisedEntity = isDelta && previousQ
        ? {
          x: previousQ.x + r.svarint(),
          y: previousQ.y + r.svarint(),
          z: previousQ.z + r.svarint(),
          rot: 0,
        }
        : { x: r.i16(), y: r.i16(), z: r.i16(), rot: 0 };
      q.rot = r.u32();
      entityRead.set(id, q);
      entities.push({
        id,
        kind: entityKinds.get(id) ?? 'unknown',
        pos: [dequantise(q.x, origin[0]), dequantise(q.y, origin[1]), dequantise(q.z, origin[2])],
        rot: unpackQuaternion(q.rot),
        vel: [0, 0, 0],
      });
    }

    frames.push({
      tick,
      time,
      players: [...live.values()],
      snapshot: { tick, time, ackSeq: 0, entities },
    });
  }

  return {
    header: { version, frameCount, firstTick, origin },
    frames,
  };
}

/** Bytes per frame, for reporting. */
export function measure(frames: readonly RecordedFrame[]): {
  bytes: number; perFrame: number; jsonBytes: number; ratio: number;
} {
  const encoded = encodeClip(frames);
  const json = new TextEncoder().encode(JSON.stringify(frames)).byteLength;
  return {
    bytes: encoded.byteLength,
    perFrame: frames.length ? encoded.byteLength / frames.length : 0,
    jsonBytes: json,
    ratio: encoded.byteLength ? json / encoded.byteLength : 0,
  };
}
