/**
 * JointIK.ts — Document A §5: the rigid two-bone solve. Delegates to the
 * engine's proven analytic solver (WeaponIK.solveTwoBoneIK) — the math is
 * identical for rigid pivots (law of cosines + pole hint), and the engine
 * version additionally returns frame-frozen bone-locals so the application
 * can never compound across frames.
 */
import * as THREE from 'three';
import { solveTwoBoneIK, applySolution, type ArmChain, type IKSolution } from '../weapons/WeaponIK';

export interface JointChain {
  shoulderPivot: THREE.Object3D;
  upperArmPivot: THREE.Object3D;
  elbowPivot: THREE.Object3D;
  wristPivot: THREE.Object3D;
}

export function toArmChain(chain: JointChain): ArmChain {
  return {
    shoulder: chain.shoulderPivot as unknown as THREE.Bone,
    upperArm: chain.upperArmPivot as unknown as THREE.Bone,
    forearm: chain.elbowPivot as unknown as THREE.Bone,
    hand: chain.wristPivot as unknown as THREE.Bone,
  };
}

export function solveJointIK(
  chain: JointChain,
  targetPos: THREE.Vector3,
  poleHintWorld: THREE.Vector3,
  targetWristWorldQuat: THREE.Quaternion | null,
): IKSolution | null {
  return solveTwoBoneIK(toArmChain(chain), targetPos, poleHintWorld, targetWristWorldQuat);
}

export function applyJointSolution(chain: JointChain, solution: IKSolution, weight: number): void {
  applySolution(toArmChain(chain), solution, weight);
}
