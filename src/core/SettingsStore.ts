/**
 * SettingsStore.ts — tiny versioned persistence layer over localStorage.
 *
 * One JSON object lives under SETTINGS.STORAGE_KEY ('operator-fps-settings-v1').
 * The version suffix is the migration strategy: when a future document changes
 * the settings shape it bumps the suffix, and stale data is simply discarded
 * (documented behaviour, never a silent crash).
 */
import { SETTINGS } from '../utils/Constants';

export class SettingsStore {
  private readonly storageKey: string;

  constructor(storageKey: string = SETTINGS.STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  /** Full parsed settings object; {} when absent or corrupted (warns, never throws). */
  getAll(): Record<string, unknown> {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw === null) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        console.warn(`[SettingsStore] "${this.storageKey}" held a non-object; ignoring.`);
        return {};
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      console.warn(`[SettingsStore] corrupted data in "${this.storageKey}"; resetting.`, err);
      return {};
    }
  }

  /** Stored value for `key`, else `fallback` (fallback is NOT persisted). */
  get<T>(key: string, fallback: T): T {
    const all = this.getAll();
    return (key in all ? (all[key] as T) : fallback);
  }

  /** Merge `{[key]: value}` into the stored object and write back synchronously. */
  set<T>(key: string, value: T): void {
    const all = this.getAll();
    all[key] = value;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(all));
    } catch (err) {
      console.error(`[SettingsStore] failed to persist "${this.storageKey}":`, err);
    }
  }

  /** Clear the stored key entirely (next read falls back to defaults). */
  resetToDefaults(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (err) {
      console.error(`[SettingsStore] failed to clear "${this.storageKey}":`, err);
    }
  }
}

/** The one shared store for the whole application. */
export const settingsStore = new SettingsStore();
export default settingsStore;
