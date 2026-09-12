/**
 * AnimationBlender.ts — thin blend layer over WeaponViewmodel's mixer
 * (Document 3 §14.1).
 *
 *  - crossfadeTo(clipName, duration): standard replace-with-blend for base
 *    locomotion/action clips (de-duped: re-requesting the running clip is a
 *    no-op so per-frame resolution never restarts animations).
 *  - Additive ADS layer: a runtime-synthesized aim-pose DELTA clip played on
 *    a second action with THREE.AdditiveBlending, weight lerped 0→1. Because
 *    the track values ARE the delta (manual additive pose — equivalent to
 *    makeClipAdditive on a synthesized pose, which would zero itself out),
 *    walking-while-aiming shows base walk sway PLUS raised sight alignment
 *    instead of one clip overriding the other.
 *
 * The mixer lives in WeaponViewmodel (one per equipped weapon); on re-equip
 * AnimationStateMachine calls attach() to rebuild the additive layer.
 */
import * as THREE from 'three';
import type { WeaponViewmodel } from '../weapons/WeaponViewmodel';
import { ANIMATION, VIEWMODEL } from '../utils/Constants';

/** Everything the state strategies may consult to resolve a clip. */
export interface AnimationContext {
  movementState: string;
  weaponAction: WeaponAction;
  isADS: boolean;
  /** Camera-local planar velocity (x = rightward, z = forward positive). */
  localVelocity: { x: number; z: number };
  /** True while the reload in flight started from an empty magazine. */
  reloadWasEmpty: boolean;
  /** 0 = switch_in half, 1 = switch_out half (see SwitchWeaponState). */
  switchPhase: 'out' | 'in';
}

export type WeaponAction = 'IDLE' | 'FIRING' | 'RELOADING' | 'SWITCHING';

export type BlendMode = 'base' | 'oneshot' | 'additive';

/** Strategy shape every /states file exports (Document 3 §14.2). */
export interface AnimationStateStrategy {
  getClipName(context: AnimationContext): string | null;
  getBlendMode(): BlendMode;
  getCrossfadeDuration(): number;
}

const ADS_POSE_DELTA = (() => {
  // Small raise-and-tuck of weapon_root (degrees from Constants, §15).
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(
    THREE.MathUtils.degToRad(ANIMATION.ADS_POSE_PITCH_DEG),
    THREE.MathUtils.degToRad(ANIMATION.ADS_POSE_YAW_DEG),
    THREE.MathUtils.degToRad(ANIMATION.ADS_POSE_ROLL_DEG),
    'YXZ',
  );
  q.setFromEuler(e);
  return q;
})();

export function synthesizeADSClip(): THREE.AnimationClip {
  const q = ADS_POSE_DELTA;
  const track = new THREE.QuaternionKeyframeTrack(
    'weapon_root.quaternion',
    [0, 1],
    [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w],
  );
  return new THREE.AnimationClip('ads_additive_layer', 1, [track]);
}

export class AnimationBlender {
  private currentClipName: string | null = null;
  private additiveAction: THREE.AnimationAction | null = null;
  private additiveWeight = 0;
  private additiveTarget = 0;

  constructor(private readonly viewmodel: WeaponViewmodel) {}

  /** Rebuild the additive layer for the freshly equipped weapon's mixer. */
  attach(): void {
    this.currentClipName = null;
    this.additiveWeight = 0;
    this.additiveTarget = this.additiveTarget; // preserved across switches
    this.additiveAction = this.viewmodel.createAdditiveAction(synthesizeADSClip());
  }

  crossfadeTo(clipName: string, duration: number = ANIMATION.CROSSFADE_DEFAULT_SECONDS, loop: THREE.AnimationActionLoopStyles = THREE.LoopRepeat): void {
    if (clipName === this.currentClipName) return;
    const action = this.viewmodel.playClip(clipName, { loop, crossfadeDuration: duration });
    if (action) this.currentClipName = clipName;
  }

  /** One-shots (fire/reload/switch) always restart, even if same clip. */
  playOneshot(clipName: string, duration: number = ANIMATION.CROSSFADE_FAST_SECONDS): void {
    const action = this.viewmodel.playClip(clipName, {
      loop: THREE.LoopOnce,
      crossfadeDuration: duration,
      clampWhenFinished: true,
    });
    if (action) this.currentClipName = clipName;
  }

  setADSActive(active: boolean): void {
    this.additiveTarget = active ? 1 : 0;
  }

  get isADSActive(): boolean {
    return this.additiveTarget > 0.5;
  }

  update(dt: number): void {
    if (!this.additiveAction) return;
    this.additiveWeight += (this.additiveTarget - this.additiveWeight) * Math.min(1, dt * VIEWMODEL.ADS_LERP_RATE);
    this.additiveAction.setEffectiveWeight(Math.max(ANIMATION.ADDITIVE_MIN_WEIGHT, this.additiveWeight));
  }
}

export default AnimationBlender;
