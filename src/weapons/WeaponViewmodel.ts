/**
 * WeaponViewmodel.ts — the held weapon's own render world (Document 3 §8).
 *
 * CLIPPING TECHNIQUE CHOSEN: spec option (a) — a DEDICATED viewmodel scene +
 * camera rendered as a second pass after renderer.clearDepth(), so the gun
 * always draws in front of world geometry no matter how close a wall is.
 * Why not (b): fiddling with the main camera's near plane distorts depth
 * precision for the whole world pass and still fails when geometry sits
 * between eye and gun; a separate pass isolates the cheat completely and
 * composes cleanly with the existing single-renderer loop via Engine's
 * post-render hook.
 *
 * The rig node inherits nothing from the world: each frame the viewmodel
 * camera copies the main camera's world transform, and the rig sits at a
 * fixed local "hands" offset (hip <-> ADS lerped). AnimationMixer drives the
 * loaded skeleton; WeaponSway's additive offsets are applied last.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import type { AssetLoader } from '../core/AssetLoader';
import { ANIMATION, VIEWMODEL } from '../utils/Constants';
import type { WeaponDefinition } from './WeaponBase';
import type { WeaponSway } from './WeaponSway';

export interface PlayClipOptions {
  loop?: THREE.AnimationActionLoopStyles;
  crossfadeDuration?: number;
  clampWhenFinished?: boolean;
}

interface CachedWeapon {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

export class WeaponViewmodel {
  readonly vmScene = new THREE.Scene();
  readonly vmCamera: THREE.PerspectiveCamera;
  private readonly rig = new THREE.Object3D();
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private muzzleSocket: THREE.Object3D | null = null;
  private attached: THREE.Group | null = null;
  private readonly cache = new Map<string, CachedWeapon>();
  private lastMainCamera: THREE.PerspectiveCamera | null = null;
  private adsT = 0;
  private adsTarget = 0;
  currentWeaponId: string | null = null;

  constructor(private readonly assetLoader: AssetLoader, private readonly sway: WeaponSway) {
    this.vmCamera = new THREE.PerspectiveCamera(VIEWMODEL.FOV, 16 / 9, VIEWMODEL.NEAR, VIEWMODEL.FAR);
    // Viewmodel-only lighting (world lights live in the world scene).
    this.vmScene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.4, 0.8, 0.6);
    this.vmScene.add(key);
    const rim = new THREE.DirectionalLight(0x8899ff, 0.8);
    rim.position.set(-0.6, 0.2, -0.5);
    this.vmScene.add(rim);
    this.vmScene.add(this.rig);
  }

  setAspect(aspect: number): void {
    this.vmCamera.aspect = aspect;
    this.vmCamera.updateProjectionMatrix();
  }

  setADSActive(active: boolean): void {
    this.adsTarget = active ? 1 : 0;
  }

  /** Load (cached) and attach a weapon; disposes/hides the previous one. */
  async equip(def: WeaponDefinition): Promise<void> {
    this.detach();
    let cached = this.cache.get(def.id);
    if (!cached) {
      const loaded = await this.assetLoader.loadModelWithAnimations(def.modelPath);
      cached = { scene: loaded.scene, clips: loaded.animations };
      this.cache.set(def.id, cached);
    }
    this.attached = cached.scene;
    this.rig.add(this.attached);
    this.mixer = new THREE.AnimationMixer(this.attached);
    this.muzzleSocket = this.attached.getObjectByName(def.muzzleSocketName) ?? null;
    this.currentWeaponId = def.id;
    this.currentAction = null;
    /** Internal Document 3 event: AnimationStateMachine re-attaches its
     *  additive layer and flips the switch one-shot to `switch_in`. */
    eventBus.emit('weapon:viewmodelEquipped', { weaponId: def.id });
  }

  get clips(): THREE.AnimationClip[] {
    if (!this.currentWeaponId) return [];
    return this.cache.get(this.currentWeaponId)?.clips ?? [];
  }

  /** AnimationBlender's additive ADS layer: a second AdditiveBlending action
   *  on the same mixer, weight-driven (never replaces the base clip). */
  createAdditiveAction(clip: THREE.AnimationClip): THREE.AnimationAction | null {
    if (!this.mixer) return null;
    const action = this.mixer.clipAction(clip);
    // Runtime property present since r137; missing from @types/three 0.170.
    (action as unknown as { blending: number }).blending = THREE.AdditiveBlending;
    action.setEffectiveWeight(ANIMATION.ADDITIVE_MIN_WEIGHT);
    action.play();
    return action;
  }

  /** The single entry point AnimationStateMachine uses (Document 3 §14.3). */
  playClip(clipName: string, options: PlayClipOptions = {}): THREE.AnimationAction | null {
    if (!this.mixer) return null;
    const clip = this.clips.find((c) => c.name === clipName);
    if (!clip) return null;
    const { loop = THREE.LoopRepeat, crossfadeDuration = 0.15, clampWhenFinished = true } = options;
    const next = this.mixer.clipAction(clip);
    // Looping bases: re-requesting the running clip is a no-op. One-shots
    // (fire/reload/switch) must RESTART even when re-requested mid-play.
    if (next === this.currentAction && next.isRunning() && loop !== THREE.LoopOnce) return next;
    if (next === this.currentAction && loop === THREE.LoopOnce) {
      next.reset();
      next.play();
      return next;
    }
    next.reset();
    next.clampWhenFinished = clampWhenFinished;
    next.setLoop(loop, Infinity);
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.crossFadeTo(next, crossfadeDuration, false);
    }
    next.play();
    this.currentAction = next;
    return next;
  }

  /** The muzzle socket node itself (muzzle flash parenting). */
  getMuzzleSocket(): THREE.Object3D | null {
    return this.muzzleSocket;
  }

  /**
   * World position of the muzzle socket (effects only — ballistics rays
   * intentionally come from the camera, not this). The socket lives in the
   * camera-local viewmodel world, so map it into the main world: rotate the
   * vm-space offset by the main camera's orientation and anchor it at the
   * camera position.
   */
  getMuzzleWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    if (!this.lastMainCamera) return target.set(0, 0, 0);
    if (this.muzzleSocket) this.muzzleSocket.getWorldPosition(target);
    else target.set(0, 0, 0);
    return target.applyQuaternion(this.lastMainCamera.quaternion).add(this.lastMainCamera.position);
  }

  update(dt: number, mainCamera: THREE.PerspectiveCamera): void {
    // The viewmodel world is camera-LOCAL by construction: the vm camera sits
    // at the origin and shares only the main camera's ROTATION (spec §8:
    // "own narrow-FOV camera sharing the main camera's rotation"), so the rig
    // at its hip/ADS local offset renders exactly in front of the eye.
    this.lastMainCamera = mainCamera;
    this.vmCamera.position.set(0, 0, 0);
    this.vmCamera.quaternion.copy(mainCamera.quaternion);
    this.vmCamera.updateMatrixWorld();

    this.adsT += (this.adsTarget - this.adsT) * Math.min(1, dt * VIEWMODEL.ADS_LERP_RATE);
    const hip = VIEWMODEL.HIP_LOCAL_OFFSET;
    const ads = VIEWMODEL.ADS_LOCAL_OFFSET;
    const s = this.sway.offsets;
    this.rig.position.set(
      THREE.MathUtils.lerp(hip.x, ads.x, this.adsT) + s.posX,
      THREE.MathUtils.lerp(hip.y, ads.y, this.adsT) + s.posY,
      THREE.MathUtils.lerp(hip.z, ads.z, this.adsT) + s.posZ,
    );
    this.rig.rotation.set(s.rotX, s.rotY, s.rotZ);
    this.mixer?.update(dt);
  }

  /** Second render pass (registered via Engine.setPostRenderHook). */
  renderPass(renderer: THREE.WebGLRenderer): void {
    if (!this.attached) return;
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCamera);
  }

  private detach(): void {
    if (this.attached) {
      this.mixer?.stopAllAction();
      this.mixer?.uncacheRoot(this.attached);
      this.rig.remove(this.attached); // cached for re-equip; not GPU-disposed
      this.attached = null;
    }
    this.mixer = null;
    this.muzzleSocket = null;
    this.currentAction = null;
  }
}

export default WeaponViewmodel;
