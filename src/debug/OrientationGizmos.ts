/**
 * OrientationGizmos.ts — Document C §3.6 in-engine orientation validator.
 *
 * F4 toggles an AxesHelper (red +X, green +Y, blue +Z) on every Socket_* of
 * the equipped weapon and on every arm-rig joint pivot, so orientation bugs
 * (§3 conventions in COORDINATE_CONVENTIONS.md) are visible in-game: a socket
 * whose blue axis doesn't point out the barrel, or a joint whose green axis
 * doesn't run up the limb, is wrong before it can misbehave downstream.
 *
 * Edge-triggered toggle, mirroring Debug (F3). Rebuilds the helper set when
 * the equipped viewmodel changes (weapon:viewmodelEquipped).
 */
import { AxesHelper, type Object3D } from 'three';
import type InputManager from '../core/InputManager';
import eventBus from '../core/EventBus';

const GIZMO_LENGTH = 0.12;
const MATCH = /^(Socket_|.*Pivot$|Hand$)/;

export class OrientationGizmos {
  private readonly input: InputManager;
  private readonly rootsProvider: () => Object3D[];
  private readonly helpers: AxesHelper[] = [];
  private previousToggleDown = false;
  private enabled = false;

  /**
   * @param rootsProvider live accessor for the object trees to instrument
   *   (viewmodel weapon root, hands rig root). Called on every rebuild.
   */
  constructor(input: InputManager, rootsProvider: () => Object3D[]) {
    this.input = input;
    this.rootsProvider = rootsProvider;
    eventBus.on('weapon:viewmodelEquipped', () => {
      if (this.enabled) this.rebuild();
    });
  }

  /** Per-frame tick (Engine registers this as an Updatable). */
  update(): void {
    const down = this.input.isActionDown('debugGizmos');
    if (down && !this.previousToggleDown) {
      this.enabled = !this.enabled;
      if (this.enabled) this.rebuild();
      else this.clear();
    }
    this.previousToggleDown = down;
  }

  /** Debug: outcome of the last rebuild scan. */
  lastScan = { roots: 0, added: 0 };

  private rebuild(): void {
    this.clear();
    this.lastScan = { roots: 0, added: 0 };
    for (const root of this.rootsProvider()) {
      if (!root) continue;
      this.lastScan.roots += 1;
      root.traverse((node) => {
        if (MATCH.test(node.name)) {
          const helper = new AxesHelper(GIZMO_LENGTH);
          node.add(helper);
          this.helpers.push(helper);
          this.lastScan.added += 1;
        }
      });
    }
  }

  private clear(): void {
    for (const helper of this.helpers) helper.removeFromParent();
    this.helpers.length = 0;
  }
}

export default OrientationGizmos;
