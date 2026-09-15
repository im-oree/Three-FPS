/**
 * OperatorShowcase.ts — the live operator standing in the menu.
 *
 * This is the centrepiece of the Call of Duty menu look: a real 3D operator,
 * lit dramatically, holding the weapon the player actually has equipped,
 * breathing and shifting his weight while the camera drifts almost
 * imperceptibly.
 *
 * WHY A REAL SCENE AND NOT A PRE-RENDERED IMAGE
 * ---------------------------------------------
 * The pose has to reflect the loadout. Swapping the primary must change the
 * gun in his hands immediately, which a baked image cannot do without one
 * render per weapon-skin-stance combination.
 *
 * It renders into its own canvas behind the menu DOM, on its own scene and
 * camera, so it cannot disturb the gameplay renderer's state. It is disposed
 * the moment the menu closes: a menu that keeps a scene alive behind a match
 * is a menu that costs frames during gameplay.
 */
import * as THREE from 'three';
import type { AssetLoader } from '../../core/AssetLoader';
import { solveJointIK, applyJointSolution, type JointChain } from '../../character/JointIK';
import { getWeapon } from '../../weapons/definitions';
import { MENU_SHOWCASE } from '../../utils/Constants';

export type ShowcaseStance = 'stand' | 'ready';

export class OperatorShowcase {
  readonly canvas: HTMLCanvasElement;

  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private root: THREE.Group | null = null;
  private weaponProp: THREE.Object3D | null = null;

  /** Joints we animate, resolved once after load. */
  private joints: Record<string, THREE.Object3D | null> = {};
  private readonly restQuat = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly restPos = new Map<THREE.Object3D, THREE.Vector3>();

  private elapsed = 0;
  private running = false;
  private stance: ShowcaseStance = 'stand';
  private loadToken = 0;
  /** Meshes whose material has been cloned for tinting. */
  private readonly tinted = new Set<THREE.Mesh>();
  /** Arm chains for the IK solver, resolved after load. */
  private readonly chains: Record<'R' | 'L', JointChain | null> = { R: null, L: null };
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchPole = new THREE.Vector3();
  private readonly scratchOffset = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  /** Rest intensities, so exposure scaling is never cumulative. */
  private readonly baseIntensity = new Map<THREE.Light, number>();
  private exposureScale = 1;
  /** The weapon hangs here, in body space, and the hands chase it. */
  private readonly weaponMount = new THREE.Group();
  /** Grip points in weapon-local space, measured from the model. */
  private gripRear: THREE.Vector3 | null = null;
  private gripFront: THREE.Vector3 | null = null;

  /** Camera drift state, integrated rather than sampled, so it never snaps. */
  private readonly driftBase = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  constructor(private readonly assetLoader: AssetLoader) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'operator-showcase';

    this.camera = new THREE.PerspectiveCamera(
      MENU_SHOWCASE.FOV, 1, 0.1, 50,
    );
    this.driftBase.set(
      MENU_SHOWCASE.CAMERA_POS[0],
      MENU_SHOWCASE.CAMERA_POS[1],
      MENU_SHOWCASE.CAMERA_POS[2],
    );
    this.lookTarget.set(0, MENU_SHOWCASE.LOOK_HEIGHT, 0);
    this.buildLighting();
  }

  get isReady(): boolean { return this.root !== null; }

  /**
   * Three-point lighting, deliberately hard and cold.
   *
   * A flat ambient fill would read as a character viewer; the strong rim and
   * the low warm kicker are what make it read as a menu hero shot.
   */
  private buildLighting(): void {
    const key = new THREE.DirectionalLight(0xd8e2f0, 1.55);
    key.position.set(-2.6, 3.0, -2.6);
    this.scene.add(key);

    // Rim from behind separates the silhouette from the dark background --
    // without it the operator disappears into the backdrop.
    const rim = new THREE.DirectionalLight(0x9ec6ff, 2.6);
    rim.position.set(2.6, 2.6, 3.4);
    this.scene.add(rim);

    const kick = new THREE.PointLight(0xff8c3a, 3.2, 7, 2);
    kick.position.set(1.5, 0.6, -1.9);
    this.scene.add(kick);

    this.scene.add(new THREE.HemisphereLight(0x1e2836, 0x05070a, 0.30));

    // Remember rest intensities before anything scales them.
    this.scene.traverse((node) => {
      const light = node as THREE.Light;
      if (light.isLight) this.baseIntensity.set(light, light.intensity);
    });

    // A ground disc catches the key light so the operator is not floating.
    // Its alpha falls off toward the rim: a hard-edged plane reads as a
    // rectangle sitting in the frame, which is worse than no floor at all.
    const floorGeometry = new THREE.CircleGeometry(2.4, 64).rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(
      floorGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { color: { value: new THREE.Color(0x121821) } },
        vertexShader: `
          varying vec2 vLocal;
          void main() {
            vLocal = position.xz / 2.4;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 color;
          varying vec2 vLocal;
          void main() {
            float edge = 1.0 - smoothstep(0.35, 1.0, length(vLocal));
            gl_FragColor = vec4(color, edge * 0.85);
          }
        `,
      }),
    );
    floor.position.y = 0.001;
    this.scene.add(floor);
  }

  /** Attach to the DOM and start rendering. */
  mount(parent: HTMLElement): void {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: true, alpha: true,
        powerPreference: 'low-power',
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = MENU_SHOWCASE.EXPOSURE * this.exposureScale;
    }
    parent.appendChild(this.canvas);
    this.running = true;
    this.resize();
  }

  /** Stop rendering and detach, keeping the loaded model for re-entry. */
  unmount(): void {
    this.running = false;
    this.canvas.remove();
  }

  /** Permanent teardown; releases GPU memory. */
  dispose(): void {
    this.unmount();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }

  async load(): Promise<void> {
    if (this.root) return;
    const token = ++this.loadToken;
    const model = await this.assetLoader.loadModel(MENU_SHOWCASE.BODY_PATH);
    // A second load may have started (or the menu closed) while this awaited.
    if (token !== this.loadToken) return;

    this.root = model as THREE.Group;
    this.root.position.set(0, 0, 0);
    this.root.rotation.y = MENU_SHOWCASE.BODY_YAW;
    this.scene.add(this.root);
    this.root.add(this.weaponMount);

    const find = (name: string): THREE.Object3D | null =>
      this.root?.getObjectByName(name) ?? null;
    this.joints = {
      pelvis: find('Bone_Pelvis'),
      spine: find('Bone_Spine'),
      chest: find('Bone_Chest'),
      neck: find('Bone_Neck'),
      head: find('Bone_Head'),
      shoulderR: find('Shoulder_R'),
      shoulderL: find('Shoulder_L'),
      upperArmR: find('UpperArmPivot_R'),
      upperArmL: find('UpperArmPivot_L'),
      elbowR: find('ElbowPivot_R'),
      elbowL: find('ElbowPivot_L'),
      wristR: find('WristPivot_R'),
      wristL: find('WristPivot_L'),
      gripR: find('Socket_HandGrip_R'),
      gripL: find('Socket_HandGrip_L'),
      hipR: find('HipPivot_R'),
      hipL: find('HipPivot_L'),
      kneeR: find('KneePivot_R'),
      kneeL: find('KneePivot_L'),
      ankleR: find('AnklePivot_R'),
      ankleL: find('AnklePivot_L'),
    };

    // Record rest transforms; every frame is rest + offset, never cumulative.
    for (const joint of Object.values(this.joints)) {
      if (!joint) continue;
      this.restQuat.set(joint, joint.quaternion.clone());
      this.restPos.set(joint, joint.position.clone());
    }
    // Wire the two arm chains for the IK solver. The grip socket is the
    // wrist: it is where the weapon hangs, so solving to it puts the gun
    // exactly where the pose asks for it.
    for (const side of ['R', 'L'] as const) {
      const shoulder = this.joints[`shoulder${side}`];
      const upperArm = this.joints[`upperArm${side}`];
      const elbow = this.joints[`elbow${side}`];
      const wrist = this.joints[`wrist${side}`];
      if (shoulder && upperArm && elbow && wrist) {
        this.chains[side] = {
          shoulderPivot: shoulder, upperArmPivot: upperArm,
          elbowPivot: elbow, wristPivot: wrist,
        };
      }
    }
    this.applyStancePose(0);
  }

  /**
   * Put the currently equipped weapon in his hands.
   *
   * The weapon is parented to the BODY and placed in body space, then both
   * hands are IK'd onto its real grip points. The obvious alternative --
   * parenting the gun to the right hand -- cannot work here: it makes the
   * left hand's correct position depend on a chain that has not been solved
   * yet, so the support hand always floats. Anchoring the weapon and letting
   * the arms chase it is what real weapon rigs do.
   */
  async setWeapon(weaponId: string): Promise<void> {
    await this.load();
    if (!this.root) return;

    const definition = getWeapon(weaponId);
    if (!definition) return;

    const token = ++this.loadToken;
    const model = await this.assetLoader.loadModel(definition.modelPath);
    if (token !== this.loadToken) return;

    if (this.weaponProp) {
      this.weaponProp.removeFromParent();
      this.weaponProp = null;
    }

    // Clone the material: the showcase and the gameplay viewmodel must not
    // share one, or a tint in the menu leaks into the match.
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        mesh.material = (mesh.material as THREE.Material).clone();
      }
    });

    this.weaponMount.add(model);
    this.weaponProp = model;
    this.measureGrips(model);
  }

  /**
   * Find where the hands belong on THIS weapon.
   *
   * Read from the model's own named parts rather than a per-weapon table of
   * magic numbers: a pistol has no foregrip, a sniper's support hand rides
   * the magazine well, and a table would silently rot the moment a weapon is
   * regenerated at a different size. Falls back to fractions of the bounding
   * box so an unnamed weapon still poses sanely.
   */
  private measureGrips(model: THREE.Object3D): void {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);

    const locate = (patterns: RegExp[]): THREE.Vector3 | null => {
      for (const pattern of patterns) {
        let found: THREE.Object3D | null = null;
        model.traverse((node) => {
          if (!found && pattern.test(node.name)) found = node;
        });
        if (found) {
          const point = new THREE.Vector3();
          (found as THREE.Object3D).getWorldPosition(point);
          return model.worldToLocal(point);
        }
      }
      return null;
    };

    // Trigger hand.
    this.gripRear = locate([/^Receiver_Trigger$/i, /^PistolGrip$/i, /^TriggerGrip$/i, /trigger/i])
      ?? new THREE.Vector3(0, box.min.y * 0.55, box.max.z * 0.35);

    // Support hand. Short weapons (pistols) get no support point at all --
    // a two-handed pistol grip would need the hands almost coincident.
    const length = box.max.z - box.min.z;
    this.gripFront = length < 0.45
      ? null
      : locate([/^Foregrip$/i, /^Bone_Pump$/i, /foregrip|handguard|pump|Magwell/i])
        ?? new THREE.Vector3(0, box.min.y * 0.4, box.min.z * 0.45);
  }

  /**
   * Test seam: a numeric fingerprint of the current pose.
   *
   * Harnesses cannot read this canvas back (no preserveDrawingBuffer), so
   * "is it animating" is proven from the skeleton and camera instead, which
   * is the state the renderer draws from anyway.
   */
  debugPose(): number[] {
    const out: number[] = [
      this.camera.position.x, this.camera.position.y, this.camera.rotation.z,
      this.weaponMount.position.y,
    ];
    for (const name of ['chest', 'head', 'hipR', 'hipL', 'kneeR', 'upperArmR'] as const) {
      const joint = this.joints[name];
      if (joint) out.push(joint.quaternion.x, joint.quaternion.y, joint.quaternion.z);
    }
    if (this.root) out.push(this.root.position.y, this.root.position.x);
    return out;
  }

  setStance(stance: ShowcaseStance): void {
    this.stance = stance;
  }

  /**
   * Brighten (or dim) the whole showcase.
   *
   * Operator select is a showroom: the player is judging a character, so the
   * dark-fatigue operators have to be legible. The lobby is a mood shot and
   * wants the opposite. One multiplier keeps both from needing separate
   * light rigs.
   */
  /** Body yaw override; operator select faces the player more squarely. */
  setBodyYaw(yaw: number): void {
    if (this.root) this.root.rotation.y = yaw;
  }

  setExposure(scale: number): void {
    this.exposureScale = scale;
    if (this.renderer) {
      this.renderer.toneMappingExposure = MENU_SHOWCASE.EXPOSURE * scale;
    }
    for (const [light, base] of this.baseIntensity) light.intensity = base * scale;
  }

  /**
   * Recolour the body for the selected operator.
   *
   * Operators share one mesh today, so identity is carried by the material
   * treatment. Materials are cloned on first tint -- the loaded model is
   * cached by AssetLoader and shared with gameplay, so tinting the originals
   * would repaint the player's body mid-match.
   */
  setOperatorTint(operator: { primaryColor: number; accentColor: number }): void {
    if (!this.root) return;
    const primary = new THREE.Color(operator.primaryColor);
    const accent = new THREE.Color(operator.accentColor);

    this.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      if (!this.tinted.has(mesh)) {
        mesh.material = (mesh.material as THREE.Material).clone();
        this.tinted.add(mesh);
      }
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material.color) return;
      // Detail meshes take the accent; the main body panels take the primary.
      material.color.copy(mesh.name.startsWith('Detail_') ? accent : primary);
    });
  }

  resize(): void {
    if (!this.renderer) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    // Cap the device pixel ratio: this runs behind a menu, and on an
    // integrated GPU a 4K backing store here costs real frames.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Advance and render one frame.
   *
   * Every motion here is small on purpose. The reference is a soldier standing
   * still, not an idle animation loop: breathing, a slow weight shift, and a
   * camera that drifts by centimetres. Anything larger reads as a character
   * viewer rather than a menu.
   */
  update(dt: number): void {
    if (!this.running || !this.renderer) return;
    this.elapsed += dt;
    this.applyStancePose(this.elapsed);
    this.driftCamera(this.elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  private driftCamera(time: number): void {
    const { DRIFT_AMPLITUDE, DRIFT_SPEED, SHAKE_AMPLITUDE, SHAKE_SPEED } = MENU_SHOWCASE;

    // Two incommensurable frequencies per axis, so the path never visibly
    // repeats -- a single sine reads as a mechanical sweep within seconds.
    const driftX = Math.sin(time * DRIFT_SPEED) * 0.6 + Math.sin(time * DRIFT_SPEED * 0.37) * 0.4;
    const driftY = Math.sin(time * DRIFT_SPEED * 0.73 + 1.1) * 0.5
      + Math.sin(time * DRIFT_SPEED * 0.29) * 0.5;

    // A separate, much faster and smaller term: the handheld-camera tremor.
    const shakeX = Math.sin(time * SHAKE_SPEED) * Math.sin(time * SHAKE_SPEED * 0.41);
    const shakeY = Math.cos(time * SHAKE_SPEED * 1.13) * Math.sin(time * SHAKE_SPEED * 0.27);

    this.camera.position.set(
      this.driftBase.x + driftX * DRIFT_AMPLITUDE + shakeX * SHAKE_AMPLITUDE,
      this.driftBase.y + driftY * DRIFT_AMPLITUDE + shakeY * SHAKE_AMPLITUDE,
      this.driftBase.z,
    );
    this.camera.lookAt(this.lookTarget);
    // Roll a hair with the drift, which is what sells it as a held camera.
    this.camera.rotation.z += driftX * 0.004;
  }

  /**
   * Rebuild the pose from rest each frame: offsets never accumulate.
   *
   * Order matters. The weapon is placed first, then each hand is solved onto
   * the grip the weapon actually presents. Solving arms first and hoping the
   * gun lands between them is what produced the scarecrow pose.
   *
   * Arms use the engine's own two-bone IK -- the same solver the gameplay
   * weapon rig uses. Hand-authored Euler angles do not work on this rig: the
   * arm hangs straight down with no rest bend, so a Z rotation on the elbow
   * splays the arm sideways instead of bending it forward.
   */
  private applyStancePose(time: number): void {
    const rotate = (
      joint: THREE.Object3D | null, x: number, y: number, z: number,
    ): void => {
      if (!joint) return;
      const rest = this.restQuat.get(joint);
      if (!rest) return;
      joint.quaternion.copy(rest).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')),
      );
    };

    const breath = Math.sin(time * MENU_SHOWCASE.BREATH_SPEED);
    const sway = Math.sin(time * MENU_SHOWCASE.SWAY_SPEED);
    const pose = this.stance === 'ready'
      ? MENU_SHOWCASE.POSE_READY
      : MENU_SHOWCASE.POSE_STAND;

    // --- walk cycle ----------------------------------------------------------
    // The reference operator advances toward camera rather than standing
    // still. One phase drives everything, so legs, bob and counter-rotation
    // can never drift out of sync with each other.
    const walk = MENU_SHOWCASE.WALK;
    const phase = time * walk.SPEED * Math.PI * 2;
    const stride = Math.sin(phase);
    // The body rises twice per stride -- once per footfall -- so the bounce
    // is at double the leg frequency. Getting this wrong is what makes a
    // walk look like a limp.
    const bounce = Math.cos(phase * 2);

    this.applyLeg('R', stride, walk);
    this.applyLeg('L', -stride, walk);

    // --- torso ---------------------------------------------------------------
    // Shoulders counter-rotate against the hips; that opposition is most of
    // what makes a walk read as a walk.
    rotate(this.joints.pelvis, 0, stride * walk.TORSO_COUNTER + sway * 0.02, sway * 0.012);
    rotate(this.joints.spine,
      breath * 0.012 - pose.torsoLean, -stride * walk.TORSO_COUNTER * 0.6, 0);
    rotate(this.joints.chest,
      breath * 0.018 - pose.chestLean,
      pose.chestTwist - stride * walk.TORSO_COUNTER * 0.5,
      0);
    rotate(this.joints.neck, -breath * 0.01, sway * 0.03, 0);
    rotate(this.joints.head,
      -breath * 0.008 + pose.headTilt,
      pose.headTurn + sway * 0.05 + stride * 0.03,
      0);

    if (this.root) {
      this.root.position.y = breath * 0.004 + bounce * walk.BOB;
      this.root.position.x = stride * walk.LATERAL;
    }

    // --- weapon --------------------------------------------------------------
    // Placed in body space; breathing rides it so the gun moves WITH the
    // chest rather than sliding against a still body.
    const bob = breath * 0.005;
    this.weaponMount.position.set(
      pose.weaponPos[0], pose.weaponPos[1] + bob, pose.weaponPos[2],
    );
    this.weaponMount.rotation.set(
      pose.weaponRot[0], pose.weaponRot[1], pose.weaponRot[2],
    );

    // --- arms, chasing the weapon --------------------------------------------
    this.root?.updateMatrixWorld(true);
    this.solveHandToGrip('R', this.gripRear, pose.poleR);
    // No foregrip (a pistol): the support hand cups under the trigger hand.
    this.solveHandToGrip('L', this.gripFront ?? this.gripRear, pose.poleL,
      this.gripFront ? null : MENU_SHOWCASE.SUPPORT_HAND_CUP);
  }

  /**
   * Swing one leg through the walk cycle.
   *
   * `swing` is the signed stride phase for this leg (+1 forward, -1 back).
   * The knee only bends on the RECOVERY half -- a knee that bends while the
   * foot is planted looks like the leg is collapsing. The ankle counter-
   * rotates so the foot stays roughly flat instead of pointing at the floor.
   */
  private applyLeg(
    side: 'R' | 'L',
    swing: number,
    walk: typeof MENU_SHOWCASE.WALK,
  ): void {
    const hip = this.joints[`hip${side}`];
    const knee = this.joints[`knee${side}`];
    const ankle = this.joints[`ankle${side}`];

    const setRot = (joint: THREE.Object3D | null, x: number): void => {
      if (!joint) return;
      const rest = this.restQuat.get(joint);
      if (!rest) return;
      joint.quaternion.copy(rest).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(x, 0, 0, 'XYZ')),
      );
    };

    // Body faces -Z, so a positive X rotation swings the leg FORWARD.
    setRot(hip, swing * walk.LEG_SWING);
    // Bend only while the leg is behind the body and lifting through to the
    // front. A knee that bends while the foot is planted reads as a collapse.
    const bend = swing < 0 ? -swing : 0;
    setRot(knee, -bend * walk.KNEE_BEND);
    // Keep the sole roughly parallel to the ground through the whole cycle.
    setRot(ankle, bend * walk.KNEE_BEND * 0.5 - swing * walk.LEG_SWING * 0.3);
  }

  /**
   * Solve one arm so its wrist lands on a point on the weapon.
   *
   * `gripLocal` is in weapon space, so it follows the weapon automatically
   * and no pose constant has to be re-derived when the weapon moves.
   */
  private solveHandToGrip(
    side: 'R' | 'L',
    gripLocal: THREE.Vector3 | null,
    pole: readonly [number, number, number],
    extraOffset: readonly [number, number, number] | null = null,
  ): void {
    const chain = this.chains[side];
    if (!chain || !this.root || !gripLocal) return;

    const target = this.scratchTarget.copy(gripLocal);
    if (extraOffset) target.add(this.scratchOffset.set(...extraOffset));
    this.weaponMount.localToWorld(target);

    // The pole is a DIRECTION the elbow bends toward, not a position, so it
    // is rotated into world space rather than translated. Passing a position
    // here aims every elbow at the world origin.
    const poleWorld = this.scratchPole
      .set(pole[0], pole[1], pole[2])
      .applyQuaternion(this.root.getWorldQuaternion(this.scratchQuat))
      .normalize();

    const solution = solveJointIK(chain, target, poleWorld, null);
    if (solution) applyJointSolution(chain, solution, 1);
  }
}
