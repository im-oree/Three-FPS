/**
 * AnimationBlender.ts — the FIRST-PERSON VIEWMODEL'S AnimationTarget
 * implementation (Document 3 §14.1, extended per Document 2.5 §6.1).
 *
 * It consumes ResolvedAnimationDescriptors (§3.3) and drives the mixer:
 *  - L1 base locomotion: replace-with-blend crossfades (de-duped),
 *  - one-shot action layer: fire/reload/switch crossfade-replaces the base,
 *  - L2 hold pose: ADDITIVE, always-on finger/grip shaping clip (§6.1 L2),
 *  - L3 ADS aim pose: ADDITIVE, weight lerped 0→1 (never a clip swap), so
 *    walking-while-aiming blends both.
 *
 * The mixer lives in WeaponViewmodel (one per equipped weapon); on re-equip
 * the state machine calls attach() to rebuild the additive layers.
 */
import * as THREE from 'three';
import { animationEngine } from '../animation-engine/OperatorAnimEngine';
import type { WeaponViewmodel } from '../weapons/WeaponViewmodel';
import { ANIMATION, VIEWMODEL } from '../utils/Constants';

/** Everything the state strategies may consult to resolve a clip. */
export interface AnimationContext {
  movementState: string;
  weaponAction: WeaponAction;
  isADS: boolean;
  /** Orthogonal tactical-sprint flag (Document 2.5 §4.1). */
  isTacticalSprinting: boolean;
  /** Camera-local planar velocity (x = rightward, z = forward positive). */
  localVelocity: { x: number; z: number };
  /** True while the reload in flight started from an empty magazine. */
  reloadWasEmpty: boolean;
  /** 0 = switch_in half, 1 = switch_out half (see SwitchWeaponState). */
  switchPhase: 'out' | 'in';
}

export type WeaponAction = 'IDLE' | 'FIRING' | 'RELOADING' | 'SWITCHING' | 'INSPECTING';

export type BlendMode = 'base' | 'oneshot' | 'additive';

/** Strategy shape every /states file exports (Document 3 §14.2). */
export interface AnimationStateStrategy {
  getClipName(context: AnimationContext): string | null;
  getBlendMode(): BlendMode;
  getCrossfadeDuration(): number;
}

/**
 * §3.3 RESOLVED DESCRIPTOR: clip names + layer weights as pure data. Any
 * consumer (first-person viewmodel today; a third-person body, killcam, or
 * mock test listener tomorrow) applies it independently.
 */
export interface ResolvedAnimationDescriptor {
  /** §6.1 L1 base locomotion clip (null while a one-shot owns the mixer). */
  baseClip: string | null;
  baseCrossfadeDuration: number;
  /** One-shot action layer clip overriding the base temporarily (§6.1). */
  oneShotClip: string | null;
  oneShotCrossfadeDuration: number;
  /** §6.1 L2 additive hold-pose clip (grip-style authored, §6.4). */
  holdPoseClip: string | null;
  /** §6.1 L3 additive ADS layer weight target (0..1). */
  adsWeightTarget: number;
  /** Movement context mirrored for consumers (pose offsets, third person). */
  movementState: string;
  isTacticalSprinting: boolean;
}

/** A consumer of resolved animation state (§3.3). */
export interface AnimationTarget {
  applyDescriptor(descriptor: ResolvedAnimationDescriptor): void;
}


export class AnimationBlender implements AnimationTarget {
  private currentClipName: string | null = null;
  private currentOneShotName: string | null = null;
  private holdPoseClipName: string | null = null;
  private additiveWeight = 0;
  private additiveTarget = 0;

  constructor(private readonly viewmodel: WeaponViewmodel) {}

  /** Rebuild the layers for the freshly equipped weapon's mixer. */
  attach(holdPoseClipName: string | null = null): void {
    this.currentClipName = null;
    this.currentOneShotName = null;
    this.additiveWeight = 0;
    this.holdPoseClipName = holdPoseClipName; // always null (no hold clips)
  }

  get currentHoldPoseClip(): string | null {
    return this.holdPoseClipName;
  }

  get adsActive(): boolean {
    return this.additiveTarget > 0.5;
  }

  /** Smoothed L3 weight — the compositor's optic-alignment solve reads this. */
  get adsSmoothedWeight(): number {
    return this.additiveWeight;
  }

  setADSActive(active: boolean): void {
    this.additiveTarget = active ? 1 : 0;
  }

  /** §3.3 consumer entry point: apply a resolved descriptor to the mixer. */
  applyDescriptor(descriptor: ResolvedAnimationDescriptor): void {
    if (descriptor.oneShotClip) {
      // Doc C §5: one-shot starts go through the engine's priority gate —
      // an equal-or-higher running one-shot REJECTS the incoming clip.
      if (descriptor.oneShotClip !== this.currentOneShotName || !this.isOneShotRunning()) {
        const granted = animationEngine.requestOneShot(
          descriptor.oneShotClip,
          this.viewmodel.activeOneShotName,
          (clip) => this.playOneshot(clip, descriptor.oneShotCrossfadeDuration),
        );
        if (granted !== null) this.currentOneShotName = descriptor.oneShotClip;
      }
    } else if (descriptor.baseClip) {
      this.currentOneShotName = null;
      this.crossfadeTo(descriptor.baseClip, descriptor.baseCrossfadeDuration);
    }
  }

  private isOneShotRunning(): boolean {
    return this.currentOneShotName !== null && this.currentClipName === this.currentOneShotName;
  }

  crossfadeTo(clipName: string, duration: number = ANIMATION.CROSSFADE_DEFAULT_SECONDS, loop: THREE.AnimationActionLoopStyles = THREE.LoopRepeat): void {
    if (clipName === this.currentClipName) return;
    const action = this.viewmodel.playClip(clipName, { loop, crossfadeDuration: duration });
    if (action) this.currentClipName = clipName;
  }

  /** One-shots (fire/reload/switch) always restart, even if same clip. */
  playOneshot(clipName: string, duration: number = ANIMATION.CROSSFADE_FAST_SECONDS): boolean {
    const action = this.viewmodel.playClip(clipName, {
      loop: THREE.LoopOnce,
      crossfadeDuration: duration,
      clampWhenFinished: true,
    });
    if (!action) return false;
    this.currentClipName = clipName;
    return true;
  }

  update(dt: number): void {
    // Additive layers are retired in the rigid rig (Document A §7.2): ADS
    // alignment is the compositor's optic solve; grip is springs + IK. Keep
    // easing the weight so the ASM/compositor descriptors stay honest.
    this.additiveWeight += (this.additiveTarget - this.additiveWeight) * Math.min(1, dt * VIEWMODEL.ADS_LERP_RATE);
  }
}

export default AnimationBlender;
