/**
 * WeaponManager.ts — central combat orchestrator (Document 3 §7).
 *
 * Slots: primary (AssaultRifle, Digit1) + secondary (Pistol, Digit2) are
 * hardcoded at boot per the spec; the wheel cycles the full inventory list,
 * which also contains the SMG so all three Document 3 weapons are reachable
 * in-session (the loadout SELECTION UI remains Document 5's job).
 *
 * Every frame it polls InputManager actions (fire/reload/ads/weaponSlot1/
 * weaponSlot2 + wheel delta), validates state before acting (no fire while
 * reloading/switching/sprinting, no reload with a full mag, no switch while
 * switching; reload/switch requests exit ADS cleanly first; switch cancels a
 * reload with no ammo grant and no completion event), delegates shot gating
 * to FireModeSystem, and emits the exact Document 5 event contract.
 */
import eventBus from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import type { PlayerCamera } from '../player/PlayerCamera';
import { PlayerState, type PlayerStateValue } from '../player/PlayerState';
import { BOOT_LOADOUT, CAMERA_FEEL, WEAPON } from '../utils/Constants';
import ballistics from './BallisticsSystem';
import { AssaultRifle } from './definitions/AssaultRifle';
import { Pistol } from './definitions/Pistol';
import { SMG } from './definitions/SMG';
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
}

export class WeaponManager {
  readonly inventory: WeaponBase[] = [
    new WeaponBase(AssaultRifle),
    new WeaponBase(Pistol),
    new WeaponBase(SMG),
    new WeaponBase(Fists),
  ];
  /**
   * Hands-first phase: wheel + slot keys cycle THIS list, not the raw
   * inventory — guns stay registered (future docs, acceptance harness) but
   * unreachable until debugSetLoadout() opens them up.
   */
  private loadout: string[] = [...BOOT_LOADOUT];
  activeIndex = 0;
  private readonly fireMode = new FireModeSystem();
  private readonly reload = new ReloadSystem();
  private adsActive = false;
  private switching = false;
  private switchElapsed = 0;
  private switchTarget = -1;
  private switchEquipDone = false;
  private prevFireDown = false;
  private clock = 0;

  constructor(private readonly deps: WeaponManagerDeps) {
    this.activeIndex = this.inventoryIndex(this.loadout[0]);
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

  /** Boot equip — no switch events; ASM still gets weapon:viewmodelEquipped. */
  async equipInitial(): Promise<void> {
    await this.deps.viewmodel.equip(this.activeWeapon.def);
  }

  update(dt: number): void {
    this.clock += dt;
    const { input } = this.deps;
    const movementState = this.deps.getMovementState();

    const fireDown = input.isActionDown('fire') && movementState !== PlayerState.SPRINT;
    const firePressed = fireDown && !this.prevFireDown;
    this.prevFireDown = fireDown;

    if (firePressed && !this.switching && !this.reload.isReloading && !this.activeWeapon.def.melee && this.activeWeapon.currentMagazineAmmo === 0) {
      eventBus.emit('weapon:emptyFire', { weaponId: this.activeWeapon.def.id });
    }

    // ADS: hold-based, edge-validated.
    const adsDown = input.isActionDown('ads');
    if (adsDown && !this.adsActive) this.startADS();
    if (!adsDown && this.adsActive) this.stopADS();

    // Reload / slot keys: edge-triggered.
    if (this.wasPressedThisFrame('reload')) this.requestReload();
    if (this.wasPressedThisFrame('weaponSlot1')) this.switchToSlot(0);
    if (this.wasPressedThisFrame('weaponSlot2')) this.switchToSlot(1);
    const wheel = input.getWheelDelta();
    if (wheel !== 0 && !this.switching) this.cycle(wheel > 0 ? 1 : -1);

    // Switch timeline: out-half on the old weapon, equip at the midpoint
    // (viewmodel emits weapon:viewmodelEquipped → ASM plays switch_in),
    // complete after out+in durations.
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
    this.fireMode.update(dt, this.activeWeapon.def, { fireHeld: fireDown, firePressed }, () =>
      this.tryConsumeShot(movementState),
    );
  }

  private tryConsumeShot(movementState: PlayerStateValue): boolean {
    const weapon = this.activeWeapon;
    if (this.switching || this.reload.isReloading) return false;
    if (!weapon.canFireNow(this.clock)) return false;
    weapon.consumeRound();
    weapon.markFired(this.clock);
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

  private requestReload(): void {
    if (this.activeWeapon.def.melee) return; // fists never reload
    if (this.switching || this.reload.isReloading) return;
    if (this.adsActive) this.stopADS(); // cleanly exit ADS first (§7)
    this.fireMode.reset();
    this.reload.begin(this.activeWeapon); // emits nothing if not possible
  }

  startADS(): void {
    if (this.adsActive || this.switching || this.reload.isReloading) return;
    if (this.deps.getMovementState() === PlayerState.SPRINT) return; // no ADS while sprinting
    this.adsActive = true;
    // ADS zoom rides the Doc-2 FOV modifier stack at a priority above
    // sprint's, so both coexist and blending never pops (§6.4/§15).
    this.deps.camera.applyFOVModifier(
      'ads',
      this.activeWeapon.def.adsZoomFOV,
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
    this.adsActive = false;
    this.deps.camera.clearFOVModifier('ads');
    eventBus.emit('weapon:adsStop', {
      weaponId: this.activeWeapon.def.id,
      moveSpeedMultiplier: 1,
    });
  }

  /** Slot keys address LOADOUT positions (Digit1 = loadout[0]), not inventory. */
  private switchToSlot(slot: number): void {
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
    const from = this.activeWeapon;
    const to = this.inventory[index];
    from.isSwitching = true;
    to.isSwitching = true;
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

  /** Wheel cycling over the full inventory (AR → Pistol → SMG → …). */
  /** Wheel cycles the LOADOUT (fists-only until guns are re-enabled). */
  cycle(direction: number): void {
    if (this.switching) return;
    const pos = this.loadout.indexOf(this.activeWeapon.def.id);
    const from = pos < 0 ? 0 : pos;
    const nextId = this.loadout[(from + direction + this.loadout.length) % this.loadout.length];
    this.switchTo(this.inventoryIndex(nextId));
  }

  private finishSwitch(): void {
    const from = this.activeWeapon;
    from.isSwitching = false;
    this.activeIndex = this.switchTarget;
    this.activeWeapon.isSwitching = false;
    this.switching = false;
    eventBus.emit('weapon:switchComplete', { weaponId: this.activeWeapon.def.id });
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
