/**
 * RenderLayers.ts — the project's single, authoritative layer registry.
 *
 * Every object in the game belongs to exactly one render layer, and every
 * render pass is defined as a mask over those layers. Centralising this is
 * what makes "one mode must never see the other mode's objects" a provable
 * property instead of a convention scattered across a dozen files.
 *
 *   WORLD (0)      the level, props, other characters, effects. Always drawn.
 *   VIEWMODEL (1)  the arms + held weapon, drawn in a second, depth-cleared
 *                  pass so they can NEVER clip into world geometry — the
 *                  standard FPS anti-clipping technique, and the reason we do
 *                  not simply let the world camera see the arms up close.
 *   CHARACTER (2)  the player character's body (torso, legs, head). Visible in
 *                  third person, and ALSO visible in first person minus the
 *                  head — that is what lets you look down and see your own
 *                  legs, Call-of-Duty style.
 *   HEAD (3)       the head/helmet/neck only. Split out from CHARACTER purely
 *                  so first person can drop it (you cannot see the inside of
 *                  your own skull) while it still casts a full-body shadow.
 *
 * IMPORTANT — shadows are unaffected by all of this. Three.js tests an
 * object's layers against the LIGHT's shadow camera, which we leave on the
 * default mask, so an object hidden from the player camera still casts a
 * correct shadow. That is how the head can be invisible in first person while
 * the silhouette on the ground remains whole.
 *
 * Audio is likewise unaffected: there is ONE camera and one AudioListener, so
 * spatial audio is identical in both perspectives and cannot desync.
 */
import * as THREE from 'three';

export const LAYER = {
  WORLD: 0,
  VIEWMODEL: 1,
  CHARACTER: 2,
  HEAD: 3,
  /**
   * The CHARACTER rig's own arms and its third-person weapon copy. Hidden in
   * first person, where the camera-relative viewmodel arms stand in for them:
   * real shoulder-length arms viewed from inside the head are enormous, clip
   * the lens and read terribly, which is exactly why every major FPS uses a
   * dedicated viewmodel for the hands and keeps the body for legs/torso.
   */
  BODY_ARMS: 4,
} as const;

export type LayerName = keyof typeof LAYER;

/** Build a bitmask from a list of layer indices. */
export function maskOf(...layers: number[]): number {
  const l = new THREE.Layers();
  l.disableAll();
  for (const index of layers) l.enable(index);
  return l.mask;
}

/**
 * The world pass mask per camera state. The VIEWMODEL layer is deliberately
 * absent from both: it is drawn by its own depth-cleared pass afterwards.
 */
export const WORLD_PASS_MASK = {
  /**
   * First person: world + the character's torso and LEGS (look down and you
   * see your own body, Call-of-Duty style) but NOT the head (you cannot see
   * inside your own skull) and NOT the body's arms (the viewmodel supplies
   * those). The viewmodel layer is drawn by its own depth-cleared pass.
   */
  FIRST: maskOf(LAYER.WORLD, LAYER.CHARACTER),
  /** Third person: the whole character — head, arms and held weapon included. */
  THIRD: maskOf(LAYER.WORLD, LAYER.CHARACTER, LAYER.HEAD, LAYER.BODY_ARMS),
} as const;

/** Assign every node in a subtree to one layer. */
export function setLayerRecursive(root: THREE.Object3D, layer: number): void {
  root.traverse((o) => o.layers.set(layer));
}

export default LAYER;
