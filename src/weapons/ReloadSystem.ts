/**
 * ReloadSystem.ts — tactical/empty reload lifecycle (Document 3 §11.2).
 *
 * Ammo is granted at RELOAD_AMMO_INSERT_FRACTION of the duration ("the new mag
 * is physically in"), via an elapsed-time scheduled trigger. NOTE: this is a
 * stand-in for true animation-embedded event callbacks — if the asset pipeline
 * ever exports named clip events, swap this fraction trigger for those without
 * touching WeaponManager.
 *
 * Cancel semantics: cancel() (weapon switch mid-reload) aborts immediately with
 * NO completion event; ammo already granted at the insert fraction stays
 * granted (physically consistent), while a cancel before that point grants
 * nothing — which is exactly what the acceptance suite verifies.
 */
import eventBus from '../core/EventBus';
import { WEAPON } from '../utils/Constants';
import type { WeaponBase } from './WeaponBase';

export class ReloadSystem {
  private weapon: WeaponBase | null = null;
  private isTactical = false;
  private duration = 0;
  private elapsed = 0;
  private ammoInserted = false;

  get isReloading(): boolean {
    return this.weapon !== null;
  }

  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 0;
  }

  /** Begins a reload if one is possible; returns whether it started. */
  begin(weapon: WeaponBase): boolean {
    if (this.weapon !== null) return false;
    if (weapon.currentMagazineAmmo >= weapon.def.magazineSize) return false;
    if (weapon.currentReserveAmmo <= 0) return false;
    this.weapon = weapon;
    this.isTactical = weapon.currentMagazineAmmo > 0;
    this.duration = this.isTactical ? weapon.def.reloadTacticalDuration : weapon.def.reloadEmptyDuration;
    this.elapsed = 0;
    this.ammoInserted = false;
    weapon.isReloading = true;
    eventBus.emit('weapon:reloadStart', {
      weaponId: weapon.def.id,
      isTactical: this.isTactical,
      duration: this.duration,
    });
    return true;
  }

  update(dt: number): void {
    const weapon = this.weapon;
    if (!weapon) return;
    this.elapsed += dt;
    if (!this.ammoInserted && this.elapsed >= this.duration * WEAPON.RELOAD_AMMO_INSERT_FRACTION) {
      this.ammoInserted = true;
      weapon.refillMagazine();
      eventBus.emit('weapon:ammoChanged', {
        weaponId: weapon.def.id,
        magazineAmmo: weapon.currentMagazineAmmo,
        reserveAmmo: weapon.currentReserveAmmo,
      });
    }
    if (this.elapsed >= this.duration) {
      weapon.isReloading = false;
      this.weapon = null;
      eventBus.emit('weapon:reloadComplete', { weaponId: weapon.def.id });
    }
  }

  /** Aborts with no completion event (see cancel semantics above). */
  cancel(): void {
    const weapon = this.weapon;
    if (!weapon) return;
    weapon.isReloading = false;
    this.weapon = null;
  }
}

export default ReloadSystem;
