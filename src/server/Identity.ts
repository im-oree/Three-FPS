/**
 * Identity.ts — who a player is, whether or not a human is driving.
 *
 * The central rule of this file, and the reason it exists at all: NOTHING
 * outside the bot spawner is allowed to care that a player is a bot. The
 * server stores `isBot` for its own scheduling, but it never leaves in a
 * snapshot, never appears in the scoreboard, and never reaches the client.
 * A bot is a player with a name.
 *
 * Three separate ids, kept apart deliberately because conflating them is what
 * breaks reconnects and stats later:
 *
 *   IdentityId     stable across sessions   "who this really is"
 *   PlayerId       one match                the id the simulation uses
 *   BotProfileId   a bot's personality      which tuning profile it runs
 */
import type { PlayerId } from '../net/Protocol';

export type IdentityId = string;
export type BotProfileId = string;

export interface PlayerIdentity {
  readonly identityId: IdentityId;
  displayName: string;
  /** Server-side only. Never serialised into a snapshot. */
  readonly isBot: boolean;
  readonly botProfileId?: BotProfileId;
}

// --- name generation ---------------------------------------------------------

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Chris', 'Marcus', 'Elena', 'Riley', 'Casey',
  'Morgan', 'Avery', 'Quinn', 'Dana', 'Reese', 'Skyler', 'Jesse', 'Devon',
  'Rowan', 'Emerson', 'Kai', 'Nico', 'Sasha', 'Toni', 'Blake', 'Drew',
];

const HANDLE_SUFFIXES = ['_', 'TTV', 'YT', 'Plays', 'Live', 'HD', 'Prime'];

const TAG_PREFIXES = [
  'Shadow', 'Ghost', 'Silent', 'Alpha', 'Rogue', 'Nova', 'Toxic', 'Frost',
  'Iron', 'Viper', 'Night', 'Dead', 'Grim', 'Rapid', 'Steel', 'Zero',
];

const TAG_ROOTS = [
  'Sniper', 'Wolf', 'Reaper', 'Phantom', 'Striker', 'Hunter', 'Blade', 'Fox',
  'Storm', 'Falcon', 'Merc', 'Recon', 'Havoc', 'Raven', 'Saint', 'Bolt',
];

const TAG_SUFFIXES = ['', 'X', 'XD', '99', '007', 'YT', 'TTV', '_', 'Prime', 'Jr'];

const LEET: Record<string, string> = { a: '4', e: '3', i: '1', o: '0', s: '5' };

/** Minimal seeded RNG, so a given match generates the same roster twice. */
export class NameRandom {
  private state: number;

  constructor(seed: number) { this.state = (seed >>> 0) || 1; }

  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    return x / 0xffffffff;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length)]; }

  chance(p: number): boolean { return this.next() < p; }
}

export type NameStyle = 'realistic' | 'gamertag' | 'leet';

/**
 * The name authority.
 *
 * Uniqueness has to be decided somewhere that can see every name at once,
 * which is the server — a client cannot know what everyone else is called
 * before it connects. So the client may suggest a name and the server either
 * accepts it or hands back a corrected one.
 */
export class NameAuthority {
  private readonly reserved = new Set<string>();

  generate(rng: NameRandom, style?: NameStyle): string {
    const roll = rng.next();
    const chosen = style ?? (roll < 0.45 ? 'realistic' : roll < 0.9 ? 'gamertag' : 'leet');

    switch (chosen) {
      case 'realistic': {
        const first = rng.pick(FIRST_NAMES);
        if (rng.chance(0.45)) return first;
        return `${first}${rng.pick(HANDLE_SUFFIXES)}${rng.int(1, 999)}`;
      }
      case 'leet': {
        const base = rng.pick(TAG_ROOTS) + rng.pick(TAG_SUFFIXES);
        return base.split('').map((ch) => {
          const sub = LEET[ch.toLowerCase()];
          return sub && rng.chance(0.6) ? sub : ch;
        }).join('');
      }
      default:
        return `${rng.pick(TAG_PREFIXES)}${rng.pick(TAG_ROOTS)}${rng.pick(TAG_SUFFIXES)}`;
    }
  }

  /** Generate a name nobody currently holds, and reserve it. */
  generateUnique(rng: NameRandom, style?: NameStyle): string {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const candidate = this.generate(rng, style);
      if (!this.reserved.has(candidate.toLowerCase())) {
        this.reserved.add(candidate.toLowerCase());
        return candidate;
      }
    }
    const forced = `${this.generate(rng, style)}${rng.int(1000, 9999)}`;
    this.reserved.add(forced.toLowerCase());
    return forced;
  }

  /** Take a requested name if it is free and legal, else mint a fresh one. */
  claim(requested: string, rng: NameRandom): string {
    const clean = sanitise(requested);
    if (clean && !this.reserved.has(clean.toLowerCase())) {
      this.reserved.add(clean.toLowerCase());
      return clean;
    }
    return this.generateUnique(rng);
  }

  rename(oldName: string, newName: string): { ok: boolean; reason?: string } {
    const clean = sanitise(newName);
    if (!clean) return { ok: false, reason: 'invalid_characters' };
    const key = clean.toLowerCase();
    if (this.reserved.has(key) && key !== oldName.toLowerCase()) {
      return { ok: false, reason: 'name_taken' };
    }
    this.release(oldName);
    this.reserved.add(key);
    return { ok: true };
  }

  release(name: string): void { this.reserved.delete(name.trim().toLowerCase()); }

  reset(): void { this.reserved.clear(); }

  get count(): number { return this.reserved.size; }
}

function sanitise(name: string): string | null {
  const trimmed = name.trim().slice(0, 20);
  if (!/^[a-zA-Z0-9_\- ]{2,20}$/.test(trimmed)) return null;
  return trimmed;
}

/** Maps simulation ids to identities. */
export class IdentityRegistry {
  private readonly byPlayer = new Map<PlayerId, PlayerIdentity>();

  bind(playerId: PlayerId, identity: PlayerIdentity): void {
    this.byPlayer.set(playerId, identity);
  }

  get(playerId: PlayerId): PlayerIdentity | undefined { return this.byPlayer.get(playerId); }

  /** The display name, or the raw id if nothing was registered. */
  nameOf(playerId: PlayerId): string {
    return this.byPlayer.get(playerId)?.displayName ?? playerId;
  }

  release(playerId: PlayerId): void { this.byPlayer.delete(playerId); }

  reset(): void { this.byPlayer.clear(); }

  get all(): IterableIterator<[PlayerId, PlayerIdentity]> { return this.byPlayer.entries(); }
}
