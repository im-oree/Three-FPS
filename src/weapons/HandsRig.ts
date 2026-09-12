/**
 * HandsRig.ts — procedural first-person hands (hands-first phase, pre-Doc-4).
 *
 * The committed hand model ships a full arm+finger skeleton but ZERO clips,
 * so EVERY pose is procedural here: boxing guard, finger clench, punch
 * wind-up/strike/recover arc. Retarget-ready: bones are resolved by ROLE via
 * the HANDS_BONE_ROLES regex table in Constants — a different hand model only
 * needs new patterns, never code changes. Poses are stored as REST-quaternion
 * × local delta, so any bind pose works.
 *
 * Lives as a base layer under the WeaponViewmodel rig, inheriting its sway,
 * breathing, chase-lag and hip/ADS offsets for free.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { HANDS_BONE_ROLES, MELEE } from '../utils/Constants';
import type { AssetLoader } from '../core/AssetLoader';
import type { WeaponViewmodel } from './WeaponViewmodel';

const X_AXIS = new THREE.Vector3(1, 0, 0);

interface PoseBoneFix {
  bone: THREE.Bone;
  gQ: THREE.Quaternion; gP: THREE.Vector3;
  sQ: THREE.Quaternion; sP: THREE.Vector3;
}

interface FingerChain {
  bones: THREE.Bone[];
  rest: THREE.Quaternion[];
  thumb: boolean;
}

export class HandsRig {
  private root: THREE.Group | null = null;
  private readonly fingers: FingerChain[] = [];
  private readonly knuckBones: Record<'R' | 'L', THREE.Bone | null> = { R: null, L: null };
  /** Per-side arm aim fixes (elbow dir + forearm->wrist point), same
   *  measurement/conjugation scheme as the fist fixes. */
  private readonly armFix: Record<'R' | 'L', {
    upper: PoseBoneFix; fore: PoseBoneFix; foreEnd: THREE.Bone;
  } | null> = { R: null, L: null };
  private readonly tipBones: Record<'R' | 'L', THREE.Bone | null> = { R: null, L: null };
  /** Per-side fist-aim corrections derived by MEASURING the authored rest
   *  pose at load time (knuckle pointing dir -> target dir, rotated about
   *  the wrist origin so the hand/twist skin seam never stretches). Stored
   *  as local quaternions for guard (g) and strike (s) variants. */
  private readonly fistFix: Record<'R' | 'L', {
    bone: THREE.Bone;
    gQ: THREE.Quaternion; gP: THREE.Vector3;
    sQ: THREE.Quaternion; sP: THREE.Vector3;
  } | null> = { R: null, L: null };
  private punchSide: 'R' | 'L' = 'R';
  private strike = 0;
  private lastPoseT = -1;
  private lastCurl = -1;
  private bakedOnce = false;
  private servoSettled = false;
  private servoMoved = false;
  private curl: number = MELEE.GUARD_CURL;
  private curlTarget: number = MELEE.GUARD_CURL;
  private skin0: THREE.SkinnedMesh | null = null;
  private readonly bake: {
    mesh: THREE.Mesh;
    skinned: THREE.SkinnedMesh;
    skeleton: THREE.Skeleton;
    basePos: Float32Array;
    baseNrm: Float32Array;
    boneMats: THREE.Matrix4[];
  }[] = [];
  private readonly bakeV = new THREE.Vector3();
  private readonly servoAcc = new THREE.Vector3();
  private readonly servoTgt = new THREE.Vector3();
  private readonly servoV = new THREE.Vector3();
  private poseT = 0; // <0 wind-up, 0 guard, 1 strike peak
  private poseTarget: number = 0;
  private punchClock = -1;
  private readonly quat = new THREE.Quaternion();

  constructor(private readonly assetLoader: AssetLoader) {
    eventBus.on('melee:swung', () => {
      this.punchClock = 0; // fresh swing restarts the timeline
      this.punchSide = this.punchSide === 'R' ? 'L' : 'R'; // alternate jabs
    });
  }

  async load(): Promise<void> {
    const { scene } = await this.assetLoaderLoad();
    this.root = scene;
    this.root.scale.setScalar(MELEE.HANDS_SCALE);
    // The CPU bake recomputes outward normals every frame, so single-sided
    // skinning-free meshes shade correctly and halve fragment cost.
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        // Authored-in-cm bounding spheres make frustum culling unreliable at
        // viewmodel scale; the hands are always on screen anyway.
        mesh.frustumCulled = false;
      }
    });
    const findBone = (pattern: string): THREE.Bone | null => {
      let hit: THREE.Bone | null = null;
      const re = new RegExp(pattern);
      scene.traverse((o) => {
        const bone = o as THREE.Bone;
        if (!hit && bone.isBone && re.test(bone.name)) hit = bone;
      });
      return hit;
    };
    const chainRoles: Array<[keyof typeof HANDS_BONE_ROLES, boolean]> = [
      ['indexR', false], ['middleR', false], ['ringR', false], ['pinkyR', false], ['thumbR', true],
      ['indexL', false], ['middleL', false], ['ringL', false], ['pinkyL', false], ['thumbL', true],
    ];
    for (const [role, thumb] of chainRoles) {
      const patterns = HANDS_BONE_ROLES[role] as readonly string[];
      const bones: THREE.Bone[] = [];
      const rest: THREE.Quaternion[] = [];
      for (const pattern of patterns) {
        const bone = findBone(pattern);
        if (bone) { bones.push(bone); rest.push(bone.quaternion.clone()); }
      }
      if (bones.length) this.fingers.push({ bones, rest, thumb });
    }
    // Imported rigs (Sketchfab exports) ship inverse bind matrices that
    // disagree with their own node transforms (unit flips, axis conversions)
    // — skinned vertices explode ~100x. Re-derive inverses from the LIVE rest
    // pose so rest-pose skinning is identity on ANY hand model (retarget
    // safety), then normalize per-mesh unit mismatches to the smallest mesh.
    scene.updateWorldMatrix(true, true);
    const skins: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) skins.push(m);
    });
    for (const m of skins) m.skeleton.calculateInverses();
    this.skin0 = skins[0] ?? null;

    // CPU skinning bake: the authored rig's GPU skinning path renders empty
    // on some drivers (bone-texture vertex fetch), so every frame we bake
    // post-skin positions/normals into the geometry and draw plain meshes.
    // Identical results on every backend, and retarget-safe.
    const maxVerts = Math.max(...skins.map((m) => m.geometry.attributes.position.count));
    for (const m of skins) {
      // Export junk (nail shards with broken weights) flies apart under pose.
      if (m.geometry.attributes.position.count < maxVerts * MELEE.HANDS_JUNK_MESH_RATIO) {
        m.visible = false;
        continue;
      }
      const geo = m.geometry;
      this.bake.push({
        mesh: m as THREE.Mesh,
        skinned: m,
        skeleton: m.skeleton,
        basePos: Float32Array.from(geo.attributes.position.array as Float32Array),
        baseNrm: Float32Array.from(geo.attributes.normal.array as Float32Array),
        boneMats: m.skeleton.bones.map(() => new THREE.Matrix4()),
      });
      // Plain-mesh rendering: the bake supplies skinned positions.
      (m as unknown as { isSkinnedMesh: boolean }).isSkinnedMesh = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.needsUpdate = true;
    }
    const sizes = skins.map((m) => {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox as THREE.Box3;
      return bb.max.distanceTo(bb.min);
    });
    const minSize = Math.min(...sizes);
    skins.forEach((m, i) => {
      const f = minSize / sizes[i];
      if (f < 0.999 || f > 1.001) m.scale.setScalar(f);
    });

    // World-preserving reparent: this rig hangs the twist bones (parents of
    // the hands) off the ROOT, which disconnects the arm chain and makes any
    // arm posing tear interleaved skin weights. Re-parenting under the
    // forearm keeps every world matrix identical (so skinning is untouched)
    // but yields a fully connected clavicle->upper->fore->twist->hand tree.
    for (const side of ['R', 'L'] as const) {
      const fore = findBone(side === 'R' ? '^forearmR_\\d' : '^forearmL_\\d');
      const twist = findBone(side === 'R' ? '^forearmR001_' : '^forearmL001_');
      if (!fore || !twist || twist.parent === fore) continue;
      fore.updateWorldMatrix(true, false);
      twist.updateWorldMatrix(true, false);
      const local = new THREE.Matrix4().copy(fore.matrixWorld).invert().multiply(twist.matrixWorld);
      fore.add(twist);
      local.decompose(twist.position, twist.quaternion, twist.scale);
    }

    for (const side of ['R', 'L'] as const) {
      const upper = findBone(side === 'R' ? '^upper_armR_' : '^upper_armL_');
      const fore = findBone(side === 'R' ? '^forearmR_\\d' : '^forearmL_\\d');
      const foreEnd = findBone(side === 'R' ? '^forearmR_end_' : '^forearmL_end_');
      if (upper && fore && foreEnd) this.armFix[side] = {
        upper: { bone: upper, gQ: new THREE.Quaternion(), gP: upper.position.clone(), sQ: new THREE.Quaternion(), sP: upper.position.clone() },
        fore: { bone: fore, gQ: new THREE.Quaternion(), gP: fore.position.clone(), sQ: new THREE.Quaternion(), sP: fore.position.clone() },
        foreEnd,
      };
      const hand = findBone(HANDS_BONE_ROLES[side === 'R' ? 'handR' : 'handL'] as string);
      const knuck = findBone(side === 'R' ? '^f_index01R_' : '^f_index01L_');
      const tip = findBone(side === 'R' ? '^f_index03R_' : '^f_index03L_');
      if (!hand || !knuck || !tip) continue;
      this.knuckBones[side] = knuck;
      this.tipBones[side] = tip;
      this.fistFix[side] = {
        bone: hand,
        gQ: new THREE.Quaternion(), gP: hand.position.clone(),
        sQ: new THREE.Quaternion(), sP: hand.position.clone(),
      };
    }
    this.computePoseFixes();
  }

  /** Derive guard + strike corrections for arms AND fists by MEASURING the
   *  authored rest pose, stage by stage (each measurement sees the corrected
   *  parent frame):
   *    1. upper_arm: elbow direction (shoulder pivot),
   *    2. forearm: aim its end bone at the guard/strike wrist POINT (elbow
   *       pivot; twist+hand follow through the load-time reparent),
   *    3. hand: knuckle pointing dir + palm-side roll (wrist pivot).
   *  Every correction is a pivot-exact rotation conjugated by the FULL parent
   *  world into bone-local (quaternion + position), so it composes over any
   *  bind orientation - identical behavior on any future hand model. */
  private computePoseFixes(): void {
    const root = this.root;
    if (!root) return;
    const rest: Record<string, { q: THREE.Quaternion; p: THREE.Vector3 }> = {};
    const noteRest = (f: PoseBoneFix) => {
      rest[f.bone.uuid] = { q: f.bone.quaternion.clone(), p: f.bone.position.clone() };
    };
    const setRest = (f: PoseBoneFix) => {
      const r = rest[f.bone.uuid];
      if (r) { f.bone.quaternion.copy(r.q); f.bone.position.copy(r.p); }
    };
    for (const side of ['R', 'L'] as const) {
      const a = this.armFix[side];
      const h = this.fistFix[side];
      if (a) { noteRest(a.upper); noteRest(a.fore); }
      if (h) noteRest(h);
    }
    this.applyFingerCurl(MELEE.GUARD_CURL);
    const wp = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());
    for (const variant of ['g', 's'] as const) {
      const armTable = (variant === 'g' ? MELEE.GUARD_ARM : MELEE.STRIKE_ARM) as {
        elbow: readonly number[]; forearmDir: readonly number[];
      };
      const fistTable = (variant === 'g' ? MELEE.FIST_GUARD_DIR : MELEE.FIST_STRIKE_DIR) as readonly number[];
      const palmTable = (variant === 'g'
        ? MELEE.FIST_PALM_GUARD_DIR : MELEE.FIST_PALM_STRIKE_DIR) as readonly number[];
      for (const side of ['R', 'L'] as const) {
        const a = this.armFix[side];
        const h = this.fistFix[side];
        if (a) { setRest(a.upper); setRest(a.fore); }
        if (h) setRest(h);
      }
      root.updateWorldMatrix(true, true);
      const rootQInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      /** Pivot-exact root-space rotation M = T(p) Q T(-p) -> bone-local fix. */
      const solve = (fix: PoseBoneFix, qRoot: THREE.Quaternion, store: 'g' | 's') => {
        const p = wp(fix.bone).applyMatrix4(rootInv);
        const M = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)
          .multiply(new THREE.Matrix4().makeRotationFromQuaternion(qRoot))
          .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
        const WpR = fix.bone.parent
          ? rootInv.clone().multiply(fix.bone.parent.matrixWorld)
          : new THREE.Matrix4();
        const newL = WpR.clone().invert().multiply(M).multiply(WpR).multiply(
          new THREE.Matrix4().compose(fix.bone.position, fix.bone.quaternion, new THREE.Vector3(1, 1, 1)),
        );
        const qF = new THREE.Quaternion().setFromRotationMatrix(newL);
        const pF = new THREE.Vector3().setFromMatrixPosition(newL);
        if (store === 'g') { fix.gQ.copy(qF); fix.gP.copy(pF); }
        else { fix.sQ.copy(qF); fix.sP.copy(pF); }
        fix.bone.quaternion.copy(qF);
        fix.bone.position.copy(pF);
      };
      for (const side of ['R', 'L'] as const) {
        const sx = side === 'R' ? 1 : -1;
        const a = this.armFix[side];
        if (a) {
          const elbowWant = new THREE.Vector3(
            (armTable.elbow[0] ?? 0) * sx, armTable.elbow[1] ?? 0, armTable.elbow[2] ?? 0,
          ).normalize();
          const curElbow = wp(a.fore.bone).sub(wp(a.upper.bone)).applyQuaternion(rootQInv).normalize();
          solve(a.upper, new THREE.Quaternion().setFromUnitVectors(curElbow, elbowWant), variant);
          root.updateWorldMatrix(true, true);
          const curWrist = wp(a.foreEnd).sub(wp(a.fore.bone)).applyQuaternion(rootQInv).normalize();
          const wantWrist = new THREE.Vector3(
            (armTable.forearmDir[0] ?? 0) * sx, armTable.forearmDir[1] ?? 0, armTable.forearmDir[2] ?? 0,
          ).normalize();
          solve(a.fore, new THREE.Quaternion().setFromUnitVectors(curWrist, wantWrist), variant);
          root.updateWorldMatrix(true, true);
        }
        const h = this.fistFix[side];
        const knuck = this.knuckBones[side];
        if (!h || !knuck) continue;
        const cur = wp(knuck).sub(wp(h.bone)).applyQuaternion(rootQInv).normalize();
        const want = new THREE.Vector3(
          (fistTable[0] ?? 0) * sx, fistTable[1] ?? 0, fistTable[2] ?? 0,
        ).normalize();
        const q1 = new THREE.Quaternion().setFromUnitVectors(cur, want);
        // Roll about the pointing axis so the dorsal/knuckle face reads
        // toward the camera instead of the palm loop.
        const tip = this.tipBones[side];
        let qRoot = q1;
        if (tip) {
          const tipRest = wp(tip).sub(wp(h.bone)).applyQuaternion(rootQInv).normalize();
          const v1 = tipRest.clone().applyQuaternion(q1);
          const proj = (v: THREE.Vector3) => v.addScaledVector(want, -v.dot(want)).normalize();
          const palmWant = proj(new THREE.Vector3(
            (palmTable[0] ?? 0) * sx, palmTable[1] ?? 0, palmTable[2] ?? 0,
          ));
          const v1p = proj(v1);
          if (v1p.lengthSq() > 1e-6 && palmWant.lengthSq() > 1e-6) {
            qRoot = new THREE.Quaternion().setFromUnitVectors(v1p, palmWant).multiply(q1);
          }
        }
        solve(h, qRoot, variant);
        root.updateWorldMatrix(true, true);
      }
    }
    this.applyPoseFixes(0, 0);
  }

  /** Guard->strike slerp per side (ext = 0 guard, 1 full extension). */
  private applyPoseFixes(extR: number, extL: number): void {
    for (const side of ['R', 'L'] as const) {
      const ext = side === 'R' ? extR : extL;
      const a = this.armFix[side];
      if (a) {
        a.upper.bone.quaternion.copy(a.upper.gQ).slerp(a.upper.sQ, ext);
        a.upper.bone.position.copy(a.upper.gP).lerp(a.upper.sP, ext);
        a.fore.bone.quaternion.copy(a.fore.gQ).slerp(a.fore.sQ, ext);
        a.fore.bone.position.copy(a.fore.gP).lerp(a.fore.sP, ext);
      }
      const f = this.fistFix[side];
      if (f) {
        f.bone.quaternion.copy(f.gQ).slerp(f.sQ, ext);
        f.bone.position.copy(f.gP).lerp(f.sP, ext);
      }
    }
  }

  /** Finger clench applied over rest quaternions (shared load/update path). */
  private applyFingerCurl(curl: number): void {
    for (const chain of this.fingers) {
      const rads = chain.thumb ? MELEE.THUMB_CURL_RAD : MELEE.FINGER_CURL_RAD;
      for (let i = 0; i < chain.bones.length; i += 1) {
        const rad = curl * (rads[Math.min(i, rads.length - 1)] ?? 0);
        this.quat.setFromAxisAngle(X_AXIS, rad);
        chain.bones[i].quaternion.copy(chain.rest[i]).multiply(this.quat);
      }
    }
  }

  /** Mean post-skin position of strided vertices, in viewmodel space. */
  private skinnedCenterVM(out: THREE.Vector3): THREE.Vector3 {
    const m = this.skin0 as THREE.SkinnedMesh;
    m.updateWorldMatrix(true, false);
    m.skeleton.update();
    const pos = m.geometry.attributes.position;
    const si = m.geometry.attributes.skinIndex;
    out.set(0, 0, 0);
    const N = 8;
    const v = this.servoV;
    for (let k = 0; k < N; k += 1) {
      const idx = Math.floor(((k + 0.5) / N) * pos.count);
      // The live position attribute IS the baked L (bindMatrix*boneMat*v);
      // the renderer only supplies meshWorld on top. Re-applying bone
      // matrices here would measure a doubly-skinned phantom space and steer
      // the servo away from where the hands actually draw.
      void si;
      v.fromBufferAttribute(pos, idx);
      v.applyMatrix4(m.matrixWorld);
      out.add(v);
    }
    return out.multiplyScalar(1 / N);
  }

  private assetLoaderLoad(): Promise<{ scene: THREE.Group }> {
    // Imported models live at repo root (ASSET_ROOTS.imported), so bypass the
    // models root and load by absolute logical path.
    return this.assetLoader.loadModelWithAnimations('/first_person_hands_rigged.glb');
  }

  attach(viewmodel: WeaponViewmodel): void {
    if (this.root) viewmodel.addBaseLayer(this.root);
  }

  update(dt: number, camera?: THREE.PerspectiveCamera): void {
    if (!this.root) return;

    // Placement servo: imported rigs carry arbitrary unit/axis/rest quirks,
    // so instead of trusting authored offsets we measure where the skinned
    // hands actually land in viewmodel space (8-vertex CPU sample) and steer
    // the root toward HANDS_VIEW_TARGET every frame. Self-calibrating for
    // any future hand model (retarget safety).
    if (this.strike > 0) this.servoSettled = false;
    this.servoMoved = false;
    if (this.skin0 && this.root.parent && !this.servoSettled) {
      const cur = this.skinnedCenterVM(this.servoAcc);
      const jab = this.strike;
      const cross = this.punchSide === 'R' ? -1 : 1;
      const tgt = this.servoTgt.set(
        MELEE.HANDS_VIEW_TARGET.x + cross * MELEE.PUNCH_JAB_LATERAL * jab,
        MELEE.HANDS_VIEW_TARGET.y + MELEE.PUNCH_JAB_LIFT * jab,
        MELEE.HANDS_VIEW_TARGET.z - MELEE.PUNCH_HAND_THRUST * jab,
      );
      const err = tgt.sub(cur);
      if (err.length() > 0.002) {
        err.applyQuaternion(this.root.parent.getWorldQuaternion(this.quat).invert());
        this.root.position.addScaledVector(err, 0.35);
        // Root translation only reaches the VISIBLE geometry through the CPU
        // bake (bone matrices are folded into attributes), so steering frames
        // must rebake or the mesh stays stale where it was first baked.
        this.servoMoved = true;
      } else {
        this.servoSettled = true; // idle frames cost nothing
      }
    }

    // Punch timeline -> pose/clench targets.
    if (this.punchClock >= 0) {
      // Clamp so low-fps heads (headless CI) still sample the whole arc.
      this.punchClock += Math.min(dt, 1 / 30);
      const w = MELEE.WINDUP_SECONDS;
      const st = MELEE.STRIKE_SECONDS;
      const r = MELEE.RECOVER_SECONDS;
      const t = this.punchClock;
      if (t < w) {
        this.poseTarget = -0.35 * (t / w); // coil back
        this.curlTarget = MELEE.PUNCH_CURL;
      } else if (t < w + st) {
        this.poseTarget = 1; // extend
        this.curlTarget = MELEE.PUNCH_CURL;
      } else if (t < w + st + r) {
        const k = (t - w - st) / r;
        this.poseTarget = 1 - k; // ease back to guard
        this.curlTarget = MELEE.PUNCH_CURL + (MELEE.GUARD_CURL - MELEE.PUNCH_CURL) * k;
      } else {
        this.punchClock = -1;
        this.poseTarget = 0;
        this.curlTarget = MELEE.GUARD_CURL;
      }
    } else {
      this.poseTarget = 0;
      this.curlTarget = MELEE.GUARD_CURL;
    }
    const smooth = 1 - Math.exp(-MELEE.POSE_SMOOTH * dt);
    this.poseT += (this.poseTarget - this.poseT) * smooth;
    this.curl += (this.curlTarget - this.curl) * smooth;

    // Fingers: rest × local-X curl per phalanx.
    this.applyFingerCurl(this.curl);

    // Arms/hands: procedural aim chain (guard <-> strike slerp per side).
    // The jab thrust itself rides the placement servo TARGET below
    // (whole-rig rigid motion => zero seam stretch on any rig).
    void camera;
    const ext = Math.max(0, Math.min(1, this.poseT));
    this.applyPoseFixes(this.punchSide === 'R' ? ext : 0, this.punchSide === 'L' ? ext : 0);

    this.strike = Math.max(0, Math.min(1, this.poseT));

    // Rebake only while something actually deforms (punch arc / clench ease);
    // the idle guard is static and root motion needs no rebake (bone deltas
    // are root-independent), so sustained-idle frames cost zero skinning.
    const deforming = Math.abs(this.poseT - this.lastPoseT) > 1e-4
      || Math.abs(this.curl - this.lastCurl) > 1e-4
      || this.servoMoved;
    if (deforming || !this.bakedOnce) {
      this.bakeSkin();
      this.bakedOnce = true;
    }
    this.lastPoseT = this.poseT;
    this.lastCurl = this.curl;
  }

  /** CPU skinning: fold bone deltas + mesh world into per-bone matrices once,
   *  then blend base-pose vertices into the live geometry attributes. */
  private bakeSkin(): void {
    for (const b of this.bake) {
      const m = b.mesh;
      m.updateWorldMatrix(true, false);
      b.skeleton.update();
      // Shader chain: world = meshWorld * bindMatrix * boneMat * v, so the
      // attribute value must be L = bindMatrix * boneMat * v (meshWorld is
      // supplied by the renderer). Conjugating by meshWorld here would scale
      // pose deltas by the authored unit factor and explode the mesh.
      for (let j = 0; j < b.skeleton.bones.length; j += 1) {
        b.boneMats[j]
          .fromArray(b.skeleton.boneMatrices, j * 16)
          .premultiply(b.skinned.bindMatrix);
      }
      const pos = m.geometry.attributes.position;
      const nrm = m.geometry.attributes.normal;
      const si = m.geometry.attributes.skinIndex;
      const sw = m.geometry.attributes.skinWeight;
      const pa = pos.array as Float32Array;
      const na = nrm.array as Float32Array;
      const v = this.bakeV;
      for (let i = 0; i < pos.count; i += 1) {
        const bx = i * 3;
        let ox = 0; let oy = 0; let oz = 0;
        let nx = 0; let ny = 0; let nz = 0;
        const w0 = sw.getX(i); const w1 = sw.getY(i);
        const w2 = sw.getZ(i); const w3 = sw.getW(i);
        const i0 = si.getX(i); const i1 = si.getY(i);
        const i2 = si.getZ(i); const i3 = si.getW(i);
        const wx = [w0, w1, w2, w3];
        const ix = [i0, i1, i2, i3];
        for (let k = 0; k < 4; k += 1) {
          const w = wx[k];
          if (w === 0) continue;
          const e = b.boneMats[ix[k]].elements;
          const px = b.basePos[bx]; const py = b.basePos[bx + 1]; const pz = b.basePos[bx + 2];
          ox += w * (e[0] * px + e[4] * py + e[8] * pz + e[12]);
          oy += w * (e[1] * px + e[5] * py + e[9] * pz + e[13]);
          oz += w * (e[2] * px + e[6] * py + e[10] * pz + e[14]);
          const qx = b.baseNrm[bx]; const qy = b.baseNrm[bx + 1]; const qz = b.baseNrm[bx + 2];
          nx += w * (e[0] * qx + e[4] * qy + e[8] * qz);
          ny += w * (e[1] * qx + e[5] * qy + e[9] * qz);
          nz += w * (e[2] * qx + e[6] * qy + e[10] * qz);
        }
        pa[bx] = ox; pa[bx + 1] = oy; pa[bx + 2] = oz;
        const nl = Math.hypot(nx, ny, nz) || 1;
        na[bx] = nx / nl; na[bx + 1] = ny / nl; na[bx + 2] = nz / nl;
        void v;
      }
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
      m.geometry.computeBoundingSphere();
    }
  }
}

export default HandsRig;
