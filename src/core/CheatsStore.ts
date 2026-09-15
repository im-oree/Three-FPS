/**
 * CheatsStore.ts — the player's opt-in cheat toggles, chosen in the main
 * menu's CHEATS panel. Deliberately a tiny store, exactly like SettingsStore:
 * gameplay code READS from it; only the menu writes.
 *
 * Two toggles, both OFF by default:
 *  - infiniteStuff: infinite magazine + reserve ammo, and killstreaks never
 *    locked/cooling — every streak is always ready.
 *  - godMode: damage applies (hit feedback stays real) but health can never
 *    reach zero, so `player:died` never fires.
 *
 * State persists in localStorage so a cheat survives a page reload, and
 * survives — by design — quitting to the main menu and re-entering a match:
 * cheats are player intent, not match state.
 */
import eventBus from './EventBus';

export const CheatId = {
  INFINITE_STUFF: 'infiniteStuff',
  GOD_MODE: 'godMode',
} as const;
export type CheatIdValue = (typeof CheatId)[keyof typeof CheatId];

const STORAGE_KEY = 'three-fps:cheats';

class CheatsStore {
  private state: Record<CheatIdValue, boolean> = {
    [CheatId.INFINITE_STUFF]: false,
    [CheatId.GOD_MODE]: false,
  };

  constructor() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<CheatIdValue, boolean>>;
        for (const id of Object.values(CheatId)) {
          if (typeof parsed[id] === 'boolean') this.state[id] = parsed[id]!;
        }
      }
    } catch {
      // storage unavailable (private mode etc.) — cheats stay at defaults.
    }
  }

  get(id: CheatIdValue): boolean {
    return this.state[id];
  }

  set(id: CheatIdValue, value: boolean): void {
    if (this.state[id] === value) return;
    this.state[id] = value;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch { /* storage unavailable — session-only cheat then */ }
    eventBus.emit('cheats:changed', { id, value });
  }

  toggle(id: CheatIdValue): boolean {
    const next = !this.state[id];
    this.set(id, next);
    return next;
  }
}

const cheatsStore = new CheatsStore();
export default cheatsStore;
