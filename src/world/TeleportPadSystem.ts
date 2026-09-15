/**
 * TeleportPadSystem.ts — stand-in teleport pads with a confirmation step.
 *
 * Per the brief: you stand IN a pad, it offers a destination choice and a
 * yes/no confirmation, plays an effect, then moves you.
 *
 * WHY CONFIRM AT ALL
 * A pad that fires the instant you touch it is hostile in a sandbox map —
 * you walk across the hub, get yanked to the airfield, walk back, and get
 * yanked again. Requiring a keypress makes the pad a door rather than a
 * trapdoor, and the destination list means six pads do not have to become
 * thirty.
 *
 * The charge-up is not decoration either: it gives the player a window to
 * step off after committing, and it gives the screen effect somewhere to
 * live so the jump does not read as a dropped frame.
 */
import * as THREE from 'three';
import type { InputManager } from '../core/InputManager';
import type { PlayerController } from '../player/PlayerController';

export interface TeleportDestination {
  readonly id: string;
  readonly label: string;
  /** Where the player lands, and the way they face. */
  readonly position: readonly [number, number, number];
  readonly yaw: number;
  /** Short line under the name, e.g. "runway, hangars, apron". */
  readonly blurb: string;
}

export interface TeleportPad {
  readonly id: string;
  /** Pad centre in world space. */
  readonly position: THREE.Vector3;
  /** Destinations reachable from this pad. */
  readonly destinations: ReadonlyArray<TeleportDestination>;
  /** The visual ring, animated while the player is standing in the pad. */
  ring: THREE.Object3D | null;
}

/** Radius the player must be within to be considered "in" the pad. */
const PAD_RADIUS = 2.4;
/** Seconds the effect runs before the player is actually moved. */
const CHARGE_TIME = 1.1;

type Phase = 'idle' | 'choosing' | 'charging';

export class TeleportPadSystem {
  private readonly pads: TeleportPad[] = [];
  private readonly player: PlayerController;
  private readonly input: InputManager;
  private readonly scene: THREE.Scene;

  private phase: Phase = 'idle';
  private activePad: TeleportPad | null = null;
  private selection = 0;
  private chargeElapsed = 0;
  private pending: TeleportDestination | null = null;

  private readonly ui: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private uiSignature = '';

  /** The expanding ring played during the charge. */
  private effectRing: THREE.Mesh | null = null;
  private effectMaterial: THREE.MeshBasicMaterial | null = null;

  private time = 0;

  constructor(scene: THREE.Scene, player: PlayerController, input: InputManager) {
    this.scene = scene;
    this.player = player;
    this.input = input;

    this.ui = document.createElement('div');
    this.ui.id = 'teleport-ui';
    this.ui.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%',
      'transform:translate(-50%,-50%)',
      'font:600 13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
      'letter-spacing:0.06em', 'color:#eef2f7',
      'background:rgba(6,9,14,0.82)',
      'border:1px solid rgba(120,200,255,0.45)',
      'border-radius:4px', 'padding:16px 22px',
      'pointer-events:none', 'opacity:0', 'min-width:280px',
      'box-shadow:0 0 30px rgba(60,150,220,0.25)',
      'transition:opacity 140ms ease-out',
    ].join(';');

    // Full-screen tint used for the charge/arrival flash. Driven by opacity
    // only, so it never forces a layout.
    this.flash = document.createElement('div');
    this.flash.style.cssText = [
      'position:absolute', 'inset:0',
      'background:radial-gradient(circle at 50% 50%,'
        + 'rgba(140,220,255,0.0) 30%, rgba(90,180,255,0.55) 100%)',
      'pointer-events:none', 'opacity:0',
    ].join(';');

    const root = document.getElementById('ui-root');
    if (root) { root.appendChild(this.flash); root.appendChild(this.ui); }
  }

  /**
   * Register the pads present in the loaded level.
   *
   * Pad transforms are read from the shell .glb by node name, so the map
   * geometry is the single source of truth for where a pad is — moving one
   * in the generator moves it here with no code change.
   */
  bindFromScene(levelRoot: THREE.Object3D, config: ReadonlyArray<{
    id: string;
    destinations: ReadonlyArray<TeleportDestination>;
  }>): number {
    this.pads.length = 0;
    for (const entry of config) {
      const node = levelRoot.getObjectByName(`Teleport_${entry.id}`);
      if (!node) continue;
      const position = new THREE.Vector3();
      node.getWorldPosition(position);
      this.pads.push({
        id: entry.id,
        position,
        destinations: entry.destinations,
        ring: levelRoot.getObjectByName(`TeleportRing_${entry.id}`) ?? null,
      });
    }
    return this.pads.length;
  }

  get padCount(): number { return this.pads.length; }

  /**
   * Read-only pad list, for the acceptance harness.
   *
   * Exposed so the harness can tour the REAL destinations instead of keeping
   * its own copy of the coordinates — a duplicate list silently goes stale
   * the moment a landing spot is retuned.
   */
  get padsForHarness(): ReadonlyArray<TeleportPad> { return this.pads; }
  get isBusy(): boolean { return this.phase !== 'idle'; }

  update(dt: number): void {
    this.time += dt;

    if (this.phase === 'charging') {
      this.updateCharge(dt);
      return;
    }

    const pad = this.findOccupiedPad();

    // Idle ring animation: a slow bob so the pads read as live, and a faster
    // pulse on the one the player is standing in.
    for (const p of this.pads) {
      if (!p.ring) continue;
      const active = p === pad;
      const speed = active ? 4.5 : 1.4;
      const amp = active ? 0.10 : 0.035;
      p.ring.position.y = 0.25 + Math.sin(this.time * speed) * amp;
      p.ring.rotation.z = this.time * (active ? 1.1 : 0.25);
    }

    if (!pad) {
      if (this.phase !== 'idle') this.cancel();
      return;
    }

    if (this.phase === 'idle') {
      this.phase = 'choosing';
      this.activePad = pad;
      this.selection = 0;
    } else if (this.activePad !== pad) {
      // Walked from one pad straight into another.
      this.activePad = pad;
      this.selection = 0;
    }

    this.readChoiceInput(pad);
    this.renderChooser(pad);
  }

  private findOccupiedPad(): TeleportPad | null {
    const p = this.player.getPosition();
    for (const pad of this.pads) {
      const dx = p.x - pad.position.x;
      const dz = p.z - pad.position.z;
      // Vertical check too, or a pad is "occupied" from a bridge above it.
      if (Math.abs(p.y - pad.position.y) > 3) continue;
      if (dx * dx + dz * dz <= PAD_RADIUS * PAD_RADIUS) return pad;
    }
    return null;
  }

  private readChoiceInput(pad: TeleportPad): void {
    const n = pad.destinations.length;
    if (n === 0) return;

    // Cycle with the weapon-slot digits' neighbours would be cryptic; the
    // scroll wheel is the natural "pick from a short list" control and is
    // otherwise unused while standing still.
    const wheel = this.input.getWheelDelta();
    if (wheel !== 0) {
      this.selection = (this.selection + (wheel > 0 ? 1 : -1) + n) % n;
    }

    if (this.input.consumeActionPresses('vehicleEnter') > 0) {
      this.pending = pad.destinations[this.selection];
      this.phase = 'charging';
      this.chargeElapsed = 0;
      this.spawnEffect(pad);
    } else if (this.input.consumeActionPresses('pause') > 0) {
      this.cancel();
    }
  }

  private renderChooser(pad: TeleportPad): void {
    const dest = pad.destinations[this.selection];
    if (!dest) return;

    const signature = `${pad.id}|${this.selection}`;
    if (signature !== this.uiSignature) {
      const rows = pad.destinations.map((d, i) => {
        const on = i === this.selection;
        return `<div style="padding:2px 0;color:${on ? '#8fd8ff' : 'rgba(238,242,247,0.45)'}">`
          + `${on ? '&#9656; ' : '&nbsp;&nbsp;'}${escapeHtml(d.label)}</div>`;
      }).join('');

      this.ui.innerHTML =
        '<div style="color:#8fd8ff;font-size:11px;letter-spacing:0.14em;'
        + 'margin-bottom:8px">TELEPORT PAD</div>'
        + rows
        + `<div style="margin-top:8px;font-size:11px;opacity:0.6">${escapeHtml(dest.blurb)}</div>`
        + '<div style="margin-top:12px;padding-top:9px;'
        + 'border-top:1px solid rgba(255,255,255,0.12);font-size:11px">'
        + '<span style="color:#8fd8ff">[WHEEL]</span> SELECT &nbsp; '
        + '<span style="color:#7fe0a0">[E]</span> CONFIRM &nbsp; '
        + '<span style="color:#ff9a8a">[ESC]</span> CANCEL</div>';
      this.uiSignature = signature;
    }
    this.ui.style.opacity = '1';
  }

  /** The visual effect: an expanding ring plus a screen tint. */
  private spawnEffect(pad: TeleportPad): void {
    if (!this.effectRing) {
      this.effectMaterial = new THREE.MeshBasicMaterial({
        color: 0x8fd8ff, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const geo = new THREE.RingGeometry(0.6, 1.0, 28);
      geo.rotateX(-Math.PI / 2);
      this.effectRing = new THREE.Mesh(geo, this.effectMaterial);
      this.effectRing.renderOrder = 10;
      this.scene.add(this.effectRing);
    }
    this.effectRing.position.copy(pad.position);
    this.effectRing.position.y += 0.2;
    this.effectRing.visible = true;
    this.effectRing.scale.setScalar(0.4);
    this.ui.style.opacity = '0';
    this.uiSignature = '';
  }

  private updateCharge(dt: number): void {
    this.chargeElapsed += dt;
    const t = Math.min(1, this.chargeElapsed / CHARGE_TIME);

    if (this.effectRing && this.effectMaterial) {
      // Ring rushes outward then snaps in at the moment of transit.
      const scale = t < 0.75
        ? 0.4 + t * 4.2
        : THREE.MathUtils.lerp(3.5, 0.2, (t - 0.75) / 0.25);
      this.effectRing.scale.setScalar(scale);
      this.effectRing.rotation.y = t * 6;
      this.effectMaterial.opacity = 0.9 * (1 - t * 0.35);
    }

    this.flash.style.opacity = String(t < 0.8 ? t * 0.7 : (1 - t) * 3.5);

    if (t < 1) return;

    // Transit.
    const dest = this.pending;
    if (dest) {
      this.player.debugTeleport(dest.position[0], dest.position[1], dest.position[2]);
      this.player.debugLook(dest.yaw, 0);
    }
    this.finish();
  }

  private finish(): void {
    this.phase = 'idle';
    this.pending = null;
    this.activePad = null;
    this.chargeElapsed = 0;
    this.ui.style.opacity = '0';
    this.flash.style.opacity = '0';
    this.uiSignature = '';
    if (this.effectRing) this.effectRing.visible = false;
  }

  private cancel(): void {
    this.phase = 'idle';
    this.activePad = null;
    this.pending = null;
    this.ui.style.opacity = '0';
    this.uiSignature = '';
  }

  dispose(): void {
    this.ui.remove();
    this.flash.remove();
    if (this.effectRing) {
      this.scene.remove(this.effectRing);
      this.effectRing.geometry.dispose();
      this.effectMaterial?.dispose();
      this.effectRing = null;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

export default TeleportPadSystem;
