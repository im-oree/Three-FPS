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
import {
  TABLET_SCREEN_ASPECT, TABLET_SCREEN_ASPECT_LANDSCAPE,
  type TabletLiveMap, type WorldExtents,
} from './TabletLiveMap';

export interface TabletDeps {
  assetLoader: AssetLoader;
  killstreaks: KillstreakManager;
  physics: PhysicsWorld;
  /** Parent for the viewmodel — the same rig the weapon viewmodel uses. */
  getRigRoot: () => THREE.Object3D | null;
  getPlayerPosition: () => THREE.Vector3;
  getYaw: () => number;
  /** Live whole-map capture feeding the designation screen (TabletLiveMap). */
  liveMap: TabletLiveMap;
  /** Level bounds for the whole-map view; returns a default if no level is loaded. */
  getWorldExtents: () => WorldExtents;
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
  /** 0..1 roll blend: the device turns LANDSCAPE while the map is open —
   *  the whole-map live view deserves the wide face, CoD-handheld style. */
  private landscapeBlend = 0;

  // Map designation state.
  private readonly cursor = new THREE.Vector3();
  private cursorValid = false;
  private pendingSlot = -1;
  /** Seconds since the device was raised — drives the sci-fi boot screen. */
  private bootElapsed = 0;
  /** Tablet time at which the map screen last appeared — map reveal sweep. */
  private mapOpenedAt = -10;

  async attach(deps: TabletDeps): Promise<void> {
    this.deps = deps;
    const model = await deps.assetLoader.loadModel('equipment/killstreak_tablet.glb');
    this.model = model;
    model.visible = false;

    const screenMesh = model.getObjectByName('Screen') as THREE.Mesh | undefined;
    if (screenMesh) {
      this.renderer = new TabletScreenRenderer(screenMesh);
      this.renderer.bindLiveMapTexture(deps.liveMap.texture);
    }
    deps.liveMap.setWorldExtents(deps.getWorldExtents());

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
  /** 0..1 raise blend — drives the weapon-drop cutoff + the boot sequence. */
  get raiseAmount(): number { return this.raiseBlend; }
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
    this.bootElapsed = 0;
    this.screen = TabletScreen.MAP;
    this.enterMapMode();
    this.mapOpenedAt = this.time + KillstreakTablet.BOOT_SECONDS;
    if (this.model) this.model.visible = true;
    inputContexts.push('tabletUI');
    // Never let a stuck tablet cost the player control of the game.
    inputContexts.guard('tabletUI', TABLET_UI.MAX_OPEN_SECONDS);
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
    this.bootElapsed = 0;
    this.screen = TabletScreen.SELECT;
    this.confirmProgress = 0;
    this.model.visible = true;
    inputContexts.push('tabletUI');
    inputContexts.guard('tabletUI', TABLET_UI.MAX_OPEN_SECONDS);
    eventBus.emit('tablet:raised', {});
  }

  /** Live texture onto the base screen + landscape roll target, with fresh extents. */
  private enterMapMode(): void {
    if (!this.deps) return;
    this.deps.liveMap.setWorldExtents(this.deps.getWorldExtents());
    this.renderer?.setMapMode(true);
  }

  /** Base screen back to dark glass, roll target back to portrait. */
  private exitMapMode(): void {
    this.renderer?.setMapMode(false);
  }

  /** Screen plane aspect the live map must currently match. */
  get displayAspect(): number {
    return this.landscapeBlend > 0.5
      ? TABLET_SCREEN_ASPECT_LANDSCAPE
      : TABLET_SCREEN_ASPECT;
  }

  lower(): void {
    if (!this.raised) return;
    this.raised = false;
    this.confirmProgress = 0;
    this.pendingSlot = -1;
    this.exitMapMode();
    inputContexts.pop('tabletUI');
    eventBus.emit('tablet:lowered', {});
  }

  /**
   * Match-boundary reset: drop the tablet instantly — no blend-out, no events
   * — so a tabled raised the moment the player quit for the menu is never
   * waiting in their face when they re-enter a fresh match.
   */
  forceLower(): void {
    this.raised = false;
    this.confirmProgress = 0;
    this.pendingSlot = -1;
    this.raiseBlend = 0;
    this.screen = TabletScreen.SELECT;
    if (inputContexts.is('tabletUI')) inputContexts.pop('tabletUI');
    if (this.model) this.model.visible = false;
    this.renderer?.markDirty();
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
      const slot = this.pendingSlot;
      const point = this.cursor.clone();
      this.screen = TabletScreen.ACTIVATING;

      // LOWER FIRST, THEN LAUNCH. Launching while the tablet is still raised
      // pushed 'missileControl' on top of 'tabletUI': the missile popped its
      // own context on impact but 'tabletUI' stayed stranded on the stack
      // forever, so the player could never move or look again. The tablet
      // must fully relinquish input before handing off.
      window.setTimeout(() => {
        this.lower();
        this.deps?.onDesignate(slot, point);
      }, TABLET_UI.ACTIVATING_HOLD_MS);
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
    // The whole world map is on screen — cursor speed tracks the view's real
    // width so pointer travel feels identical at every zoom/extents size.
    const view = this.deps.liveMap.getView(this.displayAspect);
    const metresPerPixel = (view.halfWidth * 2) / TABLET_UI.MAP_PIXELS;
    this.cursor.x += dx * metresPerPixel * TABLET_UI.CURSOR_GAIN;
    this.cursor.z += dy * metresPerPixel * TABLET_UI.CURSOR_GAIN;
    // Clamp to the actual level bounds the map is drawing (with a hair of
    // margin), never the player-centred disc the old tablet used.
    const ext = this.deps.getWorldExtents();
    this.cursor.x = THREE.MathUtils.clamp(
      this.cursor.x,
      ext.centerX - ext.halfWidth * 0.97, ext.centerX + ext.halfWidth * 0.97,
    );
    this.cursor.z = THREE.MathUtils.clamp(
      this.cursor.z,
      ext.centerZ - ext.halfHeight * 0.97, ext.centerZ + ext.halfHeight * 0.97,
    );
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
    if (this.raised) this.bootElapsed += dt;
    // Raise/lower blend drives the viewmodel pose.
    const target = this.raised ? 1 : 0;
    this.raiseBlend += (target - this.raiseBlend)
      * Math.min(1, TABLET_UI.RAISE_RATE * dt);
    // Landscape roll blend: the map owns the wide face while it is open —
    // but only after the boot sequence cleared (the intro runs portrait).
    const landscapeTarget = (this.raised && this.screen === TabletScreen.MAP
      && this.bootElapsed >= KillstreakTablet.BOOT_SECONDS) ? 1 : 0;
    this.landscapeBlend += (landscapeTarget - this.landscapeBlend)
      * Math.min(1, TABLET_UI.RAISE_RATE * dt * 0.9);
    if (this.model) {
      this.model.visible = this.raiseBlend > 0.02;
      this.placeViewmodel();
      // The base screen's map texture arrives one frame late when the map
      // opens; push map mode at steady state too (idempotent). The capture's
      // own orientation counter-rolls 1:1 with the device so north stays up.
      this.renderer?.setMapRoll(this.screen === TabletScreen.MAP ? this.landscapeBlend : 0);
      if (this.model.visible && this.screen === TabletScreen.MAP) {
        this.renderer?.setMapMode(true);
      } else if (this.screen !== TabletScreen.MAP && this.raiseBlend <= 0.9) {
        this.renderer?.setMapMode(false);
      }
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
      this.enterMapMode();
      this.mapOpenedAt = this.time;
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
    /**
     * Reading distance, not face distance. The previous pose held the tablet
     * 0.28 m from the eye at 1.25x scale — over a third of the frame height
     * at the base FOV — so its top edge clipped the view and its body slid
     * under the bottom edge ("too close to the camera and going under"). It
     * now settles at roughly arm's length: the whole device, and all four
     * edges of its screen, stay inside the frame at every aspect.
     */
    const L = this.landscapeBlend;
    this.model.position.set(
      -0.02 + b * 0.02 - L * 0.01,
      // Raised portrait sits LOW in the lower third. Landscape sits a touch
      // HIGHER: rolled wide, the screen's footer hint was sliding under the
      // frame's bottom edge at 16:9.
      -0.38 + b * 0.19 + L * 0.048,
      // Swings out from hip-close to reading distance as it comes up.
      -0.30 - b * 0.14,
    );
    this.model.rotation.set(
      (1 - b) * -1.1 + b * -0.44, // tipped back toward the face when raised
      0.30 - b * 0.26,
      (1 - b) * 0.5 + b * 0.04 - L * (Math.PI / 2),
    );
    // Bigger device (the user call): the whole-map live view needs real
    // pixels — portrait ~1.4x, landscape ~1.7x the legacy pose. The pose
    // math above keeps every device edge inside the frame at this scale.
    this.model.scale.setScalar(1.0 + b * 0.42 + L * 0.30);
  }

  private snapshot(): TabletSnapshot {
    const p = this.deps?.getPlayerPosition() ?? new THREE.Vector3();
    const aspect = this.displayAspect;
    const booted = this.bootElapsed >= KillstreakTablet.BOOT_SECONDS;
    return {
      screen: (this.raised && !booted) ? TabletScreen.BOOT : this.screen,
      slots: this.deps?.killstreaks.snapshot() ?? [],
      selectedIndex: this.selectedIndex,
      confirmProgress: this.confirmProgress,
      cursorX: this.cursor.x,
      cursorZ: this.cursor.z,
      playerX: p.x,
      playerZ: p.z,
      playerYaw: this.deps?.getYaw() ?? 0,
      mapRadius: TABLET_UI.MAP_RADIUS_METERS,
      mapView: this.deps?.liveMap.getView(aspect) ?? null,
      landscape: this.landscapeBlend > 0.5,
      contacts: radarContacts.getActiveContacts(),
      cursorValid: this.cursorValid,
      time: this.time,
      bootElapsed: this.bootElapsed,
      mapAge: this.time - this.mapOpenedAt,
    };
  }

  /** Duration of the sci-fi boot sequence the screen plays on every raise. */
  static readonly BOOT_SECONDS = 1.1;
}

export const killstreakTablet = new KillstreakTablet();
export default killstreakTablet;
