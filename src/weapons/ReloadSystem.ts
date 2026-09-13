/**
 * ReloadSystem.ts — tactical/empty reload lifecycle (Document 3 §11.2, now
 * driven by Document 2.5 §6.6 percentage-of-duration EVENT TABLES).
 *
 * Each weapon's WeaponProfile carries `{ atProgress, event }` beat tables
 * (magazine_detach / magazine_attach / chamber_round). A per-frame ticker
 * fires each beat EXACTLY ONCE as elapsed-time-as-percentage crosses it —
 * the standard, permanent technique per §6.6 (no reliance on embedded glTF
 * clip events). `magazine_attach` is also the canonical ammo-grant beat; a
 * profile without tables falls back to WEAPON.RELOAD_AMMO_INSERT_FRACTION.
 *
 * Cancel semantics (unchanged, Document 3): cancel() aborts immediately with
 * NO completion event; ammo granted before the cancel stays granted, a cancel
 * before the grant beat grants nothing — exactly what the acceptance suite
 * verifies. Tac sprint engagement cancels via WeaponManager (§8).
 */
import eventBus from '../core/EventBus';
import { WEAPON } from '../utils/Constants';
import type { ReloadEvent } from './WeaponProfile';
import { getProfile } from './WeaponProfile';
import type { WeaponBase } from './WeaponBase';
import { animationEngine } from '../animation-engine/OperatorAnimEngine';

export class ReloadSystem {
  private weapon: WeaponBase | null = null;
  private isTactical = false;
  private duration = 0;
  private elapsed = 0;
  private ammoInserted = false;
  private beats: ReloadEvent[] = [];
  private timelineId: string | null = null;
  private completedThisFrame = false;

  get isReloading(): boolean {
    return this.weapon !== null;
  }

  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 0;
  }

  /** §5 buffering: time left before the reload finishes (Infinity when idle). */
  get remainingSeconds(): number {
    return this.weapon ? Math.max(0, this.duration - this.elapsed) : Infinity;
  }

  /** WeaponManager consumes the completion edge once (buffered-fire check). */
  consumeCompletedThisFrame(): boolean {
    const value = this.completedThisFrame;
    this.completedThisFrame = false;
    return value;
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
    // §6.6: the profile's beat table for THIS variant; fallback = single
    // synthetic attach beat at the Doc-3 fraction. Beats fire through the
    // OperatorAnimEngine's AnimEventScheduler (generic names on `anim:beat`,
    // mirrored on the legacy `weapon:reloadEvent` for part animation).
    const profile = getProfile(weapon.def.id);
    const table = this.isTactical ? profile.reloadTacticalEvents : profile.reloadEmptyEvents;
    this.beats = table
      ? [...table].sort((a, b) => a.atProgress - b.atProgress)
      : [{ atProgress: WEAPON.RELOAD_AMMO_INSERT_FRACTION, event: 'magazine_attach' }];
    this.timelineId = animationEngine.scheduler.play(
      `reload:${weapon.def.id}:${this.isTactical ? 'tactical' : 'empty'}`,
      this.beats,
      { weaponId: weapon.def.id, isTactical: this.isTactical },
      (beat) => this.fireBeat(weapon, beat.event),
    );
    weapon.isReloading = true;
    eventBus.emit('weapon:reloadStart', {
      weaponId: weapon.def.id,
      isTactical: this.isTactical,
      duration: this.duration,
    });
    return true;
  }

  /** One beat: ammo grant on attach + the legacy part-animation event. */
  private fireBeat(weapon: WeaponBase, eventName: string): boolean {
    if (eventName === 'magazine_attach' && !this.ammoInserted) {
      this.ammoInserted = true;
      weapon.refillMagazine();
      eventBus.emit('weapon:ammoChanged', {
        weaponId: weapon.def.id,
        magazineAmmo: weapon.currentMagazineAmmo,
        reserveAmmo: weapon.currentReserveAmmo,
      });
    }
    eventBus.emit('weapon:reloadEvent', {
      weaponId: weapon.def.id,
      event: eventName,
      isTactical: this.isTactical,
      progress: this.progress,
    });
    return true; // scheduler also emits the generic `anim:beat`
  }

  update(dt: number): void {
    const weapon = this.weapon;
    if (!weapon) return;
    this.elapsed += dt;

    // §6.6 percentage ticker (via the engine scheduler): each crossed beat
    // fires exactly once; nothing fires on/after the completion frame.
    if (this.timelineId && this.elapsed < this.duration) {
      animationEngine.scheduler.update(this.timelineId, this.progress);
    }

    if (this.elapsed >= this.duration) {
      // Safety: a truncated/clamped dt must still grant ammo (headless runs).
      if (!this.ammoInserted) {
        this.ammoInserted = true;
        weapon.refillMagazine();
        eventBus.emit('weapon:ammoChanged', {
          weaponId: weapon.def.id,
          magazineAmmo: weapon.currentMagazineAmmo,
          reserveAmmo: weapon.currentReserveAmmo,
        });
      }
      weapon.isReloading = false;
      this.weapon = null;
      this.completedThisFrame = true;
      if (this.timelineId) animationEngine.scheduler.finish(this.timelineId);
      this.timelineId = null;
      eventBus.emit('weapon:reloadComplete', { weaponId: weapon.def.id });
    }
  }

  /** Aborts with no completion event (see cancel semantics above). */
  cancel(): void {
    const weapon = this.weapon;
    if (!weapon) return;
    if (this.timelineId) animationEngine.scheduler.cancel(this.timelineId);
    this.timelineId = null;
    weapon.isReloading = false;
    this.weapon = null;
  }
}

export default ReloadSystem;
