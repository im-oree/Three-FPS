/**
 * PerspectiveController.ts — the Camera Boom System and perspective toggle
 * (FPS/TPS Spec §1).
 *
 * Owns exactly one thing: WHERE the single camera sits and WHAT it is allowed
 * to see. It never creates a camera (SceneManager owns the only one) and never
 * touches the simulation — PlayerCamera still computes the authoritative look
 * orientation and the 1PS eye transform; this module post-processes the
 * camera's POSITION, its NEAR plane and its LAYER MASK.
 *
 * Toggle pipeline, exactly as specified:
 *
 *   [Trigger Perspective Toggle]
 *              │
 *      Evaluate Target View State
 *              │
 *     ┌────────┴────────┐
 *  [1PS]              [3PS]
 *   ├─ Hide 3PS Head    ├─ Show 3PS Head
 *   ├─ Show 1PS Arms    ├─ Hide 1PS Arms
 *   └─ Set Near-Clip    └─ Set Normal-Clip
 *
 * Implemented as layer-mask arithmetic rather than `visible` toggling, so the
 * 3PS body keeps casting a full-body shadow in first person (the shadow pass
 * tests the LIGHT's camera mask, not the player camera's).
 *
 * The camera matrix shift between the eye socket and the boom target is a
 * non-linear S-curve (smoothstep), per the spec.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { PERSPECTIVE } from '../utils/Constants';
import { WORLD_PASS_MASK } from '../core/RenderLayers';
import { clamp } from '../utils/MathUtils';
import type { InputManager } from '../core/InputManager';
import type { ThirdPersonBody } from '../character/ThirdPersonBody';

export type Perspective = 'FIRST' | 'THIRD';

/** Obstruction probe for the spring arm: returns distance to the first hit. */
export type BoomProbe = (origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number) => number | null;

const _eye = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _back = new THREE.Vector3();

/** Smoothstep — the spec's "non-linear S-curve" camera matrix interpolation. */
function sCurve(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export class PerspectiveController {
  /** Target state (what the player asked for). */
  private target: Perspective = PERSPECTIVE.DEFAULT;
  /** 0 = fully first person, 1 = fully third person. */
  private blend = PERSPECTIVE.DEFAULT === 'THIRD' ? 1 : 0;
  /** Current boom extension (metres) — collapses on obstruction. */
  private boomDistance: number = PERSPECTIVE.BOOM.LENGTH;
  private boomProbe: BoomProbe | null = null;
  private previousToggleDown = false;
  /** Re-layers the shared arms + held weapon when the camera state changes. */
  private armsLayerSink: ((firstPerson: boolean) => void) | null = null;
  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
    private readonly body: ThirdPersonBody,
  ) {
    this.applyDiscreteState(this.target);
  }

  /**
   * Register the sink that moves the SHARED arms + weapon between the
   * VIEWMODEL layer (first person: drawn depth-cleared, never clips a wall)
   * and the CHARACTER layer (third person: drawn with the world so the rifle
   * correctly occludes behind cover). Same objects either way — that is what
   * guarantees the two perspectives can never disagree about what is held.
   */
  setArmsLayerSink(sink: ((firstPerson: boolean) => void) | null): void {
    this.armsLayerSink = sink;
    if (sink) sink(this.target === 'FIRST');
  }

  /** Spring-arm obstruction query (Rapier static geometry in practice). */
  setBoomProbe(probe: BoomProbe | null): void {
    this.boomProbe = probe;
  }

  get current(): Perspective {
    return this.target;
  }

  /** 0 → first person, 1 → third person. Mid-values mean a blend is running. */
  get blendWeight(): number {
    return this.blend;
  }

  get isFirstPerson(): boolean {
    return this.target === 'FIRST';
  }

  get currentBoomDistance(): number {
    return this.boomDistance;
  }

  /**
   * The world-pass layer mask for the CURRENT camera state.
   *
   * The character BODY is in both masks — you see your own legs and torso in
   * first person, exactly like modern Call of Duty. The only difference is the
   * HEAD layer, which first person omits so the camera (which sits inside the
   * skull) never renders the inside of the head. The moment any third-person
   * blend starts, the head comes back, so it eases in with the camera instead
   * of popping at the end of the transition.
   */
  get worldPassMask(): number {
    return this.blend > 0.001 ? WORLD_PASS_MASK.THIRD : WORLD_PASS_MASK.FIRST;
  }

  /**
   * Whether the depth-cleared viewmodel pass should run.
   *
   * ONLY in (or blending toward) first person. In third person the arms and
   * weapon are drawn by the normal world pass along with the rest of the body,
   * because at that distance they must respect real depth against the world —
   * drawing them depth-cleared would paint the rifle on top of walls the
   * character is standing behind.
   */
  get viewmodelVisible(): boolean {
    return this.blend < 0.999;
  }

  /** Camera state, for systems that need to branch on it (anim, audio, UI). */
  get state(): Perspective {
    return this.target;
  }

  setPerspective(next: Perspective): void {
    if (next === this.target) return;
    this.target = next;
    this.applyDiscreteState(next);
    eventBus.emit('player:perspectiveChanged', { perspective: next });
  }

  toggle(): void {
    this.setPerspective(this.target === 'FIRST' ? 'THIRD' : 'FIRST');
  }

  /**
   * The discrete half of the toggle pipeline — the parts that must switch
   * atomically rather than blend: head masking and the 1PS arms' ownership.
   * (The camera matrix and near-clip interpolate continuously in update().)
   */
  private applyDiscreteState(perspective: Perspective): void {
    // Hide/Show 3PS head: handled by the camera mask (see worldPassMask).
    this.body.setPerspective(perspective);
    // Move the shared arms + weapon between the viewmodel and character layers.
    this.armsLayerSink?.(perspective === 'FIRST');
  }

  /**
   * Runs AFTER PlayerCamera has written the camera's eye transform for this
   * frame — it consumes that transform as the 1PS end of the interpolation.
   */
  update(dt: number): void {
    if (this.input.isActionDown('togglePerspective')) {
      if (!this.previousToggleDown) this.toggle();
      this.previousToggleDown = true;
    } else {
      this.previousToggleDown = false;
    }

    const targetBlend = this.target === 'THIRD' ? 1 : 0;
    const step = PERSPECTIVE.BLEND_SECONDS > 0 ? dt / PERSPECTIVE.BLEND_SECONDS : 1;
    this.blend = targetBlend > this.blend
      ? Math.min(targetBlend, this.blend + step)
      : Math.max(targetBlend, this.blend - step);

    // Near-clip: tight in 1PS so the viewmodel never clips the lens; normal
    // in 3PS so the body isn't sliced. Interpolated with the same curve.
    const eased = sCurve(this.blend);
    const near = THREE.MathUtils.lerp(PERSPECTIVE.NEAR_CLIP_FIRST, PERSPECTIVE.NEAR_CLIP_THIRD, eased);
    if (Math.abs(this.camera.near - near) > 1e-4) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }

    // Camera mask: world (+ body while any third-person blend is active).
    this.camera.layers.mask = this.worldPassMask;

    if (eased <= 0.0001) {
      this.boomDistance = Math.min(
        PERSPECTIVE.BOOM.LENGTH,
        this.boomDistance + PERSPECTIVE.BOOM.EXTEND_RATE * dt,
      );
      // Pure first person: PlayerCamera's eye transform stands. We deliberately
      // do NOT snap the camera to the body's head socket — the head bone is
      // driven by the aim offset, so riding it would feed the camera's own
      // rotation back into its position and jitter the view. The capsule-based
      // eye height and the rig's head socket are authored to coincide.
      return;
    }

    // --- spring arm ---------------------------------------------------------
    _eye.copy(this.camera.position);
    this.body.getBoomAnchorWorldPosition(_anchor);
    if (_anchor.lengthSq() === 0) _anchor.copy(_eye);

    // Boom direction: straight back along the camera's forward axis.
    this.camera.getWorldDirection(_dir);
    _back.copy(_dir).multiplyScalar(-1);
    _right.copy(_dir).cross(_up).normalize();

    // Over-the-shoulder offset applied at the anchor, so the boom pivots
    // around the shoulders rather than orbiting the offset point.
    const pivot = _anchor.clone()
      .addScaledVector(_right, PERSPECTIVE.BOOM.OFFSET_X)
      .addScaledVector(_up, PERSPECTIVE.BOOM.OFFSET_Y);

    let allowed: number = PERSPECTIVE.BOOM.LENGTH;
    if (this.boomProbe) {
      const hit = this.boomProbe(pivot, _back, PERSPECTIVE.BOOM.LENGTH + PERSPECTIVE.BOOM.PROBE_RADIUS);
      if (hit !== null) allowed = Math.max(0, hit - PERSPECTIVE.BOOM.PROBE_RADIUS);
    }
    // Collapse fast (a wall must never show through), extend slowly.
    const rate = allowed < this.boomDistance ? PERSPECTIVE.BOOM.COLLAPSE_RATE : PERSPECTIVE.BOOM.EXTEND_RATE;
    this.boomDistance += (allowed - this.boomDistance) * Math.min(1, rate * dt);

    _desired.copy(pivot).addScaledVector(_back, this.boomDistance);
    // Camera Matrix Shift: S-curve between eye socket and spring-arm target.
    this.camera.position.lerpVectors(_eye, _desired, eased);
  }
}

export default PerspectiveController;
