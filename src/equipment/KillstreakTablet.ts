/**
 * KillstreakTablet.ts — Document I §2, Document J §4/§5.
 *
 * Calling in a killstreak is a PHYSICAL action: the tablet raises into the
 * left hand, its screen renders live UI, the player cycles with the wheel and
 * holds fire to confirm. Streaks that need a ground point (airstrike, guided
 * missile) then switch the screen to a top-down MAP with a movable cursor,
 * rather than making the player point their gun at the floor.
 *
 * Input ownership transfers via InputContextStack — while the tablet is up the
 * context is 'tabletUI', so WeaponManager never sees the fire button.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import inputContexts from '../core/InputContextStack';
import { TABLET_UI } from '../utils/Constants';
import { killstreakIcon } from '../ui/IconLibrary';
import TabletScreenRenderer from './TabletScreenRenderer';
import {
  drawTabletScreen, TabletScreen,
  type IconImages, type TabletScreenValue, type TabletSnapshot,
} from './TabletUIScreens';
import radarContacts from '../world/RadarContactRegistry';
import { LAYER, setLayerRecursive } from '../core/RenderLayers';
import type { AssetLoader } from '../core/AssetLoader';
import type { KillstreakManager } from '../killstreaks/KillstreakManager';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export interface TabletDeps {
  assetLoader: AssetLoader;
  killstreaks: KillstreakManager;
  physics: PhysicsWorld;
  /** Parent for the viewmodel — the same rig the weapon viewmodel uses. */
  getRigRoot: () => THREE.Object3D | null;
  getPlayerPosition: () => THREE.Vector3;
  getYaw: () => number;
  /** Called with the designated point when a map target is confirmed. */
  onDesignate: (slot: number, point: THREE.Vector3) => void;
  /** Called for streaks that need no target. */
  onActivate: (slot: number) => void;
}

const _down = new THREE.Vector3(0, -1, 0);

export class KillstreakTablet {
  private deps: TabletDeps | null = null;
  private model: THREE.Object3D | null = null;
  private renderer: TabletScreenRenderer | null = null;
  private readonly icons: IconImages = {};

  private raised = false;
  /** 0..1 raise animation blend. */
  private raiseBlend = 0;
  private screen: TabletScreenValue = TabletScreen.SELECT;
  private selectedIndex = 0;
  private confirmProgress = 0;
  private time = 0;

  // Map designation state.
  private readonly cursor = new THREE.Vector3();
  private cursorValid = false;
  private pendingSlot = -1;

  async attach(deps: TabletDeps): Promise<void> {
    this.deps = deps;
    const model = await deps.assetLoader.loadModel('equipment/killstreak_tablet.glb');
    this.model = model;
    model.visible = false;

    const screenMesh = model.getObjectByName('Screen') as THREE.Mesh | undefined;
    if (screenMesh) this.renderer = new TabletScreenRenderer(screenMesh);

    // Pre-decode the icon glyphs once; Canvas2D needs real images.
    for (const slot of deps.killstreaks.slots) {
      const path = killstreakIcon(slot.id);
      if (!path) continue;
      const img = new Image();
      img.src = path;
      await img.decode().catch(() => undefined);
      this.icons[slot.id] = img;
    }

    // The tablet lives on the VIEWMODEL layer like the weapon it sits beside.
    // Without this it defaults to layer 0 (WORLD) and renders in the world
    // pass as well — visible in third person and clipping through geometry,
    // because the world pass has no depth clear.
    setLayerRecursive(model, LAYER.VIEWMODEL);
    const rig = deps.getRigRoot();
    if (rig) rig.add(model);
  }

  get isRaised(): boolean { return this.raised; }
  get currentScreen(): TabletScreenValue { return this.screen; }
  get selected(): number { return this.selectedIndex; }
  get cursorPoint(): THREE.Vector3 { return this.cursor.clone(); }
  get isCursorValid(): boolean { return this.cursorValid; }

  /**
   * SCRIPTED USE (the Call of Duty behaviour). Activating a streak that needs
   * a ground point plays the whole laptop sequence automatically: it raises,
   * shows the map, and the player's ONLY interaction is moving a cursor and
   * clicking a point. There is no menu to navigate, no slot to pick, no
   * confirm to hold — those were a first-pass invention and are gone.
   */
  openForDesignation(slot: number): void {
    if (this.raised || !this.deps) return;
    this.pendingSlot = slot;
    this.selectedIndex = slot;
    this.raised = true;
    this.screen = TabletScreen.MAP;
    if (this.model) this.model.visible = true;
    inputContexts.push('tabletUI');
    const p = this.deps.getPlayerPosition();
    // Start the cursor a little ahead of the player, on the ground.
    this.cursor.set(p.x, p.y, p.z - TABLET_UI.CURSOR_START_AHEAD);
    this.refreshCursorValidity();
    eventBus.emit('tablet:raised', {});
    eventBus.emit('tablet:mapOpened', {});
  }

  toggle(): void {
    if (this.raised) this.lower();
    else this.raise();
  }

  raise(): void {
    if (this.raised || !this.model) return;
    this.raised = true;
    this.screen = TabletScreen.SELECT;
    this.confirmProgress = 0;
    this.model.visible = true;
    inputContexts.push('tabletUI');
    eventBus.emit('tablet:raised', {});
  }

  lower(): void {
    if (!this.raised) return;
    this.raised = false;
    this.confirmProgress = 0;
    this.pendingSlot = -1;
    inputContexts.pop('tabletUI');
    eventBus.emit('tablet:lowered', {});
  }

  /** Jump straight to a slot (a direct key press routed through the tablet). */
  selectSlot(index: number): void {
    if (!this.deps) return;
    const count = this.deps.killstreaks.slots.length;
    if (index < 0 || index >= count) return;
    this.selectedIndex = index;
    this.screen = TabletScreen.SELECT;
    this.confirmProgress = 0;
  }

  /** Wheel input while raised. */
  cycle(direction: number): void {
    if (!this.raised || !this.deps) return;
    if (this.screen === TabletScreen.CONFIRM) {
      // Wheel backs out of a confirm rather than being swallowed.
      this.screen = TabletScreen.SELECT;
      this.confirmProgress = 0;
      return;
    }
    if (this.screen !== TabletScreen.SELECT) return;
    const count = this.deps.killstreaks.slots.length;
    this.selectedIndex = (this.selectedIndex + direction + count) % count;
    eventBus.emit('tablet:tap', {});
  }

  /** Fire pressed while raised — meaning depends on the current screen. */
  primaryPressed(): void {
    if (!this.raised || !this.deps) return;
    if (this.screen === TabletScreen.SELECT) {
      const snapshot = this.deps.killstreaks.snapshot()[this.selectedIndex];
      if (!snapshot || snapshot.state !== 'ready') return;
      this.screen = TabletScreen.CONFIRM;
      this.confirmProgress = 0;
    } else if (this.screen === TabletScreen.MAP) {
      if (!this.cursorValid) return;
      this.screen = TabletScreen.ACTIVATING;
      this.deps.onDesignate(this.pendingSlot, this.cursor.clone());
      window.setTimeout(() => this.lower(), TABLET_UI.ACTIVATING_HOLD_MS);
    }
  }

  /**
   * Move the designation cursor with the MOUSE. The tablet is a pointing
   * device: you push the cursor around the map and click. Sharing WASD with
   * movement was the wrong model and is gone.
   *
   * `dx`/`dy` are raw mouse deltas; the map is fixed-north so screen right is
   * world +X and screen down is world +Z.
   */
  moveCursorByMouse(dx: number, dy: number): void {
    if (this.screen !== TabletScreen.MAP || !this.deps) return;
    const metresPerPixel = TABLET_UI.MAP_RADIUS_METERS / TABLET_UI.MAP_PIXELS;
    this.cursor.x += dx * metresPerPixel * TABLET_UI.CURSOR_GAIN;
    this.cursor.z += dy * metresPerPixel * TABLET_UI.CURSOR_GAIN;
    // Keep the cursor inside the map the screen is actually drawing, so it
    // can never wander somewhere the player cannot see it.
    const p = this.deps.getPlayerPosition();
    const limit = TABLET_UI.MAP_RADIUS_METERS * 0.92;
    this.cursor.x = THREE.MathUtils.clamp(this.cursor.x, p.x - limit, p.x + limit);
    this.cursor.z = THREE.MathUtils.clamp(this.cursor.z, p.z - limit, p.z + limit);
    this.refreshCursorValidity();
  }

  /** Drop the cursor onto the ground and confirm it is on real geometry. */
  private refreshCursorValidity(): void {
    if (!this.deps) { this.cursorValid = false; return; }
    const above = this.cursor.clone();
    above.y += 80;
    const hit = this.deps.physics.castRayStatic(above, _down, 200);
    if (hit) {
      this.cursor.y = hit.point.y;
      this.cursorValid = true;
    } else {
      this.cursorValid = false;
    }
  }

  update(dt: number, confirmHeld: boolean): void {
    this.time += dt;
    // Raise/lower blend drives the viewmodel pose.
    const target = this.raised ? 1 : 0;
    this.raiseBlend += (target - this.raiseBlend)
      * Math.min(1, TABLET_UI.RAISE_RATE * dt);
    if (this.model) {
      this.model.visible = this.raiseBlend > 0.02;
      this.placeViewmodel();
    }

    if (this.raised && this.screen === TabletScreen.CONFIRM) {
      this.confirmProgress = confirmHeld
        ? Math.min(1, this.confirmProgress + dt / TABLET_UI.CONFIRM_HOLD_SECONDS)
        // Releasing decays faster than it fills: a confirm must be deliberate.
        : Math.max(0, this.confirmProgress - dt * 2.5);
      if (this.confirmProgress >= 1) this.completeConfirm();
    }

    this.renderer?.update(dt, (ctx, w, h) => {
      drawTabletScreen(ctx, w, h, this.snapshot(), this.icons);
    });
  }

  private completeConfirm(): void {
    if (!this.deps) return;
    const def = this.deps.killstreaks.slots[this.selectedIndex];
    if (!def) return;
    this.confirmProgress = 0;

    if (def.activationType === 'directional') {
      // Switch to the map so the player designates a point ON THE TABLET,
      // which is the whole reason the device exists.
      this.pendingSlot = this.selectedIndex;
      this.screen = TabletScreen.MAP;
      const p = this.deps.getPlayerPosition();
      this.cursor.set(p.x, p.y, p.z - TABLET_UI.CURSOR_START_AHEAD);
      this.refreshCursorValidity();
      eventBus.emit('tablet:mapOpened', {});
    } else {
      this.screen = TabletScreen.ACTIVATING;
      this.deps.onActivate(this.selectedIndex);
      window.setTimeout(() => this.lower(), TABLET_UI.ACTIVATING_HOLD_MS);
    }
  }

  /**
   * Hold the tablet in the left hand, swinging up from the hip as it raises.
   *
   * The tablet is 0.3 m tall and the viewmodel camera has a very tight near
   * plane, so it must sit WELL forward and to the left or it fills the
   * screen. These offsets put it where a held device actually reads: lower
   * left, angled toward the face, leaving the centre of view clear.
   */
  private placeViewmodel(): void {
    if (!this.model) return;
    const b = this.raiseBlend;
    // Held UP and CLOSE, filling a good share of the lower screen — you are
    // reading a map off it, so it has to be legible. The first pass had it
    // small and far away, which made the cursor useless.
    this.model.position.set(
      -0.02 + b * 0.02,
      -0.32 + b * 0.26,
      -0.30 + b * 0.02,
    );
    this.model.rotation.set(
      (1 - b) * -1.1 + b * -0.22,
      0.30 - b * 0.26,
      (1 - b) * 0.5 + b * 0.04,
    );
    this.model.scale.setScalar(1.25);
  }

  private snapshot(): TabletSnapshot {
    const p = this.deps?.getPlayerPosition() ?? new THREE.Vector3();
    return {
      screen: this.screen,
      slots: this.deps?.killstreaks.snapshot() ?? [],
      selectedIndex: this.selectedIndex,
      confirmProgress: this.confirmProgress,
      cursorX: this.cursor.x,
      cursorZ: this.cursor.z,
      playerX: p.x,
      playerZ: p.z,
      playerYaw: this.deps?.getYaw() ?? 0,
      mapRadius: TABLET_UI.MAP_RADIUS_METERS,
      contacts: radarContacts.getActiveContacts(),
      cursorValid: this.cursorValid,
      time: this.time,
    };
  }
}

export const killstreakTablet = new KillstreakTablet();
export default killstreakTablet;
