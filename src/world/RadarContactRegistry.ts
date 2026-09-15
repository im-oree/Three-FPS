/**
 * RadarContactRegistry.ts — Document I §3.1.
 *
 * A contact is an abstract data point (position + type), deliberately
 * decoupled from whatever 3D entity it represents. That decoupling is the
 * whole point: the minimap can show a UAV-detected position ping that has no
 * persistent mesh, and a future AI enemy can appear on radar by calling
 * addOrUpdate() once on spawn with zero minimap changes — the same
 * "register once, consumed generically" pattern as registerHittable().
 */
export type ContactType = 'hostile' | 'friendly' | 'objective';

export interface RadarContact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly type: ContactType;
  /** Radians; null when heading is unknown. */
  readonly heading: number | null;
  readonly expiresAt: number;
}

export class RadarContactRegistry {
  private readonly contacts = new Map<string, RadarContact>();

  /**
   * `ttlSeconds` of Infinity means a permanent contact (a spawned enemy);
   * a short TTL means a periodic ping that must visibly refresh, so a stale
   * position disappears rather than lying about where something is.
   */
  addOrUpdate(
    id: string, x: number, z: number, type: ContactType,
    ttlSeconds = Infinity, heading: number | null = null,
  ): void {
    this.contacts.set(id, {
      id, x, z, type, heading,
      expiresAt: ttlSeconds === Infinity
        ? Infinity
        : performance.now() + ttlSeconds * 1000,
    });
  }

  remove(id: string): void {
    this.contacts.delete(id);
  }

  clear(): void {
    this.contacts.clear();
  }

  /** Expired contacts are pruned lazily, on read. */
  getActiveContacts(): RadarContact[] {
    const now = performance.now();
    const out: RadarContact[] = [];
    for (const [id, c] of this.contacts) {
      if (c.expiresAt < now) this.contacts.delete(id);
      else out.push(c);
    }
    return out;
  }

  get size(): number {
    return this.getActiveContacts().length;
  }
}

export const radarContacts = new RadarContactRegistry();
export default radarContacts;
