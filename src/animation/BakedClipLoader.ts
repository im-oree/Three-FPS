/**
 * BakedClipLoader.ts — Document A §7.2: joint-keyframe clips are plain JSON
 * tables under /assets/animations/, loaded via AssetLoader and bound to the
 * shared ViewmodelRigRoot mixer. Tracks address NAMED PIVOTS — any joint not
 * listed stays procedurally driven (§7.4, no masking system).
 */
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { ASSET_ROOTS } from '../utils/Constants';

export interface BakedClipEventData {
  readonly atProgress: number;
  readonly event: string;
}

export interface BakedClipData {
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly {
    readonly node: string;
    readonly times: readonly number[];
    readonly quaternions: readonly (readonly number[])[];
    /** Optional position track (e.g. Bone_Pump rack). */
    readonly positions?: readonly (readonly number[])[];
  }[];
  readonly events?: readonly BakedClipEventData[];
  /** Which chains the clip owns while running: 'L'|'R'|'both'|'wristR'|'none'. */
  readonly ownsIK?: string;
}

export interface LoadedBakedClip {
  readonly clip: THREE.AnimationClip;
  readonly events: readonly BakedClipEventData[];
  /** Which chains the clip owns while running (Document A §7.4). */
  readonly ownsIK: string;
}

/** Smootherstep: zero 1st AND 2nd derivative at both ends (no visible corner). */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Resample a sparse keyframe track onto a dense, eased timeline.
 *
 * The authored clips carry only ~4 keys each. Played back with three.js's
 * default LINEAR interpolation, every key is a velocity discontinuity — the
 * motion starts and stops abruptly, which is precisely the "snappy", low
 * quality feel of the reload and inspect animations. Re-timing each segment
 * through smootherstep and emitting RESAMPLE_HZ samples gives continuous
 * velocity and acceleration, so the same authored poses read as a smooth,
 * weighted hand motion without re-authoring any asset.
 */
function resampleQuaternionTrack(
  node: string,
  times: readonly number[],
  quats: readonly (readonly number[])[],
): THREE.QuaternionKeyframeTrack {
  const RESAMPLE_HZ = 60;
  if (times.length < 2) {
    return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, [...times], quats.flat());
  }
  const start = times[0];
  const end = times[times.length - 1];
  const count = Math.max(2, Math.ceil((end - start) * RESAMPLE_HZ) + 1);
  const outTimes: number[] = [];
  const outValues: number[] = [];
  const a = new THREE.Quaternion();
  const bq = new THREE.Quaternion();
  const out = new THREE.Quaternion();
  for (let i = 0; i < count; i += 1) {
    const time = start + ((end - start) * i) / (count - 1);
    // locate the authored segment containing `time`
    let seg = 0;
    while (seg < times.length - 2 && time > times[seg + 1]) seg += 1;
    const t0 = times[seg];
    const t1 = times[seg + 1];
    const span = t1 - t0;
    const localT = span > 1e-6 ? (time - t0) / span : 0;
    a.fromArray(quats[seg] as number[]);
    bq.fromArray(quats[seg + 1] as number[]);
    out.copy(a).slerp(bq, smootherstep(Math.min(1, Math.max(0, localT))));
    outTimes.push(time);
    outValues.push(out.x, out.y, out.z, out.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, outTimes, outValues);
}

export function buildClipFromData(data: BakedClipData): LoadedBakedClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of data.tracks) {
    if (t.quaternions) {
      tracks.push(resampleQuaternionTrack(t.node, t.times, t.quaternions));
    }
    if (t.positions) {
      const track = new THREE.VectorKeyframeTrack(
        `${t.node}.position`, [...t.times], t.positions.flat(),
      );
      track.setInterpolation(THREE.InterpolateSmooth);
      tracks.push(track);
    }
  }
  return {
    clip: new THREE.AnimationClip(data.name, data.duration, tracks),
    events: data.events ?? [],
    ownsIK: data.ownsIK ?? 'none',
  };
}

/** Load a set of JSON clip files (paths under /assets/animations/). */
export async function loadBakedClips(
  assetLoader: AssetLoader,
  files: readonly string[],
): Promise<Map<string, LoadedBakedClip>> {
  const out = new Map<string, LoadedBakedClip>();
  const uniq = [...new Set(files)];
  await Promise.all(uniq.map(async (file) => {
    const data = await assetLoader.loadJSON(`${ASSET_ROOTS.animations}${file}.json`) as BakedClipData;
    out.set(data.name, buildClipFromData(data));
  }));
  return out;
}
