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
 *
 * COD CONVENTIONS, which this follows:
 *
 *  - killer name, weapon ICON, victim name. Left to right, always that order.
 *    Not a text weapon name: the icon is faster to read and is what the real
 *    feed shows.
 *  - Colour is by SIDE, not by role. Your team is blue, the enemy red, and a
 *    row you are involved in is highlighted so your own kills stand out of
 *    the stream.
 *  - In FFA there are no teams, so everyone who is not you is an enemy.
 *  - A headshot adds a skull. A kill with no killer (fell out of the world,
 *    killstreak, suicide) shows the victim alone with a skull, because there
 *    is nobody to credit.
 *  - Newest at the BOTTOM: the eye tracks a growing list downward, and a feed
 *    that pushes older rows down makes you re-find your place on every kill.
 */
import { div, el } from '../dom';

export interface KillfeedEntry {
  readonly killerName: string | null;
  readonly victimName: string;
  /** Weapon id (`rifle`, `smg`...), used to pick the silhouette. */
  readonly weaponId: string | null;
  readonly headshot: boolean;
  /** Highlights your own name in the feed. */
  readonly killerIsLocal: boolean;
  readonly victimIsLocal: boolean;
  /** True when that party is on the local player's side. FFA: only you are. */
  readonly killerIsFriendly: boolean;
  readonly victimIsFriendly: boolean;
}

/** Rows visible at once, and how long each survives. COD shows ~5 for ~7s. */
const MAX_ROWS = 5;
const ROW_LIFETIME_SECONDS = 7;
/** Seconds a row spends fading out before it is removed. */
const FADE_SECONDS = 0.45;

/**
 * Weapon id -> icon file.
 *
 * Anything unmapped falls back to the knife rather than vanishing: a row with
 * a blank gap reads as a rendering bug, and a wrong-but-present icon at least
 * keeps the three-column rhythm of the feed intact.
 */
const ICONS: Record<string, string> = {
  rifle: 'rifle',
  smg: 'smg',
  shotgun: 'shotgun',
  sniper: 'sniper',
  pistol: 'pistol',
  rocket_launcher: 'rocket_launcher',
  knife: 'knife',
  melee: 'knife',
};

function iconUrl(weaponId: string | null): string {
  const name = (weaponId && ICONS[weaponId]) ?? 'explosive';
  return `/assets/ui/weapons/${name}.svg`;
}

interface LiveRow {
  readonly node: HTMLElement;
  age: number;
}

export class Killfeed {
  readonly element = div('killfeed');

  private rows: LiveRow[] = [];

  push(entry: KillfeedEntry): void {
    const row = div('killfeed__row');
    // A row you are part of gets a lit background, as COD does: your own
    // kills must be findable in a feed that is otherwise other people's.
    if (entry.killerIsLocal || entry.victimIsLocal) {
      row.classList.add('killfeed__row--mine');
    }

    if (entry.killerName) {
      row.appendChild(this.nameNode(
        entry.killerName, entry.killerIsLocal, entry.killerIsFriendly,
      ));
    }

    // The weapon, as a silhouette. `mask-image` rather than <img> so the
    // icon inherits the row's colour -- one file serves red, blue and white.
    const icon = div('killfeed__icon');
    icon.style.webkitMaskImage = `url("${iconUrl(entry.weaponId)}")`;
    icon.style.maskImage = `url("${iconUrl(entry.weaponId)}")`;
    row.appendChild(icon);

    if (entry.headshot) row.appendChild(el('span', 'killfeed__headshot', '💀'));

    row.appendChild(this.nameNode(
      entry.victimName, entry.victimIsLocal, entry.victimIsFriendly,
    ));

    this.element.appendChild(row);
    this.rows.push({ node: row, age: 0 });

    // Oldest out first, so the feed reads top-down in kill order.
    while (this.rows.length > MAX_ROWS) {
      const dropped = this.rows.shift();
      dropped?.node.remove();
    }
  }

  private nameNode(name: string, isLocal: boolean, isFriendly: boolean): HTMLElement {
    const node = el('span', 'killfeed__name', name);
    // Order matters: "you" wins over side, because your own name should read
    // the same whichever team you are on.
    if (isLocal) node.classList.add('killfeed__name--you');
    else node.classList.add(isFriendly ? 'killfeed__name--ally' : 'killfeed__name--enemy');
    return node;
  }

  update(dt: number): void {
    if (this.rows.length === 0) return;
    const survivors: LiveRow[] = [];
    for (const row of this.rows) {
      row.age += dt;
      if (row.age >= ROW_LIFETIME_SECONDS) {
        row.node.remove();
        continue;
      }
      // Fade rather than vanish. A row blinking out draws the eye to the one
      // thing that is no longer information.
      const remaining = ROW_LIFETIME_SECONDS - row.age;
      if (remaining < FADE_SECONDS) {
        row.node.style.opacity = String(Math.max(0, remaining / FADE_SECONDS));
      }
      survivors.push(row);
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
