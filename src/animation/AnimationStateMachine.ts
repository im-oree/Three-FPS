/**
 * AnimationStateMachine.ts — the single authority on "what animation should
 * be playing right now" (Document 3 §14.3, REFINED per Document 2.5 §3.3).
 *
 * §3.3 REQUIRED REFINEMENT: this class resolves to CLIP NAMES + LAYER WEIGHTS
 * AS DATA (a ResolvedAnimationDescriptor) and emits it to any number of
 * registered AnimationTargets. It never calls viewmodel.playClip directly.
 * Today the sole production target is the AnimationBlender (first-person
 * viewmodel); a future third-person body registers as one more target with
 * ZERO changes here — the §11 acceptance suite proves this with a mock
 * second consumer.
 *
 * Inputs each frame: Document 2's movement state (PlayerState) + the
 * orthogonal isTacticalSprinting flag + camera-local velocity, and the
 * weapon-action state (IDLE / FIRING / RELOADING / SWITCHING) tracked from
 * WeaponManager events. Resolution priority: SWITCHING > RELOADING > FIRING >
 * movement base. ADS is a WEIGHT on the descriptor (§6.1 layer 3), never a
 * hard clip swap, so walking-while-aiming blends correctly.
 */
import eventBus from '../core/EventBus';
import characterState, { Traversal } from '../character/CharacterStateSystem';
import { ANIMATION } from '../utils/Constants';
import { PlayerState } from '../player/PlayerState';
import type { WeaponViewmodel } from '../weapons/WeaponViewmodel';
import AnimationBlender, {
  type AnimationContext,
  type AnimationStateStrategy,
  type ResolvedAnimationDescriptor,
  type AnimationTarget,
  type WeaponAction,
} from './AnimationBlender';
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
  /** §3.3: N consumers of the resolved descriptor (viewmodel today, body later). */
  private readonly targets = new Set<AnimationTarget>();
  private action: WeaponAction = 'IDLE';
  private fireHoldTimer = 0;
  private inspectHoldTimer = 0;
  private reloadWasEmpty = false;
  private switchPhase: 'out' | 'in' = 'out';
  private isTacticalSprinting = false;
  private currentDescriptor: ResolvedAnimationDescriptor;
  private lastContext: AnimationContext = {
    movementState: PlayerState.IDLE,
    weaponAction: 'IDLE',
    isADS: false,
    isTacticalSprinting: false,
    localVelocity: { x: 0, z: 0 },
    reloadWasEmpty: false,
    switchPhase: 'out',
  };

  constructor(
    private readonly blender: AnimationBlender,
    private readonly viewmodel: WeaponViewmodel,
  ) {
    this.registerTarget(this.blender);
    this.currentDescriptor = this.resolve(0, this.lastContext);

    eventBus.on('weapon:fired', () => {
      if (this.action === 'RELOADING' || this.action === 'SWITCHING') return;
      this.action = 'FIRING';
      this.fireHoldTimer = ANIMATION.FIRE_HOLD_SECONDS;
      this.lastContext.weaponAction = this.action;
    });
    eventBus.on('weapon:reloadStart', (payload) => {
      const p = payload as { isTactical: boolean };
      this.action = 'RELOADING';
      this.reloadWasEmpty = !p.isTactical;
      this.lastContext.reloadWasEmpty = this.reloadWasEmpty;
      this.lastContext.weaponAction = this.action;
    });
    eventBus.on('weapon:reloadComplete', () => {
      if (this.action === 'RELOADING') this.action = 'IDLE';
    });
    eventBus.on('weapon:switchStart', () => {
      this.action = 'SWITCHING';
      this.switchPhase = 'out';
      this.lastContext.switchPhase = 'out';
      this.lastContext.weaponAction = this.action;
    });
    eventBus.on('weapon:viewmodelEquipped', () => {
      // Fresh mixer under the viewmodel: rebuild the additive layers (hold
      // pose = the NEW weapon profile's grip-style clip, §6.1 L2), then the
      // new weapon's switch_in one-shot owns the mixer immediately.
      this.blender.attach(this.viewmodel.currentHoldPoseClipName);
      this.switchPhase = 'in';
      this.lastContext.switchPhase = 'in';
    });
    eventBus.on('weapon:switchComplete', () => {
      if (this.action === 'SWITCHING') this.action = 'IDLE';
    });
    // §8: inspect one-shot — idle-only trigger handled by WeaponManager; any
    // weapon action or movement cancels it instantly.
    eventBus.on('weapon:inspect', () => {
      this.action = 'INSPECTING';
      this.inspectHoldTimer = ANIMATION.INSPECT_HOLD_SECONDS;
    });
    eventBus.on('weapon:adsStart', () => {
      this.blender.setADSActive(true);
    });
    eventBus.on('weapon:adsStop', () => {
      this.blender.setADSActive(false);
    });
  }

  /** §3.3 seam: any consumer of resolved clip/weight data registers here. */
  registerTarget(target: AnimationTarget): void {
    this.targets.add(target);
  }

  unregisterTarget(target: AnimationTarget): void {
    this.targets.delete(target);
  }

  /** TEST seam: the exact descriptor emitted on the previous update. */
  getLastDescriptor(): ResolvedAnimationDescriptor {
    return this.currentDescriptor;
  }

  /** Per-frame access for the rig layer (main). */
  get lastDescriptor(): ResolvedAnimationDescriptor {
    return this.currentDescriptor;
  }

  /** TEST seam: targets the descriptor currently reaches. */
  get targetCount(): number {
    return this.targets.size;
  }

  /** Movement layer feeds the orthogonal tac-sprint flag (Document 2.5 §4.1). */
  setTacticalSprinting(active: boolean): void {
    this.isTacticalSprinting = active;
  }

  update(dt: number, movementState: string, localVelocity: { x: number; z: number }): void {
    this.lastContext.movementState = movementState;
    this.lastContext.localVelocity = localVelocity;
    this.lastContext.weaponAction = this.action;
    this.lastContext.reloadWasEmpty = this.reloadWasEmpty;
    this.lastContext.switchPhase = this.switchPhase;
    this.lastContext.isTacticalSprinting = this.isTacticalSprinting;
    this.lastContext.isADS = this.blender.adsActive;

    if (this.action === 'FIRING') {
      this.fireHoldTimer -= dt;
      if (this.fireHoldTimer <= 0) this.action = 'IDLE';
    }
    if (this.action === 'INSPECTING') {
      this.inspectHoldTimer -= dt;
      // §8 instant-cancel contract: movement, ADS, or a fresh weapon action.
      if (this.inspectHoldTimer <= 0 || movementState !== PlayerState.IDLE
        || this.lastContext.isADS || this.lastContext.weaponAction !== 'IDLE') {
        this.action = 'IDLE';
      }
    }

    this.currentDescriptor = this.resolve(dt, this.lastContext);
    for (const target of this.targets) target.applyDescriptor(this.lastDescriptor);
  }

  /** Pure resolver: state → descriptor data (no side effects on targets). */
  private resolve(dt: number, context: AnimationContext): ResolvedAnimationDescriptor {
    let oneShotClip: string | null = null;
    let baseClip: string | null = null;
    let baseCrossfade: number = ANIMATION.CROSSFADE_DEFAULT_SECONDS;

    // Traversal outranks every weapon action: the hands are on the ledge, so
    // the mantle/vault clip owns both chains. Read straight from the state
    // authority rather than a local mirror.
    const traversal = characterState.traversal;
    if (traversal === Traversal.MANTLE) {
      oneShotClip = 'mantle_climb';
    } else if (traversal === Traversal.VAULT) {
      oneShotClip = 'vault_over';
    } else if (context.weaponAction === 'SWITCHING') {
      oneShotClip = SwitchWeaponState.getClipName(context);
    } else if (context.weaponAction === 'RELOADING') {
      oneShotClip = ReloadState.getClipName(context);
    } else if (context.weaponAction === 'FIRING') {
      oneShotClip = FireState.getClipName(context);
    } else if (context.weaponAction === 'INSPECTING') {
      oneShotClip = 'inspect';
    }

    if (!oneShotClip) {
      const strategy = MOVEMENT_STRATEGIES[context.movementState] ?? IdleState;
      baseClip = strategy.getClipName(context);
      baseCrossfade = strategy.getCrossfadeDuration();
    }

    void dt;
    return {
      baseClip,
      baseCrossfadeDuration: baseCrossfade,
      oneShotClip,
      oneShotCrossfadeDuration: ANIMATION.CROSSFADE_FAST_SECONDS,
      holdPoseClip: this.blender.currentHoldPoseClip,
      adsWeightTarget: this.blender.adsActive ? 1 : 0,
      movementState: context.movementState,
      isTacticalSprinting: context.isTacticalSprinting,
    };
  }
}

export default AnimationStateMachine;
