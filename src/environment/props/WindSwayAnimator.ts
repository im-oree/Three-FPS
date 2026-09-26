/**
 * WindSwayAnimator.ts — Document N §5.3: per-tree wind motion.
 *
 * Follows CraneSwayAnimator's pattern (Document K): find named child nodes
 * once at registration, store a random phase, drive a sine in update(). No
 * allocation per frame, no skinning, no vertex shader.
 *
 * WHY PALMS ARE CLONED, NOT INSTANCED
 * An InstancedMesh shares ONE geometry across all its instances, so any
 * per-instance deformation has to happen in a shader with per-instance
 * attributes. Palms are the map's visual signature and there are only ~50 of
 * them; cloning buys independent crown rotation for a trivial draw-call cost.
 * Bushes and grass (380+) have no sway at all and stay fully instanced — the
 * split is a deliberate budget decision, not an inconsistency.
 *
 * The animation is applied to the CROWN group, not the trunk: a palm bends
 * mostly at the top, and rotating the whole tree about its base makes the
 * trunk visibly detach from the ground.
 */
import type { Object3D } from 'three';

const TWO_PI = Math.PI * 2;

interface SwayTarget {
  readonly node: Object3D;
  readonly phase: number;
  readonly freq: number;
  readonly amp: number;
  readonly restX: number;
  readonly restZ: number;
}

export interface WindSwayOptions {
  /** Wind bearing in radians; trees lean and sway along it. */
  windDirection?: number;
  baseAmplitude?: number;
  baseFrequency?: number;
  gustFrequency?: number;
  gustDepth?: number;
}

export class WindSwayAnimator {
  private readonly targets: SwayTarget[] = [];
  private readonly windDirection: number;
  private readonly baseAmplitude: number;
  private readonly baseFrequency: number;
  private readonly gustFrequency: number;
  private readonly gustDepth: number;

  constructor({
    windDirection = 0.6,
    baseAmplitude = 0.028,
    baseFrequency = 0.55,
    // Slow amplitude envelope so the treeline breathes in gusts rather than
    // every tree oscillating at one constant amplitude forever.
    gustFrequency = 0.11,
    gustDepth = 0.55,
  }: WindSwayOptions = {}) {
    this.windDirection = windDirection;
    this.baseAmplitude = baseAmplitude;
    this.baseFrequency = baseFrequency;
    this.gustFrequency = gustFrequency;
    this.gustDepth = gustDepth;
  }

  get count(): number { return this.targets.length; }

  /**
   * Register one tree. `swayTargetNames` defaults to the model's own
   * userData, so WHICH part of a tree moves is a property of the model
   * (authored by the vegetation generator), not hardcoded here.
   */
  register(model: Object3D, swayTargetNames?: readonly string[]): number {
    const names = swayTargetNames
      ?? (model.userData?.windSwayTargets as string[] | undefined)
      ?? [];
    let added = 0;
    for (const name of names) {
      const node = model.getObjectByName(name);
      if (!node) continue;
      this.targets.push({
        node,
        phase: Math.random() * TWO_PI,
        // +/-25% frequency spread: identical periods make a treeline pulse in
        // unison, which reads as a rendering artefact rather than as wind.
        freq: this.baseFrequency * (0.75 + Math.random() * 0.5),
        amp: this.baseAmplitude * (0.7 + Math.random() * 0.6),
        restX: node.rotation.x,
        restZ: node.rotation.z,
      });
      added += 1;
    }
    return added;
  }

  /** Walk a subtree and register every node that declares sway targets. */
  registerTree(root: Object3D): number {
    let total = 0;
    root.traverse((obj) => {
      const names = obj.userData?.windSwayTargets as string[] | undefined;
      if (names?.length) total += this.register(obj, names);
    });
    if (total === 0) total = this.register(root);
    return total;
  }

  update(_dt: number, elapsed: number): void {
    if (!this.targets.length) return;
    // One gust envelope shared by every tree — a wind FIELD, not per-tree
    // randomness, so gusts sweep the map coherently.
    const gust = 1 + this.gustDepth * Math.sin(elapsed * this.gustFrequency * TWO_PI);
    const cosW = Math.cos(this.windDirection);
    const sinW = Math.sin(this.windDirection);
    for (const t of this.targets) {
      // Two detuned sines: the second adds a faster flutter so the motion is
      // not a pure pendulum.
      const s = Math.sin(elapsed * t.freq * TWO_PI + t.phase)
        + 0.35 * Math.sin(elapsed * t.freq * 2.7 * TWO_PI + t.phase * 1.7);
      const a = t.amp * gust * s;
      t.node.rotation.x = t.restX + a * cosW;
      t.node.rotation.z = t.restZ + a * sinW;
    }
  }

  clear(): void {
    for (const t of this.targets) {
      t.node.rotation.x = t.restX;
      t.node.rotation.z = t.restZ;
    }
    this.targets.length = 0;
  }
}

export default WindSwayAnimator;
