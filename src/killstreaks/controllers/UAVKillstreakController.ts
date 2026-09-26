/**
 * UAVKillstreakController.ts — Document I §4.
 *
 * Orbits a recon drone overhead and periodically pings every radar-visible
 * hittable into RadarContactRegistry, which the minimap renders.
 *
 * Contacts are pushed with a SHORT TTL rather than being held permanently, so
 * they visibly refresh each sweep. Once real AI exists and targets move, a
 * stale contact would otherwise sit lying about a position it left.
 */
import * as THREE from 'three';
import eventBus from '../../core/EventBus';
import ballistics from '../../weapons/BallisticsSystem';
import radarContacts from '../../world/RadarContactRegistry';
import VehicleAnimator, { faceForward } from '../../vfx/VehicleAnimator';
import { UAV_KILLSTREAK } from '../../utils/Constants';
import {
  KillstreakControllerInterface, type KillstreakContext,
} from '../KillstreakControllerInterface';

const _pos = new THREE.Vector3();

export class UAVKillstreakController extends KillstreakControllerInterface {
  private model: THREE.Object3D | null = null;
  private animator: VehicleAnimator | null = null;
  private readonly orbitCentre = new THREE.Vector3();
  private angle = Math.random() * Math.PI * 2;
  private pingTimer = 0;
  private elapsed = 0;
  private duration = 30;

  activate(context: KillstreakContext): void {
    this.context = context;
    this.duration = context.definition.durationSeconds;
    this.orbitCentre.copy(context.getPlayerPosition());
    this.elapsed = 0;

    void context.assetLoader.loadModel('vehicles/uav_drone.glb').then((model) => {
      // The streak may have ended while the model was loading.
      if (!this.context) return;
      this.model = model;
      this.animator = new VehicleAnimator(model, [
        { nodeName: 'Bone_PropHub', axis: 'z', radiansPerSecond: 55 },
      ]);
      this.animator.snapToFullSpeed();
      context.scene.add(model);
      this.place();
    });

    eventBus.emit('killstreak:uav:active', { duration: this.duration });
  }

  private place(): void {
    if (!this.model) return;
    const r = UAV_KILLSTREAK.ORBIT_RADIUS;
    // Level airspace may raise/lower the orbit (Shipment's built-up bowl
    // reads too low at the warehouse default).
    const h = this.context?.getLevelDefinition()?.killstreakAirspace?.uavOrbitHeight
      ?? UAV_KILLSTREAK.ORBIT_HEIGHT;
    this.model.position.set(
      this.orbitCentre.x + Math.cos(this.angle) * r,
      h,
      this.orbitCentre.z + Math.sin(this.angle) * r,
    );
    // Face along the tangent of travel. faceForward() handles the -Z-forward
    // convention; a bare lookAt() aims +Z and flew the drone tail-first.
    const ahead = this.angle + 0.08;
    faceForward(
      this.model,
      this.orbitCentre.x + Math.cos(ahead) * r,
      h,
      this.orbitCentre.z + Math.sin(ahead) * r,
      -0.18,
    );
  }

  override update(dt: number): void {
    this.elapsed += dt;
    this.angle += UAV_KILLSTREAK.ORBIT_SPEED * dt;
    this.animator?.update(dt, true);
    this.place();

    this.pingTimer += dt;
    if (this.pingTimer >= UAV_KILLSTREAK.PING_INTERVAL) {
      this.pingTimer = 0;
      this.pingContacts();
    }
  }

  override get remainingSeconds(): number {
    return Math.max(0, this.duration - this.elapsed);
  }

  /**
   * Sweep the match and push every enemy onto the radar.
   *
   * Players come from the SERVER's player list, which is the only
   * authoritative account of who is in the match and where. This used to
   * read the client's ballistics hittable registry instead -- a list of
   * locally-spawned props -- so a UAV dutifully plotted the Training Range
   * dummies and showed nothing whatsoever for the actual enemies. The one
   * thing a UAV exists to do did not work.
   *
   * Dummies are still swept, because shooting range targets showing up on
   * radar is correct and the Training Range depends on it.
   */
  private pingContacts(): void {
    // Deliberately NOT gated on this.model: the drone mesh loads
    // asynchronously, and the radar sweep is a logical capability of the
    // killstreak, not of its geometry. Gating on the mesh meant the first
    // seconds of every UAV silently produced no contacts at all.
    let pinged = 0;

    for (const player of this.context?.getPlayers() ?? []) {
      // You are not a contact on your own radar, and the dead are not either.
      if (player.isLocal || !player.alive) continue;
      radarContacts.addOrUpdate(
        `player:${player.id}`, player.x, player.z,
        player.isFriendly ? 'friendly' : 'hostile',
        UAV_KILLSTREAK.CONTACT_TTL,
      );
      if (!player.isFriendly) pinged += 1;
    }

    for (const entry of ballistics.hittables) {
      const meta = entry.metadata as { radarVisible?: boolean; surfaceType?: string };
      // A dummy is radar-visible either by explicit flag or by being a dummy.
      const visible = meta.radarVisible === true || meta.surfaceType === 'dummy';
      if (!visible) continue;
      entry.object.getWorldPosition(_pos);
      const id = entry.object.name || `contact_${pinged}`;
      radarContacts.addOrUpdate(
        id, _pos.x, _pos.z, 'hostile', UAV_KILLSTREAK.CONTACT_TTL,
      );
      pinged += 1;
    }
    eventBus.emit('killstreak:uav:enemyPing', { count: pinged });
  }

  deactivate(): void {
    if (this.model) {
      this.model.parent?.remove(this.model);
      this.model = null;
    }
    this.animator = null;
    this.context = null;
    // Contacts expire on their own TTL, but clear now so the radar goes dark
    // the instant the drone leaves rather than lingering for another second.
    radarContacts.clear();
  }
}

export default UAVKillstreakController;
