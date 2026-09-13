/**
 * AnimationLayerCompositor.ts — composes the procedural layers of the
 * Document 2.5 §6.1 stack into ONE final rig pose each frame:
 *
 *   L3  ADS weight (socket-optic alignment solve, §7.2)
 *   L5  Procedural sway (mouse lag + breathing)      — from WeaponSway
 *   L6  Procedural recoil kick                       — inside WeaponSway offsets
 *   L7  Movement-state pose offsets                  — from WeaponPoseOffsets
 *
 * L1/L2/L4 (baked base, hold pose, IK) are consumed elsewhere: L1/L2 by the
 * mixer via AnimationStateMachine descriptors, L4 by WeaponIK inside
 * WeaponViewmodel AFTER this composition (the spec's ordering: IK depends on
 * where the shoulders ended up after everything else).
 *
 * Output is pure data (camera-space anchor + rig-root offsets) — the same
 * shape a future third-person blend would consume WITHOUT the first-person-
 * only terms (§7.4).
 */
import * as THREE from 'three';
import { VIEWMODEL } from '../utils/Constants';
import { degToRad, lerp } from '../utils/MathUtils';
import type { WeaponProfile } from '../weapons/WeaponProfile';
import type { SwayOffsets } from '../weapons/WeaponSway';
import WeaponPoseOffsets, { type PoseOffsetsInput } from '../weapons/WeaponPoseOffsets';

/** Everything the compositor needs per frame. */
export interface CompositorInput {
  profile: WeaponProfile;
  sway: SwayOffsets;
  poseInput: PoseOffsetsInput;
  /** Smoothed ADS weight 0..1 (driven by AnimationStateMachine descriptors). */
  adsWeight: number;
  /**
   * Socket_Optic's position relative to the Socket_Grip anchor, in CAMERA
   * space, measured on the CURRENT (pre-IK) pose. Supplied by WeaponViewmodel
   * after the mixer step — this is the §6.3 "intended position first" trick.
   * Null when no optic socket exists (layer 3 falls back to profile hip rest).
   */
  opticRelativeToAnchor: THREE.Vector3 | null;
}

/** Pure-data output consumed by WeaponViewmodel's rig + IK. */
export interface ComposedPose {
  /** Camera-space point Socket_Grip must sit at (pre-IK anchor). */
  anchorPosition: THREE.Vector3;
  /** Camera-space orientation the weapon should hold at the anchor. */
  anchorRotation: THREE.Quaternion;
  /** Rigid offset applied to ViewmodelRigRoot itself (shoulders follow at
   *  VIEWMODEL.ROOT_FOLLOW_FACTOR — the weapon is precise, the body has mass). */
  rigRootPosition: THREE.Vector3;
  rigRootRotation: THREE.Euler;
}

export class AnimationLayerCompositor {
  private readonly poseOffsets = new WeaponPoseOffsets();
  private readonly hipAnchor = new THREE.Vector3();
  private readonly adsAnchor = new THREE.Vector3();
  private readonly hipEuler = new THREE.Euler();
  private readonly pose: ComposedPose = {
    anchorPosition: new THREE.Vector3(),
    anchorRotation: new THREE.Quaternion(),
    rigRootPosition: new THREE.Vector3(),
    rigRootRotation: new THREE.Euler(),
  };
  private readonly qHip = new THREE.Quaternion();
  private readonly qIdentity = new THREE.Quaternion();
  private lastResetKey = '';

  update(dt: number, input: CompositorInput): ComposedPose {
    const { profile, sway, adsWeight } = input;

    // --- L7: movement-state pose offsets (spring-damped, §4.7) --------------
    const poseOff = this.poseOffsets.update(dt, input.poseInput);

    // --- anchor target: profile hip rest ------------------------------------
    const hip = profile.hipRestPosition;
    this.hipAnchor.set(hip[0], hip[1], hip[2]);
    this.hipAnchor.x += sway.posX + poseOff.posX;
    this.hipAnchor.y += sway.posY + poseOff.posY;
    this.hipAnchor.z += sway.posZ + poseOff.posZ;

    // --- L3: Socket_Optic alignment solve (§7.2) ----------------------------
    // At full ADS weight the OPTIC must sit on the camera axis at eye relief;
    // the anchor therefore shifts by minus the optic's offset from itself.
    let adsAnchorValid = false;
    if (input.opticRelativeToAnchor) {
      const rel = input.opticRelativeToAnchor;
      const adsOff = profile.adsCameraOffset;
      // §8.2: the eye sits profile.eyeRelief BEHIND Socket_Optic on its −Z
      // at full ADS — camera z-space target for the OPTIC is −eyeRelief
      // (negative = in front). The grip anchor = optic target − (optic's
      // measured camera-space offset from the grip).
      this.adsAnchor.set(
        adsOff[0] - rel.x + sway.posX * 0.4,
        adsOff[1] - rel.y + sway.posY * 0.4,
        -profile.eyeRelief - rel.z + sway.posZ * 0.4,
      );
      // Hard anti-clip guard: the grip anchor (and thus the whole weapon)
      // must stay IN FRONT of the eye plane — a solve that commands the
      // grip behind z=-0.10 is demanding an unreachable fold and would
      // drag the receiver through the camera.
      this.adsAnchor.z = Math.min(this.adsAnchor.z, VIEWMODEL.ADS_ANCHOR_MIN_FRONT);
      adsAnchorValid = true;
    }

    // --- summed anchor (§6.5 additive-summation design) ---------------------
    this.pose.anchorPosition.copy(this.hipAnchor);
    if (adsAnchorValid) {
      // §8.2: the anchor is the pure geometric solve. The residual the
      // arm-IK equilibrium leaves (reach/servo clamps) is closed by the
      // render-space optic trim in WeaponViewmodel (post-IK, exact by
      // construction — it acts on the measured object itself).
      this.pose.anchorPosition.lerp(this.adsAnchor, adsWeight);
    }

    // --- anchor orientation: hip rest euler eased toward straight-on aim ----
    const e = profile.hipRestRotationEuler;
    this.hipEuler.set(
      degToRad(e[0]) + sway.rotX + poseOff.rotX,
      degToRad(e[1]) + sway.rotY + poseOff.rotY,
      degToRad(e[2]) + sway.rotZ + poseOff.rotZ,
      'YXZ',
    );
    this.qHip.setFromEuler(this.hipEuler);
    // ADS rotates the weapon onto the optical axis (zero cant at full weight)
    // while keeping a share of the sway so aiming still feels alive (§6.1 L3).
    const swayShareAtAds = 0.3;
    this.pose.anchorRotation
      .copy(this.qIdentity)
      .slerp(this.qHip, lerp(1, swayShareAtAds, adsWeight));

    // --- rigid rig-root offsets: ROOT_FOLLOW_FACTOR of the full sum ---------
    const f = VIEWMODEL.ROOT_FOLLOW_FACTOR;
    // §8.2: ADS leans the upper body back toward the stock weld (BEFORE the
    // IK dispatch — the arms solve against the leaned shoulders and can
    // actually reach the anchor).
    const leanZ = VIEWMODEL.ADS_LEAN_Z * adsWeight;
    this.pose.rigRootPosition.set(
      (sway.posX + poseOff.posX) * f,
      (sway.posY + poseOff.posY) * f,
      (sway.posZ + poseOff.posZ) * f + leanZ,
    );
    this.pose.rigRootRotation.set(
      (sway.rotX + poseOff.rotX) * f,
      (sway.rotY + poseOff.rotY) * f,
      (sway.rotZ + poseOff.rotZ) * f,
      'YXZ',
    );
    return this.pose;
  }

  /** Weapon switch: reset springs keyed by weapon id (no cross-weapon drift). */
  resetForWeapon(weaponId: string): void {
    if (this.lastResetKey === weaponId) return;
    this.lastResetKey = weaponId;
    this.poseOffsets.reset();
  }
}

export default AnimationLayerCompositor;
