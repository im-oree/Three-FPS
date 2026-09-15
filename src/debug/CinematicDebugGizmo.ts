/**
 * CinematicDebugGizmo.ts — Document M §8.2.
 *
 * Live visual iteration tool for the jet launch sequence, toggled with the
 * SAME F4 'debugGizmos' action as OrientationGizmos (one key, all debug
 * gizmos). While enabled:
 *   - the jet's authored path spline is drawn as a world-space polyline,
 *     GREEN when the offline validator passed it, RED when it flagged
 *     issues (so a bad control-point edit is visible immediately, in-level);
 *   - any per-frame anti-clip correction (§7) FLASHES the whole path yellow
 *     for a beat — exactly the signal §8.3 says to treat as a re-tune
 *     request ("each flash marks a shot whose authored offset relied on the
 *     correction instead of being right").
 *
 * Cost when disabled: nothing is built, two event listeners stay idle.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import type InputManager from '../core/InputManager';
import { LAYER } from '../core/RenderLayers';

const FLASH_SECONDS = 0.3;

export class CinematicDebugGizmo {
  private readonly input: InputManager;
  private readonly scene: THREE.Scene;
  private previousToggleDown = false;
  private enabled = false;
  private line: THREE.Line | null = null;
  private flashTimer = 0;
  /** Clean (green) or flagged (red) at draw time — the flash restores it. */
  private pathClean = true;

  constructor(input: InputManager, scene: THREE.Scene) {
    this.input = input;
    this.scene = scene;

    eventBus.on('cinematic:jet:spawned', (p) => {
      if (!this.enabled) return;
      const { path, pathIssueCount } = p as {
        path?: number[]; pathIssueCount?: number;
      };
      this.drawPath(path ?? [], (pathIssueCount ?? 0) === 0);
    });
    eventBus.on('cinematic:ended', () => this.clear());
    eventBus.on('cinematic:jet:antiClipCorrection', () => {
      this.flashTimer = FLASH_SECONDS;
    });
  }

  /** Per-frame tick (Engine registers this as an Updatable). */
  update(dt: number): void {
    const down = this.input.isActionDown('debugGizmos');
    if (down && !this.previousToggleDown) {
      this.enabled = !this.enabled;
      if (!this.enabled) this.clear();
    }
    this.previousToggleDown = down;

    if (this.line && this.flashTimer > 0) {
      this.flashTimer -= dt;
      const material = this.line.material as THREE.LineBasicMaterial;
      material.color.set(this.flashTimer > 0 ? 0xffe14d
        : this.pathClean ? 0x3dff7a : 0xff4d4d);
    }
  }

  private drawPath(samples: number[], clean: boolean): void {
    this.clear();
    this.pathClean = clean;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i + 2 < samples.length; i += 3) {
      pts.push(new THREE.Vector3(samples[i], samples[i + 1], samples[i + 2]));
    }
    if (pts.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const material = new THREE.LineBasicMaterial({
      color: clean ? 0x3dff7a : 0xff4d4d,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    this.line = new THREE.Line(geometry, material);
    this.line.layers.set(LAYER.WORLD);
    this.line.renderOrder = 990;
    this.line.frustumCulled = false;
    this.scene.add(this.line);
  }

  private clear(): void {
    if (!this.line) return;
    this.line.removeFromParent();
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
    this.line = null;
    this.flashTimer = 0;
  }
}

export default CinematicDebugGizmo;
