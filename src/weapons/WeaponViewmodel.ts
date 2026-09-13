/**
 * WeaponViewmodel.ts — the first-person body's render rig (REWRITE per
 * Document 2.5 §3; supersedes Document 3 §8's dedicated-scene approach).
 *
 * ARCHITECTURE (§3.1 — runtime scene graph):
 *
 *   MainCamera (PlayerCamera-driven)
 *   └─ ViewmodelRigRoot (Object3D, CHILD OF THE CAMERA, THREE.Layers index 1)
 *        ├─ viewmodel-only lights (layer 1, illuminate nothing else)
 *        └─ ArmsRig (the hand/arm skeleton, base layer)
 *             └─ Weapon scene parented under Hand_R at runtime, with
 *                Socket_Grip authored AT the hand origin — the arm IK then
 *                bends the chain so the hand is wherever the grip must be.
 *
 * CLIPPING (§3.2 — implemented exactly): ONE camera, TWO passes. World pass
 * renders with the camera masked to layer 0; then renderer.clearDepth(); the
 * camera mask flips to layer 1 and the SAME scene renders again (viewmodel
 * always in front); mask restored. No second camera, FOV perfectly shared,
 * no near-plane hacks.
 *
 * GRIP ALIGNMENT (§2.5/§6.3): on equip the weapon's Socket_Grip is zeroed
 * onto the hand bone (gripFineTuneOffset applies here); every frame the
 * compositor produces the camera-space grip anchor (hip rest + sway + recoil
 * + pose offsets + Socket_Optic ADS solve) and the analytic two-bone solver
 * (WeaponIK) bends the arm chain so the hand lands on it — "the weapon
 * defines where the hand must be" (§3.1). The off-hand IKs to
 * Socket_GripSecondary (twoHanded) or a wrist-support point (oneHanded).
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { animationEngine } from '../animation-engine/OperatorAnimEngine';
import type { AssetLoader } from '../core/AssetLoader';
import { HANDS, IK, VIEWMODEL } from '../utils/Constants';
import { WeaponPartAnimator } from './WeaponPartAnimator';
import { loadBakedClips, type LoadedBakedClip } from '../animation/BakedClipLoader';
import type { ClipOwnership } from './HandsRig';
import type { AnimationLayerCompositor, ComposedPose } from '../animation/AnimationLayerCompositor';
import type { WeaponDefinition } from './WeaponBase';
import type { WeaponProfile } from './WeaponProfile';
import { getProfile, socketName } from './WeaponProfile';
import type { WeaponSway, SwayOffsets } from './WeaponSway';
import type { IKSolution } from './WeaponIK';
import { solveJointIK, type JointChain } from '../character/JointIK';
import type { PoseOffsetsInput } from './WeaponPoseOffsets';

export interface PlayClipOptions {
  loop?: THREE.AnimationActionLoopStyles;
  crossfadeDuration?: number;
  clampWhenFinished?: boolean;
}

/** Per-frame IK instructions consumed by the arm rig AFTER this update (the
 *  arm rig applies them pre-bake so skin and bones agree — see HandsRig). */
export interface ArmRigCommand {
  active: boolean;
  /**
   * `additive` means a baked clip owns this chain: the IK solution positions
   * the arm on the weapon, and the clip's authored rotation is layered ON TOP
   * as a delta rather than replacing it.
   */
  right: { solution: IKSolution; additive: boolean } | null;
  left: { solution: IKSolution; additive: boolean } | null;
  /** Blended IK weight (equip/unequip ease, Constants.IK.GLOBAL_WEIGHT). */
  weight: number;
  /** Camera-space coarse target for the arm rig's placement servo (midpoint). */
  servoTarget: THREE.Vector3 | null;
}

/** The arm-rig seam WeaponViewmodel measures against (HandsRig implements).
 *  The playClip mirror methods are the §6.4 tier-1/tier-2 clip route: the
 *  SAME resolved clip name plays on the arms skeleton whenever the arms GLB
 *  authors it (locomotion + grip-style hold poses), keeping one descriptor
 *  driving both skeletons (§3.3's dual-consumer property, in miniature). */
export interface ArmRigProvider {
  /** Resolved rigid pivot chain (Document A §3.1) for live measurement. */
  getArmChain(side: 'R' | 'L'): JointChain | null;
  /** Primary wrist pivot — the weapon's mount point (§3.1). */
  getWristPivot(): THREE.Object3D | null;
}

/** External per-frame pose context (movement state feeds layer 7). */
export type PoseInputProvider = () => PoseOffsetsInput;

interface CachedWeapon {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Baked joint-keyframe clips (Document A §7.2) keyed by clip name. */
  baked: Map<string, LoadedBakedClip>;
}

const _anchorWorld = new THREE.Vector3();
const _gripWorld = new THREE.Vector3();
const _opticWorld = new THREE.Vector3();

const _qCamera = new THREE.Quaternion();
const _qCameraInv = new THREE.Quaternion();
const _qDesiredWeapon = new THREE.Quaternion();
const _qLag = new THREE.Quaternion();
const _matCamInv = new THREE.Matrix4();
const _poleWorld = new THREE.Vector3();

function loopIsOnce(loop?: THREE.AnimationActionLoopStyles): boolean {
  return loop === THREE.LoopOnce;
}

export class WeaponViewmodel {
  /** The rig root: a child of the main camera (§3.1). */
  private readonly rigRoot = new THREE.Object3D();
  /** Document C §3.6: debug gizmos scan the rig tree (weapon sockets). */
  getRigRoot(): THREE.Object3D {
    return this.rigRoot;
  }

  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private muzzleSocket: THREE.Object3D | null = null;
  private gripSocket: THREE.Object3D | null = null;
  private opticSocket: THREE.Object3D | null = null;
  private secondaryGripSocket: THREE.Object3D | null = null;
  /** Animated weapon root (mixer target) — its LOCAL transform is frame-exact. */
  /** Separated-part procedural animation (rack/pump/magazine). */
  partAnimator: WeaponPartAnimator | null = null;
  /** Socket_Ejection of the live weapon (casing spawn origin). */
  ejectionSocket: THREE.Object3D | null = null;
  /** Wrist→weapon mount (socket-derived at attach; see §3.1 in equip). */
  private readonly gripMount = new THREE.Vector3();
  /** Socket_GripSecondary rest position in the Root_Weapon frame (attach-time). */
  /** Running baked one-shot (ownership + fidget gating). */
  private currentOneShotName: string | null = null;
  /** Live weapon definition (baked-clip store lookups). */
  private attachedDef: WeaponDefinition | null = null;
  private attached: THREE.Group | null = null;
  private attachedProfile: WeaponProfile | null = null;
  private readonly cache = new Map<string, CachedWeapon>();
  private armRig: ArmRigProvider | null = null;
  private poseInputProvider: PoseInputProvider | null = null;
  private compositor: AnimationLayerCompositor | null = null;
  /** Last equipped definition — re-applied if the arm rig arrives late. */
  private lastEquippedDef: WeaponDefinition | null = null;
  /** Smoothed ADS weight mirror (fed from AnimationBlender each frame). */
  private _adsWeight = 0;
  private adsWeightTarget = 0;
  /** Eased ADS weight (0..1) — shared with the rig layer (pose suppression). */
  get adsWeight(): number {
    return this._adsWeight;
  }
  /** IK weight eases in with the grip's presence (0 for fists). */
  private ikWeight = 0;
  /** Camera-frame chase lag (weapon weight on fast flicks). */
  private readonly followQuat = new THREE.Quaternion();
  private followInit = false;
  /** Composed pose from the previous frame (measurement stability, §6.3). */
  private lastComposed: ComposedPose | null = null;
  private readonly armCommand: ArmRigCommand = { active: false, right: null, left: null, weight: 0, servoTarget: null };
  private pendingCommand: ArmRigCommand | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private lastMainCamera: THREE.PerspectiveCamera | null = null;
  currentWeaponId: string | null = null;

  constructor(
    private readonly assetLoader: AssetLoader,
    private readonly sway: WeaponSway,
    compositor: AnimationLayerCompositor,
  ) {
    this.compositor = compositor;
    this.rigRoot.name = 'ViewmodelRigRoot';
    // Viewmodel-only lighting on layer 1: lights only illuminate objects that
    // share a layer with them, so world PBR lighting stays untouched.
    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    ambient.layers.set(VIEWMODEL.LAYER_INDEX);
    this.rigRoot.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.4, 0.8, 0.6);
    key.layers.set(VIEWMODEL.LAYER_INDEX);
    this.rigRoot.add(key);
    const rim = new THREE.DirectionalLight(0x8899ff, 0.8);
    rim.position.set(-0.6, 0.2, -0.5);
    rim.layers.set(VIEWMODEL.LAYER_INDEX);
    this.rigRoot.add(rim);
    this.rigRoot.traverse((o) => o.layers.set(VIEWMODEL.LAYER_INDEX));
    this.rigRoot.layers.set(VIEWMODEL.LAYER_INDEX);
    // ADS weight is presentation state owned by the weapon flow; mirror it
    // here from the same events the AnimationBlender consumes (§6.1 L3).
    this.unsubscribers.push(eventBus.on('weapon:adsStart', () => {
      this.adsWeightTarget = 1;
    }));
    this.unsubscribers.push(eventBus.on('weapon:adsStop', () => {
      this.adsWeightTarget = 0;
    }));
  }

  /** §3.1: rig root becomes a child of THE main camera (one camera, one FOV). */
  attachToCamera(camera: THREE.PerspectiveCamera): void {
    if (this.rigRoot.parent === camera) return;
    this.rigRoot.parent?.remove(this.rigRoot);
    camera.add(this.rigRoot);
  }

  setArmRig(provider: ArmRigProvider): void {
    this.armRig = provider;
    // Race guard: at boot the weapon may equip before the async hands model
    // resolves — re-run the attach so the weapon lands under Hand_R (§3.1).
    if (this.lastEquippedDef && this.lastEquippedDef.id !== 'fists') {
      void this.equip(this.lastEquippedDef);
    }
  }

  setPoseInputProvider(provider: PoseInputProvider): void {
    this.poseInputProvider = provider;
  }

  /** TEST seam: the smoothed ADS alignment weight (§6.1 L3). */
  get adsSmoothedWeight(): number {
    return this._adsWeight;
  }

  /**
   * FPS/TPS Spec §4: the currently-playing 1PS action, so PerspectiveSync can
   * time-scale it to gameplay's hard logical duration (PlaybackRate =
   * clipLength / logicalDuration) exactly as it scales the 3PS counterpart.
   */
  get activeAction(): THREE.AnimationAction | null {
    return this.currentAction;
  }

  /** TEST seam: the last composed rig pose (layers 3+5+6+7 output, §6.1). */
  get lastComposedPose(): ComposedPose | null {
    return this.lastComposed;
  }

  /** TEST seam: angular lag between the chased frame and the camera. */
  getFollowLagRad(): number {
    if (!this.rigRoot.parent) return 0;
    return this.followQuat.angleTo(this.rigRoot.parent.getWorldQuaternion(_qCamera));
  }

  /** The live weapon instance in the scene (unified-character re-layering). */
  get attachedWeaponRoot(): THREE.Object3D | null {
    return this.attached;
  }

  /** The muzzle socket node itself (muzzle flash parenting). */
  getMuzzleSocket(): THREE.Object3D | null {
    return this.muzzleSocket;
  }

  /** Persistent base layer under the rig root (the arms/hands rig). */
  addBaseLayer(obj: THREE.Object3D): void {
    obj.traverse((o) => o.layers.set(VIEWMODEL.LAYER_INDEX));
    this.rigRoot.add(obj);
  }

  /** Load (cached) and attach a weapon; disposes/hides the previous one. */
  async equip(def: WeaponDefinition): Promise<void> {
    this.detach();
    const profile = def.presentation ?? getProfile(def.id);
    if (!def.modelPath || def.melee) {
      // Fists/equipment slot: no weapon scene — the arm rig IS the viewmodel.
      // (§9: any future "weapon" without a model conforms the same way.)
      this.currentWeaponId = def.id;
      this.attachedProfile = profile;
      this.lastEquippedDef = def;
      this.currentAction = null;
      eventBus.emit('weapon:viewmodelEquipped', { weaponId: def.id });
      return;
    }
    let cached = this.cache.get(def.id);
    if (!cached) {
      const loaded = await this.assetLoader.loadModelWithAnimations(def.modelPath);
      const baked = await loadBakedClips(this.assetLoader, [
        def.clips.reloadTactical, def.clips.reloadEmpty, def.clips.switchOut,
        def.clips.switchIn, def.clips.inspect,
      ].filter((n) => n.length > 0));
      cached = { scene: loaded.scene, clips: loaded.animations, baked };
      this.cache.set(def.id, cached);
    }
    this.attached = cached.scene;
    this.attachedDef = def;
    this.attachedProfile = profile;
    this.lastEquippedDef = def;
    this.currentWeaponId = def.id;
    this.currentAction = null;

    // --- §2.2 socket resolution: builder weapons carry canonical names ------
    if (!this.gripSocket) {
      const weaponScene = this.attached;
      const byName = (canonical: Parameters<typeof socketName>[1]): THREE.Object3D | null =>
        weaponScene.getObjectByName(socketName(profile, canonical)) ?? null;
      this.gripSocket = byName('Socket_Grip');
      this.secondaryGripSocket = byName('Socket_GripSecondary');
      this.muzzleSocket = byName('Socket_Muzzle') ?? (this.attached.getObjectByName(def.muzzleSocketName) ?? null);
      this.opticSocket = byName('Socket_Optic') ?? null;
    }
    this.ejectionSocket = this.attached.getObjectByName('Socket_Ejection') ?? null;
    this.validateSockets(def, profile);

    // --- §3.1: mount the weapon under the primary WRIST pivot ---------------
    // Mount transform FROM SOCKET DATA: Socket_Grip must coincide with the
    // rig's Socket_HandGrip point (HANDS.HAND_GRIP_LOCAL). The weapon then
    // aims exactly where the composed anchor frame points, and the IK orients
    // the wrist to match (wristQuat = anchor ⊗ mount⁻¹ = anchor — the mount
    // rotation is identity for the procedural weapons).
    const wrist = this.armRig?.getWristPivot() ?? null;
    if (wrist && this.gripSocket) {
      wrist.add(this.attached);
      const g = this.gripSocket.position;
      this.gripMount.set(
        HANDS.HAND_GRIP_LOCAL.x - g.x,
        HANDS.HAND_GRIP_LOCAL.y - g.y,
        HANDS.HAND_GRIP_LOCAL.z - g.z,
      );
      this.attached.position.copy(this.gripMount);
      this.attached.quaternion.identity();
      this.attached.scale.set(1, 1, 1);
      // §2.3: artist knobs, data only.
      const tune = profile.gripFineTuneOffset;
      this.attached.position.x += tune.position[0];
      this.attached.position.y += tune.position[1];
      this.attached.position.z += tune.position[2];
        } else {
      // No arm rig / no grip socket: legacy static attach at profile hip rest.
      this.rigRoot.add(this.attached);
      const hip = profile.hipRestPosition;
      this.attached.position.set(hip[0], hip[1], hip[2]);
      this.attached.rotation.set(
        THREE.MathUtils.degToRad(profile.hipRestRotationEuler[0]),
        THREE.MathUtils.degToRad(profile.hipRestRotationEuler[1]),
        THREE.MathUtils.degToRad(profile.hipRestRotationEuler[2]),
      );
    }
    // The first-person weapon always belongs to the VIEWMODEL layer: it is the
    // camera-relative hero mesh, drawn in the depth-cleared pass so it can
    // never clip into world geometry. The body's third-person weapon is a
    // separate prop (ThirdPersonBody.setWeaponProp) on the BODY_ARMS layer.
    ensureViewmodelLayers(this.attached);

    // ONE shared mixer on the rig root (Document A §7.2): it drives BOTH the
    // arm pivots and the weapon's named part nodes from the same JSON clips.
    this.mixer = new THREE.AnimationMixer(this.rigRoot);
    this.partAnimator = new WeaponPartAnimator(def, this.attached);
    this.compositor?.resetForWeapon(def.id);
    /** Internal event: AnimationStateMachine re-attaches its layers and flips
     *  the switch one-shot to `switch_in` (Document 3 §14.3 contract). */
    eventBus.emit('weapon:viewmodelEquipped', { weaponId: def.id });
  }

  /** §2.2: a weapon missing a MANDATORY socket is an invalid asset. */
  private validateSockets(def: WeaponDefinition, profile: WeaponProfile): void {
    const missing: string[] = [];
    if (!this.gripSocket) missing.push(socketName(profile, 'Socket_Grip'));
    if (!this.secondaryGripSocket) missing.push(socketName(profile, 'Socket_GripSecondary'));
    if (!this.muzzleSocket) missing.push(socketName(profile, 'Socket_Muzzle'));
    if (!this.opticSocket) missing.push(socketName(profile, 'Socket_Optic'));
    if (missing.length > 0) {
      console.error(
        `[WeaponViewmodel] INVALID ASSET "${def.id}" (${def.modelPath}): missing mandatory socket(s) ` +
        `${missing.join(', ')} — sockets come from def.model.sockets (§2.2 data contract). ` +
        'Falling back to static hip-rest attach.',
      );
    }
  }

  get clips(): THREE.AnimationClip[] {
    if (!this.currentWeaponId) return [];
    return this.cache.get(this.currentWeaponId)?.clips ?? [];
  }

  /** AnimationBlender's additive layers: weight-driven, never clip swaps. */
  createAdditiveAction(clip: THREE.AnimationClip): THREE.AnimationAction | null {
    if (!this.mixer) return null;
    const action = this.mixer.clipAction(clip);
    // Runtime property present since r137; missing from @types/three 0.170.
    (action as unknown as { blending: number }).blending = THREE.AdditiveBlending;
    action.setEffectiveWeight(ANIMATION_ADDITIVE_MIN_WEIGHT);
    // Doc C §5: the engine owns every action start (single mixer.play site).
    animationEngine.playAction(action, {
      loop: THREE.LoopRepeat,
      clampWhenFinished: false,
      restartIfRunning: false,
    });
    return action;
  }

  /**
   * Hold-pose layer seam (kept for ASM/blender compatibility): the rigid rig
   * has NO hold clips — grip is procedural (springs + IK), so this is null
   * and the blender's hold layer no-ops (Document A §7.2).
   */
  createAdditiveActionByName(_clipName: string): THREE.AnimationAction | null {
    return null;
  }

  /** TEST/ASM seam: always null — no hold-pose clips in the rigid rig. */
  get currentHoldPoseClipName(): string | null {
    return null;
  }

  /** Map a logical clip name onto the equipped weapon's asset id. */
  private resolveClipName(clipName: string): string {
    const clips = this.attachedDef?.clips;
    if (!clips) return clipName;
    switch (clipName) {
      case 'reload_tactical': return clips.reloadTactical ?? clipName;
      case 'reload_empty': return clips.reloadEmpty ?? clipName;
      case 'switch_out': return clips.switchOut ?? clipName;
      case 'switch_in': return clips.switchIn ?? clipName;
      case 'inspect': return clips.inspect ?? clipName;
      default: return clipName;
    }
  }

  /** The single entry point AnimationStateMachine uses (Document A §7.3). */
  playClip(clipName: string, options: PlayClipOptions = {}): THREE.AnimationAction | null {
    if (!this.mixer) return null;
    // BAKED joint-keyframe clips first (Document A §7.2): reloads, switches,
    // punches. Durations equal the definitions' (data-integrity pair).
    // The state machine speaks in LOGICAL clip names ('reload_tactical'); the
    // weapon definition maps those to its own asset ids ('rifle_reload_
    // tactical'). Resolving here — rather than making every caller know the
    // weapon prefix — is why a reload request from the ASM silently resolved
    // to nothing and no reload animation ever played.
    const resolvedName = this.resolveClipName(clipName);
    const store = this.attachedDef ? this.cache.get(this.attachedDef.id) : null;
    const bakedClip = store?.baked.get(resolvedName) ?? store?.baked.get(clipName);
    const clip = bakedClip
      ? bakedClip.clip
      : this.clips.find((c) => c.name === resolvedName) ?? this.clips.find((c) => c.name === clipName);
    if (!clip) return null;
    clipName = resolvedName;
    this.currentOneShotName = loopIsOnce(options.loop) ? clipName : null;
    const { loop = THREE.LoopRepeat, crossfadeDuration = 0.15, clampWhenFinished = true } = options;
    const next = this.mixer.clipAction(clip);
    // Looping bases: re-requesting the running clip is a no-op. One-shots
    // (fire/reload/switch) must RESTART even when re-requested mid-play.
    if (next === this.currentAction && next.isRunning() && loop !== THREE.LoopOnce) return next;
    if (next === this.currentAction && loop === THREE.LoopOnce) {
      animationEngine.playAction(next, { loop, clampWhenFinished, restartIfRunning: true });
      return next;
    }
    next.clampWhenFinished = clampWhenFinished;
    next.setLoop(loop, Infinity);
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.crossFadeTo(next, crossfadeDuration, false);
    }
    animationEngine.playAction(next, { loop, clampWhenFinished, restartIfRunning: true });
    this.currentAction = next;
    return next;
  }

  /** Name of the running one-shot (ownership lookups, fidget gating). */
  get activeOneShotName(): string | null {
    return this.currentOneShotName;
  }

  /** TEST seam: baked JSON clip names available for the live weapon. */
  get bakedClipNames(): string[] {
    const store = this.attachedDef && this.cache.get(this.attachedDef.id);
    return store ? [...store.baked.keys()] : [];
  }

  /** True while a baked one-shot owns joints (Document A §7.4). */
  get isOneShotRunning(): boolean {
    return this.currentOneShotName !== null;
  }

  /**
   * World position of the muzzle socket. The rig lives under the camera inside
   * the world scene graph, so the socket's world transform IS world space.
   */
  getMuzzleWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    if (this.muzzleSocket) {
      this.muzzleSocket.getWorldPosition(target);
      return target;
    }
    // No socket (fists/no weapon): tracers spawn from the eye point.
    const camera = this.rigRoot.parent;
    return camera ? target.setFromMatrixPosition(camera.matrixWorld) : target.set(0, 0, 0);
  }

  update(dt: number, mainCamera: THREE.PerspectiveCamera): void {
    this.lastMainCamera = mainCamera;

    // --- L3 mirror: eased ADS weight (drives the optic solve + additive L3) --
    this._adsWeight += (this.adsWeightTarget - this._adsWeight) * (1 - Math.exp(-VIEWMODEL.ADS_LERP_RATE * dt));

    // --- clips: baked one-shots + part cycles run on the SHARED mixer -------
    this.mixer?.update(dt);
    // One-shot finished → ownership returns to the procedural layer.
    if (this.currentAction && this.currentOneShotName
        && !this.currentAction.isRunning() && this.currentAction.loop === THREE.LoopOnce) {
      this.currentOneShotName = null;
    }
    this.partAnimator?.update(dt);

    // Camera-frame chase lag: the rig root's LOCAL rotation trails the camera
    // so fast flicks read as weight (never a welded 1:1).
    mainCamera.getWorldQuaternion(_qCamera);
    if (!this.followInit) {
      this.followQuat.copy(_qCamera);
      this.followInit = true;
    }
    this.followQuat.slerp(_qCamera, 1 - Math.exp(-VIEWMODEL.FOLLOW_RATE * dt));
    const lagQuat = _qLag.copy(_qCamera).invert().multiply(this.followQuat);

    // --- compositor: layers 3+5+6+7 → ONE camera-space pose (§6.1) ----------
    const sway: SwayOffsets = this.sway.offsets;
    const poseInput: PoseOffsetsInput = this.poseInputProvider
      ? this.poseInputProvider()
      : { movementState: 'IDLE', isTacticalSprinting: false, isSnappingToReady: false, landingImpactVelocity: 0 };
    const opticRel = this.measureOpticRelativeToGrip(mainCamera);
    const composed = this.compositor
      ? this.compositor.update(dt, {
          profile: this.attachedProfile ?? getProfile('fists'),
          sway,
          poseInput,
          adsWeight: this._adsWeight,
          opticRelativeToAnchor: opticRel,
        })
      : null;
    this.lastComposed = composed;

    // --- rigid rig-root offsets (shoulders follow at ROOT_FOLLOW_FACTOR) ----
    if (composed) {
      this.rigRoot.position.copy(composed.rigRootPosition);
      this.rigRoot.rotation.copy(composed.rigRootRotation);
      this.rigRoot.quaternion.multiply(lagQuat);
    } else {
      this.rigRoot.quaternion.copy(lagQuat);
    }
    this.rigRoot.updateMatrixWorld(true);

    // --- L4 procedural IK: hands to the composed grip anchors (§6.3) --------
    this.solveAndDispatchArmIK(dt, mainCamera, composed);
  }

  /**
   * §8.2 render-space optic trim: after the arm IK has had its say, measure
   * the optic's ACTUAL camera-space position and shift the weapon root by
   * the residual (× adsWeight). Exact by construction — the correction acts
   * on the measured object itself, immune to arm/servo clamps and frame
   * lag. Under ~5 cm at the hip blend, fading to zero by adsWeight 0.05.
   */
  /** Optic socket offset from the grip socket, in CAMERA space (pre-IK). */
  private measureOpticRelativeToGrip(camera: THREE.PerspectiveCamera): THREE.Vector3 | null {
    if (!this.opticSocket || !this.gripSocket) return null;
    camera.updateWorldMatrix(true, false);
    camera.getWorldQuaternion(_qCamera);
    this.gripSocket.getWorldPosition(_gripWorld);
    this.opticSocket.getWorldPosition(_opticWorld);
    return _opticWorld.sub(_gripWorld).applyQuaternion(_qCameraInv.copy(_qCamera).invert());
  }

  /**
   * L4: analytic two-bone solves; results dispatched to the arm rig.
   * Document A §5/§7.4: each solved wrist target = the composed anchor frame
   * transformed by the socket-derived mount inverse; joints the active baked
   * clip owns (one-shot ownership) receive NO command — the clip's motion IS
   * the truth for those joints. The oneHanded support pose keeps the left
   * hand under the grip for stability without touching the weapon frame.
   */
  private solveAndDispatchArmIK(
    dt: number,
    camera: THREE.PerspectiveCamera,
    composed: ComposedPose | null,
  ): void {
    const weaponGripped = Boolean(this.attached && this.gripSocket && this.armRig);
    // IK presence eases (no pops on equip/unequip).
    this.ikWeight += ((weaponGripped ? IK.GLOBAL_WEIGHT : 0) - this.ikWeight)
      * (1 - Math.exp(-IK.SMOOTH_RATE * dt));
    this.armCommand.active = weaponGripped;
    this.armCommand.right = null;
    this.armCommand.left = null;
    this.armCommand.weight = this.ikWeight;
    this.armCommand.servoTarget = null;
    this.pendingCommand = weaponGripped ? this.armCommand : null;
    if (!weaponGripped || !composed || this.ikWeight <= 0.001) {
      this.pendingCommand = null;
      return;
    }
    const chainR = this.armRig?.getArmChain('R');
    const chainL = this.armRig?.getArmChain('L');
    if (!chainR || !this.gripSocket) return;

    // Desired grip anchor in WORLD space (anchor is camera-space data).
    camera.updateWorldMatrix(true, false);
    camera.getWorldQuaternion(_qCamera);
    _qCameraInv.copy(_qCamera).invert();
    _anchorWorld.copy(composed.anchorPosition).applyMatrix4(camera.matrixWorld);
    _qDesiredWeapon.copy(_qCamera).multiply(composed.anchorRotation);
    _matCamInv.copy(camera.matrixWorld).invert();

    // --- BAKED-CLIP OWNERSHIP (Document A §7.4) ----------------------------
    // While a one-shot runs, it owns exactly the joints listed in its JSON
    // `ownsIK`; the corresponding chains get no IK command this frame.
    const ownership = this.activeOneShotOwnership;
    const rightOwned = ownership === 'R' || ownership === 'both' || ownership === 'wristR';
    const leftOwned = ownership === 'L' || ownership === 'both';

    // --- PRIMARY WRIST TARGET = anchor ⊗ mount⁻¹ (§5.1) --------------------
    // Mount rotation is identity for the procedural weapons (wrist axes ==
    // weapon axes by construction), so wristQuat = anchorQuat and the wrist
    // sits at anchor minus the rotated mount offset (HAND_GRIP_LOCAL point).
    const rightTargetPos = _anchorWorld.clone()
      .sub(this.gripMount.clone().applyQuaternion(_qDesiredWeapon));
    const rightTargetQuat = _qDesiredWeapon.clone();
    // IK is ALWAYS solved, even while a baked clip owns the joint. Previously
    // ownership skipped the solve entirely, so the arm fell back to its rest
    // pose for the whole clip — which is exactly why reload and inspect looked
    // like the gun "sank" and the hands disappeared. The clip is now applied
    // as an ADDITIVE offset on top of the IK pose (see HandsRig.applyArmCommand),
    // so the weapon stays in the hands throughout the action.
    const rightSolution = solveJointIK(chainR, rightTargetPos, this._poleHintWorld(camera), rightTargetQuat);
    if (rightSolution) this.armCommand.right = { solution: rightSolution, additive: rightOwned };

    // --- OFF-HAND (§5.2, grip-style data) -----------------------------------
    if (chainL && this.attachedProfile) {
      let leftTargetPos: THREE.Vector3;
      let leftTargetQuat: THREE.Quaternion;
      if (this.attachedProfile.gripStyle === 'twoHanded') {
        // Foregrip: Socket_GripSecondary's local offset composed with the
        // same anchor frame (frame-exact; no live socket reads needed).
        const g = this.gripSocketWorld();
        void g;
        const secondary = this.secondaryGripSocket
          ? this.secondaryGripSocket.position.clone().add(this.gripMount.clone().negate())
          : new THREE.Vector3(0, 0, 0.28);
        leftTargetPos = _anchorWorld.clone().add(secondary.applyQuaternion(_qDesiredWeapon));
        leftTargetQuat = _qDesiredWeapon.clone();
      } else {
        // oneHanded support: cupped under/behind the primary wrist.
        leftTargetPos = rightTargetPos.clone().add(
          new THREE.Vector3(
            IK.ONE_HANDED_SUPPORT_OFFSET.x,
            IK.ONE_HANDED_SUPPORT_OFFSET.y,
            IK.ONE_HANDED_SUPPORT_OFFSET.z,
          ).applyQuaternion(_qCamera),
        );
        leftTargetQuat = _qDesiredWeapon.clone();
      }
      const leftSolution = solveJointIK(chainL, leftTargetPos, this._poleHintWorld(camera), leftTargetQuat);
      if (leftSolution) this.armCommand.left = { solution: leftSolution, additive: leftOwned };
    }

    // Coarse servo target (reported for rig-level consumers).
    this.armCommand.servoTarget = composed.anchorPosition.clone();
  }

  /** Camera-space pole hint in world orientation (elbow-down bias, §5.2). */
  private _poleHintWorld(_camera: THREE.PerspectiveCamera): THREE.Vector3 {
    return _poleWorld
      .set(IK.POLE_HINT_CAMERA_LOCAL.x, IK.POLE_HINT_CAMERA_LOCAL.y, IK.POLE_HINT_CAMERA_LOCAL.z)
      .applyQuaternion(_qCamera);
  }

  private gripSocketWorld(): THREE.Vector3 {
    const v = new THREE.Vector3();
    this.gripSocket?.getWorldPosition(v);
    return v;
  }

  /**
   * Which chain the RUNNING one-shot owns (Document A §7.4). Empty while no
   * one-shot or after it finishes — the mixer clock is the single truth.
   */
  get activeOneShotOwnership(): ClipOwnership {
    const name = this.currentOneShotName;
    if (!name) return 'none';
    const def = this.attachedDef;
    const store = def && this.cache.get(def.id);
    const clip = store?.baked.get(name);
    return (clip?.ownsIK ?? 'none') as ClipOwnership;
  }

  /** The arm rig consumes the frame's IK command (applies it pre-bake). */
  consumeArmCommand(): ArmRigCommand | null {
    const command = this.pendingCommand;
    this.pendingCommand = null;
    return command;
  }

  /** Second render pass (§3.2, implemented exactly): clearDepth + layer 1. */
  renderPass(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const camera = this.lastMainCamera;
    if (!camera) return;
    // Pass 1 (world) rendered by Engine with the camera masked to layer 0.
    // Pass 2 (viewmodel): fresh depth, layer-1 mask, same camera + scene.
    // three.js repaints scene.background on EVERY render() even with
    // autoClear=false — suspend it here so pass 2 never wipes pass 1.
    const prevMask = camera.layers.mask;
    const prevAutoClear = renderer.autoClear;
    const prevBackground = scene.background;
    renderer.autoClear = false;
    scene.background = null;
    renderer.clearDepth();
    camera.layers.set(VIEWMODEL.LAYER_INDEX);
    renderer.render(scene, camera);
    camera.layers.mask = prevMask;
    scene.background = prevBackground;
    renderer.autoClear = prevAutoClear;
  }

  private detach(): void {
    if (this.attached) {
      this.mixer?.stopAllAction();
      this.mixer?.uncacheRoot(this.attached);
      this.attached.parent?.remove(this.attached); // cached for re-equip
      this.attached = null;
    }
    this.mixer = null;
    this.muzzleSocket = null;
    this.gripSocket = null;
    this.opticSocket = null;
    this.secondaryGripSocket = null;
    this.partAnimator = null;
    this.attachedProfile = null;
    this.currentAction = null;
    this.ikWeight = 0;
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
  }
}

/** §3.2: a freshly cloned weapon GLB carries default layer 0 on every node —
 *  the whole subtree must move to the viewmodel layer or it renders in NO
 *  pass (world pass masks it out, viewmodel pass never reaches layer 0). */
function ensureViewmodelLayers(root: THREE.Object3D): void {
  root.traverse((o) => o.layers.set(VIEWMODEL.LAYER_INDEX));
}

const ANIMATION_ADDITIVE_MIN_WEIGHT = 0.0001;

export default WeaponViewmodel;
