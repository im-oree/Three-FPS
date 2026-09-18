/**
 * CombatSystem.ts — the authoritative answer to "did that shot hit".
 *
 * This is the system that most needs to be server-side. A client that decides
 * its own hits is a client that can claim any hit it likes, and "I shot him
 * first" arguments are unresolvable when both machines believe themselves.
 *
 * The client sends `Fire` in its button mask and nothing else. It does not say
 * what it hit, how far away the target was, or how much damage it did. All of
 * that is derived here from the server's own copy of the world.
 *
 * Weapon numbers come from the shared definitions in src/weapons/definitions,
 * which are pure data with no renderer imports (verified by the purity check).
 * The gun that does 35 damage on screen does 35 damage here, necessarily.
 */
import type { ServerSystem } from '../ServerSystem';
import type { ServerWorld, ServerPlayer, ServerEntity } from '../ServerWorld';
import type { CollisionWorld } from '../CollisionWorld';
import { Button, type EntityId, type PlayerId, type Vec3 } from '../../net/Protocol';
import { PLAYER } from '../../utils/Constants';
import { SERVER_WEAPONS, type ServerWeapon } from '../WeaponStats';
import type { DamageSystem } from './DamageSystem';
import { bodyOfEntity, intersectBody } from '../Bodies';

/**
 * Hit zones as fractions of capsule height, measured from the feet.
 *
 * The client has no hitbox model at all -- it raycasts against whole meshes --
 * so this is new authority rather than a port. Zones are derived from the
 * capsule so they follow crouch height automatically; hard-coded heights
 * would put the head at chest level the moment a player crouched.
 */
const ZONE_HEAD_BOTTOM = 0.86;
const ZONE_LIMB_RADIUS_SCALE = 1.35;
/**
 * The head is its own, much narrower column.
 *
 * Using the body radius for the head band made a shot 45 cm wide of the neck
 * register as a headshot -- the hit zone was a 0.94 m wide slab across the
 * shoulders. A real head is ~22 cm across, so it needs its own radius or
 * headshots are free for anyone aiming vaguely upward.
 */
const HEAD_RADIUS = 0.12;

const MULTIPLIER_HEAD = 2.0;
const MULTIPLIER_TORSO = 1.0;
const MULTIPLIER_LIMB = 0.85;

export type HitZone = 'head' | 'torso' | 'limb';

export interface ShotResult {
  readonly shooter: PlayerId;
  readonly victim: PlayerId | EntityId | null;
  readonly zone: HitZone | null;
  readonly damage: number;
  readonly distance: number;
  readonly point: Vec3;
  readonly lethal: boolean;
}

interface WeaponState {
  /** Seconds until the weapon can fire again. */
  cooldown: number;
  ammo: number;
  reserve: number;
  reloading: number;
  /** Whether Fire was held last tick, for semi-auto edge detection. */
  triggerHeld: boolean;
}

export class CombatSystem implements ServerSystem {
  readonly name = 'combat';

  private readonly weapons = new Map<PlayerId, WeaponState>();
  /** Which weapon id each player last fired, for resupply caps. */
  private readonly loadoutIds = new Map<PlayerId, string>();
  /** Shots resolved this tick, exposed for tests and scoring. */
  private readonly resolved: ShotResult[] = [];

  constructor(
    private readonly collision: CollisionWorld,
    /**
     * Every point of damage in the world goes through here. Combat does not
     * subtract health itself: friendly fire, regeneration timers and death
     * reporting are one shared set of rules, not per-system copies.
     */
    private readonly damage: DamageSystem,
  ) {}

  get lastShots(): readonly ShotResult[] { return this.resolved; }

  reset(): void {
    this.weapons.clear();
    this.resolved.length = 0;
  }

  tick(dt: number, world: ServerWorld): void {
    this.resolved.length = 0;

    for (const player of world.allPlayers) {
      const weapon = this.weaponFor(player);
      const state = this.stateFor(player.id, weapon);

      state.cooldown = Math.max(0, state.cooldown - dt);
      if (state.reloading > 0) {
        state.reloading -= dt;
        if (state.reloading <= 0) this.finishReload(state, weapon);
        continue;
      }

      if (!player.alive) continue;

      // Buttons come from the latest input the movement system consumed. A
      // dead or vehicle-bound player does not shoot from their own hands.
      const buttons = player.lastButtons;
      const firing = (buttons & Button.Fire) !== 0;
      const reloading = (buttons & Button.Reload) !== 0;

      if (reloading && state.ammo < weapon.magazineSize && state.reserve > 0) {
        state.reloading = weapon.reloadSeconds;
        state.triggerHeld = firing;
        continue;
      }

      const canFire = weapon.automatic ? firing : firing && !state.triggerHeld;
      state.triggerHeld = firing;

      if (!canFire || state.cooldown > 0) continue;
      if (state.ammo <= 0) {
        // Auto-reload on a dry trigger, as the client does.
        if (state.reserve > 0) state.reloading = weapon.reloadSeconds;
        continue;
      }

      state.ammo -= 1;
      state.cooldown = 60 / weapon.rpm;
      this.fire(player, weapon, world);
    }
  }

  /** Resolve one bullet from a player's eye along their look direction. */
  private fire(shooter: ServerPlayer, weapon: ServerWeapon, world: ServerWorld): void {
    const eye: Vec3 = [
      shooter.px,
      shooter.py + shooter.height - PLAYER.EYE_OFFSET_FROM_TOP,
      shooter.pz,
    ];
    const dir = forwardFrom(shooter.yaw, shooter.pitch);

    // Geometry first: a wall between shooter and target stops the bullet, so
    // the maximum useful range is however far the ray travels before a wall.
    const wall = this.collision.raycast(eye, dir, weapon.maxRange);
    const limit = wall ? wall.distance : weapon.maxRange;

    // Then bodies, nearest first, but only those in front of the wall.
    //
    // Entities are tested with the same ray as players. Before this, a
    // helicopter was invincible scenery: bullets went straight through
    // anything that was not a player, so no killstreak could ever be shot
    // down and the training dummies could not be shot at all.
    let bestEntity: { entity: ServerEntity; distance: number } | null = null;
    for (const entity of world.allEntities) {
      if (entity.owner === shooter.id && entity.kind === 'care_package') continue;
      const body = bodyOfEntity(entity);
      if (!body) continue;
      const distance = intersectBody(eye, dir, body, limit);
      if (distance === null) continue;
      if (!bestEntity || distance < bestEntity.distance) {
        bestEntity = { entity, distance };
      }
    }

    let best: { player: ServerPlayer; distance: number; zone: HitZone } | null = null;
    for (const target of world.allPlayers) {
      if (target.id === shooter.id || !target.alive) continue;
      const hit = intersectPlayer(eye, dir, target, limit);
      if (!hit) continue;
      if (!best || hit.distance < best.distance) {
        best = { player: target, distance: hit.distance, zone: hit.zone };
      }
    }

    // An entity in front of the nearest player takes the bullet instead.
    if (bestEntity && (!best || bestEntity.distance < best.distance)) {
      const point: Vec3 = [
        eye[0] + dir[0] * bestEntity.distance,
        eye[1] + dir[1] * bestEntity.distance,
        eye[2] + dir[2] * bestEntity.distance,
      ];
      world.raiseFx({ t: 'tracer', from: eye, to: point, weaponId: weapon.id });
      const outcome = this.damage.apply(world, {
        target: bestEntity.entity,
        targetKind: 'entity',
        amount: falloffDamage(weapon, bestEntity.distance),
        type: 'bullet',
        source: shooter.id,
        at: point,
        weaponId: weapon.id,
        capabilityId: 'Shoot',
      });
      world.raiseFx({ t: 'hitMarker', lethal: outcome.lethal });
      this.resolved.push({
        shooter: shooter.id, victim: null, zone: null, damage: outcome.applied,
        distance: bestEntity.distance, point, lethal: false,
      });
      return;
    }

    if (!best) {
      // A miss still produces effects: a tracer, and an impact if it hit
      // geometry. The client renders those; it does not invent them.
      const end: Vec3 = wall
        ? wall.point
        : [eye[0] + dir[0] * limit, eye[1] + dir[1] * limit, eye[2] + dir[2] * limit];
      world.raiseFx({ t: 'tracer', from: eye, to: end, weaponId: weapon.id });
      if (wall) {
        world.raiseFx({ t: 'impact', at: wall.point, normal: wall.normal, surface: wall.surface });
      }
      this.resolved.push({
        shooter: shooter.id, victim: null, zone: null, damage: 0,
        distance: limit, point: end, lethal: false,
      });
      return;
    }

    const raw = Math.round(
      falloffDamage(weapon, best.distance) * zoneMultiplier(best.zone),
    );
    const victim = best.player;

    const point: Vec3 = [
      eye[0] + dir[0] * best.distance,
      eye[1] + dir[1] * best.distance,
      eye[2] + dir[2] * best.distance,
    ];
    world.raiseFx({ t: 'tracer', from: eye, to: point, weaponId: weapon.id });

    const outcome = this.damage.apply(world, {
      target: victim,
      targetKind: 'player',
      amount: raw,
      type: 'bullet',
      source: shooter.id,
      at: point,
      zone: best.zone,
      weaponId: weapon.id,
      capabilityId: 'Shoot',
    });

    // A blocked hit (friendly fire) still drew a tracer, but it must not
    // report a hit marker or a damage number -- the shooter needs to see
    // that nothing happened.
    if (outcome.blocked) {
      this.resolved.push({
        shooter: shooter.id, victim: null, zone: null, damage: 0,
        distance: best.distance, point, lethal: false,
      });
      return;
    }

    world.raiseFx({ t: 'hitMarker', lethal: outcome.lethal });

    this.resolved.push({
      shooter: shooter.id, victim: victim.id, zone: best.zone,
      damage: outcome.applied, distance: best.distance, point,
      lethal: outcome.lethal,
    });
  }

  private weaponFor(player: ServerPlayer): ServerWeapon {
    const id = player.loadout?.primaryId ?? 'rifle';
    this.loadoutIds.set(player.id, id);
    return SERVER_WEAPONS[id] ?? SERVER_WEAPONS.rifle;
  }

  /**
   * A fresh life gets a fresh weapon: full magazine, full reserve, nothing
   * mid-reload. Without this, ammunition carried across deaths and the whole
   * lobby eventually ran dry.
   */
  onPlayerSpawn(id: PlayerId): void {
    this.weapons.delete(id);
  }

  /** Current magazine and reserve, for the HUD and for tests. */
  ammoOf(id: PlayerId): { ammo: number; reserve: number } {
    const state = this.weapons.get(id);
    if (!state) {
      const weapon = SERVER_WEAPONS[this.loadoutIds.get(id) ?? 'rifle'] ?? SERVER_WEAPONS.rifle;
      return { ammo: weapon.magazineSize, reserve: weapon.reserveAmmo };
    }
    return { ammo: state.ammo, reserve: state.reserve };
  }

  /**
   * Scavenge from a kill, the way a player picks the dead man's gun up.
   *
   * Without any resupply a long life ends with the player standing in the
   * open holding an empty rifle: bots that ran dry stayed in Engage forever,
   * unable to shoot and unwilling to do anything else, and the match's kill
   * rate flatlined. Topping the reserve up on a kill is Call of Duty's own
   * answer (Scavenger, and simply walking over the body) and it keeps a
   * good player armed without ever granting infinite ammunition.
   */
  resupplyOnKill(id: PlayerId): void {
    const state = this.weapons.get(id);
    if (!state) return;
    const weapon = SERVER_WEAPONS[this.loadoutIds.get(id) ?? 'rifle'] ?? SERVER_WEAPONS.rifle;
    state.reserve = Math.min(weapon.reserveAmmo, state.reserve + weapon.magazineSize);
  }

  private stateFor(id: PlayerId, weapon: ServerWeapon): WeaponState {
    let state = this.weapons.get(id);
    if (!state) {
      state = {
        cooldown: 0,
        ammo: weapon.magazineSize,
        reserve: weapon.reserveAmmo,
        reloading: 0,
        triggerHeld: false,
      };
      this.weapons.set(id, state);
    }
    return state;
  }

  private finishReload(state: WeaponState, weapon: ServerWeapon): void {
    const needed = weapon.magazineSize - state.ammo;
    const taken = Math.min(needed, state.reserve);
    state.ammo += taken;
    state.reserve -= taken;
    state.reloading = 0;
  }

  /** Ammo state, so the HUD can show the server's count rather than its own. */
  ammoFor(id: PlayerId): { ammo: number; reserve: number; reloading: boolean } | null {
    const state = this.weapons.get(id);
    if (!state) return null;
    return { ammo: state.ammo, reserve: state.reserve, reloading: state.reloading > 0 };
  }
}

// --- geometry ---------------------------------------------------------------

/** Look direction from yaw/pitch, matching the movement system's convention. */
export function forwardFrom(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch];
}

/** Damage after distance falloff, linear between the near and far distances. */
export function falloffDamage(weapon: ServerWeapon, distance: number): number {
  if (distance <= weapon.falloffStart) return weapon.damageNear;
  if (distance >= weapon.falloffEnd) return weapon.damageFar;
  const t = (distance - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart);
  return weapon.damageNear + (weapon.damageFar - weapon.damageNear) * t;
}

export function zoneMultiplier(zone: HitZone): number {
  if (zone === 'head') return MULTIPLIER_HEAD;
  if (zone === 'limb') return MULTIPLIER_LIMB;
  return MULTIPLIER_TORSO;
}

/**
 * Ray against a player's capsule, returning the nearest hit and its zone.
 *
 * The capsule is treated as a vertical cylinder: exact enough at the scale a
 * bullet cares about, and far cheaper than a true capsule test, which matters
 * when it runs per bullet per player per tick.
 */
export function intersectPlayer(
  origin: Vec3, dir: Vec3, target: ServerPlayer, maxDistance: number,
): { distance: number; zone: HitZone } | null {
  const feet = target.py;
  const top = target.py + target.height;
  const headBottom = feet + target.height * ZONE_HEAD_BOTTOM;

  // Two stacked columns: a narrow head above, the wider body below. Testing
  // them separately is what stops a shoulder-height shot counting as a head.
  const head = intersectColumn(
    origin, dir, target.px, target.pz, HEAD_RADIUS, headBottom, top, maxDistance,
  );
  const body = intersectColumn(
    origin, dir, target.px, target.pz,
    PLAYER.CAPSULE_RADIUS * ZONE_LIMB_RADIUS_SCALE,
    feet, headBottom, maxDistance,
  );

  // Whichever the bullet reaches first.
  if (head !== null && (body === null || head <= body)) {
    return { distance: head, zone: 'head' };
  }
  if (body === null) return null;

  const y = origin[1] + dir[1] * body;
  const fraction = (y - feet) / Math.max(0.01, target.height);
  return { distance: body, zone: fraction < 0.45 ? 'limb' : 'torso' };
}

/** Ray against a vertical cylinder segment. Returns entry distance or null. */
function intersectColumn(
  origin: Vec3, dir: Vec3,
  cx: number, cz: number, radius: number,
  bottom: number, top: number,
  maxDistance: number,
): number | null {
  const dx = origin[0] - cx;
  const dz = origin[2] - cz;

  const a = dir[0] * dir[0] + dir[2] * dir[2];
  if (a < 1e-9) {
    // Straight up or down: inside the radius means it passes through.
    if (dx * dx + dz * dz > radius * radius) return null;
    const t = dir[1] > 0 ? (bottom - origin[1]) / dir[1] : (top - origin[1]) / dir[1];
    return t >= 0 && t <= maxDistance ? t : null;
  }
  const b = 2 * (dx * dir[0] + dz * dir[2]);
  const c = dx * dx + dz * dz - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrt = Math.sqrt(discriminant);
  for (const t of [(-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a)]) {
    if (t < 0 || t > maxDistance) continue;
    const y = origin[1] + dir[1] * t;
    if (y >= bottom && y <= top) return t;
  }
  return null;
}
