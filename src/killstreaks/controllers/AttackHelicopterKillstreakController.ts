/**
 * AttackHelicopterKillstreakController.ts — Document H §2.3 / Document I §5.
 *
 * Spawns the helicopter, flies a waypoint patrol with banked turns, acquires
 * radar-visible targets with a line-of-sight check, and engages them through
 * the SHARED BallisticsSystem damage path — proving any entity, not just the
 * player, can drive the same pipeline.
 *
 * SCOPE BOUNDARY: the patrol/acquire/engage logic here is deliberately simple
 * and is explicitly a PLACEHOLDER for a future AI document's behaviour tree.
 * What is real and load-bearing today is the seam: the helicopter is a
 * genuine registered hittable that can be shot down, and its lifecycle is
 * driven entirely by the generic killstreak framework.
 */
import * as THREE from 'three';
import eventBus from '../../core/EventBus';
import ballistics from '../../weapons/BallisticsSystem';
import VehicleAnimator, { faceForward } from '../../vfx/VehicleAnimator';
import { HELICOPTER } from '../../utils/Constants';
import {
  KillstreakControllerInterface, type KillstreakContext,
} from '../KillstreakControllerInterface';

const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

interface HeliTarget {
  object: THREE.Object3D;
  takeDamage?: (amount: number, point: THREE.Vector3) => void;
}

export class AttackHelicopterKillstreakController extends KillstreakControllerInterface {
  private model: THREE.Object3D | null = null;
  private animator: VehicleAnimator | null = null;
  private readonly waypoints: THREE.Vector3[] = [];
  private waypointIndex = 0;
  private scanTimer = 0;
  private fireTimer = 0;
  private podToggle = false;
  private engaging: HeliTarget | null = null;
  private elapsed = 0;
  private duration = 45;
  private health = HELICOPTER.HEALTH;
  private readonly desiredQuat = new THREE.Quaternion();

  activate(context: KillstreakContext): void {
    this.context = context;
    this.duration = context.definition.durationSeconds;
    this.elapsed = 0;
    this.health = HELICOPTER.HEALTH;

    // A square patrol loop around the spawn point. A level may later override
    // this via metadata; the fallback is deliberately always valid.
    const centre = context.getPlayerPosition().clone();
    const r = HELICOPTER.PATROL_RADIUS;
    const h = HELICOPTER.ENGAGE_ALTITUDE;
    this.waypoints.length = 0;
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      this.waypoints.push(new THREE.Vector3(centre.x + dx * r, h, centre.z + dz * r));
    }
    this.waypointIndex = 0;

    void context.assetLoader.loadModel('vehicles/attack_helicopter.glb').then((model) => {
      if (!this.context) return;
      this.model = model;
      model.position.copy(this.waypoints[0]);
      this.animator = new VehicleAnimator(model, [
        { nodeName: 'Bone_MainRotorHub', axis: 'y', radiansPerSecond: 26 },
        { nodeName: 'Bone_TailRotorHub', axis: 'y', radiansPerSecond: 48 },
      ]);
      this.animator.snapToFullSpeed();
      context.scene.add(model);

      // The seam that matters: a genuinely destroyable entity on the SAME
      // hittable registry as everything else in the game.
      model.name = 'killstreak_attack_helicopter';
      ballistics.registerHittable(model, {
        surfaceType: 'metal',
        takeDamage: (amount: number) => this.onDamaged(amount),
      });
    });

    eventBus.emit('killstreak:heli:active', { duration: this.duration });
  }

  private onDamaged(amount: number): void {
    this.health -= amount;
    if (this.health <= 0) this.die();
  }

  private die(): void {
    if (!this.model || !this.context) return;
    const p = this.model.position;
    // Destruction reuses the SHARED explosion — no bespoke death VFX.
    eventBus.emit('combat:explosion', {
      point: { x: p.x, y: p.y, z: p.z },
      radius: 8, maxDamage: 0, falloffCurve: 'quadratic',
      weaponId: 'attack_helicopter', presetId: 'rocketLauncher', shakeScale: 1.2,
    });
    this.context.reportEnded();
  }

  override update(dt: number): void {
    this.elapsed += dt;
    this.animator?.update(dt, true);
    if (!this.model) return;

    this.scanTimer += dt;
    if (this.scanTimer >= HELICOPTER.TARGET_SCAN_INTERVAL) {
      this.scanTimer = 0;
      this.acquireTarget();
    }

    if (this.engaging) this.engage(dt);
    else this.patrol(dt);
  }

  private patrol(dt: number): void {
    if (!this.model) return;
    const wp = this.waypoints[this.waypointIndex];
    const toWp = _dir.copy(wp).sub(this.model.position);
    const distance = toWp.length();
    if (distance < 4) {
      this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
      return;
    }
    toWp.normalize();
    this.model.position.addScaledVector(toWp, HELICOPTER.PATROL_SPEED * dt);
    this.faceAlong(toWp, dt, -0.25);
  }

  private engage(dt: number): void {
    if (!this.model || !this.engaging) return;
    this.engaging.object.getWorldPosition(_target);

    // Hold station above and short of the target rather than flying into it.
    const hover = _target.clone();
    hover.y = HELICOPTER.ENGAGE_ALTITUDE;
    const toHover = _dir.copy(hover).sub(this.model.position);
    if (toHover.length() > HELICOPTER.ENGAGE_STANDOFF) {
      toHover.normalize();
      this.model.position.addScaledVector(toHover, HELICOPTER.PATROL_SPEED * dt);
    }

    // Nose onto the target so the pods point the right way.
    const aim = _dir.copy(_target).sub(this.model.position).normalize();
    this.faceAlong(aim, dt, -0.1);

    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    this.fireTimer = 60 / HELICOPTER.MINIGUN_FIRE_RATE_RPM;
    this.fireAtTarget();
  }

  /** Alternate pods, emit a tracer, apply damage through the shared path. */
  private fireAtTarget(): void {
    if (!this.model || !this.engaging) return;
    const podName = this.podToggle ? 'Socket_Muzzle_R' : 'Socket_Muzzle_L';
    this.podToggle = !this.podToggle;
    const pod = this.model.getObjectByName(podName);
    if (pod) pod.getWorldPosition(_muzzle);
    else _muzzle.copy(this.model.position);

    this.engaging.object.getWorldPosition(_target);
    eventBus.emit('combat:tracer', {
      from: [_muzzle.x, _muzzle.y, _muzzle.z] as [number, number, number],
      to: [_target.x, _target.y + 1, _target.z] as [number, number, number],
    });
    this.engaging.takeDamage?.(HELICOPTER.MINIGUN_DAMAGE, _target.clone());
  }

  /** Slerp toward a heading, then bank — a snapping aircraft reads wrong. */
  private faceAlong(dir: THREE.Vector3, dt: number, bank: number): void {
    if (!this.model) return;
    const look = this.model.position.clone().add(dir);
    const current = this.model.quaternion.clone();
    faceForward(this.model, look.x, look.y, look.z, bank);
    this.desiredQuat.copy(this.model.quaternion);
    this.model.quaternion.copy(current);
    this.model.quaternion.slerp(this.desiredQuat, Math.min(1, HELICOPTER.TURN_RATE * dt));
  }

  /**
   * Pick the nearest radar-visible hittable with clear line of sight. Uses the
   * same registry the UAV reads and the same physics the player's bullets use.
   */
  private acquireTarget(): void {
    if (!this.model || !this.context) return;
    let best: HeliTarget | null = null;
    let bestDistance: number = HELICOPTER.ENGAGE_RANGE;

    for (const entry of ballistics.hittables) {
      const meta = entry.metadata as { radarVisible?: boolean; surfaceType?: string };
      if (entry.object === this.model) continue;
      const visible = meta.radarVisible === true || meta.surfaceType === 'dummy';
      if (!visible) continue;

      entry.object.getWorldPosition(_target);
      const distance = this.model.position.distanceTo(_target);
      if (distance >= bestDistance) continue;

      // Line of sight, via the same Rapier query the player's shots use.
      _dir.copy(_target).sub(this.model.position).normalize();
      const hit = this.context.physics.castRayStatic(this.model.position, _dir, distance - 1.2);
      if (hit) continue; // blocked by geometry

      bestDistance = distance;
      best = { object: entry.object, takeDamage: entry.metadata.takeDamage };
    }
    this.engaging = best;
  }

  override get remainingSeconds(): number {
    return Math.max(0, this.duration - this.elapsed);
  }

  deactivate(): void {
    if (this.model) {
      ballistics.unregisterHittable(this.model);
      this.model.parent?.remove(this.model);
      this.model = null;
    }
    this.animator = null;
    this.engaging = null;
    this.context = null;
  }
}

export default AttackHelicopterKillstreakController;
