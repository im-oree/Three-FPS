/**
 * PoseComposer.ts — Document C §5.3.
 *
 * Accumulates one Map<joint, JointPose> across layers. `set` overwrites
 * (later layers win — the enforcement order is a precedence chain);
 * `blend` slerp-merges for weight-bearing contributions. The engine applies
 * the composed map to the scene graph in ONE pass.
 */
import type * as THREE from 'three';
import type { JointPose } from './AnimLayer';

export class PoseComposer {
  private readonly poses = new Map<THREE.Object3D, JointPose>();

  /** Overwrite the joint's contribution (full ownership). */
  set(joint: THREE.Object3D, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    const existing = this.poses.get(joint);
    if (existing) {
      existing.position.copy(position);
      existing.quaternion.copy(quaternion);
    } else {
      this.poses.set(joint, { position: position.clone(), quaternion: quaternion.clone() });
    }
  }

  /** Weighted merge for an unowned joint; weight 1 ≡ set. */
  blend(joint: THREE.Object3D, position: THREE.Vector3, quaternion: THREE.Quaternion, weight: number): void {
    const existing = this.poses.get(joint);
    if (!existing || weight >= 1) {
      this.set(joint, position, quaternion);
      return;
    }
    if (weight <= 0) return;
    existing.position.lerp(position, weight);
    existing.quaternion.slerp(quaternion, weight);
  }

  has(joint: THREE.Object3D): boolean {
    return this.poses.has(joint);
  }

  get(joint: THREE.Object3D): JointPose | undefined {
    return this.poses.get(joint);
  }

  size(): number {
    return this.poses.size;
  }

  /** Apply the composed map — the SINGLE scene-graph write pass. */
  apply(): void {
    for (const [joint, pose] of this.poses) {
      joint.position.copy(pose.position);
      joint.quaternion.copy(pose.quaternion);
    }
  }

  clear(): void {
    this.poses.clear();
  }
}
