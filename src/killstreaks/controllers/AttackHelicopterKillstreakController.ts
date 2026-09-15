/**
 * AttackHelicopterKillstreakController.ts — Document H §2.3 / Document I §5.
 *
 * Spawns the gunship, flies a CONTINUOUS ORBIT that follows the player who
 * called it, acquires targets preferring those near that player, and engages
 * them through the SHARED BallisticsSystem damage path — proving any entity,
 * not just the player, can drive the same pipeline.
 *
 * FLIGHT MODEL
 * ------------
 * The previous version flew between four fixed waypoints computed once at
 * activation. Two consequences, both visible in play: the aircraft stopped
 * dead the moment it reached a corner it could not quite touch, and because
 * the corners were baked from the spawn position it drifted permanently out
 * of the fight as the player moved on.
 *
 * This one integrates an ORBIT ANGLE instead of chasing waypoints. The orbit
 * centre eases toward the owner continuously, so the gunship covers the
 * player without ever being stapled to them, and there is no waypoint to
 * arrive at and stall on. Engagement pulls the orbit radius in rather than
 * abandoning the circle, so the aircraft keeps moving while it shoots — a
 * hovering gunship is both trivially shootable and reads as broken.
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
const _desired = new THREE.Vector3();
const _owner = new THREE.Vector3();

interface HeliTarget {
  object: THREE.Object3D;
  takeDamage?: (amount: number, point: THREE.Vector3) => void;
}

export class AttackHelicopterKillstreakController extends KillstreakControllerInterface {
  private model: THREE.Object3D | null = null;
  private animator: VehicleAnimator | null = null;
  /** Centre of the orbit; eases toward the owner every frame. */
  private readonly orbitCentre = new THREE.Vector3();
  /** Current angle around that centre, radians. Integrated, never snapped. */
  private orbitAngle = 0;
  /** Smoothed orbit radius, pulled in when engaging. */
  private orbitRadius = HELICOPTER.PATROL_RADIUS;
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

    // Start the orbit centred on the caller and enter the circle from
    // whichever side the player is facing away from, so the gunship sweeps
    // INTO view rather than materialising in front of them.
    this.orbitCentre.copy(context.getPlayerPosition());
    this.orbitCentre.y = HELICOPTER.ENGAGE_ALTITUDE;
    this.orbitAngle = Math.random() * Math.PI * 2;
    this.orbitRadius = HELICOPTER.PATROL_RADIUS;

    void context.assetLoader.loadModel('vehicles/attack_helicopter.glb').then((model) => {
      if (!this.context) return;
      this.model = model;
      model.position.set(
        this.orbitCentre.x + Math.cos(this.orbitAngle) * this.orbitRadius,
        HELICOPTER.ENGAGE_ALTITUDE,
        this.orbitCentre.z + Math.sin(this.orbitAngle) * this.orbitRadius,
      );
      // Drive the real rotor groups. The Bone_* aliases still exist for
      // compatibility but they are children of these, so spinning the group
      // spins everything mounted on it.
      this.animator = new VehicleAnimator(model, [
        { nodeName: 'Rotor_Main', axis: 'y', radiansPerSecond: 26 },
        { nodeName: 'Rotor_Tail', axis: 'x', radiansPerSecond: 48 },
      ]);

      // A killstreak gunship is always at full RPM, so show the blur discs
      // and hide the discrete blades outright -- four/five blades spinning at
      // 26 rad/s strobe badly at 60 Hz.
      for (const name of ['Blur_Main', 'Blur_Tail']) {
        const blur = model.getObjectByName(name) as THREE.Mesh | undefined;
        if (!blur) continue;
        blur.visible = true;
        const mat = blur.material as THREE.Material & { opacity: number };
        // clone(): this material is per-instance animated state and the .glb
        // hands every clone the same one.
        blur.material = mat.clone();
        (blur.material as THREE.Material & { opacity: number }).opacity = 0.55;
      }
      for (const name of ['Rotor_MainBlades', 'Rotor_TailBlades']) {
        const blades = model.getObjectByName(name);
        if (blades) blades.visible = false;
      }
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

    // A dead target must not keep the gunship circling a corpse.
    if (this.engaging && !this.engaging.object.parent) this.engaging = null;

    this.fly(dt);
    if (this.engaging) this.shoot(dt);
  }

  /**
   * One flight routine for both states.
   *
   * Splitting patrol and engage into separate movement functions is what let
   * the old controller stall: each had its own idea of where the aircraft
   * should be and neither guaranteed progress. Here the orbit always
   * advances; engaging only biases the centre and tightens the radius.
   */
  private fly(dt: number): void {
    if (!this.model || !this.context) return;

    // 1. The orbit centre chases the owner, or the target while engaging.
    _owner.copy(this.context.getPlayerPosition());
    if (this.engaging) {
      this.engaging.object.getWorldPosition(_target);
      // Bias toward the target but stay anchored to the player, so the
      // gunship never wanders the whole map after one distant contact.
      _desired.lerpVectors(_owner, _target, HELICOPTER.ENGAGE_CENTRE_BIAS);
    } else {
      _desired.copy(_owner);
    }
    _desired.y = HELICOPTER.ENGAGE_ALTITUDE;

    // Frame-rate independent easing. Deliberately slow: the gunship should
    // follow the player's general area, not track them like a camera.
    const follow = 1 - Math.exp(-HELICOPTER.FOLLOW_RATE * dt);
    this.orbitCentre.lerp(_desired, follow);

    // 2. Tighten the orbit when engaging so the guns are in range.
    const wantRadius = this.engaging
      ? HELICOPTER.ENGAGE_STANDOFF : HELICOPTER.PATROL_RADIUS;
    this.orbitRadius += (wantRadius - this.orbitRadius)
      * (1 - Math.exp(-HELICOPTER.RADIUS_RATE * dt));

    // 3. Advance the orbit. Angular rate derives from linear speed so the
    //    aircraft flies at a constant airspeed regardless of radius --
    //    a fixed angular rate makes a tight orbit crawl and a wide one race.
    this.orbitAngle += (HELICOPTER.PATROL_SPEED / Math.max(6, this.orbitRadius)) * dt;

    const nextX = this.orbitCentre.x + Math.cos(this.orbitAngle) * this.orbitRadius;
    const nextZ = this.orbitCentre.z + Math.sin(this.orbitAngle) * this.orbitRadius;
    _dir.set(nextX - this.model.position.x, 0, nextZ - this.model.position.z);

    // 4. Move toward the orbit point, capped at the aircraft's top speed, so
    //    a sudden centre jump cannot teleport it.
    const step = HELICOPTER.PATROL_SPEED * dt;
    const travel = _dir.length();
    if (travel > 1e-4) {
      this.model.position.addScaledVector(_dir.normalize(), Math.min(step, travel));
    }

    // 5. Ease altitude separately; terrain and the orbit are independent.
    const targetY = HELICOPTER.ENGAGE_ALTITUDE;
    this.model.position.y += (targetY - this.model.position.y)
      * (1 - Math.exp(-1.5 * dt));

    // 6. Point the nose where it is going, or at the target while engaging,
    //    and bank into the turn.
    if (this.engaging) {
      this.engaging.object.getWorldPosition(_target);
      _dir.copy(_target).sub(this.model.position).normalize();
      this.faceAlong(_dir, dt, -0.12);
    } else if (travel > 1e-4) {
      this.faceAlong(_dir, dt, -0.28);
    }
  }

  /** Trigger discipline, independent of where the aircraft is flying. */
  private shoot(dt: number): void {
    if (!this.model || !this.engaging) return;
    this.engaging.object.getWorldPosition(_target);
    if (this.model.position.distanceTo(_target) > HELICOPTER.ENGAGE_RANGE) return;

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
   * Pick a target, preferring threats NEAR THE OWNER.
   *
   * Nearest-to-the-aircraft was the obvious rule and the wrong one: it made
   * the gunship peel off after whatever happened to drift under its nose,
   * which is the opposite of what a player expects from a streak they called
   * to cover themselves. The score blends both distances, weighted toward the
   * owner, and only falls back to far contacts when nothing is close.
   *
   * Uses the same hittable registry the UAV reads and the same physics query
   * the player's bullets use.
   */
  private acquireTarget(): void {
    if (!this.model || !this.context) return;
    let best: HeliTarget | null = null;
    let bestScore = Infinity;

    _owner.copy(this.context.getPlayerPosition());

    for (const entry of ballistics.hittables) {
      const meta = entry.metadata as { radarVisible?: boolean; surfaceType?: string };
      if (entry.object === this.model) continue;
      const visible = meta.radarVisible === true || meta.surfaceType === 'dummy';
      if (!visible) continue;

      entry.object.getWorldPosition(_target);
      const fromHeli = this.model.position.distanceTo(_target);
      if (fromHeli >= HELICOPTER.ENGAGE_RANGE) continue;

      const fromOwner = _owner.distanceTo(_target);
      if (fromOwner > HELICOPTER.MAX_OWNER_DISTANCE) continue;

      const score = fromHeli + fromOwner * HELICOPTER.OWNER_PROXIMITY_WEIGHT;
      if (score >= bestScore) continue;

      // Line of sight, via the same Rapier query the player's shots use.
      // Checked last because it is by far the most expensive test.
      _dir.copy(_target).sub(this.model.position).normalize();
      const hit = this.context.physics.castRayStatic(this.model.position, _dir, fromHeli - 1.2);
      if (hit) continue; // blocked by geometry

      bestScore = score;
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
