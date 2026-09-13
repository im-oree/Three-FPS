/**
 * WeaponIK.ts — the two-bone IK solver (Document 2.5 §6.3).
 *
 * ANALYTIC, not iterative: one closed-form pass per arm per frame (the spec's
 * "single analytic pass is sufficient and standard" resolution-order trick —
 * the weapon is parented under the hand, so the target is computed from where
 * the hand WOULD be at rest and treated as converged after one solve).
 *
 * Fully convention-independent: everything is derived from LIVE world
 * transforms (bone lengths read from the current skeleton each solve — the
 * §2.4 property that lets a differently-proportioned hand model drop in with
 * zero re-tuning), and results are converted world→local at the end, so bone
 * local-axis conventions never matter. Elbow direction is resolved by a pole
 * hint (camera-space "down and outward") per §6.3.
 */
import * as THREE from 'three';

export interface ArmChain {
  /** Clavicle/shoulder — the "aim" joint that steers the whole chain plane. */
  shoulder: THREE.Bone;
  upperArm: THREE.Bone;
  forearm: THREE.Bone;
  hand: THREE.Bone;
}

interface ChainSnapshot {
  shoulderPos: THREE.Vector3;
  elbowPos: THREE.Vector3;
  handPos: THREE.Vector3;
  upperLen: number;
  foreLen: number;
  shoulderWorldQuat: THREE.Quaternion;
  upperWorldQuat: THREE.Quaternion;
  foreWorldQuat: THREE.Quaternion;
  handWorldQuat: THREE.Quaternion;
  upperParentWorldQuat: THREE.Quaternion;
  foreParentWorldQuat: THREE.Quaternion;
  handParentWorldQuat: THREE.Quaternion;
}

const EPSILON = 1e-6;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _polePerp = new THREE.Vector3();
const _elbowTarget = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _solvedUpper = new THREE.Quaternion();
const _solvedFore = new THREE.Quaternion();
const _solvedHand = new THREE.Quaternion();

function snapshot(chain: ArmChain): ChainSnapshot | null {
  const { shoulder, upperArm, forearm, hand } = chain;
  // CONSISTENT WORLD REFRESH: the arms mixer animates bone quaternions
  // without touching cached matrixWorld, and positions below are read from
  // that cache. getWorldQuaternion would lazily refresh per call, mixing
  // fresh quats with stale positions — the snapshot then "solves" toward
  // last frame's pose (observed as a no-op left-arm IK). One explicit
  // refresh keeps every read on the same world state.
  upperArm.updateWorldMatrix(true, true);
  // JOINT LABELS (§2.1 rig): the upper-arm VECTOR runs UpperArm origin →
  // Forearm origin; the forearm VECTOR runs Forearm origin → Hand origin.
  // (Bone NODE origins sit at their proximal pivots: UpperArm.matrixWorld is
  // the shoulder pivot, Forearm.matrixWorld the elbow, Hand.matrixWorld the
  // wrist.) Getting these one bone off silently aims the ELBOW at the grip.
  const shoulderPos = new THREE.Vector3().setFromMatrixPosition(upperArm.matrixWorld);
  const elbowPos = new THREE.Vector3().setFromMatrixPosition(forearm.matrixWorld);
  const wristPos = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
  const handPos = wristPos.clone();
  const upperLen = elbowPos.distanceTo(shoulderPos);
  const foreLen = wristPos.distanceTo(elbowPos);
  // Degenerate chain (bones not resolved / zero-length rig): refuse to solve.
  if (upperLen < EPSILON || foreLen < EPSILON) return null;
  return {
    shoulderPos,
    elbowPos,
    handPos,
    upperLen,
    foreLen,
    shoulderWorldQuat: shoulder.getWorldQuaternion(new THREE.Quaternion()),
    upperWorldQuat: upperArm.getWorldQuaternion(new THREE.Quaternion()),
    foreWorldQuat: forearm.getWorldQuaternion(new THREE.Quaternion()),
    handWorldQuat: hand.getWorldQuaternion(new THREE.Quaternion()),
    upperParentWorldQuat: upperArm.parent
      ? upperArm.parent.getWorldQuaternion(new THREE.Quaternion())
      : new THREE.Quaternion(),
    foreParentWorldQuat: forearm.parent
      ? forearm.parent.getWorldQuaternion(new THREE.Quaternion())
      : new THREE.Quaternion(),
    handParentWorldQuat: hand.parent
      ? hand.parent.getWorldQuaternion(new THREE.Quaternion())
      : new THREE.Quaternion(),
  };
}

export interface IKSolution {
  /**
   * BONE-LOCAL orientations produced by the solve, converted against THE
   * SOLVE'S OWN snapshot. (Converting world→local at apply time against a
   * RE-SNAPSHOTTED pose mixes two different frames — the mixer may have
   * advanced in between — and twists the chain. Locals are frozen at solve
   * time; applying them later is order-independent.)
   */
  upperArmLocal: THREE.Quaternion;
  forearmLocal: THREE.Quaternion;
  handLocal: THREE.Quaternion;
  /** Debug: world-space orientations at solve time. */
  upperArmWorld: THREE.Quaternion;
  /** True when the target was outside reach and got clamped (arm fully extended). */
  clamped: boolean;
}

/**
 * Closed-form solve. `poleHintWorld` is a DIRECTION (from the shoulder) the
 * elbow should bend toward — camera-local "down/outward" transformed to world
 * by the caller. `targetHandWorldQuat` orients the wrist after the position
 * solve (wrist carries the orientation residual — anatomically correct).
 */
export function solveTwoBoneIK(
  chain: ArmChain,
  targetPos: THREE.Vector3,
  poleHintWorld: THREE.Vector3,
  targetHandWorldQuat: THREE.Quaternion | null,
): IKSolution | null {
  const snap = snapshot(chain);
  if (!snap) return null;

  // --- 1. clamp target into the annulus the two bones can actually reach ---
  const reach = _axis.subVectors(targetPos, snap.shoulderPos);
  let dist = reach.length();
  const minReach = Math.abs(snap.upperLen - snap.foreLen) + 1e-4;
  const maxReach = snap.upperLen + snap.foreLen - 1e-4;
  let clamped = false;
  if (dist < EPSILON) {
    reach.set(0, -1, 0);
    dist = minReach;
    clamped = true;
  } else if (dist < minReach || dist > maxReach) {
    reach.multiplyScalar(THREE.MathUtils.clamp(dist, minReach, maxReach) / dist);
    dist = THREE.MathUtils.clamp(dist, minReach, maxReach);
    clamped = true;
  }
  _axis.copy(reach).normalize();

  // --- 2. pole hint -> elbow plane normal ---
  _polePerp.copy(poleHintWorld).addScaledVector(_axis, -poleHintWorld.dot(_axis));
  if (_polePerp.lengthSq() < EPSILON) {
    // Pole parallel to the limb: pick any stable perpendicular.
    _polePerp.set(_axis.y, _axis.z, -_axis.x);
    _polePerp.addScaledVector(_axis, -_polePerp.dot(_axis));
  }
  _polePerp.normalize();

  // --- 3. law of cosines -> elbow target position on the bend plane ---
  const a = (snap.upperLen * snap.upperLen - snap.foreLen * snap.foreLen + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(snap.upperLen * snap.upperLen - a * a, 0));
  _elbowTarget
    .copy(snap.shoulderPos)
    .addScaledVector(_axis, a)
    .addScaledVector(_polePerp, h);

  // --- 4. swing upper arm so its child lands on the elbow target ---
  _v1.subVectors(snap.elbowPos, snap.shoulderPos).normalize();
  _v2.subVectors(_elbowTarget, snap.shoulderPos).normalize();
  _q.setFromUnitVectors(_v1, _v2);
  _solvedUpper.copy(_q).multiply(snap.upperWorldQuat);

  // --- 5. bend forearm so the wrist lands on the target ---
  // CAREFUL with composition: the upper-arm swing q carries the forearm
  // world frame along (q * foreWorld); the elbow bend q2 then premultiplies
  // THAT result. Composing via _solvedUpper here would count upperWorld
  // twice (verified by isolated numeric test).
  _v1.subVectors(snap.handPos, snap.elbowPos).normalize().applyQuaternion(_q);
  _v2.subVectors(targetPos, _elbowTarget).normalize();
  _q2.setFromUnitVectors(_v1, _v2);
  _solvedFore.copy(_q2).multiply(_q).multiply(snap.foreWorldQuat);

  // --- 6. wrist carries the orientation residual (§6.3 fine-pose) ---
  // The caller supplies the hand's desired WORLD orientation outright (the
  // grip is authored coincident with the hand frame), so the residual is
  // exact, not a single-axis twist: handLocal = solvedFore⁻¹ · target,
  // which step 7 performs once _solvedHand is set.
  if (targetHandWorldQuat) {
    _solvedHand.copy(targetHandWorldQuat);
  } else {
    _solvedHand.copy(snap.handWorldQuat);
  }

  // --- 7. world → bone-LOCAL, using each bone's SOLVED parent frame ---------
  // The upper arm's parent (shoulder) does not move during the solve, but the
  // FOREARM's parent (the upper arm) and the HAND's parent (the forearm) DO —
  // converting against the pre-solve parent frames would apply the upper-arm
  // swing twice (verified by isolated numeric test).
  const upperLocal = new THREE.Quaternion().copy(snap.upperParentWorldQuat).invert().multiply(_solvedUpper);
  const foreLocal = new THREE.Quaternion().copy(_solvedUpper).invert().multiply(_solvedFore);
  const handLocal = new THREE.Quaternion().copy(_solvedFore).invert().multiply(_solvedHand);

  return {
    upperArmLocal: upperLocal,
    forearmLocal: foreLocal,
    handLocal,
    upperArmWorld: _solvedUpper.clone(),
    clamped,
  };
}

/**
 * Applies a solution's bone-LOCAL orientations (frozen at solve time — see
 * IKSolution) with a blend weight (0 = no-op, 1 = snap). No re-snapshot:
 * safe to run at any point after the solve within the same frame.
 */
export function applySolution(
  chain: ArmChain,
  solution: IKSolution,
  weight: number,
): void {
  if (weight <= 0) return;
  chain.upperArm.quaternion.slerp(solution.upperArmLocal, weight);
  chain.forearm.quaternion.slerp(solution.forearmLocal, weight);
  chain.hand.quaternion.slerp(solution.handLocal, weight);
}

/**
 * Utility: bone chain length helpers (live-read per §6.3).
 */
export function chainReach(chain: ArmChain): { upper: number; fore: number } {
  const snap = snapshot(chain);
  if (!snap) return { upper: 0, fore: 0 };
  return { upper: snap.upperLen, fore: snap.foreLen };
}

export default { solveTwoBoneIK, applySolution, chainReach };
