/**
 * definitions/index.ts — the one place that knows every weapon.
 *
 * Before this, each consumer (WeaponManager, the loadout menu, the server's
 * WeaponStats) imported the six definition files individually and built its
 * own lookup. That meant adding a weapon was a change in several unrelated
 * files, and forgetting one produced a weapon that existed in the menu but
 * not in the match -- or worse, on the client but not the server.
 *
 * Pure data with no renderer imports, so the server can use it too.
 */
import { Rifle } from './Rifle';
import { SMG } from './SMG';
import { Pistol } from './Pistol';
import { Shotgun } from './Shotgun';
import { Sniper } from './Sniper';
import { RocketLauncher } from './RocketLauncher';
import { Fists } from './Fists';
import type { WeaponDefinition } from '../WeaponBase';

export const ALL_WEAPONS: readonly WeaponDefinition[] = [
  Rifle, SMG, Pistol, Shotgun, Sniper, RocketLauncher, Fists,
];

const BY_ID = new Map<string, WeaponDefinition>(
  ALL_WEAPONS.map((weapon) => [weapon.id, weapon]),
);

/** Look up a weapon by id. Null rather than throwing: ids come from storage. */
export function getWeapon(id: string): WeaponDefinition | null {
  return BY_ID.get(id) ?? null;
}

export { Rifle, SMG, Pistol, Shotgun, Sniper, RocketLauncher, Fists };
