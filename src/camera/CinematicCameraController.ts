/**
 * CinematicCameraController.ts — Document I §6.4.
 *
 * A generic, reusable camera sequencer. Deliberately NOT missile-specific: a
 * sequence is DATA (dolly / hold / attachTo / detach steps), so any future
 * killstreak or cutscene reuses this unchanged.
 *
 * The camera is temporarily detached from the player rig and re-parented, then
 * restored exactly. Restoring is the part that must never fail — a stranded
 * camera is unrecoverable without a reload — so detach() is idempotent and
 * always restores the original parent and local transform.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { JET_CINEMATIC } from '../utils/Constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export type CinematicStep =
  | { type: 'dolly'; toPosition: THREE.Vector3; toLookAt: THREE.Vector3; duration: number }
  | { type: 'hold'; duration: number }
  | { type: 'attachTo'; target: THREE.Object3D; localOffset: THREE.Vector3 }
  | { type: 'detach' };

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _posScratch = new THREE.Vector3();
const _dirScratch = new THREE.Vector3();
const _scaleScratch = new THREE.Vector3();

export class CinematicCameraController {
  private camera: THREE.Camera | null = null;
  private originalParent: THREE.Object3D | null = null;
  private readonly originalPosition = new THREE.Vector3();
  private readonly originalQuaternion = new THREE.Quaternion();
  private active = false;
  private detached = false;

  /** Current step machinery. */
  private steps: CinematicStep[] = [];
  private stepIndex = 0;
  private stepElapsed = 0;
  private readonly fromPosition = new THREE.Vector3();
  private readonly fromQuaternion = new THREE.Quaternion();
  private readonly toQuaternion = new THREE.Quaternion();
  private onComplete: (() => void) | null = null;

  /** Document M §5: per-frame driven shots (chase/whip-pan/swoop). */
  private manual = false;
  private manualSeated = false;
  private physics: PhysicsWorld | null = null;
  private readonly manualPos = new THREE.Vector3();
  private readonly manualLookAt = new THREE.Vector3();

  attach(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /** Anti-clipping geometry source (Document M §7). Wired once by main. */
  attachPhysics(world: PhysicsWorld): void {
    this.physics = world;
  }

  get isActive(): boolean { return this.active; }
  get isDetached(): boolean { return this.detached; }

  /** Begin a sequence. `onComplete` fires once the last step finishes. */
  play(steps: CinematicStep[], onComplete?: () => void): void {
    if (!this.camera) return;
    this.steps = steps;
    this.stepIndex = 0;
    this.stepElapsed = 0;
    this.onComplete = onComplete ?? null;
    this.active = true;
    this.captureOriginal();
    eventBus.emit('cinematic:started', {});
    this.beginStep();
  }

  private captureOriginal(): void {
    if (!this.camera || this.detached) return;
    this.originalParent = this.camera.parent;
    this.originalPosition.copy(this.camera.position);
    this.originalQuaternion.copy(this.camera.quaternion);
    this.detached = true;
  }

  /** Restore the camera to the player rig. Safe to call more than once. */
  restore(): void {
    if (!this.camera || !this.detached) return;
    if (this.originalParent) this.originalParent.add(this.camera);
    this.camera.position.copy(this.originalPosition);
    this.camera.quaternion.copy(this.originalQuaternion);
    this.detached = false;
    this.originalParent = null;
  }

  private beginStep(): void {
    if (!this.camera) return;
    const step = this.steps[this.stepIndex];
    if (!step) return;
    this.stepElapsed = 0;

    if (step.type === 'dolly') {
      // Work in WORLD space for the duration of a dolly.
      this.camera.getWorldPosition(this.fromPosition);
      this.camera.getWorldQuaternion(this.fromQuaternion);
      if (this.camera.parent) this.camera.parent.remove(this.camera);
      this.camera.position.copy(this.fromPosition);
      this.camera.quaternion.copy(this.fromQuaternion);
      _m.lookAt(step.toPosition, step.toLookAt, _up);
      this.toQuaternion.setFromRotationMatrix(_m);
    } else if (step.type === 'attachTo') {
      step.target.add(this.camera);
      this.camera.position.copy(step.localOffset);
      this.camera.quaternion.identity();
      this.advance();
    } else if (step.type === 'detach') {
      this.restore();
      this.advance();
    }
  }

  private advance(): void {
    this.stepIndex += 1;
    if (this.stepIndex >= this.steps.length) {
      this.active = false;
      eventBus.emit('cinematic:ended', {});
      const done = this.onComplete;
      this.onComplete = null;
      done?.();
      return;
    }
    this.beginStep();
  }

  update(dt: number): void {
    if (!this.active || !this.camera) return;
    const step = this.steps[this.stepIndex];
    if (!step) return;
    this.stepElapsed += dt;

    if (step.type === 'hold') {
      if (this.stepElapsed >= step.duration) this.advance();
      return;
    }
    if (step.type !== 'dolly') return;

    const t = Math.min(1, this.stepElapsed / Math.max(1e-3, step.duration));
    // Smoothstep: decelerate into position rather than arriving at full speed.
    const eased = t * t * (3 - 2 * t);
    this.camera.position.lerpVectors(this.fromPosition, step.toPosition, eased);
    _q.copy(this.fromQuaternion).slerp(this.toQuaternion, eased);
    this.camera.quaternion.copy(_q);
    if (t >= 1) this.advance();
  }

  /** Abort everything and hand the camera back. */
  cancel(): void {
    this.steps = [];
    this.stepIndex = 0;
    this.active = false;
    this.manual = false;
    this.manualSeated = false;
    this.restore();
    eventBus.emit('cinematic:ended', {});
  }

  // ---------------- Document M: manually-driven shot mode -----------------

  /**
   * Begin per-frame driven cinematography (the jet launch sequence). The
   * camera leaves the player rig into world space; from here,
   * setDesiredTransform() is called once per frame with each shot's desired
   * position/look-at, and the anti-clipping layer (§7) corrects them.
   */
  beginManual(): void {
    if (!this.camera) return;
    if (this.active) this.cancel(); // clear any lingering step sequence first
    this.captureOriginal();
    // Detach into world space, preserving the current world transform.
    if (this.camera.parent) {
      this.camera.getWorldPosition(this.manualPos);
      _m.copy(this.camera.matrixWorld).decompose(
        this.manualPos, this.fromQuaternion, _scaleScratch,
      );
      this.camera.parent.remove(this.camera);
      this.camera.position.copy(this.manualPos);
      this.camera.quaternion.copy(this.fromQuaternion);
    }
    this.manual = true;
    this.manualSeated = false;
    this.active = true;
    this.manualLookAt.set(0, 0, -1)
      .applyQuaternion(this.camera.quaternion).add(this.camera.position);
    eventBus.emit('cinematic:started', {});
  }

  /**
   * One frame of a manually-driven shot. followSmoothing 1.0 snaps (hard
   * cuts, whip-pans); lower values ease (chase cam) so the camera does not
   * rigidly mirror every micro-adjustment of the subject's banking.
   */
  setDesiredTransform(
    desiredPos: THREE.Vector3,
    desiredLookAt: THREE.Vector3,
    { fov = 65, followSmoothing = 1 }: { fov?: number; followSmoothing?: number } = {},
  ): void {
    if (!this.manual || !this.camera || this.manualSeated) return;
    this.manualPos.lerp(desiredPos, followSmoothing);
    this.manualLookAt.lerp(desiredLookAt, followSmoothing);

    _posScratch.copy(this.manualPos);
    if (this.physics) {
      this.applyAntiClipping(_posScratch, this.manualLookAt);
      this.applyGroundClearance(_posScratch);
    }
    this.camera.position.copy(_posScratch);
    _m.lookAt(_posScratch, this.manualLookAt, _up);
    this.camera.quaternion.setFromRotationMatrix(_m);

    const cam = this.camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      cam.fov += (fov - cam.fov) * 0.15;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Final hard seat (§5.1 shot 5 / §7 attachTo): parents the camera into the
   * target, bypassing the lerp/anti-clip logic — once seated it moves
   * rigidly with the parent, and the nose socket is authored in open air by
   * construction.
   */
  seatTo(
    target: THREE.Object3D, localOffset: THREE.Vector3,
    { fov = 75 }: { fov?: number } = {},
  ): void {
    if (!this.camera) return;
    target.add(this.camera);
    this.camera.position.copy(localOffset);
    this.camera.quaternion.identity();
    this.manualSeated = true;
    const cam = this.camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** The driven camera's live world position (null while no camera attached). */
  getWorldPosition(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.camera) return null;
    return out.setFromMatrixPosition(this.camera.matrixWorld);
  }

  /**
   * End manual driving. With keepSeated the camera REMAINS parented to the
   * target (the guided missile): the controller reports inactive but still
   * detached, so the jitter-proof restore paths (cancel/end-of-streak) can
   * hand it back to the player rig later.
   */
  endManual({ keepSeated = false }: { keepSeated?: boolean } = {}): void {
    if (!this.manual) return;
    this.manual = false;
    this.active = false;
    if (!keepSeated) {
      this.manualSeated = false;
      this.restore();
    }
    eventBus.emit('cinematic:ended', {});
  }

  /**
   * §7 anti-clipping: cast FROM the subject TOWARD the camera (not the other
   * way) — the corrected position then lies on the one ray already proven
   * clear up to the hit point. Pull the camera to just short of the
   * obstruction. Static-geometry-only ray: the jet (no collider) and the
   * missile (kinematic) are excluded by construction.
   */
  private applyAntiClipping(pos: THREE.Vector3, lookAt: THREE.Vector3): void {
    if (!this.physics) return;
    _dirScratch.subVectors(pos, lookAt);
    const distance = _dirScratch.length();
    if (distance < 0.01) return;
    _dirScratch.divideScalar(distance);
    const hit = this.physics.castRayStatic(lookAt, _dirScratch, distance);
    if (hit && hit.toi < distance) {
      pos.copy(lookAt).addScaledVector(
        _dirScratch,
        Math.max(hit.toi - JET_CINEMATIC.ANTI_CLIP_MARGIN, 0.5),
      );
      // Debug-gizmo consumption (§8.2) + the QA repro's zero-correction gate.
      eventBus.emit('cinematic:jet:antiClipCorrection', {
        t: performance.now() / 1000,
      });
    }
  }

  /**
   * §7 ground-clearance clamp: belt-and-suspenders hard floor — ground is
   * the single most common sky-cam clipping failure.
   */
  private applyGroundClearance(pos: THREE.Vector3): void {
    if (!this.physics) return;
    const toi = this.physics.castRayDistance(pos, _down, 500);
    if (toi === null) return;
    const groundY = pos.y - toi;
    if (pos.y - groundY < JET_CINEMATIC.GROUND_CLEARANCE) {
      pos.y = groundY + JET_CINEMATIC.GROUND_CLEARANCE;
    }
  }
}

export const cinematicCamera = new CinematicCameraController();
export default cinematicCamera;
