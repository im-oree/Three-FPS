/**
 * KillstreakManager.ts — Document H §1.2/§1.3: tracking, earning, cooldown
 * and dispatch. Contains ZERO per-streak logic; it looks up a controller
 * class and hands it a context, exactly as WeaponManager relates to weapons.
 *
 * AVAILABILITY (the "no enemies yet" problem)
 * -------------------------------------------
 * A strict kills-required gate would make every killstreak permanently
 * unreachable right now, because nothing in the game can die. So the earning
 * RULE is swappable via KILLSTREAK.EARN_MODE:
 *
 *   'open'  — always available, unlimited uses. Cooldown is STILL enforced,
 *             so the pacing and the HUD's cooling state are real and tested.
 *   'kills' — the shipping rule: gated behind killsRequired, consumed on use.
 *
 * The kill counter is wired and running in BOTH modes; 'open' simply does not
 * consult it for availability. Flipping the mode once AI exists is a one-line
 * change, and nothing else in the framework moves.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import cheatsStore, { CheatId } from '../core/CheatsStore';
import { KILLSTREAK } from '../utils/Constants';
import { DEFAULT_KILLSTREAK_LOADOUT, getKillstreak } from './definitions';
import type { KillstreakDefinition } from './definitions/types';
import type { LevelDefinition } from '../environment/LevelDefinition';
import type {
  KillstreakContext, KillstreakControllerInterface, RadarPlayer,
} from './KillstreakControllerInterface';
import type { AssetLoader } from '../core/AssetLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export type ControllerFactory = () => KillstreakControllerInterface;

export type SlotState =
  | 'locked'     // kills mode, threshold not met
  | 'ready'      // callable right now
  | 'active'     // currently running
  | 'cooling';   // ran recently, waiting out its cooldown

export interface SlotSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly iconLabel: string;
  readonly state: SlotState;
  /** Kills accumulated toward this streak (kills mode). */
  readonly progress: number;
  readonly required: number;
  /** Seconds left of the active duration, or of the cooldown. */
  readonly remaining: number;
  readonly totalForBar: number;
}

interface ActiveEntry {
  definition: KillstreakDefinition;
  controller: KillstreakControllerInterface;
  elapsed: number;
}

export interface KillstreakManagerDeps {
  scene: THREE.Scene;
  assetLoader: AssetLoader;
  physics: PhysicsWorld;
  getPlayerPosition: () => THREE.Vector3;
  getCameraForward: () => THREE.Vector3;
  /** The active level — vehicle cinematics read its airspace metadata. */
  getLevelDefinition: () => LevelDefinition | null;
  /** Every player the server reports, for radar and targeting. */
  getPlayers: () => readonly RadarPlayer[];
}

export class KillstreakManager {
  /** The three equipped streaks, in slot order. */
  /** Three equipped of the four that exist. */
  private loadout: KillstreakDefinition[] = DEFAULT_KILLSTREAK_LOADOUT
    .map((id) => getKillstreak(id))
    .filter(Boolean) as KillstreakDefinition[];
  private readonly factories = new Map<string, ControllerFactory>();
  private readonly active: ActiveEntry[] = [];
  /** id -> seconds of cooldown remaining. */
  private readonly cooldowns = new Map<string, number>();
  private currentStreak = 0;
  private deps: KillstreakManagerDeps | null = null;
  private sinceLastActivation = Infinity;

  attach(deps: KillstreakManagerDeps): void {
    this.deps = deps;
  }

  /** Document H §1.4: register a controller. This map IS the extension point. */
  registerController(name: string, factory: ControllerFactory): void {
    this.factories.set(name, factory);
  }

  start(): void {
    // The kill counter runs in BOTH modes so that flipping EARN_MODE to
    // 'kills' needs no additional wiring — the data is already accurate.
    eventBus.on('combat:hit', (payload) => {
      if ((payload as { isKill?: boolean }).isKill) this.currentStreak += 1;
    });
    eventBus.on('player:died', () => { this.currentStreak = 0; });
    // Leaving a match must not strand an active streak in the next one.
    eventBus.on('level:unloaded', () => this.deactivateAll());
  }

  get streak(): number { return this.currentStreak; }
  get earnMode(): string { return KILLSTREAK.EARN_MODE; }
  get activeCount(): number { return this.active.length; }
  get slots(): readonly KillstreakDefinition[] { return this.loadout; }

  /** Loadout menu hook — choose which three are equipped. */
  setLoadout(ids: readonly string[]): void {
    const picked = ids.map((id) => getKillstreak(id)).filter(Boolean) as KillstreakDefinition[];
    if (picked.length) this.loadout = picked;
  }

  isActive(id: string): boolean {
    return this.active.some((a) => a.definition.id === id);
  }

  /** Seconds of cooldown left, 0 when ready. */
  cooldownRemaining(id: string): number {
    return this.cooldowns.get(id) ?? 0;
  }

  stateOf(id: string): SlotState {
    if (this.isActive(id)) return 'active';
    const def = getKillstreak(id);
    if (!def) return 'locked';
    // Infinite-stuff cheat: killstreaks are simply always ready — no kill
    // threshold and, crucially, no post-run cooldown either. Active stays
    // active (its own timer ends it).
    if (cheatsStore.get(CheatId.INFINITE_STUFF)) return 'ready';
    if (this.cooldownRemaining(id) > 0) return 'cooling';
    if (KILLSTREAK.EARN_MODE === 'kills' && this.currentStreak < def.killsRequired) {
      return 'locked';
    }
    return 'ready';
  }

  /** Everything the HUD needs, computed in one pass. */
  snapshot(): SlotSnapshot[] {
    return this.loadout.map((def) => {
      const state = this.stateOf(def.id);
      let remaining = 0;
      let totalForBar = 1;
      if (state === 'active') {
        const entry = this.active.find((a) => a.definition.id === def.id);
        remaining = entry ? Math.max(0, def.durationSeconds - entry.elapsed) : 0;
        totalForBar = def.durationSeconds || 1;
      } else if (state === 'cooling') {
        remaining = this.cooldownRemaining(def.id);
        totalForBar = def.cooldownSeconds || 1;
      }
      return {
        id: def.id,
        displayName: def.displayName,
        iconLabel: def.iconLabel,
        state,
        progress: Math.min(this.currentStreak, def.killsRequired),
        required: def.killsRequired,
        remaining,
        totalForBar,
      };
    });
  }

  /**
   * Call the streak in `slotIndex`. Returns why it failed, or null on success,
   * so callers (and tests) get a real reason rather than a silent no-op. Every
   * failure ALSO emits `killstreak:denied` so the HUD can flash the slot —
   * gameplay code reaching for a streak must never be met with pure silence
   * ("sometimes the missile doesn't work at all" turns out to be these
   * refusals happening invisibly).
   */
  activate(slotIndex: number): string | null {
    const deny = (reason: string): string => {
      eventBus.emit('killstreak:denied', {
        id: this.loadout[slotIndex]?.id ?? `slot_${slotIndex}`, reason,
      });
      return reason;
    };
    const def = this.loadout[slotIndex];
    if (!def) return deny('no_such_slot');
    if (!this.deps) return deny('not_attached');
    if (this.sinceLastActivation < KILLSTREAK.MIN_ACTIVATION_GAP) return deny('too_soon');

    const state = this.stateOf(def.id);
    if (state === 'locked') return deny('locked');
    if (state === 'active') return deny('already_active');
    if (state === 'cooling') return deny('cooling');
    if (this.active.length >= KILLSTREAK.MAX_CONCURRENT) return deny('too_many_active');

    const factory = this.factories.get(def.controllerClass);
    if (!factory) return deny('no_controller');

    const controller = factory();
    const context: KillstreakContext = {
      definition: def,
      scene: this.deps.scene,
      assetLoader: this.deps.assetLoader,
      physics: this.deps.physics,
      getPlayerPosition: this.deps.getPlayerPosition,
      getCameraForward: this.deps.getCameraForward,
      getLevelDefinition: this.deps.getLevelDefinition,
      getPlayers: this.deps.getPlayers,
      reportEnded: () => this.endStreak(def.id),
    };

    this.active.push({ definition: def, controller, elapsed: 0 });
    this.sinceLastActivation = 0;
    // 'kills' mode consumes the streak; 'open' mode leaves it for reuse.
    if (KILLSTREAK.EARN_MODE === 'kills') this.currentStreak = 0;

    controller.activate(context);
    eventBus.emit('killstreak:activated', { id: def.id, displayName: def.displayName });
    return null;
  }

  private endStreak(id: string): void {
    const index = this.active.findIndex((a) => a.definition.id === id);
    if (index < 0) return;
    const entry = this.active[index];
    this.active.splice(index, 1);
    entry.controller.deactivate();
    // The cooldown starts when the streak ENDS, not when it began.
    this.cooldowns.set(id, entry.definition.cooldownSeconds);
    eventBus.emit('killstreak:ended', { id });
  }

  deactivateAll(): void {
    for (const entry of [...this.active]) this.endStreak(entry.definition.id);
    this.cooldowns.clear();
  }

  update(dt: number): void {
    this.sinceLastActivation += dt;

    for (const [id, remaining] of [...this.cooldowns]) {
      const next = remaining - dt;
      if (next <= 0) {
        this.cooldowns.delete(id);
        eventBus.emit('killstreak:ready', { id });
      } else {
        this.cooldowns.set(id, next);
      }
    }

    for (const entry of [...this.active]) {
      entry.elapsed += dt;
      entry.controller.update(dt);
      // durationSeconds 0 means fire-and-forget: the controller decides when
      // it is done and calls reportEnded() itself.
      if (entry.definition.durationSeconds > 0
          && entry.elapsed >= entry.definition.durationSeconds) {
        this.endStreak(entry.definition.id);
      }
    }
  }

  /**
   * The live controller of a given class, or null. Lets main feed per-frame
   * input to a streak that needs it (the missile) without the manager
   * knowing anything about that streak specifically.
   */
  activeControllerOfType<T extends KillstreakControllerInterface>(
    ctor: abstract new (...args: never[]) => T,
  ): T | null {
    for (const entry of this.active) {
      if (entry.controller instanceof ctor) return entry.controller as T;
    }
    return null;
  }

  /**
   * Debug state from whichever active controller exposes it.
   *
   * Tests need the aircraft's own orbit centre, which moves with the owner;
   * inferring it from a position track breaks the moment the owner walks or
   * respawns. Reading it from the controller is both simpler and honest.
   */
  debugControllerState(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const entry of this.active) {
      const orbit = (entry.controller as { debugOrbit?: unknown }).debugOrbit;
      if (orbit) out[entry.definition.id] = orbit;
    }
    return out;
  }

  /**
   * A NEW MATCH starts clean: no running streaks, no cooldowns, no earned
   * streak count. Called when the player leaves for the main menu and again,
   * defensively, at match entry — a streak state surviving across matches is
   * exactly the "main menu reset doesn't reset anything" bug.
   */
  resetForNewMatch(): void {
    this.deactivateAll();
    this.currentStreak = 0;
    this.sinceLastActivation = Infinity;
  }

  /** Test seam. */
  resetForTest(): void {
    this.resetForNewMatch();
  }
}

export const killstreakManager = new KillstreakManager();
export default killstreakManager;
