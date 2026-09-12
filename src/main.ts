/**
 * main.ts — OPERATOR entry point. Pure wiring, no implementation.
 * Document 3: the combat layer — viewmodel pass, weapon manager, ballistics,
 * recoil, sway, effects pools and the animation state machine — is composed
 * here and plugged into the Engine exclusively through registerUpdatable()
 * and the post-render hook seam.
 */
import './style.css';
import * as THREE from 'three';
import Engine from './core/Engine';
import gameStateManager, { GameState } from './state/GameStateManager';
import eventBus from './core/EventBus';
import TestArena from './environment/TestArena';
import PlayerCollider from './player/PlayerCollider';
import PlayerController from './player/PlayerController';
import { resolveNextState } from './player/PlayerState';
import WeaponSway from './weapons/WeaponSway';
import WeaponViewmodel from './weapons/WeaponViewmodel';
import WeaponManager from './weapons/WeaponManager';
import RecoilSystem from './weapons/RecoilSystem';
import MuzzleFlashEffect from './weapons/MuzzleFlashEffect';
import ImpactEffect from './weapons/ImpactEffect';
import TracerEffect from './weapons/TracerEffect';
import ballistics from './weapons/BallisticsSystem';
import { SWAY } from './utils/Constants';
import AnimationStateMachine from './animation/AnimationStateMachine';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('[main] #game-canvas element missing from index.html');

const engine = new Engine(canvas);

// TEMPORARY — Document 2 test arena (deleted in Document 4). Its constructor
// registers all static geometry + the three training dummies as hittables.
const arena = new TestArena();
engine.sceneManager.setScene(arena.scene);

const playerController = new PlayerController(
  engine.clock,
  engine.inputManager,
  engine.sceneManager,
  new PlayerCollider(arena.colliders),
  canvas,
);
engine.registerUpdatable(playerController);

// --- Document 3 combat layer -------------------------------------------------
const sway = new WeaponSway();
const viewmodel = new WeaponViewmodel(engine.assetLoader, sway);
const animationStateMachine = new AnimationStateMachine(viewmodel);
const weaponManager = new WeaponManager({
  input: engine.inputManager,
  camera: playerController.camera,
  viewmodel,
  getMovementState: () => playerController.currentState,
});
const recoilSystem = new RecoilSystem(playerController.camera, sway);
const muzzleFlash = new MuzzleFlashEffect(engine.assetLoader, viewmodel);
const impactEffect = new ImpactEffect(engine.assetLoader, arena.scene);
const tracerEffect = new TracerEffect(engine.assetLoader, arena.scene);

// Tracers visually start at the gun's muzzle (rays still come from camera).
const muzzleScratch = new THREE.Vector3();
const rightScratch = new THREE.Vector3();
const forwardScratch = new THREE.Vector3();
ballistics.setMuzzleProvider(() =>
  viewmodel.currentWeaponId ? viewmodel.getMuzzleWorldPosition(muzzleScratch) : null,
);

// Second render pass: viewmodel scene after a depth clear (§8, technique (a)).
// Also captures per-pass draw calls (renderer.info resets at each render
// call): the §15 "no draw-call growth under sustained fire" acceptance read.
const drawCalls = { world: 0, viewmodel: 0 };
engine.setPostRenderHook((renderer) => {
  drawCalls.world = renderer.info.render.calls;
  viewmodel.renderPass(renderer);
  drawCalls.viewmodel = renderer.info.render.calls;
});

// Per-frame combat update order matters:
//   1. weaponManager  — input → fire/reload/switch/ADS (+ ballistics shots),
//   2. recoilSystem   — clock for pattern-reset grace,
//   3. sway           — consumes the look delta PlayerCamera mirrored,
//   4. animationStateMachine — resolves clips from movement + weapon action,
//   5. viewmodel      — camera copy, hip/ADS lerp, sway offsets, mixer step,
//   6. effects + arena dummies.
engine.registerUpdatable({
  update: (dt: number) => {
    weaponManager.update(dt);
    recoilSystem.update(dt);
    const velocity = playerController.movement.state.velocity;
    const yaw = playerController.movement.state.yaw;
    rightScratch.set(Math.cos(yaw), 0, -Math.sin(yaw));
    forwardScratch.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    sway.update(
      dt,
      playerController.camera.lastMouseDelta,
      weaponManager.isADSActive,
      playerController.getHorizontalSpeed() < SWAY.STATIONARY_SPEED_EPS && playerController.isGrounded(),
      { x: velocity.dot(rightScratch), z: velocity.dot(forwardScratch) },
    );
    animationStateMachine.update(dt, playerController.currentState, {
      x: velocity.dot(rightScratch),
      z: velocity.dot(forwardScratch),
    });
    viewmodel.update(dt, engine.sceneManager.getCamera());
    viewmodel.setAspect(engine.sceneManager.getCamera().aspect);
    muzzleFlash.update(dt);
    impactEffect.update(dt);
    tracerEffect.update(dt);
    arena.update(dt);
  },
});

void weaponManager.equipInitial();

// PBR environment for the viewmodel pass: the committed equirect is PMREM-
// convolved once and applied to the viewmodel scene ONLY, so the weapon's
// metalness maps read as metal instead of black (world lighting is still the
// Document 2 arena's, untouched).
engine.assetLoader.loadTexture('environment/studio_equirect.png').then((tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(engine.renderer.getRenderer());
  viewmodel.vmScene.environment = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
});

engine.start();

// Document 1 boots straight into PLAYING (no menus exist yet).
// Document 5 changes this initial state to MAIN_MENU.
gameStateManager.setState(GameState.PLAYING);

// ---------------------------------------------------------------------------
// TEMPORARY — acceptance proofs. Footstep/landing lines are Document 2's
// harness contract (kept until Document 4 deletes the arena); the weapon and
// combat lines are Document 3 §15's "every event payload verified via TEMP
// logging" requirement. DELETE with the test scaffolding.
// ---------------------------------------------------------------------------
eventBus.on('player:footstep', (p) => console.log('[TEMP-PROOF] player:footstep', JSON.stringify(p)));
eventBus.on('player:landed', (p) => console.log('[TEMP-PROOF] player:landed', JSON.stringify(p)));
for (const eventName of [
  'weapon:fired',
  'weapon:ammoChanged',
  'weapon:reloadStart',
  'weapon:reloadComplete',
  'weapon:adsStart',
  'weapon:adsStop',
  'weapon:switchStart',
  'weapon:switchComplete',
  'weapon:emptyFire',
  'weapon:viewmodelEquipped',
  'combat:hit',
  'combat:shotFired',
  'combat:tracer',
] as const) {
  eventBus.on(eventName, (p) => console.log('[TEMP-PROOF]', eventName, JSON.stringify(p)));
}
engine.debug.addLine('stamina', () => `STA   ${playerController.getStaminaValue().toFixed(2)}`);
engine.debug.addLine('weapon', () => {
  const w = weaponManager.activeWeapon;
  return `WPN   ${w.def.id} ${w.currentMagazineAmmo}/${w.currentReserveAmmo}`;
});
// §15: sustained fire must not grow draw calls — watch this under the overlay.
engine.debug.addLine('drawcalls', () => `CALLS W${drawCalls.world}+VM${drawCalls.viewmodel}`);

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
  sway: WeaponSway;
  recoilSystem: RecoilSystem;
  drawCalls: () => { world: number; viewmodel: number };
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
  sway,
  recoilSystem,
  drawCalls: () => ({ ...drawCalls }),
};
// ---------------------------------------------------------------------------
// End TEMPORARY block.
// ---------------------------------------------------------------------------
