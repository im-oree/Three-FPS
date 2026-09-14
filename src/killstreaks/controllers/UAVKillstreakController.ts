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
import VehicleAnimator from '../../vfx/VehicleAnimator';
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
    const h = UAV_KILLSTREAK.ORBIT_HEIGHT;
    this.model.position.set(
      this.orbitCentre.x + Math.cos(this.angle) * r,
      h,
      this.orbitCentre.z + Math.sin(this.angle) * r,
    );
    // Face along the tangent of travel; the model is authored -Z forward.
    const ahead = this.angle + 0.08;
    this.model.lookAt(
      this.orbitCentre.x + Math.cos(ahead) * r,
      h,
      this.orbitCentre.z + Math.sin(ahead) * r,
    );
    this.model.rotateZ(-0.18); // bank into the turn
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
   * Sweep every registered hittable and push the radar-visible ones as
   * contacts. With no AI yet, the Training Range dummies stand in — and note
   * the LEVEL file stays completely agnostic of killstreaks: the decision to
   * treat dummies as hostile lives here, in the UAV, not in the level.
   */
  private pingContacts(): void {
    // Deliberately NOT gated on this.model: the drone mesh loads
    // asynchronously, and the radar sweep is a logical capability of the
    // killstreak, not of its geometry. Gating on the mesh meant the first
    // seconds of every UAV silently produced no contacts at all.
    let pinged = 0;
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
