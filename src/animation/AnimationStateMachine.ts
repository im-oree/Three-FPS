/**
 * AnimationStateMachine.ts — the single authority on "what animation should
 * be playing right now" (Document 3 §14.3). No other module calls
 * WeaponViewmodel.playClip directly; everything routes through the
 * AnimationBlender from here.
 *
 * Inputs each frame: Document 2's movement state (PlayerState) + camera-local
 * velocity, and this document's weapon-action state (IDLE / FIRING /
 * RELOADING / SWITCHING) tracked internally from WeaponManager events.
 * Resolution priority: SWITCHING > RELOADING > FIRING > movement base.
 * ADS is NOT a base clip — ADSState engages the blender's additive layer on
 * top of whatever the movement base resolves to, so walking while aiming
 * blends both (verified for all three weapons, spec §14.3).
 *
 * Base-locomotion selection uses the /states strategy objects keyed by
 * movement state; one-shots (fire/reload/switch) are edge-triggered from the
 * events themselves so identical consecutive clips still restart.
 */
import eventBus from '../core/EventBus';
import { ANIMATION } from '../utils/Constants';
import { PlayerState } from '../player/PlayerState';
import type { WeaponViewmodel } from '../weapons/WeaponViewmodel';
import AnimationBlender, { type AnimationContext, type AnimationStateStrategy, type WeaponAction } from './AnimationBlender';
import { IdleState } from './states/IdleState';
import { WalkState } from './states/WalkState';
import { SprintState } from './states/SprintState';
import { JumpState } from './states/JumpState';
import { SlideState } from './states/SlideState';
import { CrouchState } from './states/CrouchState';
import { FireState } from './states/FireState';
import { ReloadState } from './states/ReloadState';
import { SwitchWeaponState } from './states/SwitchWeaponState';

const MOVEMENT_STRATEGIES: Record<string, AnimationStateStrategy> = {
  [PlayerState.IDLE]: IdleState,
  [PlayerState.WALK]: WalkState,
  [PlayerState.SPRINT]: SprintState,
  [PlayerState.CROUCH_IDLE]: CrouchState,
  [PlayerState.CROUCH_WALK]: CrouchState,
  [PlayerState.SLIDE]: SlideState,
  [PlayerState.JUMP]: JumpState,
  [PlayerState.AIR]: JumpState,
  [PlayerState.LANDING]: JumpState,
};

export class AnimationStateMachine {
  private readonly blender: AnimationBlender;
  private action: WeaponAction = 'IDLE';
  private fireHoldTimer = 0;
  private reloadWasEmpty = false;
  private switchPhase: 'out' | 'in' = 'out';
  private lastContext: AnimationContext = {
    movementState: PlayerState.IDLE,
    weaponAction: 'IDLE',
    isADS: false,
    localVelocity: { x: 0, z: 0 },
    reloadWasEmpty: false,
    switchPhase: 'out',
  };

  constructor(private readonly viewmodel: WeaponViewmodel) {
    this.blender = new AnimationBlender(viewmodel);
    this.blender.attach();

    eventBus.on('weapon:fired', () => {
      if (this.action === 'RELOADING' || this.action === 'SWITCHING') return;
      this.action = 'FIRING';
      this.fireHoldTimer = ANIMATION.FIRE_HOLD_SECONDS;
      this.playOneshot(FireState);
    });
    eventBus.on('weapon:reloadStart', (payload) => {
      const p = payload as { isTactical: boolean };
      this.action = 'RELOADING';
      this.reloadWasEmpty = !p.isTactical;
      // Sync the strategy context NOW: handlers run between frames, and the
      // one-shot must reflect THIS reload's variant, not last frame's.
      this.lastContext.reloadWasEmpty = this.reloadWasEmpty;
      this.lastContext.weaponAction = this.action;
      this.playOneshot(ReloadState);
    });
    eventBus.on('weapon:reloadComplete', () => {
      if (this.action === 'RELOADING') this.action = 'IDLE';
    });
    eventBus.on('weapon:switchStart', () => {
      this.action = 'SWITCHING';
      this.switchPhase = 'out';
      this.lastContext.switchPhase = 'out';
      this.lastContext.weaponAction = this.action;
      this.playOneshot(SwitchWeaponState);
    });
    eventBus.on('weapon:viewmodelEquipped', () => {
      // Fresh mixer under the viewmodel: rebuild the additive ADS layer,
      // then play the new weapon's switch_in one-shot.
      this.blender.attach();
      this.switchPhase = 'in';
      this.lastContext.switchPhase = 'in';
      this.playOneshot(SwitchWeaponState);
    });
    eventBus.on('weapon:switchComplete', () => {
      if (this.action === 'SWITCHING') this.action = 'IDLE';
    });
    eventBus.on('weapon:adsStart', () => {
      this.blender.setADSActive(true);
      this.viewmodel.setADSActive(true);
    });
    eventBus.on('weapon:adsStop', () => {
      this.blender.setADSActive(false);
      this.viewmodel.setADSActive(false);
    });
  }

  update(dt: number, movementState: string, localVelocity: { x: number; z: number }): void {
    this.lastContext.movementState = movementState;
    this.lastContext.localVelocity = localVelocity;
    this.lastContext.weaponAction = this.action;
    this.lastContext.reloadWasEmpty = this.reloadWasEmpty;
    this.lastContext.switchPhase = this.switchPhase;
    this.lastContext.isADS = this.blender.isADSActive;

    if (this.action === 'FIRING') {
      this.fireHoldTimer -= dt;
      if (this.fireHoldTimer <= 0) this.action = 'IDLE';
    }

    if (this.action === 'IDLE') {
      // Base locomotion clip. FIRING keeps its one-shot until the hold
      // window expires; RELOADING / SWITCHING own the mixer until their
      // completion events arrive.
      const strategy = MOVEMENT_STRATEGIES[movementState] ?? IdleState;
      const clip = strategy.getClipName(this.lastContext);
      if (clip) this.blender.crossfadeTo(clip, strategy.getCrossfadeDuration());
    }

    this.blender.update(dt);
  }

  private playOneshot(strategy: AnimationStateStrategy): void {
    const clip = strategy.getClipName(this.lastContext);
    if (!clip) return;
    this.blender.playOneshot(clip, strategy.getCrossfadeDuration());
  }
}

export default AnimationStateMachine;
