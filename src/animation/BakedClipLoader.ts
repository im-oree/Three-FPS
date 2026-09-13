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

export function buildClipFromData(data: BakedClipData): LoadedBakedClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of data.tracks) {
    if (t.quaternions) {
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${t.node}.quaternion`, [...t.times], t.quaternions.flat(),
      ));
    }
    if (t.positions) {
      tracks.push(new THREE.VectorKeyframeTrack(`${t.node}.position`, [...t.times], t.positions.flat()));
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
