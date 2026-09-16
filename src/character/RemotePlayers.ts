/**
 * RemotePlayers.ts — drawing everybody who is not you.
 *
 * Lives in `character/`, not `net/`: it RENDERS players. `src/net/` is the
 * wire protocol and is held to JSON-only purity, so a three.js import there
 * is a build-breaking layering error (the purity check catches it).
 *
 * Until this existed the client rendered exactly one character: the local
 * player. The server simulated a full lobby, the killfeed filled with their
 * names and their bullets killed you, but the map looked deserted — you were
 * fighting ghosts. This turns each `PlayerPublicState` the server sends into
 * a visible body.
 *
 * Design notes:
 *
 *  - Bodies are the SAME mesh and the SAME operator tint the local player and
 *    the menu showcase use. A bot is drawn by the identical path a human is,
 *    which is what makes them indistinguishable — there is no "bot model" to
 *    accidentally look different.
 *
 *  - Positions are INTERPOLATED toward the latest snapshot rather than
 *    snapped. Snapshots arrive at the server's send rate, not the frame rate,
 *    so snapping produces visible stepping at any framerate above the tick.
 *
 *  - Yaw is interpolated the short way round, or a player crossing the
 *    +/-PI seam spins through a full circle.
 *
 * The rig is deliberately NOT the full ThirdPersonBody: that class owns a
 * single shared instance wired to local input, spring state, IK and the
 * viewmodel. Twenty of them would each load clips and run foot IK. Remote
 * bodies need pose, not simulation — so they get the mesh, a walk cycle and
 * nothing else.
 */
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import type { PlayerPublicState } from '../net/Protocol';
import { getOperator, OPERATORS } from '../customization/OperatorRoster';
import { LAYER } from '../core/RenderLayers';
import { PERSPECTIVE } from '../utils/Constants';

/** How fast a body eases toward the server's position (fraction per second). */
const POSITION_LERP = 14;
/** How fast a body eases toward the server's facing. */
const YAW_LERP = 12;
/** Metres/second above which the legs are considered to be walking. */
const MOVING_SPEED = 0.35;
/** Radians of leg swing at a full stride. */
const STRIDE_SWING = 0.62;
/** Stride cycles per second per metre/second of speed. */
const STRIDE_RATE = 0.42;

interface Body {
  readonly group: THREE.Object3D;
  readonly joints: {
    pelvis: THREE.Object3D | null;
    chest: THREE.Object3D | null;
    head: THREE.Object3D | null;
    legR: THREE.Object3D | null;
    legL: THREE.Object3D | null;
    armR: THREE.Object3D | null;
    armL: THREE.Object3D | null;
  };
  /** Rest rotations, so each frame poses from rest rather than accumulating. */
  readonly rest: Map<THREE.Object3D, THREE.Quaternion>;
  /** Rendered position, easing toward `target`. */
  readonly current: THREE.Vector3;
  readonly target: THREE.Vector3;
  currentYaw: number;
  targetYaw: number;
  pitch: number;
  stridePhase: number;
  speed: number;
  alive: boolean;
  operatorId: string;
}

export class RemotePlayers {
  private readonly bodies = new Map<string, Body>();
  private scene: THREE.Scene | null = null;
  private template: THREE.Object3D | null = null;
  private loading: Promise<void> | null = null;
  /** The local player's id — never drawn, they have their own body. */
  private localId = '';

  constructor(private readonly assetLoader: AssetLoader) {}

  setLocalId(id: string): void { this.localId = id; }

  attach(scene: THREE.Scene): void { this.scene = scene; }

  /**
   * Load the shared body mesh once.
   *
   * Every remote player clones this. AssetLoader caches the GLTF, but a clone
   * per player is still required: two players cannot share one Object3D and
   * stand in different places.
   */
  private async ensureTemplate(): Promise<void> {
    if (this.template) return;
    if (!this.loading) {
      this.loading = this.assetLoader.loadModel(PERSPECTIVE.BODY_PATH)
        .then((model) => { this.template = model; })
        .catch((error: unknown) => {
          console.warn('[remote] body model failed to load:', error);
        });
    }
    await this.loading;
  }

  /**
   * Reconcile the drawn bodies with what the server says exists.
   *
   * Called on every `playerStates` message. Players who left are disposed,
   * new ones are created, and the rest have their targets updated.
   */
  sync(states: readonly PlayerPublicState[]): void {
    void this.ensureTemplate();
    const seen = new Set<string>();

    for (const state of states) {
      if (state.id === this.localId) continue;
      seen.add(state.id);
      let body = this.bodies.get(state.id);
      if (!body) {
        const spawned = this.spawn(state);
        if (!spawned) continue;
        body = spawned;
        this.bodies.set(state.id, body);
      }

      // Re-tint if the player changed operator (they respawned as someone
      // else, or joined before their loadout arrived).
      if (body.operatorId !== state.operatorId) {
        body.operatorId = state.operatorId;
        this.tint(body.group, state.operatorId, state.id);
      }

      const [x, y, z] = state.pos;
      const dx = x - body.target.x;
      const dz = z - body.target.z;
      // Speed drives the walk cycle. Derived from how far the SERVER moved
      // them between snapshots, so the legs match the actual travel rather
      // than a guess from input the client cannot see.
      body.speed = Math.hypot(dx, dz) * 12;
      body.target.set(x, y, z);
      body.targetYaw = state.yaw;
      body.pitch = state.pitch;

      if (body.alive !== state.alive) {
        body.alive = state.alive;
        body.group.visible = state.alive;
        // A corpse that keeps standing is worse than no corpse: it reads as a
        // live enemy. Hiding is honest until a death animation exists.
      }
    }

    for (const [id, body] of this.bodies) {
      if (seen.has(id)) continue;
      this.despawn(body);
      this.bodies.delete(id);
    }
  }

  private spawn(state: PlayerPublicState): Body | null {
    if (!this.template || !this.scene) return null;
    const group = this.template.clone(true);
    group.position.set(state.pos[0], state.pos[1], state.pos[2]);

    // CHARACTER, not WORLD: this is the layer the external/death camera draws
    // and the first-person pass excludes. A remote body on WORLD would render
    // into the first-person view of a player standing inside it.
    setLayerRecursive(group, LAYER.CHARACTER);

    const byName = (n: string): THREE.Object3D | null => group.getObjectByName(n) ?? null;
    const joints = {
      pelvis: byName('Bone_Pelvis'),
      chest: byName('Bone_Chest'),
      head: byName('Bone_Head'),
      // Real rig node names, taken from ThirdPersonBody rather than guessed:
      // a wrong name silently resolves to null and the body walks stiff-
      // legged with no error anywhere.
      legR: byName('HipPivot_R'),
      legL: byName('HipPivot_L'),
      armR: byName('Shoulder_R'),
      armL: byName('Shoulder_L'),
    };

    const rest = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const joint of Object.values(joints)) {
      if (joint) rest.set(joint, joint.quaternion.clone());
    }

    const body: Body = {
      group,
      joints,
      rest,
      current: new THREE.Vector3(state.pos[0], state.pos[1], state.pos[2]),
      target: new THREE.Vector3(state.pos[0], state.pos[1], state.pos[2]),
      currentYaw: state.yaw,
      targetYaw: state.yaw,
      pitch: state.pitch,
      stridePhase: Math.random() * Math.PI * 2,
      speed: 0,
      alive: state.alive,
      operatorId: state.operatorId,
    };
    body.group.visible = state.alive;
    this.tint(group, state.operatorId, state.id);
    this.scene.add(group);
    return body;
  }

  /**
   * Paint a body in its operator's colours.
   *
   * Materials are cloned per body: the template's materials are shared with
   * every other clone and with the local player, so tinting in place would
   * repaint the whole lobby one colour.
   *
   * An unknown operator id falls back to a stable per-player choice rather
   * than a default, so a roster addition the client does not recognise still
   * produces a distinct-looking player instead of a crowd of identical ones.
   */
  private tint(group: THREE.Object3D, operatorId: string, playerId: string): void {
    const operator = getOperator(operatorId)
      ?? OPERATORS[hashString(playerId) % OPERATORS.length];
    const primary = new THREE.Color(operator.primaryColor);
    const accent = new THREE.Color(operator.accentColor);
    group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const material = (mesh.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
      if (material.color) {
        material.color.copy(mesh.name.startsWith('Detail_') ? accent : primary);
      }
      mesh.material = material;
    });
  }

  private despawn(body: Body): void {
    this.scene?.remove(body.group);
    body.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }

  /** Ease every body toward the server's truth and run its walk cycle. */
  update(dt: number): void {
    const positionAlpha = 1 - Math.exp(-POSITION_LERP * dt);
    const yawAlpha = 1 - Math.exp(-YAW_LERP * dt);

    for (const body of this.bodies.values()) {
      body.current.lerp(body.target, positionAlpha);
      body.currentYaw += shortestAngle(body.currentYaw, body.targetYaw) * yawAlpha;

      body.group.position.copy(body.current);
      // The model faces -Z, matching the server's forward of (-sin, cos).
      body.group.rotation.y = body.currentYaw;

      if (!body.alive) continue;

      const moving = body.speed > MOVING_SPEED;
      if (moving) body.stridePhase += dt * body.speed * STRIDE_RATE * Math.PI * 2;

      const swing = moving ? Math.sin(body.stridePhase) * STRIDE_SWING : 0;
      const { joints, rest } = body;

      // Pose from rest every frame. Accumulating onto the live quaternion
      // drifts, and a body that has been walking for a minute ends up folded.
      poseX(joints.legR, rest, swing);
      poseX(joints.legL, rest, -swing);
      poseX(joints.armR, rest, -swing * 0.55);
      poseX(joints.armL, rest, swing * 0.55);
      // The head tracks where they are actually looking, which is the tell a
      // player reads to know whether they have been seen.
      poseX(joints.head, rest, -body.pitch * 0.7);
      poseX(joints.chest, rest, -body.pitch * 0.25);
    }
  }

  /** Drop every body. Called when a match ends. */
  clear(): void {
    for (const body of this.bodies.values()) this.despawn(body);
    this.bodies.clear();
  }

  /** Test seam. */
  get count(): number { return this.bodies.size; }

  /** Test seam: where a given player is being drawn. */
  positionOf(id: string): [number, number, number] | null {
    const body = this.bodies.get(id);
    return body ? [body.current.x, body.current.y, body.current.z] : null;
  }

  /** Test seam: whether a body is currently visible. */
  isVisible(id: string): boolean {
    return this.bodies.get(id)?.group.visible ?? false;
  }
}

function poseX(
  joint: THREE.Object3D | null,
  rest: Map<THREE.Object3D, THREE.Quaternion>,
  angle: number,
): void {
  if (!joint) return;
  const base = rest.get(joint);
  if (!base) return;
  joint.quaternion.copy(base);
  joint.rotateX(angle);
}

/** Signed shortest angular distance from `from` to `to`. */
function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function setLayerRecursive(root: THREE.Object3D, layer: number): void {
  root.traverse((node) => { node.layers.set(layer); });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export default RemotePlayers;
