/**
 * LoadoutManager.ts — Document 5 §7.3.
 *
 * Holds the player's chosen primary/secondary weapon and skin, persisted
 * through SettingsStore so the selection survives a reload.
 *
 * WeaponManager reads this at match start instead of its hardcoded default,
 * which is the one explicit touch-point back into Document 3.
 */
import eventBus from '../core/EventBus';
import settingsStore from '../core/SettingsStore';

export interface Loadout {
  primaryId: string;
  secondaryId: string;
  primarySkinId: string;
  secondarySkinId: string;
}

const DEFAULT_LOADOUT: Loadout = {
  primaryId: 'rifle',
  secondaryId: 'pistol',
  primarySkinId: 'standard',
  secondarySkinId: 'standard',
};

/** Weapons offerable in each slot. Fists are always implicitly available. */
export const PRIMARY_CHOICES = ['rifle', 'smg', 'shotgun', 'sniper', 'rocket_launcher'] as const;
export const SECONDARY_CHOICES = ['pistol', 'smg', 'shotgun'] as const;

export class LoadoutManager {
  private loadout: Loadout;

  constructor() {
    const stored = settingsStore.get<Partial<Loadout>>('loadout', {});
    this.loadout = { ...DEFAULT_LOADOUT, ...stored };
    this.validate();
  }

  getCurrentLoadout(): Loadout {
    return { ...this.loadout };
  }

  set(patch: Partial<Loadout>): void {
    this.loadout = { ...this.loadout, ...patch };
    this.validate();
    settingsStore.set('loadout', this.loadout);
    eventBus.emit('loadout:changed', { ...this.loadout });
  }

  /**
   * Guard against a stale or hand-edited localStorage entry naming a weapon
   * that no longer exists — otherwise the game boots holding nothing.
   */
  private validate(): void {
    if (!PRIMARY_CHOICES.includes(this.loadout.primaryId as typeof PRIMARY_CHOICES[number])) {
      this.loadout.primaryId = DEFAULT_LOADOUT.primaryId;
    }
    if (!SECONDARY_CHOICES.includes(this.loadout.secondaryId as typeof SECONDARY_CHOICES[number])) {
      this.loadout.secondaryId = DEFAULT_LOADOUT.secondaryId;
    }
  }

  /** The ordered weapon ids a match should boot with. */
  get bootOrder(): string[] {
    return [this.loadout.primaryId, this.loadout.secondaryId, 'fists'];
  }
}

export const loadoutManager = new LoadoutManager();
export default loadoutManager;
