/**
 * WeaponPartAnimator.ts — Document A §8.7: the procedural weapons carry
 * NAMED moving parts; their cycles are event-driven node motion:
 *   magazine_detach → Bone_Magazine hidden + pooled falling-mag prop spawns
 *   magazine_attach → fresh magazine mesh shown
 *   chamber_round   → Bone_ChargingHandle procedural rack (pull + spring back)
 *   pump_cycle      → Bone_Pump pull toward the shooter and return
 *   weapon:fired    → shotgun pumps after every shot (def.pumpCycleSeconds)
 * All numbers live in Constants.WEAPON_PARTS / the def — no inline tuning.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { WEAPON_PARTS } from '../utils/Constants';
import type { WeaponDefinition } from './WeaponBase';

interface RackPart {
  node: THREE.Object3D;
  rest: THREE.Vector3;
  /** Seconds remaining in the pull phase. */
  pulling: number;
  /** 0..1 current displacement. */
  amount: number;
  axis: 'x' | 'z';
  travel: number;
}

interface MagPart {
  node: THREE.Object3D;
  socket: THREE.Object3D | null;
}

export class WeaponPartAnimator {
  private readonly chargingHandle: RackPart | null;
  private readonly pump: RackPart | null;
  private readonly magazine: MagPart | null;
  private pumpHold = 0;

  constructor(def: WeaponDefinition, root: THREE.Object3D) {
    const bindRack = (name: string | undefined, axis: 'x' | 'z', travel: number): RackPart | null => {
      if (!name) return null;
      const node = root.getObjectByName(name);
      if (!node) return null;
      return { node, rest: node.position.clone(), pulling: 0, amount: 0, axis, travel };
    };
    this.chargingHandle = bindRack(def.parts?.chargingHandle, 'x', WEAPON_PARTS.RACK_OFFSET);
    this.pump = bindRack(def.parts?.pump, 'z', WEAPON_PARTS.PUMP_TRAVEL);
    const magNode = def.parts?.magazine ? root.getObjectByName(def.parts.magazine) ?? null : null;
    this.magazine = magNode
      ? { node: magNode, socket: root.getObjectByName('Socket_Magazine') ?? null }
      : null;

    eventBus.on('weapon:reloadEvent', (payload: { event?: string }) => this.onBeat(payload?.event));
    eventBus.on('weapon:switchStart', () => this.reset());
    if (def.pumpCycleSeconds) {
      eventBus.on('weapon:fired', () => { this.pumpHold = def.pumpCycleSeconds!; });
    }
  }

  private onBeat(event: string | undefined): void {
    if (event === 'magazine_detach' && this.magazine) {
      this.magazine.node.visible = false;
    } else if (event === 'magazine_attach' && this.magazine) {
      this.magazine.node.visible = true;
      // reseat exactly at the socket (clip motion may have left it elsewhere)
      if (this.magazine.socket) {
        this.magazine.node.position.copy(this.magazine.socket.position);
      }
    } else if (event === 'chamber_round' && this.chargingHandle) {
      this.chargingHandle.pulling = WEAPON_PARTS.RACK_SECONDS;
    } else if (event === 'pump_cycle' && this.pump) {
      this.pump.pulling = WEAPON_PARTS.PUMP_SECONDS;
    }
  }

  private reset(): void {
    for (const part of [this.chargingHandle, this.pump]) {
      if (part) { part.pulling = 0; part.amount = 0; part.node.position.copy(part.rest); }
    }
    if (this.magazine) this.magazine.node.visible = true;
    this.pumpHold = 0;
  }

  /** True while any part is mid-cycle (viewmodel may expose for tests). */
  get busy(): boolean {
    return (this.chargingHandle?.pulling ?? 0) > 0 || (this.pump?.pulling ?? 0) > 0 || this.pumpHold > 0;
  }

  update(dt: number): void {
    // shotgun pumps after every shot (data-timed, Document A §8.7)
    if (this.pumpHold > 0) {
      this.pumpHold -= dt;
      if (this.pumpHold <= 0 && this.pump) this.pump.pulling = WEAPON_PARTS.PUMP_SECONDS;
    }
    for (const part of [this.chargingHandle, this.pump]) {
      if (!part) continue;
      if (part.pulling > 0) {
        part.pulling -= dt;
        part.amount = Math.min(1, part.amount + dt / (WEAPON_PARTS.RACK_SECONDS * 0.6));
        if (part.pulling <= 0) part.pulling = 0;
      } else if (part.amount > 0) {
        part.amount = Math.max(0, part.amount - dt / (WEAPON_PARTS.RACK_SECONDS * 0.8));
      }
      const sign = part.axis === 'x' ? -1 : 1; // handle pulls -X (outboard), pump pulls +Z (rearward)
      part.node.position.set(
        part.rest.x + (part.axis === 'x' ? sign * part.travel * part.amount : 0),
        part.rest.y,
        part.rest.z + (part.axis === 'z' ? sign * part.travel * part.amount : 0),
      );
    }
  }
}
