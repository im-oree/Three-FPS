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

export type CinematicStep =
  | { type: 'dolly'; toPosition: THREE.Vector3; toLookAt: THREE.Vector3; duration: number }
  | { type: 'hold'; duration: number }
  | { type: 'attachTo'; target: THREE.Object3D; localOffset: THREE.Vector3 }
  | { type: 'detach' };

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

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

  attach(camera: THREE.Camera): void {
    this.camera = camera;
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
    this.restore();
    eventBus.emit('cinematic:ended', {});
  }
}

export const cinematicCamera = new CinematicCameraController();
export default cinematicCamera;
