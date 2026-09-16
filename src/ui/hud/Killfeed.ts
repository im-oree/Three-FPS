/**
 * Killfeed.ts — the running list of who killed whom, top right.
 *
 * This is the widget that makes a lobby feel populated. Without it the other
 * players in the match are invisible until you walk into one; with it you can
 * see the match happening around you, which is most of what makes a
 * single-player-with-bots session read as multiplayer.
 *
 * It is fed from the SERVER's killfeed messages, not from local events, so it
 * reports the authoritative result of every fight in the match — including
 * ones far away that the client never simulated.
 */
import { div, el } from '../dom';

export interface KillfeedEntry {
  readonly killerName: string | null;
  readonly victimName: string;
  readonly weaponLabel: string | null;
  readonly headshot: boolean;
  /** Highlights your own name in the feed. */
  readonly killerIsLocal: boolean;
  readonly victimIsLocal: boolean;
}

/** Rows visible at once, and how long each survives. COD shows ~5 for ~7s. */
const MAX_ROWS = 5;
const ROW_LIFETIME_SECONDS = 7;

interface LiveRow {
  readonly node: HTMLElement;
  age: number;
}

export class Killfeed {
  readonly element = div('killfeed');

  private rows: LiveRow[] = [];

  push(entry: KillfeedEntry): void {
    const row = div('killfeed__row');

    if (entry.killerName) {
      const killer = el('span', 'killfeed__killer', entry.killerName);
      if (entry.killerIsLocal) killer.classList.add('killfeed__killer--you');
      row.appendChild(killer);
    }

    if (entry.headshot) {
      row.appendChild(el('span', 'killfeed__headshot', '◎'));
    }

    row.appendChild(el(
      'span', 'killfeed__weapon',
      entry.weaponLabel ?? (entry.killerName ? 'ELIMINATED' : 'DIED'),
    ));

    const victim = el('span', 'killfeed__victim', entry.victimName);
    if (entry.victimIsLocal) victim.classList.add('killfeed__victim--you');
    row.appendChild(victim);

    this.element.appendChild(row);
    this.rows.push({ node: row, age: 0 });

    // Oldest out first, so the feed reads top-down in kill order.
    while (this.rows.length > MAX_ROWS) {
      const dropped = this.rows.shift();
      dropped?.node.remove();
    }
  }

  update(dt: number): void {
    if (this.rows.length === 0) return;
    const survivors: LiveRow[] = [];
    for (const row of this.rows) {
      row.age += dt;
      if (row.age >= ROW_LIFETIME_SECONDS) row.node.remove();
      else survivors.push(row);
    }
    this.rows = survivors;
  }

  /** Wipe the feed — a new match must not inherit the last one's kills. */
  clear(): void {
    for (const row of this.rows) row.node.remove();
    this.rows.length = 0;
  }
}

export default Killfeed;
