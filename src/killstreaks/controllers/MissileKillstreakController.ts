/**
 * MissileKillstreakController.ts — Document M (supersedes Document I §6.2–6.4's
 * simplified "spawn missile directly above target" launch).
 *
 * Five phases with clean handoffs:
 *   1 designate (tablet map)          2 fighter-jet cinematic launch (~4.3s)
 *   3 player-steered flight           4 impact, hold   5 return
 *
 * The launch phase IS the Document M choreographed sequence:
 *   shot 1 (0.0–1.3) establishing wide dolly    shot 2 (1.3–2.6) chase cam
 *   shot 3 (2.6–3.0) release + whip-pan         shot 4 (3.0–4.3) swoop-in
 *   shot 5 (4.3)     seat into the nose socket + control handoff
 * The jet enters at cruise altitude, banks DOWN to release altitude directly
 * above the designated point, drops the missile (velocity inheritance +
 * free-fall, Document M §6), and climbs away. Player control begins at the
 * seat — which is always AFTER motor ignition (§6.3).
 *
 * Sequencing notes (hard-won):
 *  - Input is locked the INSTANT the streak activates ('cinematic' context),
 *    not only once steering begins — otherwise WASD/mouse keep working during
 *    the launch shots and arrive mid-handoff.
 *  - The camera is driven per-frame (CinematicCameraController manual mode)
 *    because the chase/whip/swoop shots read the JET's live position, which
 *    only exists at runtime — no pre-baked camera path can follow it.
 *  - The anti-clipping layer (camera §7) corrects every driven frame against
 *    static geometry; the offline validator (§8.1) and repro prove it is
 *    never actually needed for the authored paths (zero corrections).
 */
import * as THREE from 'three';
import eventBus from '../../core/EventBus';
import inputContexts from '../../core/InputContextStack';
import cinematicCamera from '../../camera/CinematicCameraController';
import cameraShake from '../../camera/CameraShakeController';
import MissileFlightController from '../MissileFlightController';
import VehicleAnimator from '../../vfx/VehicleAnimator';
import JetFlightController from '../JetFlightController';
import JetVFX from '../JetVFX';
import { buildJetFlightPath, type JetFlightPath } from '../JetFlightPathBuilder';
import { validateCinematicPath } from '../CinematicPathValidator';
import { LAYER, setLayerRecursive } from '../../core/RenderLayers';
import { JET_CINEMATIC, MISSILE } from '../../utils/Constants';
import {
  KillstreakControllerInterface, type KillstreakContext,
} from '../KillstreakControllerInterface';

type Phase = 'idle' | 'launching' | 'flying' | 'impact' | 'returning';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

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

  // ---------------- Document M launch sequence state -----------------------
  private jet: THREE.Object3D | null = null;
  private jetFlight: JetFlightController | null = null;
  private jetVfx: JetVFX | null = null;
  private path: JetFlightPath | null = null;
  private sequenceStarted = false;
  private sequenceElapsed = 0;
  private missileReleased = false;
  private seated = false;
  private jetRemoved = false;
  private closePassPlayed = false;

  activate(context: KillstreakContext): void {
    this.context = context;
    this.phase = 'launching';
    this.sequenceStarted = false;
    this.sequenceElapsed = 0;
    this.missileReleased = false;
    this.seated = false;
    this.jetRemoved = false;
    this.closePassPlayed = false;
    this.loadWait = 0;
    this.target.copy(
      MissileKillstreakController.pendingTarget ?? context.getPlayerPosition(),
    );
    MissileKillstreakController.pendingTarget = null;

    // Lock the player out immediately — the launch cinematic OWNS the frame
    // from here, through the nose-cam handoff, until impact return.
    inputContexts.push('cinematic');
    inputContexts.guard('cinematic', MISSILE.CONTROL_HARD_CEILING_SECONDS);

    eventBus.emit('killstreak:missile:launching', {
      x: this.target.x, z: this.target.z,
    });

    // Author the banking arc NOW (§3): path needs the designated point and a
    // player position, both fixed at designation time, not load time.
    try {
      this.path = buildJetFlightPath(
        context.getLevelDefinition(), this.target, context.getPlayerPosition(),
      );
    } catch (err) {
      // NEVER softlock: designation already locked input, so any failure here
      // must hand control straight back and end the streak (see abortLaunch).
      console.error('[missile] jet path authoring failed', err);
      this.abortLaunch();
      return;
    }

    // §8.1: deterministic clip check of the candidate spline BEFORE anything
    // renders. Clean is the rule (the gizmo + repro gate on it); any issue is
    // loud — the runtime anti-clip layer stays the in-flight safety net.
    let pathIssues: ReturnType<typeof validateCinematicPath> = [];
    try {
      pathIssues = validateCinematicPath(
        this.path.curve, context.physics, this.path.jetBoundingRadius,
      );
    } catch (err) {
      console.warn('[missile] path validation failed to run (non-fatal)', err);
    }
    if (pathIssues.length > 0) {
      console.warn(
        `[missile] jet path has ${pathIssues.length} clip issue(s):
`
        + pathIssues.map((i) => `  ${i.type} ${i.detail}`).join('\n'),
      );
    }

    void Promise.all([
      context.assetLoader.loadModel('vehicles/fighter_jet.glb'),
      context.assetLoader.loadModel('vehicles/guided_missile.glb'),
    ]).then(([jet, missile]) => {
      // The streak may have been shut down (or the level unloaded) while the
      // GLBs decoded — spawn NOTHING in that case.
      if (this.phase !== 'launching' || !this.context || !this.path) return;

      // --- the jet ----------------------------------------------------------
      this.jet = jet;
      setLayerRecursive(jet, LAYER.WORLD);
      context.scene.add(jet);
      this.jetFlight = new JetFlightController(
        jet, this.path.curve, JET_CINEMATIC.FLIGHT_DURATION,
      );
      this.jetVfx = new JetVFX(jet, context.assetLoader);
      jet.position.copy(this.path.entryPoint);

      // --- the missile rides the pylon (random side, visual variety, §2) ----
      const socketName = Math.random() > 0.5
        ? 'Socket_MissilePylon_L' : 'Socket_MissilePylon_R';
      const pylon = jet.getObjectByName(socketName) ?? jet;
      this.model = missile;
      setLayerRecursive(missile, LAYER.WORLD);
      // The missile builder's nose is -Z; the jet's nose is +Z — yaw-flip the
      // rider so both point the same way downrange.
      missile.rotation.y = Math.PI;
      missile.position.set(0, 0, 0);
      pylon.add(missile);
      this.animator = new VehicleAnimator(missile, []);

      this.sequenceStarted = true;
      cinematicCamera.beginManual();

      // The gizmo (§8.2) and the offline validator share this sampled path.
      const samples: number[] = [];
      for (let i = 0; i <= 60; i += 1) {
        const p = this.path.curve.getPointAt(i / 60);
        samples.push(p.x, p.y, p.z);
      }
      eventBus.emit('cinematic:jet:spawned', {
        x: this.target.x, z: this.target.z, path: samples,
        pathIssueCount: pathIssues.length,
      });
    }).catch((err: unknown) => {
      // NEVER softlock (the user-visible failure this guards): a rejected
      // load once left 'cinematic' pushed forever — tablet up, no movement,
      // no camera. Any failure past designation unwinds cleanly instead.
      console.error('[missile] launch sequence failed to start', err);
      this.abortLaunch();
    });
  }

  /** Watchdog seconds with no sequence start before the launch is aborted. */
  private static readonly LOAD_WATCHDOG_SECONDS = 6;
  private loadWait = 0;

  /**
   * The failure-unwind shared by every "the cinematic cannot begin" path:
   * give input back, restore any camera detach, end the streak. Any caller
   * failure BEFORE this point must be loud (console.error) — silent streaks
   * die here but never take the player's controls hostage again.
   */
  private abortLaunch(): void {
    if (this.phase !== 'launching') return;
    if (inputContexts.is('missileControl')) inputContexts.pop('missileControl');
    if (inputContexts.is('cinematic')) inputContexts.pop('cinematic');
    if (cinematicCamera.isActive || cinematicCamera.isDetached) cinematicCamera.cancel();
    this.phase = 'returning';
    this.context?.reportEnded();
  }

  /** Fed by main from the raw mouse delta while in missileControl. */
  setSteering(look: { x: number; y: number }, boosting: boolean): void {
    this.lookDelta = look;
    this.boosting = boosting;
  }

  override update(dt: number): void {
    if (this.phase === 'launching') {
      if (this.sequenceStarted) {
        this.updateLaunchSequence(dt);
      } else {
        // Watchdog: the GLB loads should resolve in well under a second once
        // warm, but a failed decode must never strand the player in the input
        // lock (the softlock this watchdog exists to kill).
        this.loadWait += dt;
        if (this.loadWait > MissileKillstreakController.LOAD_WATCHDOG_SECONDS) {
          console.error('[missile] launch assets never arrived — aborting');
          this.abortLaunch();
          return;
        }
      }
      // After release the missile is a live physics object: free-fall, then
      // unguided powered flight — impact can still end the sequence early.
      if (this.missileReleased) this.stepFlight(dt, { x: 0, y: 0 }, false);
      return;
    }

    if (this.phase === 'flying' && this.flight) {
      this.stepFlight(dt, this.lookDelta, this.boosting);
      this.lookDelta = { x: 0, y: 0 }; // deltas are per-frame, never carried
      if (this.boosting) cameraShake.addTrauma(MISSILE.BOOST_TRAUMA * dt);
      return;
    }

    if (this.phase === 'impact') {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) this.returnToPlayer();
    }
  }

  // ================= Document M shot choreography (per-frame) ===============

  private updateLaunchSequence(dt: number): void {
    if (!this.jet || !this.jetFlight || !this.path || !this.model) return;
    this.sequenceElapsed += dt;
    const t = this.sequenceElapsed;

    // The jet flies its whole curve regardless of which shot is on screen.
    const frame = this.jetFlight.update(dt);
    this.jetVfx?.update(dt);

    // Layered close-pass rumble once (§4), when the jet actually goes by.
    if (!this.closePassPlayed && cinematicCamera.getWorldPosition(_v3)) {
      if (_v3.distanceTo(frame.position) < JET_CINEMATIC.CLOSE_PASS_DISTANCE) {
        this.closePassPlayed = true;
        eventBus.emit('cinematic:jet:closepass', {
          x: frame.position.x, y: frame.position.y, z: frame.position.z,
        });
      }
    }

    if (t < JET_CINEMATIC.PHASE1_END) {
      this.shotEstablishing(t / JET_CINEMATIC.PHASE1_END, frame.position);
    } else if (t < JET_CINEMATIC.PHASE2_END) {
      this.shotChase();
    } else if (t < JET_CINEMATIC.PHASE3_END) {
      this.releaseMissileOnce();
      this.shotWhipPan((t - JET_CINEMATIC.PHASE2_END)
        / (JET_CINEMATIC.PHASE3_END - JET_CINEMATIC.PHASE2_END));
    } else if (t < JET_CINEMATIC.PHASE4_END) {
      this.handleIgnition();
      this.shotSwoop((t - JET_CINEMATIC.PHASE3_END)
        / (JET_CINEMATIC.PHASE4_END - JET_CINEMATIC.PHASE3_END));
    } else {
      this.handleIgnition();
      this.seatAndHandOff();
    }

    // The jet keeps egressing even after the seat (it may still be visible
    // far above); drop it once its own curve is done.
    if (frame.isComplete && !this.jetRemoved) this.removeJet();
  }

  /** Shot 1 — static-ish wide dolly beside the bank apex, jet crosses frame. */
  private shotEstablishing(t: number, jetPos: THREE.Vector3): void {
    if (!this.path) return;
    // Side offset decays 30% across the shot — the slow dolly-in.
    _v1.set(18, 6, 0).applyAxisAngle(_up, 0.3).multiplyScalar(1 - 0.3 * t);
    const camPos = _v2.copy(this.path.bankApex).add(_v1);
    cinematicCamera.setDesiredTransform(camPos, jetPos, { fov: 62 });
  }

  /** Shot 2 — chase cam on the authored jet-relative anchor (§5.2). */
  private shotChase(): void {
    if (!this.jet) return;
    const anchor = this.jet.getObjectByName('Anchor_ChaseCam');
    const camPos = anchor
      ? anchor.getWorldPosition(_v1) : _v1.copy(this.jet.position).add(_v2.set(0, 1.4, -8.5));
    const lookTarget = _v2.set(0, 0.3, 4).applyQuaternion(this.jet.quaternion)
      .add(this.jet.position);
    cinematicCamera.setDesiredTransform(camPos, lookTarget, {
      fov: 70, followSmoothing: 0.15,
    });
  }

  /**
   * Shot 3 — whip-pan (§5.1): a HARD directorial beat, look-at transfers
   * from jet to falling missile over 0.25s; the camera holds roughly where
   * the release happened rather than chasing the jet further.
   */
  private readonly whipAnchor = new THREE.Vector3();
  private readonly whipCamPos = new THREE.Vector3();
  private shotWhipPan(p: number): void {
    if (!this.jet || !this.model) return;
    if (this.missileJustReleased) {
      this.missileJustReleased = false;
      // Freeze the frame: camera stays where the release happened.
      this.whipAnchor.copy(this.jet.position);
      this.whipCamPos.copy(this.jet.position).add(_v5.set(4, 1.5, -6));
    }
    // flight exists by construction (releaseMissileOnce ran this same frame);
    // flight.position is the model's LIVE vector — safe to read, never written.
    const k = Math.min(1, p * ((JET_CINEMATIC.PHASE3_END - JET_CINEMATIC.PHASE2_END)
      / JET_CINEMATIC.WHIP_SECONDS));
    const s = k * k * (3 - 2 * k);
    const jetPos = _v2.copy(this.jet.position);
    _v3.lerpVectors(jetPos, this.flight!.position, s);
    cinematicCamera.setDesiredTransform(this.whipCamPos, _v3, { fov: 55 });
  }

  /**
   * Shot 4 — spline pursuit (§5.1): ease-OUT from 25m behind+6m above down
   * to 2.2m+0.3m behind the missile's own backward axis — fast start, gentle
   * arrival, no jarring hard stop into the seat.
   */
  private shotSwoop(p: number): void {
    if (!this.flight || !this.model) return;
    const eased = 1 - Math.pow(1 - p, 3);
    const missilePos = _v1.copy(this.flight.position);
    const backward = _v2.set(0, 0, 1).applyQuaternion(this.model.quaternion);
    const far = _v3.copy(missilePos).addScaledVector(backward, 25).add(_v5.set(0, 6, 0));
    const near = _v4.copy(missilePos).addScaledVector(backward, 2.2).add(_v5.set(0, 0.3, 0));
    const camPos = far.lerp(near, eased);
    cinematicCamera.setDesiredTransform(camPos, missilePos, {
      fov: THREE.MathUtils.lerp(55, 75, eased),
    });
  }

  /** Shot 5 — hard seat into the authored nose socket, then control handoff. */
  private seatAndHandOff(): void {
    if (this.seated || !this.model) return;
    this.seated = true;
    const noseCam = this.model.getObjectByName('Socket_NoseCam');
    cinematicCamera.seatTo(
      this.model,
      noseCam ? noseCam.position.clone() : new THREE.Vector3(0, 0, -1.15),
      { fov: 75 },
    );
    cinematicCamera.endManual({ keepSeated: true });

    // §6.3: control arrives only AFTER ignition (the ignition flag flipped
    // during the swoop). The letterbox wrapper owns the handoff event order:
    // context swap first, then 'flying' for the HUD.
    inputContexts.pop('cinematic');
    inputContexts.push('missileControl');
    // Hard ceiling: flight time plus the impact hold, with slack. If the
    // missile somehow never resolves, control returns anyway.
    inputContexts.guard('missileControl',
      MISSILE.FLIGHT_TIME_BUDGET + MISSILE.IMPACT_HOLD_SECONDS + 4);
    this.phase = 'flying';
    eventBus.emit('killstreak:missile:flying', {});
  }

  // ------------------------------- mechanics -------------------------------

  private missileJustReleased = false;

  /** The pylon drop (§6): velocity inheritance + ignition delay. */
  private releaseMissileOnce(): void {
    if (this.missileReleased || !this.jet || !this.model || !this.jetFlight) return;
    this.missileReleased = true;
    this.missileJustReleased = true;

    const worldPos = _v1.setFromMatrixPosition(this.model.matrixWorld).clone();
    const worldQuat = this.model.getWorldQuaternion(new THREE.Quaternion());
    this.model.parent?.remove(this.model);
    this.context?.scene.add(this.model);
    this.model.position.copy(worldPos);
    this.model.quaternion.copy(worldQuat);

    // Inherit the JET's velocity at this exact frame — no instant-stop pop.
    const jetVelocity = _v3.set(0, 0, 1).applyQuaternion(this.jet.quaternion)
      .multiplyScalar(this.path?.cruiseSpeed ?? 40).clone();

    const planar = _v2.set(jetVelocity.x, 0, jetVelocity.z);
    const yaw = planar.lengthSq() > 1e-6
      ? Math.atan2(-planar.x, -planar.z) : 0;

    this.flight = new MissileFlightController(
      this.model, this.context!.physics, worldPos, yaw, MISSILE.START_PITCH,
      jetVelocity, JET_CINEMATIC.IGNITION_DELAY_SECONDS,
    );

    eventBus.emit('cinematic:jet:released', {
      x: worldPos.x, y: worldPos.y, z: worldPos.z,
    });
  }

  /**
   * Single-frame ignition beat (§6.2): whoosh + punch once the motor lights —
   * AND the missile adopts its dive onto the designated point. (Inheriting
   * the jet's release tangent verbatim aimed it up the climbing egress, so it
   * sailed away and airbursted; designation must mean the missile goes there.)
   */
  private handleIgnition(): void {
    if (!this.flight) return;
    if (this.flight.justIgnited) {
      this.flight.aimAt(this.target);
      const p = this.flight.position;
      eventBus.emit('killstreak:missile:ignition', { x: p.x, y: p.y, z: p.z });
      cameraShake.addTrauma(0.15);
    }
  }

  private removeJet(): void {
    if (this.jetRemoved) return;
    this.jetRemoved = true;
    this.jetVfx?.dispose();
    this.jetVfx = null;
    this.jet?.parent?.remove(this.jet);
    this.jet = null;
    this.jetFlight = null;
  }

  /** One physics step for either the scripted or the steered phase. */
  private stepFlight(
    dt: number, look: { x: number; y: number }, boosting: boolean,
  ): void {
    if (!this.flight) return;
    const result = this.flight.update(dt, look, boosting);
    this.animator?.update(dt, true);
    if (result.impact) this.detonate(result.impact, false);
    else if (result.outOfFuel) {
      // Air-burst rather than flying forever or silently vanishing.
      this.detonate(this.flight.position.clone(), true);
    }
  }

  private detonate(at: THREE.Vector3, airburst: boolean): void {
    if (this.phase !== 'flying' && this.phase !== 'launching') return;
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
    inputContexts.pop('cinematic'); // covers the impact-during-launch path
    // A mid-launch impact aborts a manual sequence that is still RUNNING;
    // cancel restores the rig. A completed handoff only needs the re-parent.
    if (cinematicCamera.isActive) cinematicCamera.cancel();
    else cinematicCamera.restore();
    this.context?.reportEnded();
  }

  override get remainingSeconds(): number {
    return this.flight?.fuelSeconds ?? 0;
  }

  /** Test/HUD seam — everything the missile feed displays. */
  get flightState(): {
    phase: Phase; fuel: number; pitch: number;
    altitude: number; heading: number; boosting: boolean;
    x: number; z: number;
  } {
    const pos = this.flight?.position;
    return {
      phase: this.phase,
      fuel: this.flight?.fuelFraction ?? 0,
      pitch: this.flight?.pitchRadians ?? 0,
      altitude: this.flight?.altitudeAboveGround() ?? 0,
      heading: this.flight?.headingDegrees ?? 0,
      boosting: this.boosting,
      // World metres — the feed's S/W coordinate readouts.
      x: pos?.x ?? 0,
      z: pos?.z ?? 0,
    };
  }

  deactivate(): void {
    // Always unwind camera and input, whatever phase we died in.
    if (inputContexts.is('missileControl')) inputContexts.pop('missileControl');
    if (inputContexts.is('cinematic')) inputContexts.pop('cinematic');
    if (cinematicCamera.isActive || cinematicCamera.isDetached) cinematicCamera.cancel();
    this.removeJet();
    this.flight?.dispose();
    this.flight = null;
    if (this.model) {
      this.model.parent?.remove(this.model);
      this.model = null;
    }
    this.animator = null;
    this.sequenceStarted = false;
    this.missileReleased = false;
    this.seated = false;
    this.path = null;
    this.phase = 'idle';
    this.context = null;
  }
}


export default MissileKillstreakController;
