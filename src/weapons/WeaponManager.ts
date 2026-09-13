/**
 * WeaponManager.ts — central combat orchestrator (Document 3 §7, integrated
 * with Document 2.5 §4/§5/§8: movement-state weapon semantics).
 *
 * Slots: primary (AssaultRifle, Digit1) + secondary (Pistol, Digit2); the
 * wheel cycles the loadout; Fists stays registered via debugSetLoadout().
 *
 * Document 2.5 interaction semantics implemented here:
 *  - Regular SPRINT: fire/ADS press cancels sprint (requestSprintCancel) and
 *    starts the SPRINT_TO_READY snap-up window before the shot/ADS executes.
 *  - TAC SPRINT: fire/ADS press does NOTHING except end tac sprint — the
 *    press is swallowed; a SECOND press goes through the regular-sprint
 *    snap-up path (§4.3 two-step rule). Reload/switch blocked mid-tac-sprint;
 *    an active reload is cancelled by tac sprint (§8).
 *  - SLIDE: firing allowed (spread penalty in BallisticsSystem), ADS no-op.
 *  - ADS hold-by-default with SettingsStore "Toggle ADS" (§5).
 *  - Fire buffering: a press inside the final FIRE_BUFFER_WINDOW of a reload/
 *    switch executes the instant the blocking action completes (§5).
 */
import eventBus from '../core/EventBus';
import characterState, { WeaponAction, Aim } from '../character/CharacterStateSystem';
import type { InputManager } from '../core/InputManager';
import settingsStore from '../core/SettingsStore';
import type { PlayerCamera } from '../player/PlayerCamera';
import { PlayerState, type PlayerStateValue } from '../player/PlayerState';
import { ANIMATION, BOOT_LOADOUT, CAMERA, CAMERA_FEEL, SETTINGS_KEYS, WEAPON } from '../utils/Constants';
import { getProfile } from './WeaponProfile';
import ballistics from './BallisticsSystem';
import { Rifle } from './definitions/Rifle';
import { Pistol } from './definitions/Pistol';
import { Shotgun } from './definitions/Shotgun';
import { Fists } from './definitions/Fists';
import FireModeSystem from './FireModeSystem';
import ReloadSystem from './ReloadSystem';
import WeaponBase from './WeaponBase';
import type { WeaponViewmodel } from './WeaponViewmodel';

const AIRBORNE: readonly string[] = [PlayerState.JUMP, PlayerState.AIR, PlayerState.LANDING];

export interface WeaponManagerDeps {
  input: InputManager;
  camera: PlayerCamera;
  viewmodel: WeaponViewmodel;
  getMovementState: () => PlayerStateValue;
  /** Document 2.5 §4.3: the orthogonal tactical-sprint flag. */
  getTacticalSprinting: () => boolean;
  /** §4.2: sprint-cancel + snap-up request (owned by PlayerController). */
  requestSprintCancel: () => void;
}

export class WeaponManager {
  readonly inventory: WeaponBase[] = [
    new WeaponBase(Rifle),
    new WeaponBase(Pistol),
    new WeaponBase(Shotgun),
    new WeaponBase(Fists),
  ];
  private loadout: string[] = [...BOOT_LOADOUT];
  activeIndex = 0;
  private readonly fireMode = new FireModeSystem();
  private readonly reload = new ReloadSystem();
  private adsActive = false;
  private adsLatched = false; // toggle-ADS mode latch
  private switching = false;
  private switchElapsed = 0;
  private switchTarget = -1;
  private switchEquipDone = false;
  private prevFireDown = false;
  /** §4.3: a press swallowed by the tac-sprint cancel must be RELEASED before
   *  fire/ADS input registers again (two-step cost, literally enforced). */
  private fireSwallowed = false;
  private adsSwallowed = false;
  /** §4.2: snap-up window after sprint-cancel before fire/ADS executes. */
  private snapToReadyTimer = 0;
  /** §5 buffering: pending fire across a reload/switch completion. */
  private bufferedFire = false;
  /** §8 inspect idle-fidget state. */
  private lastShotClock = -Infinity;
  private inspectHoldTimer = 0;
  private clock = 0;

  constructor(private readonly deps: WeaponManagerDeps) {
    this.activeIndex = this.inventoryIndex(this.loadout[0]);
    // §8: starting tac sprint mid-reload cancels it (no completion event).
    eventBus.on('player:tacSprintStart', () => {
      if (this.reload.isReloading) this.reload.cancel();
    });
  }

  get activeLoadout(): readonly string[] {
    return this.loadout;
  }

  private inventoryIndex(id: string): number {
    const i = this.inventory.findIndex((w) => w.def.id === id);
    return i < 0 ? 0 : i;
  }

  /** TEST / future-doc seam: reopen guns (or any subset) in the loadout. */
  debugSetLoadout(ids: string[], equipFirst = true): void {
    const valid = ids.length > 0 && ids.every((id) => this.inventory.some((w) => w.def.id === id));
    if (!valid) return;
    this.loadout = [...ids];
    if (!equipFirst) return;
    this.switching = false;
    this.switchTarget = -1;
    this.reload.cancel();
    this.activeIndex = this.inventoryIndex(ids[0]);
    void this.deps.viewmodel.equip(this.activeWeapon.def);
  }

  get activeWeapon(): WeaponBase {
    return this.inventory[this.activeIndex];
  }

  get isADSActive(): boolean {
    return this.adsActive;
  }

  /** §4.2/§4.3 pose layer input: snap-up window drives READY_SNAP offset. */
  get isSnappingToReady(): boolean {
    return this.snapToReadyTimer > 0;
  }

  /** §8: inspect one-shot in flight. */
  get isInspecting(): boolean {
    return this.inspectHoldTimer > 0;
  }

  /** Boot equip — no switch events; ASM still gets weapon:viewmodelEquipped. */
  async equipInitial(): Promise<void> {
    await this.deps.viewmodel.equip(this.activeWeapon.def);
  }

  update(dt: number): void {
    this.clock += dt;
    const { input } = this.deps;
    const movementState = this.deps.getMovementState();
    const tacSprinting = this.deps.getTacticalSprinting();
    const sprinting = movementState === PlayerState.SPRINT && !tacSprinting;
    if (this.snapToReadyTimer > 0) this.snapToReadyTimer -= dt;
    if (this.inspectHoldTimer > 0) this.inspectHoldTimer -= dt;

    // --- fire input with Document 2.5 movement gating ------------------------
    // Base gate: reloading/switching always block; SPRINT states resolve via
    // the §4.2/§4.3 cancel rules below; SLIDE/AIR/LANDING/CROUCH all allow.
    const rawFireDown = input.isActionDown('fire');
    const fireDown = rawFireDown && !this.switching && !this.reload.isReloading;
    let firePressed = fireDown && !this.prevFireDown;
    this.prevFireDown = fireDown;

    // §4.3 tac sprint: press does nothing but cancel; swallow until release.
    if (tacSprinting && firePressed) {
      this.fireSwallowed = true;
      this.deps.requestSprintCancel(); // ends tac sprint → back to SPRINT/WALK
      firePressed = false;
    }
    if (this.fireSwallowed) {
      if (!rawFireDown) this.fireSwallowed = false;
      firePressed = false;
    }

    // §4.2 regular sprint: cancel + snap-up, then the shot executes.
    if (sprinting && firePressed) {
      this.deps.requestSprintCancel();
      this.snapToReadyTimer = WEAPON.SPRINT_TO_READY_DURATION;
    }
    const snapGate = this.snapToReadyTimer > 0;
    const effectiveFireDown = fireDown && !snapGate;
    const effectiveFirePressed = firePressed && !snapGate;

    if (effectiveFirePressed && !this.activeWeapon.def.melee && this.activeWeapon.currentMagazineAmmo === 0) {
      eventBus.emit('weapon:emptyFire', { weaponId: this.activeWeapon.def.id });
    }

    // --- §5 fire buffering across blocking actions ---------------------------
    const remainingReload = this.reload.remainingSeconds;
    const remainingSwitch = this.switching
      ? WEAPON.SWITCH_OUT_SECONDS + WEAPON.SWITCH_IN_SECONDS - this.switchElapsed
      : Infinity;
    const blocking = this.reload.isReloading || this.switching;
    const blockingRemainder = Math.min(remainingReload, remainingSwitch);
    if (firePressed && blocking && blockingRemainder <= WEAPON.FIRE_BUFFER_WINDOW_SECONDS) {
      this.bufferedFire = true;
    }

    // --- ADS: hold OR toggle (SettingsStore), with §4 gates ------------------
    const adsDown = input.isActionDown('ads');
    const adsPressed = adsDown && !this.prevAdsDown;
    this.prevAdsDown = adsDown;
    if (tacSprinting && adsPressed) {
      this.adsSwallowed = true;
      this.deps.requestSprintCancel();
    }
    // §4.2: ADS during REGULAR sprint cancels sprint + snap-up; engagement
    // happens the moment the gate clears (hold keeps the intent latched).
    if (adsPressed && sprinting) {
      this.deps.requestSprintCancel();
      this.snapToReadyTimer = WEAPON.SPRINT_TO_READY_DURATION;
    }
    if (this.adsSwallowed) {
      if (!adsDown) this.adsSwallowed = false;
      this.handleADS(false, movementState);
    } else if (this.adsToggleMode) {
      if (adsPressed && !this.switching && !this.reload.isReloading
        && movementState !== PlayerState.SLIDE) {
        this.adsLatched = !this.adsLatched;
      }
      this.handleADS(this.adsLatched, movementState);
    } else {
      this.handleADS(adsDown && !snapGate, movementState);
    }

    // --- reload / slot keys / wheel / inspect: edge-triggered ----------------
    if (this.wasPressedThisFrame('reload')) this.requestReload(tacSprinting);
    if (this.wasPressedThisFrame('weaponSlot1')) this.switchToSlot(0, tacSprinting);
    if (this.wasPressedThisFrame('weaponSlot2')) this.switchToSlot(1, tacSprinting);
    if (this.wasPressedThisFrame('weaponSlot3')) this.switchToSlot(2, tacSprinting);
    const wheel = input.getWheelDelta();
    if (wheel !== 0 && !this.switching && !tacSprinting) this.cycle(wheel > 0 ? 1 : -1);
    if (this.wasPressedThisFrame('inspect')) this.tryInspect(movementState, tacSprinting);
    // §8: inspect cancels instantly on movement/fire/ADS input.
    if (this.inspectHoldTimer > 0 && movementState !== PlayerState.IDLE) this.inspectHoldTimer = 0;

    // --- switch timeline ------------------------------------------------------
    if (this.switching) {
      this.switchElapsed += dt;
      if (!this.switchEquipDone && this.switchElapsed >= WEAPON.SWITCH_OUT_SECONDS) {
        this.switchEquipDone = true;
        void this.deps.viewmodel.equip(this.inventory[this.switchTarget].def);
      }
      if (this.switchElapsed >= WEAPON.SWITCH_OUT_SECONDS + WEAPON.SWITCH_IN_SECONDS) {
        this.finishSwitch();
      }
    }

    this.reload.update(dt);

    // Reload completion is ALSO the reloadEvent ticker's ammo beat (§6.6);
    // buffered fire executes the instant the blocker completes (§5).
    if (this.reload.consumeCompletedThisFrame()) this.executeBufferedFire();
    if (this.switchJustCompleted) {
      this.switchJustCompleted = false;
      this.executeBufferedFire();
    }

    this.fireMode.update(dt, this.activeWeapon.def, { fireHeld: effectiveFireDown, firePressed: effectiveFirePressed }, () =>
      this.tryConsumeShot(movementState),
    );
  }

  private prevAdsDown = false;
  private switchJustCompleted = false;

  private get adsToggleMode(): boolean {
    return settingsStore.get<boolean>(SETTINGS_KEYS.ADS_TOGGLE, false);
  }

  private handleADS(want: boolean, movementState: PlayerStateValue): void {
    // §4.4/§4.7: ADS is a no-op during a slide; sprint handled via snap-up.
    const blocked = !want || this.switching || this.reload.isReloading
      || movementState === PlayerState.SLIDE
      || (movementState === PlayerState.SPRINT && this.deps.getTacticalSprinting());
    if (blocked) {
      if (this.adsActive) this.stopADS();
      return;
    }
    if (!this.adsActive) this.startADS();
  }

  private executeBufferedFire(): void {
    if (!this.bufferedFire) return;
    this.bufferedFire = false;
    this.tryConsumeShot(this.deps.getMovementState());
  }

  private tryConsumeShot(movementState: PlayerStateValue): boolean {
    const weapon = this.activeWeapon;
    if (this.switching || this.reload.isReloading) return false;
    if (movementState === PlayerState.SPRINT && this.deps.getTacticalSprinting()) return false;
    if (!weapon.canFireNow(this.clock)) return false;
    weapon.consumeRound();
    weapon.markFired(this.clock);
    this.lastShotClock = this.clock;
    if (weapon.def.melee) {
      eventBus.emit('melee:swung', {
        weaponId: weapon.def.id,
        rangeMeters: weapon.def.meleeRangeMeters ?? 0,
      });
    }
    eventBus.emit('weapon:fired', {
      weaponId: weapon.def.id,
      remainingMagazineAmmo: weapon.currentMagazineAmmo,
    });
    eventBus.emit('weapon:ammoChanged', {
      weaponId: weapon.def.id,
      magazineAmmo: weapon.currentMagazineAmmo,
      reserveAmmo: weapon.currentReserveAmmo,
    });
    ballistics.resolveShot(this.deps.camera.threeCamera, weapon, {
      movementState,
      isADS: this.adsActive,
      isJumping: AIRBORNE.includes(movementState),
    });
    return true;
  }

  private requestReload(tacSprinting: boolean): void {
    if (this.activeWeapon.def.melee) return; // fists never reload
    if (this.switching || this.reload.isReloading) return;
    if (tacSprinting) return; // §8: blocked mid-tac-sprint
    if (this.adsActive) this.stopADS(); // cleanly exit ADS first (§7)
    this.fireMode.reset();
    this.bufferedFire = false;
    this.reload.begin(this.activeWeapon); // emits nothing if not possible
  }

  startADS(): void {
    if (this.adsActive || this.switching || this.reload.isReloading) return;
    const movementState = this.deps.getMovementState();
    if (movementState === PlayerState.SLIDE) return; // §4.4
    if (movementState === PlayerState.SPRINT) {
      // §4.2: allowed WITH the snap-up interrupt.
      this.deps.requestSprintCancel();
      this.snapToReadyTimer = WEAPON.SPRINT_TO_READY_DURATION;
      return;
    }
    if (!characterState.request({ channel: 'aim', to: Aim.ADS, source: 'WeaponManager.startADS' })) return;
    this.adsActive = true;
    // ADS zoom rides the Doc-2 FOV modifier stack at a priority above
    // sprint's, so both coexist and blending never pops (§6.4/§15 + §7.1).
    // Doc C §8.3: the FOV target derives from the profile's optic data —
    // adsFOV = baseFOV / max(magnification, 1/ADS_ONE_X_FEEL) — so irons
    // tighten to ~0.92× base while a 4x prism lands at exactly baseFOV/4.
    // Melee (fists) keeps its authored no-zoom stance via adsZoomFOV.
    const profile = getProfile(this.activeWeapon.def.id);
    const adsFov = profile.magnification > 0 && this.activeWeapon.def.id !== 'fists'
      ? CAMERA.DEFAULT_FOV / Math.max(profile.magnification, 1 / CAMERA_FEEL.ADS_ONE_X_FEEL)
      : this.activeWeapon.def.adsZoomFOV;
    this.deps.camera.applyFOVModifier(
      'ads',
      adsFov,
      CAMERA_FEEL.ADS_FOV_LERP_SPEED,
      CAMERA_FEEL.ADS_FOV_PRIORITY,
    );
    eventBus.emit('weapon:adsStart', {
      weaponId: this.activeWeapon.def.id,
      moveSpeedMultiplier: this.activeWeapon.def.adsMoveSpeedMultiplier,
    });
  }

  stopADS(): void {
    if (!this.adsActive) return;
    characterState.request({ channel: 'aim', to: Aim.HIP, source: 'WeaponManager.stopADS', force: true });
    this.adsActive = false;
    this.adsLatched = false;
    this.deps.camera.clearFOVModifier('ads');
    eventBus.emit('weapon:adsStop', {
      weaponId: this.activeWeapon.def.id,
      moveSpeedMultiplier: 1,
    });
  }

  /** Slot keys address LOADOUT positions (Digit1 = loadout[0]), not inventory. */
  private switchToSlot(slot: number, tacSprinting: boolean): void {
    if (tacSprinting) return; // §8: blocked mid-tac-sprint-transition
    const id = this.loadout[slot];
    if (!id) return;
    this.switchTo(this.inventoryIndex(id));
  }

  switchTo(index: number): void {
    if (index === this.activeIndex || this.switching) return;
    if (index < 0 || index >= this.inventory.length) return;
    if (this.adsActive) this.stopADS();
    if (this.reload.isReloading) this.reload.cancel(); // no ammo, no complete event
    this.fireMode.reset();
    this.bufferedFire = false;
    const from = this.activeWeapon;
    const to = this.inventory[index];
    
    
    // Ask the authority FIRST. Committing switching=true before the request
    // meant a rejection left the manager permanently stuck mid-switch: every
    // later switchTo() bailed on `this.switching`, so the weapon could never
    // be changed again (fists became unreachable).
    if (!characterState.request({
      channel: 'weaponAction', to: WeaponAction.SWITCHING, source: 'WeaponManager.switchTo',
    })) return;
    this.switching = true;
    this.switchTarget = index;
    this.switchElapsed = 0;
    this.switchEquipDone = false;
    eventBus.emit('weapon:switchStart', {
      fromWeaponId: from.def.id,
      toWeaponId: to.def.id,
      duration: WEAPON.SWITCH_OUT_SECONDS + WEAPON.SWITCH_IN_SECONDS,
    });
  }

  /** Wheel cycling over the LOADOUT. */
  cycle(direction: number): void {
    if (this.switching) return;
    const pos = this.loadout.indexOf(this.activeWeapon.def.id);
    const from = pos < 0 ? 0 : pos;
    const nextId = this.loadout[(from + direction + this.loadout.length) % this.loadout.length];
    this.switchTo(this.inventoryIndex(nextId));
  }

  private finishSwitch(): void {
    this.activeIndex = this.switchTarget;
    
    this.switching = false;
    this.switchJustCompleted = true;
    characterState.setFact('weaponId', this.activeWeapon.def.id);
    characterState.request({
      channel: 'weaponAction', to: WeaponAction.NONE,
      source: 'WeaponManager.finishSwitch', force: true,
    });
    eventBus.emit('weapon:switchComplete', { weaponId: this.activeWeapon.def.id });
  }

  /** §8: inspect plays only from a fully idle, non-combat state. */
  private tryInspect(movementState: PlayerStateValue, tacSprinting: boolean): void {
    if (this.switching || this.reload.isReloading || tacSprinting) return;
    if (movementState !== PlayerState.IDLE) return;
    if (this.clock - this.lastShotClock < WEAPON.INSPECT_QUIET_SECONDS) return;
    this.inspectHoldTimer = ANIMATION.INSPECT_HOLD_SECONDS; // authored clip length
    eventBus.emit('weapon:inspect', { weaponId: this.activeWeapon.def.id });
  }

  /** One-frame press latch lives in InputManager; edges tracked locally. */
  private pressedThisFrame = new Map<string, boolean>();
  private wasPressedThisFrame(action: string): boolean {
    const down = this.deps.input.isActionDown(action);
    const prev = this.pressedThisFrame.get(action) ?? false;
    this.pressedThisFrame.set(action, down);
    return down && !prev;
  }
}

export default WeaponManager;
