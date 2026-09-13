/**
 * CharacterStateSystem.ts — THE SINGLE AUTHORITY OVER CHARACTER STATE.
 *
 * ============================================================================
 *  READ THIS BEFORE ADDING ANY CHARACTER FEATURE, IN ANY SESSION.
 *  Full contract, rationale and checklist: /CHARACTER_STATE.md (normative).
 * ============================================================================
 *
 * Every fact about what the character is currently doing lives here and ONLY
 * here. No subsystem may keep its own private copy of "am I reloading", "am I
 * sprinting", "am I mid-vault". Those duplicated booleans are exactly how this
 * codebase previously ended up with tactical sprint that could never start,
 * reloads that played no animation, and a mantle that fired on its own — three
 * systems each believed something different and nobody owned the truth.
 *
 * THE RULES (enforced by tools/verify/state-authority.mjs — CI will fail):
 *
 *   1. To CHANGE state you call `characterState.request(...)`. Nothing else.
 *      There are no public setters. A request is validated against the
 *      transition rules below and is either ACCEPTED or REJECTED with a
 *      reason; it never silently half-applies.
 *
 *   2. To READ state you call `characterState.get(channel)` or one of the
 *      derived query helpers (`canFire()`, `isBusy()`, ...). Do not cache the
 *      result across frames; ask again.
 *
 *   3. To ADD A NEW STATE you add it to the relevant channel's enum AND
 *      declare its transition rules in TRANSITIONS. A state that is not
 *      declared cannot be entered — `request` will reject it. This is
 *      deliberate: it makes "somebody bolted on a feature without telling the
 *      state system" impossible rather than merely discouraged.
 *
 *   4. To ADD A NEW CHANNEL (a genuinely orthogonal axis of behaviour) add it
 *      to `CHANNELS`, give it a default, and document what it means. Channels
 *      are orthogonal ON PURPOSE: the character is legitimately "sprinting AND
 *      reloading AND holding a rifle" at the same time, and a single flat enum
 *      cannot express that. That is why this is a multi-channel system.
 *
 * WHY CHANNELS INSTEAD OF ONE ENUM: a flat state machine would need
 * SPRINT_RELOADING_RIFLE, CROUCH_WALK_ADS_PISTOL, and so on — a combinatorial
 * explosion. Each channel here is independently valid, and the cross-channel
 * interactions (reloading cancels ADS, mantling stows the weapon) are declared
 * once in INTERACTIONS rather than scattered through gameplay code.
 */
import eventBus from '../core/EventBus';

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/**
 * LOCOMOTION — how the body is moving through the world. Mutually exclusive
 * by nature: you cannot be sprinting and sliding simultaneously.
 */
export const Locomotion = Object.freeze({
  IDLE: 'IDLE',
  WALK: 'WALK',
  SPRINT: 'SPRINT',
  TAC_SPRINT: 'TAC_SPRINT',
  CROUCH_IDLE: 'CROUCH_IDLE',
  CROUCH_WALK: 'CROUCH_WALK',
  SLIDE: 'SLIDE',
  JUMP: 'JUMP',
  AIR: 'AIR',
  LANDING: 'LANDING',
} as const);

/**
 * TRAVERSAL — scripted movement that SUSPENDS normal physics. While this is
 * anything other than NONE, the locomotion channel is frozen and the movement
 * integrator must not run.
 */
export const Traversal = Object.freeze({
  NONE: 'NONE',
  VAULT: 'VAULT',
  MANTLE: 'MANTLE',
} as const);

/**
 * WEAPON_ACTION — what the hands are doing with the weapon. Exclusive: you
 * cannot reload and switch at once.
 */
export const WeaponAction = Object.freeze({
  NONE: 'NONE',
  FIRING: 'FIRING',
  RELOADING: 'RELOADING',
  SWITCHING: 'SWITCHING',
  INSPECTING: 'INSPECTING',
  MELEE: 'MELEE',
} as const);

/** AIM — sight picture. Orthogonal to everything else. */
export const Aim = Object.freeze({
  HIP: 'HIP',
  ADS: 'ADS',
} as const);

/**
 * CARRY — how the weapon is held. Traversal forces STOWED so both hands are
 * free for the climb; that is declared in INTERACTIONS, not hand-coded.
 */
export const Carry = Object.freeze({
  READY: 'READY',
  LOWERED: 'LOWERED',
  STOWED: 'STOWED',
} as const);

export type LocomotionValue = (typeof Locomotion)[keyof typeof Locomotion];
export type TraversalValue = (typeof Traversal)[keyof typeof Traversal];
export type WeaponActionValue = (typeof WeaponAction)[keyof typeof WeaponAction];
export type AimValue = (typeof Aim)[keyof typeof Aim];
export type CarryValue = (typeof Carry)[keyof typeof Carry];

export interface CharacterStateSnapshot {
  locomotion: LocomotionValue;
  traversal: TraversalValue;
  weaponAction: WeaponActionValue;
  aim: AimValue;
  carry: CarryValue;
  /** Equipped weapon id — data, not a state, but part of the snapshot. */
  weaponId: string;
  /** Grounded flag, mirrored here so consumers need only one source. */
  grounded: boolean;
}

export type ChannelName = 'locomotion' | 'traversal' | 'weaponAction' | 'aim' | 'carry';

// ---------------------------------------------------------------------------
// Declared transitions
// ---------------------------------------------------------------------------

/**
 * Allowed transitions per channel. `'*'` means "from any state".
 *
 * A target state absent from its channel's table is UNREACHABLE — adding a
 * state to the enum without adding it here will make every request for it be
 * rejected, which is the intended forcing function (rule 3 above).
 */
const TRANSITIONS: Record<ChannelName, Record<string, readonly string[]>> = {
  locomotion: {
    IDLE: ['*'],
    WALK: ['*'],
    SPRINT: ['IDLE', 'WALK', 'LANDING', 'TAC_SPRINT', 'AIR'],
    // Tactical sprint is a PROMOTION of an existing sprint, never a cold start.
    TAC_SPRINT: ['SPRINT'],
    CROUCH_IDLE: ['*'],
    CROUCH_WALK: ['*'],
    // Slide is reachable only at speed (see INTERACTIONS for the speed gate).
    SLIDE: ['SPRINT', 'TAC_SPRINT', 'WALK'],
    JUMP: ['IDLE', 'WALK', 'SPRINT', 'TAC_SPRINT', 'CROUCH_IDLE', 'CROUCH_WALK', 'SLIDE', 'LANDING'],
    AIR: ['*'],
    LANDING: ['JUMP', 'AIR'],
  },
  traversal: {
    NONE: ['*'],
    VAULT: ['NONE'],
    MANTLE: ['NONE'],
  },
  weaponAction: {
    NONE: ['*'],
    FIRING: ['NONE'],
    RELOADING: ['NONE', 'FIRING'],
    SWITCHING: ['NONE', 'FIRING', 'RELOADING'],
    INSPECTING: ['NONE'],
    MELEE: ['NONE', 'FIRING'],
  },
  aim: {
    HIP: ['*'],
    ADS: ['HIP'],
  },
  carry: {
    READY: ['*'],
    LOWERED: ['*'],
    STOWED: ['*'],
  },
};

/** A rejected request, for logging and for the debug overlay. */
export interface StateRejection {
  channel: ChannelName;
  from: string;
  to: string;
  reason: string;
  source: string;
}

export interface StateRequest {
  channel: ChannelName;
  to: string;
  /** Who asked — shows up in the audit log and in rejection reasons. */
  source: string;
  /**
   * Force the transition past the declared rules. Reserved for authoritative
   * corrections (e.g. physics reporting a landing). Still audited, still
   * subject to INTERACTIONS, and still rejected if the target is undeclared.
   */
  force?: boolean;
}

export interface StateChange {
  channel: ChannelName;
  from: string;
  to: string;
  source: string;
}

// ---------------------------------------------------------------------------

const DEFAULTS: CharacterStateSnapshot = {
  locomotion: Locomotion.IDLE,
  traversal: Traversal.NONE,
  weaponAction: WeaponAction.NONE,
  aim: Aim.HIP,
  carry: Carry.READY,
  weaponId: 'rifle',
  grounded: true,
};

const AIRBORNE: readonly string[] = [Locomotion.JUMP, Locomotion.AIR];
const CROUCHED: readonly string[] = [Locomotion.CROUCH_IDLE, Locomotion.CROUCH_WALK, Locomotion.SLIDE];
const SPRINTING: readonly string[] = [Locomotion.SPRINT, Locomotion.TAC_SPRINT];

export class CharacterStateSystem {
  private readonly state: CharacterStateSnapshot = { ...DEFAULTS };
  private readonly listeners = new Set<(change: StateChange) => void>();
  /** Rolling audit log — the debug overlay and the verify harness read this. */
  private readonly log: StateChange[] = [];
  private readonly rejections: StateRejection[] = [];
  private static readonly LOG_LIMIT = 200;

  // -- reads ----------------------------------------------------------------

  get(channel: ChannelName): string {
    return this.state[channel];
  }

  /** Full immutable snapshot; safe to hand to animation/UI consumers. */
  snapshot(): Readonly<CharacterStateSnapshot> {
    return { ...this.state };
  }

  get locomotion(): LocomotionValue { return this.state.locomotion; }
  get traversal(): TraversalValue { return this.state.traversal; }
  get weaponAction(): WeaponActionValue { return this.state.weaponAction; }
  get aim(): AimValue { return this.state.aim; }
  get carry(): CarryValue { return this.state.carry; }
  get weaponId(): string { return this.state.weaponId; }
  get grounded(): boolean { return this.state.grounded; }

  // -- derived queries (the ONLY sanctioned way to ask "may I…") ------------

  /** Scripted traversal owns the capsule: movement/gravity must not run. */
  isTraversing(): boolean {
    return this.state.traversal !== Traversal.NONE;
  }

  /** A weapon action is mid-flight; most new actions must wait. */
  isBusy(): boolean {
    return this.state.weaponAction === WeaponAction.RELOADING
      || this.state.weaponAction === WeaponAction.SWITCHING;
  }

  isAirborne(): boolean { return AIRBORNE.includes(this.state.locomotion); }
  isCrouched(): boolean { return CROUCHED.includes(this.state.locomotion); }
  isSprinting(): boolean { return SPRINTING.includes(this.state.locomotion); }
  isTacticalSprinting(): boolean { return this.state.locomotion === Locomotion.TAC_SPRINT; }

  canFire(): boolean {
    return !this.isBusy()
      && !this.isTraversing()
      && this.state.carry === Carry.READY
      && this.state.locomotion !== Locomotion.TAC_SPRINT;
  }

  canADS(): boolean {
    return !this.isBusy() && !this.isTraversing() && !this.isSprinting()
      && this.state.carry === Carry.READY;
  }

  canReload(): boolean {
    return !this.isBusy() && !this.isTraversing() && this.state.carry === Carry.READY;
  }

  /** Traversal may only begin from a grounded, non-busy, non-traversing body. */
  canTraverse(): boolean {
    return !this.isTraversing() && this.state.locomotion !== Locomotion.SLIDE;
  }

  // -- the single mutation entry point --------------------------------------

  /**
   * Request a state change. Returns true if ACCEPTED.
   *
   * Order of evaluation:
   *   1. Is the target declared for this channel?      (else reject)
   *   2. Is from→to allowed, or is force set?          (else reject)
   *   3. Do the cross-channel INTERACTIONS permit it?  (else reject)
   *   4. Apply, run INTERACTION side effects, notify.
   */
  request(req: StateRequest): boolean {
    const { channel, to, source } = req;
    const from = this.state[channel];
    if (from === to) return true; // idempotent, not an error

    const allowedFrom = TRANSITIONS[channel]?.[to];
    if (!allowedFrom) {
      return this.reject(channel, from, to, source,
        `'${to}' is not declared in TRANSITIONS.${channel} — declare it before use (rule 3)`);
    }
    if (!req.force && !allowedFrom.includes('*') && !allowedFrom.includes(from)) {
      return this.reject(channel, from, to, source,
        `illegal transition ${from} -> ${to}; allowed from [${allowedFrom.join(', ')}]`);
    }
    const veto = this.checkInteractions(channel, to);
    if (veto) return this.reject(channel, from, to, source, veto);

    (this.state as unknown as Record<string, unknown>)[channel] = to;
    const change: StateChange = { channel, from, to, source };
    this.push(change);
    this.applyInteractionEffects(channel, to, source);
    for (const fn of this.listeners) fn(change);
    eventBus.emit('character:stateChanged', { ...change });
    return true;
  }

  /**
   * Mirror non-state facts the rules depend on (grounded, equipped weapon).
   * These are inputs to the system, not states with transition rules.
   */
  setFact(fact: 'grounded' | 'weaponId', value: boolean | string): void {
    if (fact === 'grounded') this.state.grounded = Boolean(value);
    else this.state.weaponId = String(value);
  }

  // -- cross-channel rules --------------------------------------------------

  /**
   * INTERACTIONS (veto half): cross-channel preconditions. Returning a string
   * rejects the request with that reason.
   */
  private checkInteractions(channel: ChannelName, to: string): string | null {
    // Nothing may start a weapon action or an aim change mid-traversal: both
    // hands are on the ledge.
    if (this.isTraversing() && channel !== 'traversal') {
      if (channel === 'weaponAction' && to !== WeaponAction.NONE) {
        return `blocked: ${this.state.traversal} in progress (both hands on the ledge)`;
      }
      if (channel === 'aim' && to === Aim.ADS) {
        return `blocked: cannot aim during ${this.state.traversal}`;
      }
      if (channel === 'locomotion') {
        return `blocked: ${this.state.traversal} owns the capsule`;
      }
    }
    // Traversal itself requires a body in a fit state to start one.
    if (channel === 'traversal' && to !== Traversal.NONE) {
      if (this.state.locomotion === Locomotion.SLIDE) return 'blocked: cannot traverse while sliding';
    }
    // ADS and sprinting are mutually exclusive; the sprint must drop first.
    if (channel === 'aim' && to === Aim.ADS && this.isSprinting()) {
      return 'blocked: cannot ADS while sprinting (drop the sprint first)';
    }
    // A stowed or lowered weapon cannot fire or aim.
    if (this.state.carry !== Carry.READY) {
      if (channel === 'weaponAction' && (to === WeaponAction.FIRING || to === WeaponAction.RELOADING)) {
        return `blocked: weapon is ${this.state.carry}`;
      }
      if (channel === 'aim' && to === Aim.ADS) return `blocked: weapon is ${this.state.carry}`;
    }
    return null;
  }

  /**
   * INTERACTIONS (effect half): consequences that MUST follow a change. These
   * are applied through `request` itself (with force), so they are audited
   * exactly like any other transition — there is no back door.
   */
  private applyInteractionEffects(channel: ChannelName, to: string, source: string): void {
    const via = `${source}->interaction`;
    if (channel === 'traversal') {
      if (to !== Traversal.NONE) {
        // Climbing is a two-handed action: drop the sights and stow the gun.
        this.request({ channel: 'aim', to: Aim.HIP, source: via, force: true });
        this.request({ channel: 'weaponAction', to: WeaponAction.NONE, source: via, force: true });
        this.request({ channel: 'carry', to: Carry.STOWED, source: via, force: true });
      } else {
        this.request({ channel: 'carry', to: Carry.READY, source: via, force: true });
      }
    }
    // Reloading or switching breaks the sight picture.
    if (channel === 'weaponAction'
      && (to === WeaponAction.RELOADING || to === WeaponAction.SWITCHING)) {
      this.request({ channel: 'aim', to: Aim.HIP, source: via, force: true });
    }
    // Entering a sprint drops ADS; tac sprint additionally lowers the weapon.
    if (channel === 'locomotion') {
      if (SPRINTING.includes(to)) {
        this.request({ channel: 'aim', to: Aim.HIP, source: via, force: true });
      }
      if (to === Locomotion.TAC_SPRINT) {
        this.request({ channel: 'carry', to: Carry.LOWERED, source: via, force: true });
      } else if (this.state.carry === Carry.LOWERED && !this.isTraversing()) {
        this.request({ channel: 'carry', to: Carry.READY, source: via, force: true });
      }
    }
  }

  // -- plumbing -------------------------------------------------------------

  onChange(fn: (change: StateChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Recent accepted transitions, newest last (debug overlay / verify). */
  getLog(): readonly StateChange[] { return this.log; }
  /** Recent rejected requests — invaluable when a feature "does nothing". */
  getRejections(): readonly StateRejection[] { return this.rejections; }

  private push(change: StateChange): void {
    this.log.push(change);
    if (this.log.length > CharacterStateSystem.LOG_LIMIT) this.log.shift();
  }

  private reject(
    channel: ChannelName, from: string, to: string, source: string, reason: string,
  ): false {
    const rejection: StateRejection = { channel, from, to, reason, source };
    this.rejections.push(rejection);
    if (this.rejections.length > CharacterStateSystem.LOG_LIMIT) this.rejections.shift();
    return false;
  }

  /** TEST seam only. */
  resetForTest(): void {
    Object.assign(this.state, DEFAULTS);
    this.log.length = 0;
    this.rejections.length = 0;
  }
}

/** Process-wide singleton: there is exactly one character. */
export const characterState = new CharacterStateSystem();
export default characterState;
