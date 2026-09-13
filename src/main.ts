/**
 * main.ts — OPERATOR entry point. Pure wiring, no implementation.
 * Document 3 built the combat layer; Document 2.5 (§10) re-architects the
 * viewmodel side: AnimationLayerCompositor (§6.1 layers), WeaponViewmodel as
 * a camera-child layer-1 rig, socket-driven grips via WeaponIK, and the
 * AnimationStateMachine emitting resolved descriptors to registered targets.
 */
import './style.css';
import * as THREE from 'three';
import Engine from './core/Engine';
import gameStateManager, { GameState } from './state/GameStateManager';
import eventBus from './core/EventBus';
import TestArena from './environment/TestArena';

import PlayerController from './player/PlayerController';
import { resolveNextState } from './player/PlayerState';
import WeaponSway from './weapons/WeaponSway';
import WeaponViewmodel from './weapons/WeaponViewmodel';
import WeaponManager from './weapons/WeaponManager';
import HandsRig from './weapons/HandsRig';
import { CasingPhysics } from './weapons/CasingPhysics';
import { DroppedMagSystem } from './weapons/DroppedMagSystem';
import { MAG } from './utils/Constants';
import { getProfile } from './weapons/WeaponProfile';
import { OrientationGizmos } from './debug/OrientationGizmos';
import { animationEngine } from './animation-engine/OperatorAnimEngine';
import { MeleeHitDetection } from './weapons/MeleeHitDetection';
import { MeleeComboTracker } from './weapons/MeleeComboTracker';
import { IdleFidgetController } from './animation/IdleFidgetController';
import { Fists } from './weapons/definitions/Fists';
import RecoilSystem from './weapons/RecoilSystem';
import MuzzleFlashEffect from './weapons/MuzzleFlashEffect';
import ImpactEffect from './weapons/ImpactEffect';
import TracerEffect from './weapons/TracerEffect';
import ballistics from './weapons/BallisticsSystem';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { ColliderFactory } from './physics/ColliderFactory';
import PlayerCharacterController from './physics/PlayerCharacterController';
import { SWAY } from './utils/Constants';
import AnimationStateMachine from './animation/AnimationStateMachine';
import AnimationBlender from './animation/AnimationBlender';
import AnimationLayerCompositor from './animation/AnimationLayerCompositor';
import type { ResolvedAnimationDescriptor, AnimationTarget } from './animation/AnimationBlender';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('[main] #game-canvas element missing from index.html');

const engine = new Engine(canvas);

// Document C §4: the Rapier world boots first (WASM init), is the FIRST
// engine updatable (fixed-step dynamics before any consumer queries), and
// backs ALL collision: player capsule, level, casings, hitscan.
const physics = await PhysicsWorld.create();
const colliderFactory = new ColliderFactory(physics);

// TEMPORARY — Document 2 test arena (deleted in Document 4). Its constructor
// registers all static geometry + the three training dummies as hittables.
const arena = new TestArena();
engine.sceneManager.setScene(arena.scene);
// Level collision → Rapier static colliders (Document C §4.2 ColliderFactory).
for (const box of arena.colliders) colliderFactory.addStaticBox(box, 'generic');

// Hittable registry → Rapier colliders, then swap the hitscan query backend.
ballistics.attachPhysics(physics, colliderFactory);
for (const entry of ballistics.hittables) colliderFactory.addHittableObject(entry.object, entry.metadata);
const registerHittableRapier = ballistics.registerHittable.bind(ballistics);
ballistics.registerHittable = (object, metadata) => {
  registerHittableRapier(object, metadata);
  colliderFactory.addHittableObject(object, metadata);
};
const unregisterHittableRapier = ballistics.unregisterHittable.bind(ballistics);
ballistics.unregisterHittable = (object) => {
  const entry = ballistics.hittables.find((h) => h.object === object);
  if (entry) {
    for (const [handle, meta] of colliderFactory.byHandle) {
      if (meta.hittable?.object === object) colliderFactory.removeByHandle(handle);
    }
  }
  unregisterHittableRapier(object);
};

const playerCollider = new PlayerCharacterController(physics, colliderFactory, new THREE.Vector3(0, 0, 10));
const playerController = new PlayerController(
  engine.clock,
  engine.inputManager,
  engine.sceneManager,
  playerCollider,
  canvas,
);
engine.registerUpdatable(playerController);
engine.registerUpdatable({ update: (dt: number) => physics.update(dt) });

// --- Document 2.5 viewmodel stack (§10 required files) ------------------------
const sway = new WeaponSway();
const compositor = new AnimationLayerCompositor();
const viewmodel = new WeaponViewmodel(engine.assetLoader, sway, compositor);
// §3.1: the rig root is a CHILD of the main camera; §3.2 does the rendering.
viewmodel.attachToCamera(engine.sceneManager.getCamera());

const blender = new AnimationBlender(viewmodel);
const animationStateMachine = new AnimationStateMachine(blender, viewmodel);

const weaponManager = new WeaponManager({
  input: engine.inputManager,
  camera: playerController.camera,
  viewmodel,
  getMovementState: () => playerController.currentState,
  getTacticalSprinting: () => playerController.isTacticalSprinting,
  requestSprintCancel: () => playerController.requestSprintCancel(),
});

const handsRig = new HandsRig(engine.assetLoader);

// --- Document C §3.6: F4 socket/joint orientation axes ----------------------
const orientationGizmos = new OrientationGizmos(engine.inputManager, () => {
  const roots: THREE.Object3D[] = [];
  const rigRoot = viewmodel.getRigRoot();
  if (rigRoot) roots.push(rigRoot);
  const handsRoot = handsRig.debugRoot();
  if (handsRoot) roots.push(handsRoot);
  return roots;
});
engine.registerUpdatable(orientationGizmos);
void handsRig.load().then(() => {
  viewmodel.setArmRig(handsRig); // may re-run the equip attach (race guard)
  handsRig.attach(viewmodel);
});

// --- Document A §8.6: pooled shell casings vs REAL level geometry ----------
const casingPhysics = new CasingPhysics(physics, engine.sceneManager.getScene());

// --- Document C §5.6: dropped magazines as pooled Rapier bodies ------------
const droppedMags = new DroppedMagSystem(physics, engine.sceneManager.getScene(), () => {
  // Placeholder pool mesh; live drops swap in the weapon's real mag clone.
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(MAG.HALF_EXTENTS.x * 2, MAG.HALF_EXTENTS.y * 2, MAG.HALF_EXTENTS.z * 2),
    new THREE.MeshLambertMaterial({ color: MAG.COLOR }),
  );
  return box;
});
droppedMags.magSocket = () => {
  const root = viewmodel.getRigRoot();
  return root ? root.getObjectByName('Socket_Magazine') ?? null : null;
};
droppedMags.magMeshFactory = () => {
  const root = viewmodel.getRigRoot();
  const mag = root?.getObjectByName('Bone_Magazine') ?? null;
  if (mag) return mag.clone(true);
  // Fallback: dark box (never expected on the rifle).
  return new THREE.Mesh(
    new THREE.BoxGeometry(MAG.HALF_EXTENTS.x * 2, MAG.HALF_EXTENTS.y * 2, MAG.HALF_EXTENTS.z * 2),
    new THREE.MeshLambertMaterial({ color: MAG.COLOR }),
  );
};
engine.registerUpdatable(droppedMags);

// --- Document B: melee + idle fidgets --------------------------------------
const meleeCombo = new MeleeComboTracker();
const meleeHit = new MeleeHitDetection(ballistics);
meleeHit.setCamera(engine.sceneManager.getCamera());
const fidgets = new IdleFidgetController(
  handsRig.fidgetSprings.shoulderR,
  handsRig.fidgetSprings.shoulderL,
  handsRig.fidgetSprings.wristR,
  handsRig.fidgetSprings.wristL,
);

// Per-weapon joint-recoil scale (Document A §8.3) on every equip.
eventBus.on('weapon:viewmodelEquipped', (payload) => {
  const { weaponId } = payload as { weaponId: string };
  const def = weaponManager.inventory.find((w) => w.def.id === weaponId)?.def;
  handsRig.setRecoilScale(def?.recoilJointScale ?? 1);
});

// Fists: swing → combo punch clip (Document B §2) + guard stance (§3).
// Doc C §5: routed through the engine's priority gate (punch may interrupt
// a reload — Melee 9 >= Reload 7 — but never a switch-in, Switch 8 < 9 ok,
// and never another punch).
eventBus.on('melee:swung', () => {
  if (weaponManager.activeWeapon.def.id !== 'fists') return;
  const clip = meleeCombo.onSwung(Fists.punchClips ?? ['melee_punch_01']);
  animationEngine.requestOneShot(
    clip,
    viewmodel.activeOneShotName,
    (c) => Boolean(viewmodel.playClip(c, { loop: THREE.LoopOnce, crossfadeDuration: 0.05, clampWhenFinished: false })),
  );
});

// --- Document C §5: OperatorAnimEngine layer registration (enforced order) --
animationEngine.registerLayer({
  name: 'BaseLocomotion',
  category: 'locomotion',
  update: () => {
    const descriptor = animationStateMachine.lastDescriptor;
    handsRig.setLocomotion({
      state: descriptor?.movementState ?? playerController.currentState,
      isTacticalSprinting: playerController.isTacticalSprinting,
      speed: playerController.getHorizontalSpeed(),
      isGrounded: playerController.isGrounded(),
      adsWeight: viewmodel.adsWeight,
    });
    handsRig.setGuard(weaponManager.activeWeapon.def.melee === true && weaponManager.isADSActive);
  },
  contribute: () => undefined,
});
animationEngine.registerLayer({
  name: 'AdditivePose',
  category: 'additive',
  update: (dt) => blender.update(dt),
  contribute: () => undefined,
});
animationEngine.registerLayer({
  name: 'ProceduralSpring',
  category: 'spring',
  update: (dt) => handsRig.update(dt, viewmodel.activeOneShotOwnership, viewmodel.isOneShotRunning),
  contribute: () => undefined,
});
animationEngine.registerLayer({
  name: 'ProceduralIK',
  category: 'ik',
  update: (dt) => {
    viewmodel.update(dt, engine.sceneManager.getCamera());
    handsRig.applyArmCommand(viewmodel.consumeArmCommand());
  },
  contribute: () => undefined,
});

const recoilSystem = new RecoilSystem(playerController.camera, sway);
const muzzleFlash = new MuzzleFlashEffect(engine.assetLoader, viewmodel);
const impactEffect = new ImpactEffect(engine.assetLoader, arena.scene);
const tracerEffect = new TracerEffect(engine.assetLoader, arena.scene);

// Tracers visually start at the gun's muzzle (rays still come from camera).
const muzzleScratch = new THREE.Vector3();
const rightScratch = new THREE.Vector3();
const forwardScratch = new THREE.Vector3();
const ejectOrigin = new THREE.Vector3();
const ejectDir = new THREE.Vector3();
const ejectQuat = new THREE.Quaternion();
let ejectionPending = 0;
eventBus.on('weapon:fired', () => { ejectionPending += 1; });
ballistics.setMuzzleProvider(() =>
  viewmodel.currentWeaponId ? viewmodel.getMuzzleWorldPosition(muzzleScratch) : null,
);

// Second render pass: viewmodel layer after a depth clear (§3.2, exactly).
// Also captures per-pass draw calls (renderer.info resets at each render
// call): the §15 "no draw-call growth under sustained fire" acceptance read.
const drawCalls = { world: 0, viewmodel: 0 };
engine.setPostRenderHook((renderer) => {
  drawCalls.world = renderer.info.render.calls;
  viewmodel.renderPass(renderer, engine.sceneManager.getScene());
  drawCalls.viewmodel = renderer.info.render.calls;
});

// Per-frame combat update order matters:
//   1. weaponManager  — input → fire/reload/switch/ADS (+ tac-sprint gating),
//   2. recoilSystem   — clock for pattern-reset grace,
//   3. sway           — consumes the look delta PlayerCamera mirrored,
//   4. animationStateMachine — resolves descriptors → registered targets,
//   5. viewmodel      — compositor (L3/5/6/7), mixer, IK solve dispatch,
//   6. handsRig       — servo, guard/fingers, applies the IK command pre-bake,
//   7. effects + arena dummies.
engine.registerUpdatable({
  update: (dt: number) => {
    weaponManager.update(dt);
    recoilSystem.update(dt);
    const velocity = playerController.movement.state.velocity;
    const yaw = playerController.movement.state.yaw;
    rightScratch.set(Math.cos(yaw), 0, -Math.sin(yaw));
    forwardScratch.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const localVelocity = {
      x: velocity.dot(rightScratch),
      z: velocity.dot(forwardScratch),
    };
    sway.update(
      dt,
      playerController.camera.lastMouseDelta,
      weaponManager.isADSActive,
      playerController.getHorizontalSpeed() < SWAY.STATIONARY_SPEED_EPS && playerController.isGrounded(),
      localVelocity,
    );
    animationStateMachine.setTacticalSprinting(playerController.isTacticalSprinting);
    animationStateMachine.update(dt, playerController.currentState, localVelocity);
    // Doc C §5: the OperatorAnimEngine owns the animation frame — layers run
    // in the enforced order (locomotion → additive → spring → ik → oneshot);
    // the internal order still matches Document A/§6.1 exactly (springs
    // integrate → mixer steps → IK solves → applied same-frame).
    playerController.camera.setAdsWeight(viewmodel.adsWeight); // Doc C §6.4
    // §5: the one-shot arbiter tracks the viewmodel's LIVE clip state.
    animationEngine.syncOneShot(viewmodel.isOneShotRunning ? viewmodel.activeOneShotName : null);
    animationEngine.update(dt);
    // Document A §8.6: eject a casing per shot (from Socket_Ejection, +X).
    if (ejectionPending > 0) {
      ejectionPending -= 1;
      const socket = viewmodel.ejectionSocket;
      if (socket) {
        socket.getWorldPosition(ejectOrigin);
        socket.getWorldQuaternion(ejectQuat);
        ejectDir.set(1, 0, 0).applyQuaternion(ejectQuat); // local +X (§8.6)
        casingPhysics.spawn(ejectOrigin, ejectDir);
      }
    }
    meleeCombo.update(dt);
    meleeHit.update(dt);
    casingPhysics.update(dt);
    fidgets.update(dt, viewmodel.currentWeaponId ?? '', playerController.getHorizontalSpeed() > 0.5, viewmodel.isOneShotRunning);
    muzzleFlash.update(dt);
    impactEffect.update(dt);
    tracerEffect.update(dt);
    arena.update(dt);
  },
});

// Layer-7 pose input (movement state → weapon pose offsets, §4.7).
viewmodel.setPoseInputProvider(() => ({
  movementState: playerController.currentState,
  isTacticalSprinting: playerController.isTacticalSprinting,
  isSnappingToReady: weaponManager.isSnappingToReady,
  landingImpactVelocity: playerController.consumeLandingImpact(),
}));

void weaponManager.equipInitial();

engine.start();

// Document 1 boots straight into PLAYING (no menus exist yet).
// Document 5 changes this initial state to MAIN_MENU.
gameStateManager.setState(GameState.PLAYING);

// ---------------------------------------------------------------------------
engine.debug.addLine('stamina', () => `STA   ${playerController.getStaminaValue().toFixed(2)}`);
engine.debug.addLine('weapon', () => {
  const w = weaponManager.activeWeapon;
  const tac = playerController.isTacticalSprinting ? ' TAC' : '';
  return `WPN   ${w.def.id} ${w.currentMagazineAmmo}/${w.currentReserveAmmo}${tac}`;
});
// §15: sustained fire must not grow draw calls — watch this under the overlay.
engine.debug.addLine('drawcalls', () => `CALLS W${drawCalls.world}+VM${drawCalls.viewmodel}`);

// §3.3 PROOF TARGET: a second, non-viewmodel consumer of resolved descriptors.
// The acceptance suite asserts it receives frames WITHOUT any state-machine
// modification — the exact third-person-body seam, exercised for real.
const descriptorLog: ResolvedAnimationDescriptor[] = [];
const mockAnimationTarget: AnimationTarget = {
  applyDescriptor(descriptor: ResolvedAnimationDescriptor): void {
    if (descriptorLog.length === 0 || descriptorLog[descriptorLog.length - 1] !== descriptor) {
      descriptorLog.push(descriptor);
      if (descriptorLog.length > 240) descriptorLog.shift();
    }
  },
};
animationStateMachine.registerTarget(mockAnimationTarget);

interface OperatorTestHook {
  engine: Engine;
  gameStateManager: typeof gameStateManager;
  eventBus: typeof eventBus;
  playerController: PlayerController;
  resolveNextState: typeof resolveNextState;
  inputManager: Engine['inputManager'];
  // Document 3 additions (headless acceptance harness).
  weaponManager: WeaponManager;
  viewmodel: WeaponViewmodel;
  ballistics: typeof ballistics;
  arena: TestArena;
  animationStateMachine: AnimationStateMachine;
  blender: AnimationBlender;
  compositor: AnimationLayerCompositor;
  sway: WeaponSway;
  recoilSystem: RecoilSystem;
  handsRig: HandsRig;
  casingPhysics: CasingPhysics;
  playerCollider: PlayerCharacterController;
  colliderFactory: ColliderFactory;
  meleeHit: MeleeHitDetection;
  fidgets: IdleFidgetController;
  drawCalls: () => { world: number; viewmodel: number };
  // Document 2.5 §3.3 acceptance seams.
  descriptorLog: () => ResolvedAnimationDescriptor[];
  mockAnimationTarget: AnimationTarget;
}
(window as unknown as { __OPERATOR__: OperatorTestHook }).__OPERATOR__ = {
  engine,
  gameStateManager,
  eventBus,
  playerController,
  resolveNextState,
  inputManager: engine.inputManager,
  weaponManager,
  viewmodel,
  ballistics,
  arena,
  animationStateMachine,
  blender,
  compositor,
  sway,
  recoilSystem,
  handsRig,
  casingPhysics,
  playerCollider,
  colliderFactory,
  meleeHit,
  fidgets,
  drawCalls: () => ({ ...drawCalls }),
  descriptorLog: () => descriptorLog,
  mockAnimationTarget,
};
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.orientationGizmos = orientationGizmos;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.droppedMags = droppedMags;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.animationEngine = animationEngine;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.getProfile = getProfile;
// ---------------------------------------------------------------------------
// End TEMPORARY block.
// ---------------------------------------------------------------------------
