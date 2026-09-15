/**
 * HandsRig.ts — the RIGID low-poly arm rig side of the viewmodel
 * (Document A §3/§8/§9; replaces the skinned-hands implementation).
 *
 * Loads HANDS.rigPath — the procedural box-segment rig produced ONCE by
 * tools/generateHandModel.js into a real .glb; any conforming export
 * (arms_gloved.glb) is a DATA swap with zero code changes (§13 acceptance).
 *
 * Division of labour per frame (Document A §7.1):
 *  - BAKED joint-keyframe clips (reload/switch/punch) run on the SHARED
 *    mixer in WeaponViewmodel and own exactly the joints they list (§7.4) —
 *    this rig releases its IK/pose ownership of those joints while a clip
 *    runs (see activeOneShotOwnership);
 *  - PROCEDURAL everything-else: movement-state pose targets, tac-sprint
 *    off-hand free swing, fists guard + stride swing, look/breathing — all
 *    fed through the per-joint JointSprings (§8.1/8.2/8.8) which sum every
 *    contribution with zero special-casing;
 *  - GUN mode: the WeaponIK command (§5 analytic two-bone solve) is applied
 *    to the IK joints AFTER the viewmodel solved against this frame's pose;
 *  - RECOIL (§8.3): joint-distributed instantaneous displacement — wrist
 *    most, elbow some, shoulder slightly — each spring recovering at its
 *    own rate (SPRING_PROFILES.jointWrist/jointElbow/jointShoulder).
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { FISTS_GUARD, FOOTSTEP, HANDS, JOINT_RECOIL, RIG_POSES, SPRING_PROFILES, WEAPON_SHAKE } from '../utils/Constants';
import type { AssetLoader } from '../core/AssetLoader';
import type { WeaponViewmodel, ArmRigCommand } from './WeaponViewmodel';
import type { JointChain } from '../character/JointIK';
import type { IKSolution } from './WeaponIK';
import { applyJointSolution } from '../character/JointIK';
import { JointSpring } from '../character/JointSpring';

/** Which chain(s) the currently-running baked clip owns (Document A §7.4). */
export type ClipOwnership = 'none' | 'R' | 'L' | 'both' | 'wristR';

export interface LocomotionInput {
  state: string;
  isTacticalSprinting: boolean;
  /** Horizontal speed (m/s) — scales the stride swing. */
  speed: number;
  isGrounded: boolean;
  /** 0..1 eased ADS weight (tightens/suppresses pose contributions). */
  adsWeight: number;
}

export class HandsRig {
  private root: THREE.Group | null = null;
  private readonly chains: Record<'R' | 'L', JointChain | null> = { R: null, L: null };
  /** Rest orientations captured at load. Springs write ABSOLUTE per-frame
   *  deltas from these — without the per-frame restore, applySpring's
   *  multiply would integrate the spring value into the joint (the
   *  sprint "hands spinning" bug). */
  private readonly restQuat = new Map<THREE.Object3D, THREE.Quaternion>();
  private wristR: THREE.Object3D | null = null;

  // --- per-joint springs (Document A §8.1) --------------------------------
  private readonly springShoulderR = new JointSpring(SPRING_PROFILES.jointShoulder);
  private readonly springShoulderL = new JointSpring(SPRING_PROFILES.jointShoulder);
  private readonly springElbowR = new JointSpring(SPRING_PROFILES.jointElbow);
  private readonly springElbowL = new JointSpring(SPRING_PROFILES.jointElbow);
  private readonly springWristR = new JointSpring(SPRING_PROFILES.jointWrist);
  private readonly springWristL = new JointSpring(SPRING_PROFILES.jointWrist);

  private recoilScale = 1;
  /** Set once bindToCharacter() hands us the shared skeleton's arms. */
  private externallyOwned = false;
  private locomotion: LocomotionInput = {
    state: 'IDLE', isTacticalSprinting: false, speed: 0, isGrounded: true, adsWeight: 0,
  };
  private guardWeight = 0;
  private guardTarget = 0;
  private stridePhase = 0;
  /** Locomotion weapon-shake oscillator phase (figure-8). */
  private shakePhase = 0;
  /** Decaying 0..1 fire-shake envelope and its oscillator phase. */
  private fireShake = 0;
  private fireShakePhase = 0;
  private armed = false;

  private readonly euler = new THREE.Euler();
  private readonly quat = new THREE.Quaternion();

  constructor(private readonly assetLoader: AssetLoader) {}

  async load(): Promise<void> {
    await this.loadFrom(HANDS.rigPath);
    // §8.3: joint-distributed recoil on every shot.
    eventBus.on('weapon:fired', () => { this.kickRecoil(); this.addFireShake(); });
  }

  /**
   * UNIFIED CHARACTER MODE — bind this rig's spring/IK machinery to the arms
   * of the ONE shared character skeleton instead of loading a separate pair of
   * floating viewmodel arms.
   *
   * This is the architectural fix for two problems at once:
   *   (1) the first-person view showed disembodied arms with no torso or legs;
   *   (2) the third-person body held NO weapon, because the weapon lived under
   *       a camera-parented rig the body never saw.
   *
   * With one rig there is exactly one set of arms, one weapon, and one set of
   * animations — so the two perspectives are incapable of disagreeing. Every
   * procedural layer (sway, breathing, joint recoil, pose blends, free-swing)
   * keeps working unchanged, because they only ever addressed the chain by
   * name and this supplies the same named chain.
   */
  /** TEST seam: the live arm chains, for harnesses to sample bone poses. */
  get chainsForTest(): Record<'R' | 'L', JointChain | null> {
    return this.chains;
  }

  bindToCharacter(root: THREE.Group, chains: { R: JointChain | null; L: JointChain | null }): void {
    this.armed = false;
    // Drop the standalone arms asset if load() built one — the character's
    // own arms replace it entirely (never render both).
    if (this.root && this.root !== root) this.root.parent?.remove(this.root);
    this.root = root;
    this.restQuat.clear();
    this.chains.R = chains.R;
    this.chains.L = chains.L;
    this.wristR = chains.R?.wristPivot ?? null;
    for (const side of ['R', 'L'] as const) {
      const chain = chains[side];
      if (!chain) continue;
      for (const pivot of [chain.shoulderPivot, chain.upperArmPivot, chain.elbowPivot, chain.wristPivot]) {
        this.restQuat.set(pivot, pivot.quaternion.clone());
      }
    }
    if (!this.chains.R || !this.chains.L) {
      throw new Error('[HandsRig] character rig is missing arm chains');
    }
    this.externallyOwned = true;
    this.armed = true;
  }

  /** True when the arms belong to the shared character rig (not a local asset). */
  get isCharacterBound(): boolean {
    return this.externallyOwned;
  }

  private async loadFrom(path: string): Promise<void> {
    const scene = await this.assetLoader.loadModel(path);
    this.root = scene;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false; // always on screen
    });
    for (const side of ['R', 'L'] as const) {
      const names = HANDS.PIVOTS[side];
      const byName = (n: string): THREE.Object3D | null => scene.getObjectByName(n) ?? null;
      const shoulder = byName(names.shoulder);
      const upperArm = byName(names.upperArm);
      const elbow = byName(names.elbow);
      const wrist = byName(names.wrist);
      if (shoulder && upperArm && elbow && wrist) {
        this.chains[side] = { shoulderPivot: shoulder, upperArmPivot: upperArm, elbowPivot: elbow, wristPivot: wrist };
        if (side === 'R') this.wristR = wrist;
        for (const pivot of [shoulder, upperArm, elbow, wrist]) {
          this.restQuat.set(pivot, pivot.quaternion.clone());
        }
      }
    }
    if (!this.chains.R || !this.chains.L) {
      throw new Error('[HandsRig] rig is missing mandatory pivots — regenerate assets (tools/generateHandModel.js)');
    }
    this.armed = true;
  }

  /** §11/A zero-code variant swap: whole-asset (data only). */
  async swapRig(path: string): Promise<void> {
    this.armed = false;
    const previous = this.root;
    await this.loadFrom(path);
    if (previous && previous.parent) previous.parent.remove(previous);
  }

  /** IdleFidgetController seam (Document B §6): the pose springs. */
  get fidgetSprings(): {
    shoulderR: JointSpring; shoulderL: JointSpring;
    wristR: JointSpring; wristL: JointSpring;
  } {
    return {
      shoulderR: this.springShoulderR, shoulderL: this.springShoulderL,
      wristR: this.springWristR, wristL: this.springWristL,
    };
  }

  /** WeaponViewmodel's §5 seam: the solved chains for live measurement. */
  getArmChain(side: 'R' | 'L'): JointChain | null {
    return this.chains[side];
  }

  /** Wrist pivot of the primary hand — the weapon's mount point (§3.1). */
  getWristPivot(): THREE.Object3D | null {
    return this.wristR;
  }

  /** TEST seam: the loaded rig root (acceptance/trace probes). */
  debugRoot(): THREE.Group | null {
    return this.root;
  }

  /** TEST seam: whether both chains resolved (acceptance harness). */
  get chainsResolved(): boolean {
    return Boolean(this.chains.R && this.chains.L);
  }

  attach(viewmodel: WeaponViewmodel): void {
    if (!this.root) return;
    // Character-bound arms already live in the world under the shared rig at
    // the capsule's transform. Re-parenting them to the camera is exactly the
    // "floating detached arms" bug this mode exists to remove.
    if (this.externallyOwned) return;
    this.root.position.set(HANDS.RIG_OFFSET.x, HANDS.RIG_OFFSET.y, HANDS.RIG_OFFSET.z);
    this.root.quaternion.identity();
    viewmodel.addBaseLayer(this.root);
  }

  setCamera(_camera: THREE.PerspectiveCamera): void {}

  /** Per-frame locomotion/ADS context from main (Document A §9 table). */
  setLocomotion(input: LocomotionInput): void {
    this.locomotion = input;
  }

  /** Fists guard stance weight (Document B §3 — the ADS action, no FOV). */
  setGuard(active: boolean): void {
    this.guardTarget = active ? 1 : 0;
  }

  /** Per-weapon joint recoil magnitude (def.recoilJointScale). */
  setRecoilScale(scale: number): void {
    this.recoilScale = scale;
  }

  /** Document A §8.3 — wrist most, elbow some, shoulder slightly. */
  private kickRecoil(): void {
    const s = this.recoilScale;
    const yaw = (Math.random() - 0.5) * JOINT_RECOIL.YAW_JITTER;
    this.springWristR.jump(JOINT_RECOIL.WRIST.x * s, JOINT_RECOIL.WRIST.y * s * yaw, JOINT_RECOIL.WRIST.z * s);
    this.springElbowR.jump(JOINT_RECOIL.ELBOW.x * s, 0, JOINT_RECOIL.ELBOW.z * s);
    this.springShoulderR.jump(JOINT_RECOIL.SHOULDER.x * s, 0, JOINT_RECOIL.SHOULDER.z * s);
  }

  /**
   * Frame-order contract: viewmodel.update (shared mixer + IK solve) has NOT
   * run yet when this is called — springs/poses are integrated here, then the
   * IK command lands later in applyArmCommand(). Baked clips own their joints
   * via the ownership query, so nothing fights the mixer (§7.4).
   */
  /**
   * True when the running clip animates the SHOULDER joints (not just the
   * elbow/wrist). Set by the viewmodel from the clip's own track list, so this
   * is data-driven rather than a hardcoded clip-name check.
   */
  private clipDrivesShoulder = false;

  setClipDrivesShoulder(value: boolean): void {
    this.clipDrivesShoulder = value;
  }

  update(dt: number, ownership: ClipOwnership, oneShotRunning: boolean): void {
    if (!this.armed || !this.chains.R || !this.chains.L) return;

    // --- springs integrate every contribution fed this frame ---------------
    // Restore rest orientations FIRST: this frame's write is
    // rest + springDelta (absolute). Pivots the baked mixer animates get
    // overwritten later this frame anyway (ownership contract).
    for (const [pivot, rest] of this.restQuat) pivot.quaternion.copy(rest);
    this.feedPoseTargets(dt, ownership);
    for (const spring of [this.springShoulderR, this.springShoulderL, this.springElbowR, this.springElbowL, this.springWristR, this.springWristL]) {
      spring.update(dt);
    }

    // --- apply spring deltas as LOCAL rotations on the pose pivots ---------
    // Elbow/wrist springs layer over whatever the mixer + IK produced (right
    // side) or the baked clip produced (owned side).
    const rightOwned = ownership === 'R' || ownership === 'both' || ownership === 'wristR';
    const leftOwned = ownership === 'L' || ownership === 'both';
    // SHOULDERS: normally pure procedural, so they take the full pose delta.
    // The exception is a clip that OWNS the chain and animates the shoulder
    // itself — the mantle climb does exactly that, because a pull-up is driven
    // from the shoulder, not the wrist. Writing the spring on top of it
    // silently cancelled the clip's shoulder track and the arms never left
    // their rest pose. Ownership means ownership: all the way up the chain.
    if (!(rightOwned && this.clipDrivesShoulder)) {
      this.applySpring(this.chains.R!.shoulderPivot, this.springShoulderR.value, 1);
    }
    if (!(leftOwned && this.clipDrivesShoulder)) {
      this.applySpring(this.chains.L!.shoulderPivot, this.springShoulderL.value, 1);
    }
    if (!rightOwned) {
      this.applySpring(this.chains.R!.elbowPivot, this.springElbowR.value, 1);
      this.applySpring(this.chains.R!.wristPivot, this.springWristR.value, 1);
    }
    if (!leftOwned) {
      this.applySpring(this.chains.L!.elbowPivot, this.springElbowL.value, 1);
      this.applySpring(this.chains.L!.wristPivot, this.springWristL.value, 1);
    }
    void oneShotRunning;
  }

  /**
   * Stride-synced weapon shake for WALK / SPRINT / TAC_SPRINT.
   *
   * Amplitude and frequency both scale with the measured horizontal speed, so
   * the weapon settles naturally as the player slows instead of switching
   * between discrete canned states.
   */
  private applyLocomotionShake(dt: number, adsSuppress: number): void {
    const loc = this.locomotion;
    if (!loc.isGrounded) return;
    const profile = loc.isTacticalSprinting
      ? WEAPON_SHAKE.TAC_SPRINT
      : loc.state === 'SPRINT'
        ? WEAPON_SHAKE.SPRINT
        : loc.state === 'WALK'
          ? WEAPON_SHAKE.WALK
          : null;
    if (!profile) return;
    const intensity = Math.min(1, loc.speed / WEAPON_SHAKE.SPEED_REFERENCE) * adsSuppress;
    if (intensity <= 0.001) return;
    this.shakePhase += dt * profile.FREQUENCY_HZ * Math.PI * 2 * Math.max(0.35, intensity);
    const pitch = Math.sin(this.shakePhase) * profile.PITCH_RAD * intensity;
    // Half frequency on the lateral axis is what makes the tip trace a
    // figure-8 rather than a lifeless straight line.
    const yaw = Math.cos(this.shakePhase * 0.5) * profile.YAW_RAD * intensity;
    const roll = Math.sin(this.shakePhase * 0.5) * profile.ROLL_RAD * intensity;
    this.springShoulderR.addTarget(pitch, yaw, roll);
    this.springShoulderL.addTarget(pitch * 0.8, -yaw * 0.6, -roll * 0.8);
    this.springElbowR.addTarget(pitch * profile.ELBOW_SCALE, 0, 0);
    this.springWristR.addTarget(pitch * profile.WRIST_SCALE, yaw * 0.5, 0);
  }

  /** Kick the hands on every shot (called from the weapon:fired handler). */
  addFireShake(amount = 1): void {
    this.fireShake = Math.min(1, this.fireShake + amount);
  }

  /** Feed this frame's pose targets into the springs (§8.1/8.2/8.8/§9). */
  private feedPoseTargets(dt: number, ownership: ClipOwnership): void {
    const loc = this.locomotion;

    // --- movement-state shoulder targets (Document A §9) --------------------
    let sx = 0, sy = 0, sz = 0;
    const adsSuppress = 1 - loc.adsWeight;
    if (loc.isTacticalSprinting) {
      sx += RIG_POSES.TAC_SPRINT_SHOULDER.x; sy += RIG_POSES.TAC_SPRINT_SHOULDER.y; sz += RIG_POSES.TAC_SPRINT_SHOULDER.z;
    } else if (loc.state === 'SPRINT') {
      sx += RIG_POSES.SPRINT_SHOULDER.x; sy += RIG_POSES.SPRINT_SHOULDER.y; sz += RIG_POSES.SPRINT_SHOULDER.z;
    } else if (loc.state === 'SLIDE') {
      sx += RIG_POSES.SLIDE_SHOULDER.x; sy += RIG_POSES.SLIDE_SHOULDER.y; sz += RIG_POSES.SLIDE_SHOULDER.z;
    } else if (!loc.isGrounded) {
      sx += RIG_POSES.AIR_SHOULDER.x;
    }
    this.springShoulderR.addTarget(sx * adsSuppress, sy * adsSuppress, sz * adsSuppress);
    // left shoulder mirrors with opposite lateral component
    this.springShoulderL.addTarget(sx * adsSuppress, sy * adsSuppress * 0.6, -sz * adsSuppress);

    // --- locomotion weapon shake: the sense of carrying weight -------------
    // Static sprint/tac-sprint POSES alone read as a stiff mannequin holding a
    // prop. Real running jolts the weapon every footfall, so the rig gets a
    // stride-synced figure-8 (sin on pitch, cos at HALF frequency on yaw —
    // the classic bob relationship) whose amplitude scales with actual speed
    // and is suppressed when aiming down sights.
    this.applyLocomotionShake(dt, adsSuppress);

    // --- fire shake: recoil felt in the HANDS, not just the camera ---------
    this.fireShake = Math.max(0, this.fireShake - dt / WEAPON_SHAKE.FIRE_DECAY_SECONDS);
    if (this.fireShake > 0) {
      const k = this.fireShake * this.fireShake; // ease-out: snappy then settles
      this.fireShakePhase += dt * WEAPON_SHAKE.FIRE_FREQUENCY_HZ * Math.PI * 2;
      const p = this.fireShakePhase;
      this.springShoulderR.addTarget(
        Math.sin(p) * WEAPON_SHAKE.FIRE_PITCH_RAD * k,
        Math.cos(p * 0.7) * WEAPON_SHAKE.FIRE_YAW_RAD * k,
        0,
      );
      this.springWristR.addTarget(
        Math.sin(p * 1.3) * WEAPON_SHAKE.FIRE_WRIST_RAD * k, 0, 0,
      );
    }

    // --- tactical sprint: LEFT hand RELEASES (Document A §9/§10) -----------
    // (the viewmodel simultaneously drops the left IK command; the free arm
    // swings stride-synced like a real sprinting arm)
    if (loc.isTacticalSprinting && ownership !== 'L' && ownership !== 'both') {
      // Document E §2 tac-sprint: the released arm swings stride-synced and
      // COUNTER-PHASE to the weapon bob — the shared distance-based stride
      // phase (same FOOTSTEP table WeaponPoseOffsets consumes) locks the two
      // oscillators so the arm pumps opposite the shoulder/gun, never in
      // phase. Free-running time-based oscillators drift together, which
      // reads wrong the instant they sync up.
      const swing = RIG_POSES.FREE_SWING;
      this.stridePhase += (loc.speed * dt / FOOTSTEP.STRIDE_SPRINT_METERS) * Math.PI * 2;
      const amp = swing.AMPLITUDE_RAD * Math.min(1, loc.speed / swing.SPEED_REF);
      this.springShoulderL.addTarget(-Math.sin(this.stridePhase) * amp * 0.6, 0, 0);
      this.springElbowL.addTarget(-Math.abs(Math.cos(this.stridePhase)) * amp * 0.9, 0, 0);
    }

    // --- fists: guard pose + BOTH-arms stride swing (Document B §3/§4) ------
    this.guardWeight += (this.guardTarget - this.guardWeight) * Math.min(1, FISTS_GUARD.BLEND_RATE * dt);
    if (this.guardWeight > 0.001) {
      const w = this.guardWeight;
      this.springShoulderR.addTarget(FISTS_GUARD.SHOULDER_R.x * w, FISTS_GUARD.SHOULDER_R.y * w, FISTS_GUARD.SHOULDER_R.z * w);
      this.springElbowR.addTarget(FISTS_GUARD.ELBOW_R.x * w, 0, FISTS_GUARD.ELBOW_R.z * w);
      this.springShoulderL.addTarget(FISTS_GUARD.SHOULDER_L.x * w, FISTS_GUARD.SHOULDER_L.y * w, FISTS_GUARD.SHOULDER_L.z * w);
      this.springElbowL.addTarget(FISTS_GUARD.ELBOW_L.x * w, 0, FISTS_GUARD.ELBOW_L.z * w);
      // Roll the wrists inward so the knuckles face the target.
      this.springWristR.addTarget(FISTS_GUARD.WRIST_R.x * w, FISTS_GUARD.WRIST_R.y * w, FISTS_GUARD.WRIST_R.z * w);
      this.springWristL.addTarget(FISTS_GUARD.WRIST_L.x * w, FISTS_GUARD.WRIST_L.y * w, FISTS_GUARD.WRIST_L.z * w);
    }
    if (this.isFists(loc) && ownership === 'none') {
      const swing = RIG_POSES.FISTS_SWING;
      if (loc.speed > 0.5) {
        this.stridePhase += dt * swing.FREQUENCY_HZ * Math.PI * 2 * Math.max(0.2, loc.speed / swing.SPEED_REF);
        const amp = swing.AMPLITUDE_RAD * Math.min(1, loc.speed / swing.SPEED_REF) * (1 - this.guardWeight);
        this.springShoulderR.addTarget(-Math.sin(this.stridePhase) * amp, 0, 0);
        this.springShoulderL.addTarget(Math.sin(this.stridePhase) * amp, 0, 0);
        this.springElbowR.addTarget(-Math.abs(Math.cos(this.stridePhase)) * amp * 0.8, 0, 0);
        this.springElbowL.addTarget(-Math.abs(Math.sin(this.stridePhase)) * amp * 0.8, 0, 0);
      }
    }
  }

  private isFists(loc: LocomotionInput): boolean {
    void loc;
    // guard weight is only driven in fists mode (main wires it)
    return this.guardTarget > 0;
  }

  /** Rotate `pivot` by the spring's euler delta (local-space, right-multiplied). */
  private applySpring(pivot: THREE.Object3D, value: THREE.Euler, scale: number): void {
    this.euler.set(value.x * scale, value.y * scale, value.z * scale, 'XYZ');
    this.quat.setFromEuler(this.euler);
    pivot.quaternion.multiply(this.quat);
  }

  /**
   * §5 — GUN MODE final writer. Called by main AFTER WeaponViewmodel.update()
   * solved against this frame's pose; the solutions' bone-locals are frozen at
   * solve time, so this application is exact within the frame.
   */
  applyArmCommand(command: ArmRigCommand | null): void {
    if (!command?.active) return;
    this.applyChainCommand('R', command.right, command.weight);
    this.applyChainCommand('L', command.left, command.weight);
  }

  /**
   * Apply one chain's IK solution, preserving a baked clip's authored motion.
   *
   * When a clip owns the chain (`additive`), the mixer has already written the
   * clip's pose into the pivots. We capture that pose as a DELTA from rest,
   * apply the IK solution (which puts the hand on the weapon), then re-apply
   * the delta on top. The result: the reload/inspect motion plays while the
   * weapon stays gripped, instead of the arm snapping back to rest and the
   * gun appearing to sink out of view.
   */
  private applyChainCommand(
    side: 'R' | 'L',
    entry: { solution: IKSolution; additive: boolean } | null,
    weight: number,
  ): void {
    const chain = this.chains[side];
    if (!entry || !chain) return;
    if (!entry.additive) {
      applyJointSolution(chain, entry.solution, weight);
      return;
    }
    const pivots = [chain.upperArmPivot, chain.elbowPivot, chain.wristPivot];
    const deltas = pivots.map((pivot) => {
      const rest = this.restQuat.get(pivot);
      if (!rest) return null;
      // delta = rest⁻¹ * current  (the clip's contribution in local space)
      return rest.clone().invert().multiply(pivot.quaternion.clone());
    });
    applyJointSolution(chain, entry.solution, weight);
    pivots.forEach((pivot, i) => {
      const delta = deltas[i];
      if (delta) pivot.quaternion.multiply(delta);
    });
  }
}

export default HandsRig;
