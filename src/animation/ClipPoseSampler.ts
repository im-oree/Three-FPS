/**
 * ClipPoseSampler.ts — evaluate a baked JSON clip at an arbitrary normalized
 * time and write the result onto a set of named joints.
 *
 * WHY THIS EXISTS
 * ---------------
 * The first-person arms are driven by the shared AnimationMixer inside
 * WeaponViewmodel. The third-person body has its OWN arm chains (it is the
 * same rig contract but a different instance), and those are posed
 * procedurally rather than by a mixer.
 *
 * For a mantle that means both perspectives must show the same two-handed
 * climb, from the SAME authored asset — duplicating the keyframes in code
 * would be exactly the kind of drift this project keeps stamping out. So the
 * third-person body samples `mantle_climb.json` directly through this helper,
 * at the traversal's own progress, and the clip stays the single source of
 * truth for what the climb looks like.
 *
 * Sampling is a plain quaternion slerp between the two bracketing keys, which
 * matches what THREE's QuaternionKeyframeTrack does for the mixer path.
 */
import * as THREE from 'three';

interface RawTrack {
  node: string;
  times: number[];
  quaternions: [number, number, number, number][];
}

interface RawClip {
  name: string;
  duration: number;
  ownsIK?: string;
  tracks: RawTrack[];
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class ClipPoseSampler {
  private clip: RawClip | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly url: string) {}

  /** Fetch the clip JSON once. Safe to call repeatedly. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = fetch(this.url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${this.url}: ${r.status}`))))
      .then((json: RawClip) => { this.clip = json; })
      .catch((e) => { console.warn('[ClipPoseSampler]', e); });
    return this.loading;
  }

  get isReady(): boolean {
    return this.clip !== null;
  }

  get duration(): number {
    return this.clip?.duration ?? 0;
  }

  /**
   * Write the clip's pose at `progress` (0..1) onto the joints resolved by
   * `resolve`. Joints the clip does not mention are left untouched, so this
   * composes with whatever else posed the rig.
   *
   * @param weight 0..1 blend against each joint's current orientation, so the
   *               clip can fade in and out instead of popping.
   */
  applyPose(
    progress: number,
    resolve: (nodeName: string) => THREE.Object3D | null | undefined,
    weight = 1,
  ): void {
    const clip = this.clip;
    if (!clip || weight <= 0) return;
    const t = THREE.MathUtils.clamp(progress, 0, 1) * clip.duration;

    for (const track of clip.tracks) {
      const joint = resolve(track.node);
      if (!joint) continue;
      this.sampleTrack(track, t, _qa);
      if (weight >= 1) joint.quaternion.copy(_qa);
      else joint.quaternion.slerp(_qa, weight);
    }
  }

  private sampleTrack(track: RawTrack, t: number, out: THREE.Quaternion): void {
    const { times, quaternions } = track;
    const last = times.length - 1;
    if (t <= times[0]) { out.fromArray(quaternions[0]); return; }
    if (t >= times[last]) { out.fromArray(quaternions[last]); return; }

    let i = 0;
    while (i < last && times[i + 1] < t) i += 1;
    const span = times[i + 1] - times[i];
    const alpha = span > 0 ? (t - times[i]) / span : 0;
    _qb.fromArray(quaternions[i + 1]);
    out.fromArray(quaternions[i]).slerp(_qb, alpha);
  }
}
