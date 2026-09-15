/**
 * WeaponStats.ts — the server's view of the weapons.
 *
 * DERIVED, NOT RETYPED. The numbers come from the same
 * src/weapons/definitions the client uses, so a balance change to the rifle
 * changes what the rifle does on the server in the same edit. Copying the
 * values here instead would have created exactly the two-sources-of-truth
 * problem this whole migration exists to remove -- and the copy would have
 * looked correct right up until someone retuned one side.
 *
 * Only the combat-relevant fields are projected. The definitions also carry
 * model paths, animation clip names, ADS timings and recoil curves, which are
 * presentation: the server has no opinion about how a reload looks, only how
 * long it makes the weapon unavailable.
 *
 * The definitions import WeaponBase for a TYPE only (erased at compile time)
 * and WeaponProfile, which imports only Constants -- so this whole graph stays
 * renderer-free. The purity check follows those imports and would fail if that
 * ever stopped being true.
 */
import { Rifle } from '../weapons/definitions/Rifle';
import { SMG } from '../weapons/definitions/SMG';
import { Pistol } from '../weapons/definitions/Pistol';
import { Shotgun } from '../weapons/definitions/Shotgun';
import { Sniper } from '../weapons/definitions/Sniper';
import type { WeaponDefinition } from '../weapons/WeaponBase';

export interface ServerWeapon {
  readonly id: string;
  readonly damageNear: number;
  readonly damageFar: number;
  readonly falloffStart: number;
  readonly falloffEnd: number;
  readonly rpm: number;
  readonly automatic: boolean;
  readonly magazineSize: number;
  readonly reserveAmmo: number;
  readonly reloadSeconds: number;
  /** Shotguns fire several rays per trigger pull. */
  readonly pellets: number;
  /** Beyond this the bullet is not simulated at all. */
  readonly maxRange: number;
}

/** How far past the falloff end a bullet still travels. */
const RANGE_BEYOND_FALLOFF = 2.5;

function project(def: WeaponDefinition): ServerWeapon {
  return {
    id: def.id,
    damageNear: def.damageNear,
    damageFar: def.damageFar,
    falloffStart: def.damageFalloffStartDistance,
    falloffEnd: def.damageFalloffEndDistance,
    rpm: def.fireRateRPM,
    automatic: def.fireMode === 'auto',
    magazineSize: def.magazineSize,
    reserveAmmo: def.startingReserveAmmo,
    reloadSeconds: def.reloadTacticalDuration,
    pellets: def.pelletCount ?? 1,
    maxRange: Math.max(60, def.damageFalloffEndDistance * RANGE_BEYOND_FALLOFF),
  };
}

export const SERVER_WEAPONS: Readonly<Record<string, ServerWeapon>> = Object.freeze({
  rifle: project(Rifle),
  smg: project(SMG),
  pistol: project(Pistol),
  shotgun: project(Shotgun),
  sniper: project(Sniper),
});
