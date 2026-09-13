/**
 * AnimLayer.ts — Document C §5 layer contract.
 *
 * An AnimLayer CONTRIBUTES joint transforms; it never writes them into the
 * scene graph. The OperatorAnimEngine collects contributions into the
 * PoseComposer and applies the final Map<joint, {position, quaternion}> in a
 * single pass — one owner, one write per joint per frame.
 *
 * Layer categories are ORDER-ENFORCED (registerLayer rejects out-of-order
 * registration):
 *   locomotion → additive → spring → ik → oneshot
 */

/** Enforcement order — the index IS the mandated sequence (Doc C §5.2). */
export const LAYER_ORDER = [
  'locomotion',
  'additive',
  'spring',
  'ik',
  'oneshot',
] as const;

export type LayerCategory = (typeof LAYER_ORDER)[number];

/** One joint's composed contribution (camera-space root or joint-local). */
export interface JointPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

import type * as THREE from 'three';

export interface AnimLayer {
  readonly name: string;
  readonly category: LayerCategory;
  /** Per-frame advance (sampling, spring integration, solves). */
  update(dt: number): void;
  /**
   * Emit this layer's transforms into the composer. Layers later in the
   * order OVERRIDE earlier ones joint-by-joint (IK wins over locomotion, a
   * one-shot wins over everything its boneMask covers).
   */
  contribute(composer: import('./PoseComposer').PoseComposer): void;
}
