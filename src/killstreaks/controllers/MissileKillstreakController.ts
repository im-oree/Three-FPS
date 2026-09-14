/**
 * MissileKillstreakController.ts — Document I §6.
 *
 * Five phases with clean handoffs:
 *   1 designate (tablet map)  2 cinematic launch  3 camera handoff
 *   4 player-steered flight   5 impact, hold, return
 *
 * Everything downstream of impact is REUSED: the shared ExplosionEffect, the
 * shared damage resolver, the shared camera shake. This controller only
 * orchestrates.
 */
import * as THREE from 'three';
import eventBus from '../../core/EventBus';
import inputContexts from '../../core/InputContextStack';
import cinematicCamera from '../../camera/CinematicCameraController';
import cameraShake from '../../camera/CameraShakeController';
import MissileFlightController from '../MissileFlightController';
import VehicleAnimator from '../../vfx/VehicleAnimator';
import { LAYER, setLayerRecursive } from '../../core/RenderLayers';
import { MISSILE } from '../../utils/Constants';
import {
  KillstreakControllerInterface, type KillstreakContext,
} from '../KillstreakControllerInterface';

type Phase = 'idle' | 'launching' | 'flying' | 'impact' | 'returning';

export class MissileKillstreakController extends KillstreakControllerInterface {
  /** Set by the tablet's map designation before activate() runs. */
  static pendingTarget: THREE.Vector3 | null = null;

  private phase: Phase = 'idle';
  private model: THREE.Object3D | null = null;
  private flight: MissileFlightController | null = null;
  private animator: VehicleAnimator | null = null;
  private holdTimer = 0;
  private readonly target = new THREE.Vector3();
  private lookDelta = { x: 0, y: 0 };
  private boosting = false;

  activate(context: KillstreakContext): void {
    this.context = context;
    this.phase = 'launching';
    this.target.copy(
      MissileKillstreakController.pendingTarget ?? context.getPlayerPosition(),
    );
    MissileKillstreakController.pendingTarget = null;

    eventBus.emit('killstreak:missile:launching', {
      x: this.target.x, z: this.target.z,
    });

    void context.assetLoader.loadModel('vehicles/guided_missile.glb').then((model) => {
      if (this.phase !== 'launching' || !this.context) return;
      this.model = model;
      setLayerRecursive(model, LAYER.WORLD);
      context.scene.add(model);
      this.animator = new VehicleAnimator(model, []);

      // Launch HIGH and almost directly above the designated point, with a
      // small standoff so the dive has a direction. The camera starts looking
      // essentially straight down, exactly like the real Predator feed.
      const launch = this.target.clone();
      launch.y += MISSILE.LAUNCH_ALTITUDE;
      launch.z += MISSILE.LAUNCH_STANDOFF;

      const toTarget = this.target.clone().sub(launch);
      const yaw = Math.atan2(-toTarget.x, -toTarget.z);

      this.flight = new MissileFlightController(
        model, context.physics, launch, yaw, MISSILE.START_PITCH,
      );

      const noseCam = model.getObjectByName('Socket_NoseCam');
      const offset = noseCam ? noseCam.position.clone() : new THREE.Vector3(0, 0, -1.2);

      // NO player input anywhere in this sequence — the laptop comes up, the
      // feed cuts in, and control is handed over. The player never navigates
      // a menu, which is the single biggest correction from the first pass.
      cinematicCamera.play([
        { type: 'hold', duration: MISSILE.LAPTOP_RAISE_SECONDS },
        { type: 'attachTo', target: model, localOffset: offset },
        { type: 'hold', duration: MISSILE.HANDOFF_SECONDS },
      ], () => this.beginFlight());
    });
  }

  private beginFlight(): void {
    this.phase = 'flying';
    inputContexts.push('missileControl');
    eventBus.emit('killstreak:missile:flying', {});
  }

  /** Fed by main from the raw mouse delta while in missileControl. */
  setSteering(look: { x: number; y: number }, boosting: boolean): void {
    this.lookDelta = look;
    this.boosting = boosting;
  }

  override update(dt: number): void {
    cinematicCamera.update(dt);

    if (this.phase === 'flying' && this.flight) {
      const result = this.flight.update(dt, this.lookDelta, this.boosting);
      this.lookDelta = { x: 0, y: 0 }; // deltas are per-frame, never carried
      this.animator?.update(dt, true);
      if (this.boosting) cameraShake.addTrauma(MISSILE.BOOST_TRAUMA * dt);

      if (result.impact) this.detonate(result.impact, false);
      else if (result.outOfFuel) {
        // Air-burst rather than flying forever or silently vanishing.
        this.detonate(this.flight.position.clone(), true);
      }
      return;
    }

    if (this.phase === 'impact') {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) this.returnToPlayer();
    }
  }

  private detonate(at: THREE.Vector3, airburst: boolean): void {
    if (this.phase !== 'flying') return;
    this.phase = 'impact';
    this.holdTimer = MISSILE.IMPACT_HOLD_SECONDS;

    // Same event every other explosion uses: visuals, damage and shake all
    // hang off it, and none of them know a missile was involved.
    eventBus.emit('combat:explosion', {
      point: { x: at.x, y: at.y, z: at.z },
      radius: MISSILE.BLAST_RADIUS,
      maxDamage: MISSILE.BLAST_DAMAGE,
      falloffCurve: 'quadratic',
      weaponId: 'guided_missile',
      presetId: airburst ? 'missileAirburst' : 'missileKillstreak',
      shakeScale: 1.6,
    });

    if (this.model) this.model.visible = false;
    this.flight?.dispose();
    this.flight = null;
    eventBus.emit('killstreak:missile:impact', { airburst });
  }

  private returnToPlayer(): void {
    this.phase = 'returning';
    // Hand input back FIRST, then the camera: if the camera restore somehow
    // threw, the player would still be able to move rather than being frozen.
    inputContexts.pop('missileControl');
    cinematicCamera.restore();
    this.context?.reportEnded();
  }

  override get remainingSeconds(): number {
    return this.flight?.fuelSeconds ?? 0;
  }

  /** Test/HUD seam — everything the missile feed displays. */
  get flightState(): {
    phase: Phase; fuel: number; pitch: number;
    altitude: number; heading: number; boosting: boolean;
  } {
    return {
      phase: this.phase,
      fuel: this.flight?.fuelFraction ?? 0,
      pitch: this.flight?.pitchRadians ?? 0,
      altitude: this.flight?.altitudeAboveGround() ?? 0,
      heading: this.flight?.headingDegrees ?? 0,
      boosting: this.boosting,
    };
  }

  deactivate(): void {
    // Always unwind camera and input, whatever phase we died in.
    if (inputContexts.is('missileControl')) inputContexts.pop('missileControl');
    if (cinematicCamera.isActive || cinematicCamera.isDetached) cinematicCamera.cancel();
    this.flight?.dispose();
    this.flight = null;
    if (this.model) {
      this.model.parent?.remove(this.model);
      this.model = null;
    }
    this.animator = null;
    this.phase = 'idle';
    this.context = null;
  }
}

export default MissileKillstreakController;
