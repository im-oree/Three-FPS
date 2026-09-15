/**
 * GameAudioBindings.ts — Document 5 §9.3.
 *
 * Attaches real AudioManager calls to every pre-existing gameplay event that
 * currently makes no sound. Deliberately a SEPARATE module rather than calls
 * scattered through the gameplay systems: the systems keep emitting events
 * and know nothing about audio, and every sound the game makes is listed in
 * one readable place.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import {
  SOUND_MANIFEST, footstepPathFor, impactKeyFor, landingPathFor,
} from './SoundLibrary';
import type AudioManager from './AudioManager';
import type { WeaponManager } from '../weapons/WeaponManager';

const _v = new THREE.Vector3();

export interface AudioBindingDeps {
  audio: AudioManager;
  weaponManager: WeaponManager;
  getPlayerPosition: () => THREE.Vector3;
  /** Surface tag under the player's feet, for footsteps and landings. */
  getGroundSurface: () => string;
}

/** Resolve a manifest key ('weapon_ar_fire') to its file path. */
function pathOf(key: string): string | null {
  return (SOUND_MANIFEST as Record<string, string>)[key] ?? null;
}

function play2D(audio: AudioManager, key: string | undefined, volume = 1): void {
  if (!key) return;
  const path = pathOf(key);
  if (path) audio.playSound2D(path, { volume, key });
}

export function bindGameAudio(deps: AudioBindingDeps): void {
  const { audio, weaponManager } = deps;

  // --- weapon handling -----------------------------------------------------
  eventBus.on('weapon:fired', () => {
    const def = weaponManager.activeWeapon.def;
    if (def.melee) return; // fists have no report
    play2D(audio, def.soundKeys.fire, 0.85);
  });

  eventBus.on('weapon:reloadStart', (p) => {
    const { isTactical } = p as { isTactical?: boolean };
    const keys = weaponManager.activeWeapon.def.soundKeys;
    play2D(audio, isTactical ? keys.reloadTactical : keys.reloadEmpty, 0.8);
  });

  eventBus.on('weapon:adsStart', () => {
    play2D(audio, weaponManager.activeWeapon.def.soundKeys.adsIn, 0.35);
  });
  eventBus.on('weapon:adsStop', () => {
    play2D(audio, weaponManager.activeWeapon.def.soundKeys.adsOut, 0.3);
  });

  eventBus.on('weapon:switchStart', () => {
    play2D(audio, weaponManager.activeWeapon.def.soundKeys.switchOut, 0.6);
  });
  eventBus.on('weapon:switchComplete', () => {
    play2D(audio, weaponManager.activeWeapon.def.soundKeys.switchIn, 0.6);
  });
  eventBus.on('weapon:emptyFire', () => {
    play2D(audio, weaponManager.activeWeapon.def.soundKeys.emptyClick, 0.7);
  });
  eventBus.on('weapon:inspect', () => {
    play2D(audio, 'weapon_check', 0.6);
  });

  // Document D: pump/bolt racking.
  eventBus.on('weapon:cycleStart', () => {
    const id = weaponManager.activeWeapon.def.id;
    play2D(audio, id === 'sniper' ? 'weapon_bolt_cycle' : 'weapon_pump_cycle', 0.75);
  });

  // --- world ---------------------------------------------------------------
  eventBus.on('player:footstep', (p) => {
    const { surfaceType } = p as { surfaceType?: string };
    const surface = surfaceType ?? deps.getGroundSurface();
    const position = deps.getPlayerPosition();
    audio.playSound3D(footstepPathFor(surface), position, {
      volume: 0.5, refDistance: 4, key: `footstep_${surface}`,
    });
  });

  eventBus.on('player:landed', (p) => {
    // PlayerMovement emits impactVelocity; the surface comes from the same
    // provider the footsteps use, since the event predates surface tagging.
    const { impactVelocity } = p as { impactVelocity?: number };
    const surfaceType = deps.getGroundSurface();
    const position = deps.getPlayerPosition();
    // Scale with fall speed so a hop and a drop do not sound identical.
    const strength = Math.min(1, Math.abs(impactVelocity ?? 4) / 12);
    audio.playSound3D(landingPathFor(surfaceType), position, {
      volume: 0.3 + strength * 0.6, refDistance: 5,
      key: `land_${surfaceType}`,
    });
  });

  eventBus.on('combat:hit', (p) => {
    const { point, surfaceType } = p as
      { point?: { x: number; y: number; z: number }; surfaceType?: string };
    if (!point) return;
    _v.set(point.x, point.y, point.z);
    const key = impactKeyFor(surfaceType ?? 'concrete');
    const path = pathOf(key);
    if (path) audio.playSound3D(path, _v, { volume: 0.7, refDistance: 8, key });
  });

  eventBus.on('combat:explosion', (p) => {
    const { point } = p as { point?: { x: number; y: number; z: number } };
    if (!point) return;
    _v.set(point.x, point.y, point.z);
    const path = pathOf('explosion');
    if (path) audio.playSound3D(path, _v, { volume: 1, refDistance: 30, key: 'explosion' });
  });

  // --- Document M: guided-missile jet launch cinematic ----------------------
  // Approach rumble begins at spawn, BEFORE the jet is in frame — real
  // acoustics arrive before the aircraft does (§4).
  eventBus.on('cinematic:jet:spawned', (p) => {
    const { x, z } = p as { x?: number; z?: number; path?: number[] };
    const path = pathOf('killstreak_jet_approach');
    if (!path || x === undefined || z === undefined) return;
    // The sound source is the entry point (first sampled path point) — far
    // away by construction, so it starts quiet and rises as the jet closes.
    const py = (p as { path?: number[] }).path;
    _v.set(x, py && py.length > 1 ? py[1] : 180, z);
    audio.playSound3D(path, _v, { refDistance: 90, key: 'jet_approach' });
  });
  eventBus.on('cinematic:jet:closepass', (p) => {
    const path = pathOf('killstreak_jet_close');
    const { x, y, z } = p as { x?: number; y?: number; z?: number };
    if (!path || x === undefined || y === undefined || z === undefined) return;
    _v.set(x, y, z);
    audio.playSound3D(path, _v, {
      volume: 1, refDistance: 55, key: 'jet_close',
    });
  });
  // The pylon letting go — a player-triggered beat, heard in the player's
  // ears regardless of where in the sky it happened (§4).
  eventBus.on('cinematic:jet:released', () => {
    play2D(audio, 'missile_release_clunk', 0.9);
  });
  // The motor lights — positional at the missile, mid-whoosh (§6.2).
  eventBus.on('killstreak:missile:ignition', (p) => {
    const { x, y, z } = p as { x?: number; y?: number; z?: number };
    const path = pathOf('missile_ignition_whoosh');
    if (!path || x === undefined || y === undefined || z === undefined) return;
    _v.set(x, y, z);
    audio.playSound3D(path, _v, {
      volume: 1, refDistance: 60, key: 'missile_ignition',
    });
  });

  // --- ambience follows the level -----------------------------------------
  eventBus.on('level:loaded', (p) => {
    const { ambientSoundKey } = p as { ambientSoundKey?: string };
    const path = ambientSoundKey ? pathOf(ambientSoundKey) : null;
    if (path) audio.startAmbience(path, 0.4);
  });
  eventBus.on('level:unloaded', () => audio.stopAmbience());
}

export default bindGameAudio;
