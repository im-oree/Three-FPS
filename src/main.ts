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
import characterState from './character/CharacterStateSystem';
import projectileSystem from './weapons/ProjectileSystem';
import cameraShake from './camera/CameraShakeController';
import bindShakeTriggers from './camera/ShakeTriggers';
import explosionEffect, { EXPLOSION_PRESETS } from './vfx/ExplosionEffect';
import vehicleShowcase from './vfx/VehicleShowcase';
import killstreakManager from './killstreaks/KillstreakManager';
import UAVKillstreakController from './killstreaks/controllers/UAVKillstreakController';
import AirstrikeKillstreakController from './killstreaks/controllers/AirstrikeKillstreakController';
import AttackHelicopterKillstreakController from './killstreaks/controllers/AttackHelicopterKillstreakController';
import groundTargeting from './killstreaks/GroundTargetingMode';
import radarContacts from './world/RadarContactRegistry';
import KillstreakHUD from './ui/hud/KillstreakHUD';
import equipmentManager from './equipment/EquipmentManager';
import throwableEffects from './equipment/ThrowableEffects';
import statusEffects from './player/ActiveStatusEffects';
import smokeVolume from './vfx/SmokeVolume';
import visionObstructions from './world/VisionObstructionRegistry';
import EquipmentHUD from './ui/hud/EquipmentHUD';
import DisorientOverlays from './ui/hud/DisorientOverlays';
import Minimap from './ui/hud/Minimap';
import LiveMinimapCapture from './ui/hud/LiveMinimapCapture';
import minimapPreview from './ui/hud/MinimapPreview';
import TabletLiveMap from './equipment/TabletLiveMap';
import { getThrowable } from './equipment/definitions';
import inputContexts from './core/InputContextStack';
import cheatsStore from './core/CheatsStore';
import killstreakTablet from './equipment/KillstreakTablet';
import cinematicCamera from './camera/CinematicCameraController';
import MissileKillstreakController from './killstreaks/controllers/MissileKillstreakController';
import MissileHUD from './ui/hud/MissileHUD';
import scopeSystem from './weapons/ScopeSystem';
import scopeOverlay from './ui/ScopeOverlay';
import explosionDamage from './weapons/ExplosionDamageResolver';
import { TraversalPrompt } from './ui/TraversalPrompt';
import LevelLoader from './environment/LevelLoader';
import AudioManager from './audio/AudioManager';
import bindGameAudio from './audio/GameAudioBindings';
import { allAudioPaths } from './audio/SoundLibrary';
import SkinManager from './customization/SkinManager';
import PlayerHealth from './player/PlayerHealth';
import matchStats from './state/MatchStatsTracker';
import UIManager from './ui/UIManager';
import HUDManager from './ui/hud/HUDManager';
import MainMenu from './ui/menus/MainMenu';
import LoadingScreen from './ui/menus/LoadingScreen';
import SettingsMenu from './ui/menus/SettingsMenu';
import LoadoutMenu from './ui/menus/LoadoutMenu';
import PauseMenu from './ui/menus/PauseMenu';
import GameOverScreen from './ui/menus/GameOverScreen';
import { setUIAudio, prettyKey } from './ui/dom';
import { LEVELS, getLevel } from './environment/LevelDefinition';
import settingsStore from './core/SettingsStore';
import loadoutManager from './customization/LoadoutManager';
import { CAMERA_SHAKE, HEALTH } from './utils/Constants';
import './ui/styles.css';


import PlayerController from './player/PlayerController';
import { PlayerState, resolveNextState } from './player/PlayerState';
import WeaponSway from './weapons/WeaponSway';
import WeaponViewmodel from './weapons/WeaponViewmodel';
import WeaponManager from './weapons/WeaponManager';
import HandsRig from './weapons/HandsRig';
import { CasingPhysics } from './weapons/CasingPhysics';
import { DroppedMagSystem } from './weapons/DroppedMagSystem';
import { MAG, TPS_CARRY } from './utils/Constants';
import { getProfile } from './weapons/WeaponProfile';
import { OrientationGizmos } from './debug/OrientationGizmos';
import { CinematicDebugGizmo } from './debug/CinematicDebugGizmo';
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
import { SWAY, SCOPE } from './utils/Constants';
import AnimationStateMachine from './animation/AnimationStateMachine';
import AnimationBlender from './animation/AnimationBlender';
import AnimationLayerCompositor from './animation/AnimationLayerCompositor';
import ThirdPersonBody from './character/ThirdPersonBody';
import PerspectiveController from './player/PerspectiveController';
import PerspectiveSync from './animation/PerspectiveSync';
import type { ResolvedAnimationDescriptor, AnimationTarget } from './animation/AnimationBlender';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('[main] #game-canvas element missing from index.html');

const engine = new Engine(canvas);

// Document C §4: the Rapier world boots first (WASM init), is the FIRST
// engine updatable (fixed-step dynamics before any consumer queries), and
// backs ALL collision: player capsule, level, casings, hitscan.
const physics = await PhysicsWorld.create();
const colliderFactory = new ColliderFactory(physics);

// Document 4/5: real LevelLoader. The scene is created empty here and filled
// by load(levelId) when the player picks a deployment from the main menu.
// Geometry, colliders, surface tags and dummies are all owned by the loader,
// so unloading leaves no residue behind for the next match.
const levelLoader = new LevelLoader(colliderFactory, {
  physics,
  assetLoader: engine.assetLoader,
  renderer: engine.renderer.getRenderer(),
  culling: engine.sceneManager.culling,
});
const arena = levelLoader; // legacy alias: same `.scene`/`.update(dt)` surface
engine.sceneManager.setScene(levelLoader.scene);

// Hittable registry → Rapier colliders, then swap the hitscan query backend.
ballistics.attachPhysics(physics, colliderFactory);
// Document K: bullets may also strike the prop pool's live dynamic barrels
// (colliders that are not level-static); the set is swapped on level load.
ballistics.setPropHitProvider(
  () => levelLoader.mapProps?.propPool.dynamicHitHandles ?? null,
);
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
// Manual-traversal HUD hint (pure state consumer) — see /CHARACTER_STATE.md §6.
const traversalPrompt = new TraversalPrompt();
// Document C §8.4: the scope tunnel is a DOM overlay over the canvas.
scopeOverlay.mount();

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

// --- Document M §8.2: F4 jet-path gizmo + anti-clip flash -------------------
const cinematicGizmo = new CinematicDebugGizmo(
  engine.inputManager, levelLoader.scene,
);
engine.registerUpdatable(cinematicGizmo);

// --- Document L §4.3: kill-plane guard --------------------------------------
// If the player ever falls below the level's kill plane (physics bug, a
// collision gap, an exploit), teleport them back to spawn instead of falling
// forever. Inert for levels without a killPlaneY.
const killPlaneGuard = {
  update: (): void => {
    const def = levelLoader.current;
    if (!def || def.killPlaneY == null) return;
    const p = playerController.getPosition();
    if (p.y < def.killPlaneY) {
      playerController.debugTeleport(def.spawn[0], def.spawn[1], def.spawn[2]);
      eventBus.emit('player:resetFromVoid', { levelId: def.id });
    }
  },
};
engine.registerUpdatable(killPlaneGuard);

void handsRig.load().then(() => {
  viewmodel.setArmRig(handsRig); // may re-run the equip attach (race guard)
  handsRig.attach(viewmodel);
});

// ---------------------------------------------------------------------------
// FPS/TPS Unified Character Controller (Architectural Specification)
//
// ONE logical entity, TWO visual representations. The viewmodel stack above is
// the 1PS half; the body below is the 3PS half. Both are driven by the SAME
// simulation state (PlayerController) and the SAME resolved animation
// descriptors — never by two parallel sources of truth, which is what makes
// the perspectives structurally incapable of desyncing.
// ---------------------------------------------------------------------------
const thirdPersonBody = new ThirdPersonBody(engine.assetLoader);
const perspective = new PerspectiveController(
  engine.sceneManager.getCamera(),
  engine.inputManager,
  thirdPersonBody,
);
const perspectiveSync = new PerspectiveSync();

void thirdPersonBody.load(arena.scene).then(() => {
  // --- HYBRID VIEWMODEL + BODY (what shipping FPS games actually do) -------
  // First person uses dedicated, camera-relative viewmodel arms: real
  // shoulder-length arms seen from inside the head are enormous, clip the
  // lens and read terribly. The character body still renders in first person
  // MINUS its head and arms, so looking down shows your own torso and legs.
  // Third person shows the body's own arms holding its own weapon copy.
  // Both are driven by the SAME simulation + animation state, so they stay
  // in lockstep — see thirdPersonBody.setWeaponProp below.
  thirdPersonBody.setArmsExternallyDriven(false);

  // Keep the body's weapon prop in lockstep with the equipped weapon.
  //
  // RACE GUARD: loadModel() is async, so two quick switches can resolve out of
  // order and leave the body holding the WRONG weapon -- or, when the second
  // switch is to fists (which resolves synchronously to null), leave a real
  // gun's late-arriving prop attached to empty hands. Stamp each request and
  // drop any result that is no longer the active weapon.
  // The guard compares the ACTIVE WEAPON ID on resolve, not a request counter.
  // A single switch emits weapon:viewmodelEquipped more than once, so a
  // counter made every in-flight load look superseded by its own successor
  // and the body ended up holding nothing.
  // Drive this off the EVENT'S weaponId, not weaponManager.activeWeapon.
  // weapon:viewmodelEquipped fires from inside equip(), at which point the
  // manager's activeIndex still points at the OUTGOING weapon -- so reading
  // activeWeapon here attached the previous gun (and, coming from fists,
  // attached nothing at all and stripped the body's weapon entirely).
  let equippedPropId: string | null = null;
  const syncWeaponProp = async (weaponId: string): Promise<void> => {
    equippedPropId = weaponId;
    const def = weaponManager.inventory.find((w) => w.def.id === weaponId)?.def;
    if (!def || def.melee || !def.modelPath) {
      thirdPersonBody.setWeaponProp(null, TPS_CARRY.GRIP_LOCAL);
      return;
    }
    const prop = await engine.assetLoader.loadModel(def.modelPath);
    // Superseded by a later equip while this model was loading: discard.
    if (equippedPropId !== weaponId) return;
    thirdPersonBody.setWeaponProp(prop, TPS_CARRY.GRIP_LOCAL);
  };
  eventBus.on('weapon:viewmodelEquipped', (payload) => {
    void syncWeaponProp((payload as { weaponId: string }).weaponId);
  });
  void syncWeaponProp(weaponManager.activeWeapon.def.id);

  // §4 foot IK traces against the REAL collision world (Rapier statics).
  thirdPersonBody.setGroundProbe((origin, maxDistance) => {
    const down = new THREE.Vector3(0, -1, 0);
    const hit = physics.castRayStatic(origin, down, maxDistance);
    return hit ? { point: hit.point, normal: hit.normal } : null;
  });
  thirdPersonBody.setPerspective(perspective.current);
});

// §1 spring arm: the boom collapses against real geometry so the 3PS camera
// never clips through a wall.
perspective.setBoomProbe((origin, direction, maxDistance) => {
  const hit = physics.castRayStatic(origin, direction.clone().normalize(), maxDistance);
  return hit ? hit.toi : null;
});

// The world pass now shows/hides the body purely by layer mask (§1).
engine.setWorldPassMaskProvider(() => perspective.worldPassMask);

// §4 cross-perspective desync prevention: gameplay's HARD logical durations
// are registered once per weapon; both perspectives' clips are time-scaled to
// them, so the magazine seats on the same frame inside and outside.
for (const entry of weaponManager.inventory) {
  const def = entry.def;
  perspectiveSync.durations.registerWeapon(def.id, {
    reload_tactical: def.reloadTacticalDuration,
    reload_empty: def.reloadEmptyDuration,
    ads_in: def.adsInDuration,
    ads_out: def.adsOutDuration,
  });
}
eventBus.on('weapon:reloadStart', (payload) => {
  const { weaponId, isTactical } = payload as { weaponId: string; isTactical?: boolean };
  const action = isTactical === false ? 'reload_empty' : 'reload_tactical';
  const duration = perspectiveSync.durations.resolve(weaponId, action);
  if (duration === undefined) return;
  perspectiveSync.begin(`${weaponId}:${action}`, duration);
  // The 1PS viewmodel clip is scaled to the same logical clock the 3PS body
  // animation would be — identical beats, differently-authored assets.
  perspectiveSync.attach(`${weaponId}:${action}`, viewmodel.activeAction);
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

// Killstreak tablet: play the RIG's own hand animations for the device —
// the baked one-shot clips own the LEFT chain (ownsIK: "L") so the right
// arm's procedural weapon IK keeps running underneath while the left hand
// comes up to hold position, exactly as the clip authoring intends. The
// raise clip clamps at its end pose, holding the arm at reading height for
// as long as the tablet stays up; lowering replays the reverse motion.
eventBus.on('tablet:raised', () => {
  viewmodel.playClip('tablet_raise', {
    loop: THREE.LoopOnce, crossfadeDuration: 0.08, clampWhenFinished: true,
  });
});
eventBus.on('tablet:lowered', () => {
  viewmodel.playClip('tablet_lower', {
    loop: THREE.LoopOnce, crossfadeDuration: 0.08, clampWhenFinished: false,
  });
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
    // FISTS MODE: unarmed hands are ALWAYS up in a guard. Previously the guard
    // pose was gated on isADSActive, so with no weapon equipped the arms hung
    // at their rest pose far below the lens and fists mode looked like it had
    // no hands at all. ADS now only TIGHTENS the guard, it does not create it.
    handsRig.setGuard(weaponManager.activeWeapon.def.melee === true);
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
  update: (dt) => {
    handsRig.setClipDrivesShoulder(viewmodel.activeOneShotDrivesShoulder);
    handsRig.update(dt, viewmodel.activeOneShotOwnership, viewmodel.isOneShotRunning);
  },
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
// --- Document D §2.2: projectile + splash damage wiring --------------------
projectileSystem.attach(physics.world, arena.scene);
// The rocket mesh is a real generated asset (tools/builders/RocketLauncherBuilder
// .js -> rocket_projectile.glb), never geometry built in gameplay code.
void engine.assetLoader.loadModel('weapons/rocket_projectile.glb').then((proto) => {
  projectileSystem.setMeshFactory(() => proto.clone(true));
});
explosionDamage.start();
// §7.1: the blast reaches the shooter too — firing at your own feet hurts.
explosionDamage.setPlayerTarget(
  () => playerController.getPosition().clone(),
  (amount) => eventBus.emit('player:damaged', { amount, source: 'explosion' }),
);

// --- Document E §1.4: every camera-shake trauma source, bound in one place --
bindShakeTriggers({
  getListenerPosition: () => playerController.getPosition(),
});

// --- Document F: throwables ------------------------------------------------
const eyeOf = (): THREE.Vector3 =>
  playerController.camera.threeCamera.getWorldPosition(new THREE.Vector3());
const forwardOf = (): THREE.Vector3 =>
  playerController.camera.threeCamera.getWorldDirection(new THREE.Vector3());

equipmentManager.attach({
  scene: levelLoader.scene,
  assetLoader: engine.assetLoader,
  physics,
  getEyePosition: eyeOf,
  getForward: forwardOf,
});
equipmentManager.setTactical(
  settingsStore.get<string>('loadout.tactical', 'flashbang'),
);
throwableEffects.attach({ physics, getEyePosition: eyeOf, getForward: forwardOf });
throwableEffects.start();
void smokeVolume.load(engine.assetLoader, levelLoader.scene);

const equipmentHUD = new EquipmentHUD(equipmentManager);
const disorientOverlays = new DisorientOverlays();
const minimap = new Minimap(radarContacts, {
  getPlayerX: () => playerController.getPosition().x,
  getPlayerZ: () => playerController.getPosition().z,
  getYaw: () => playerController.camera.threeCamera.rotation.y,
});
/** Live top-down world capture feeding the minimap dish + the settings preview. */
const minimapCapture = new LiveMinimapCapture(engine.sceneManager.culling);
/** Last per-frame dt, for preview timing inside the post-render hook. */
let latestFrameDt = 1 / 60;
/** Throttles the killstreak tablet's map capture to 12 Hz. */
let tabletMapAccumulator = 1;

// Throw input: HOLD to cook, RELEASE to throw (Document F §3).
window.addEventListener('keydown', (e) => {
  if (!gameStateManager.is(GameState.PLAYING) || e.repeat) return;
  if (e.code === engine.inputManager.getBindings().throwTactical) {
    equipmentManager.beginCook();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === engine.inputManager.getBindings().throwTactical) {
    equipmentManager.release();
  }
});

// Throwable audio, bound in one place like every other sound.
eventBus.on('equipment:cookStart', () => {
  audioManager.playSound2D('equipment/grenade_pin_pull.wav', { volume: 0.7, key: 'pin' });
});
eventBus.on('equipment:thrown', () => {
  audioManager.playSound2D('equipment/grenade_throw_whoosh.wav', { volume: 0.6, key: 'whoosh' });
});
eventBus.on('equipment:bounce', (payload) => {
  const p = (payload as { point: { x: number; y: number; z: number } }).point;
  audioManager.playSound3D('equipment/grenade_bounce_metal.wav',
    new THREE.Vector3(p.x, p.y, p.z), { volume: 0.5, refDistance: 6, key: 'bounce' });
});
eventBus.on('equipment:detonated', (payload) => {
  const p = payload as { id: string; point: { x: number; y: number; z: number } };
  const profile = getThrowable(p.id);
  if (!profile) return;
  const path = profile.id === 'smoke_grenade'
    ? 'equipment/smoke_hiss_loop.wav'
    : `equipment/${profile.soundKeys.detonate}.wav`;
  audioManager.playSound3D(path, new THREE.Vector3(p.point.x, p.point.y, p.point.z),
    { volume: 0.9, refDistance: 14, key: profile.soundKeys.detonate });
});
// Hearing damage + ear ring.
eventBus.on('effect:audioMuffle', (payload) => {
  const p = payload as { seconds: number; strength: number; ringTone: string | null };
  audioManager.applyMuffle(p.seconds, p.strength);
  if (p.ringTone) {
    audioManager.playSound2D(`equipment/${p.ringTone}.wav`,
      { volume: 0.5 * p.strength, key: p.ringTone });
  }
});
// A nearby detonation gives positional awareness even with no damage dealt.
eventBus.on('equipment:detonated', (payload) => {
  const p = (payload as { point: { x: number; y: number; z: number } }).point;
  eventBus.emit('player:damaged', { amount: 0, sourceWorldPosition: p });
});

// --- Document H: killstreak framework --------------------------------------
// The manager holds NO per-streak logic; this map is the entire extension
// point. Killstreak #4 = one controller + one definition + one line here.
killstreakManager.registerController('UAVKillstreakController', () => new UAVKillstreakController());
killstreakManager.registerController('AirstrikeKillstreakController', () => new AirstrikeKillstreakController());
killstreakManager.registerController('AttackHelicopterKillstreakController', () => new AttackHelicopterKillstreakController());
killstreakManager.registerController('MissileKillstreakController', () => new MissileKillstreakController());
killstreakManager.attach({
  scene: levelLoader.scene,
  assetLoader: engine.assetLoader,
  physics,
  getPlayerPosition: () => playerController.getPosition(),
  getCameraForward: () => {
    const v = new THREE.Vector3();
    playerController.camera.threeCamera.getWorldDirection(v);
    return v;
  },
  getLevelDefinition: () => levelLoader.current,
});
killstreakManager.start();
groundTargeting.attach(levelLoader.scene, physics);

const killstreakHUD = new KillstreakHUD(killstreakManager);
const missileHUD = new MissileHUD();
cinematicCamera.attach(playerController.camera.threeCamera);
// Document M §7: the anti-clipping layer's geometry source.
cinematicCamera.attachPhysics(physics);

// --- Document I §2: the killstreak command tablet --------------------------
// Own camera-space anchor, NOT the weapon rig root: the weapon's pose
// offsets (sprint lower, tablet-hold drop) move the rig root, and a laptop
// parented to it rode the rifle's drop — the exact "tablet goes under the
// screen" failure. A device the player raises with their other hand follows
// the CAMERA, never the weapon's pose springs.
const tabletAnchor = new THREE.Object3D();
tabletAnchor.name = 'TabletAnchor';
playerController.camera.threeCamera.add(tabletAnchor);
/** Live whole-map capture feeding the killstreak tablet's designation map. */
const tabletLiveMap = new TabletLiveMap(engine.sceneManager.culling);
void killstreakTablet.attach({
  assetLoader: engine.assetLoader,
  killstreaks: killstreakManager,
  physics,
  getRigRoot: () => tabletAnchor,
  getPlayerPosition: () => playerController.getPosition(),
  getYaw: () => playerController.camera.threeCamera.rotation.y,
  liveMap: tabletLiveMap,
  getWorldExtents: () => {
    const level = levelLoader.current;
    return level?.worldExtents ?? {
      centerX: 0, centerZ: 0,
      halfWidth: level?.groundHalfSize ?? 60, halfHeight: level?.groundHalfSize ?? 60,
    };
  },
  onActivate: (slot) => { killstreakManager.activate(slot); },
  onDesignate: (slot, point) => {
    const def = killstreakManager.slots[slot];
    if (!def) return;
    if (def.id === 'guided_missile') {
      MissileKillstreakController.pendingTarget = point;
    } else {
      AirstrikeKillstreakController.pendingTarget = point;
      const fwd = new THREE.Vector3();
      playerController.camera.threeCamera.getWorldDirection(fwd);
      AirstrikeKillstreakController.pendingAxis = fwd;
    }
    killstreakManager.activate(slot);
  },
});


/**
 * The airstrike is 'directional': it needs a designated ground point BEFORE
 * activating. Pressing its key opens targeting; pressing fire confirms.
 */
let airstrikePendingSlot = -1;
const confirmAirstrike = (): void => {
  if (airstrikePendingSlot < 0) return;
  // RESOLVE THE TARGET NOW, on the click, rather than trusting whatever the
  // last frame's update() left behind. The update runs late in the frame, so
  // a fast confirm could otherwise fire against a stale or never-computed
  // point — which is exactly why the strike sometimes silently did nothing.
  groundTargeting.update(eyeOf(), forwardOf());
  if (groundTargeting.hasValidTarget) {
    AirstrikeKillstreakController.pendingTarget = groundTargeting.targetPoint;
    const forward = new THREE.Vector3();
    playerController.camera.threeCamera.getWorldDirection(forward);
    AirstrikeKillstreakController.pendingAxis = forward;
    killstreakManager.activate(airstrikePendingSlot);
  }
  groundTargeting.end();
  airstrikePendingSlot = -1;
};

// --- Killstreak input -------------------------------------------------------
// PRIMARY path is the tablet (Document I §2): raise it, cycle, hold to
// confirm, designate on the map. The direct slot keys remain as a fast
// alternative for streaks that need no target.
const KILLSTREAK_BINDS = ['killstreakSlot1', 'killstreakSlot2', 'killstreakSlot3'];
window.addEventListener('keydown', (e) => {
  if (!gameStateManager.is(GameState.PLAYING)) return;
  const bindings = engine.inputManager.getBindings();

  // Escape backs out of whatever overlay owns input, innermost first.
  if (e.code === bindings.pause) {
    if (killstreakTablet.isRaised) { killstreakTablet.lower(); e.stopPropagation(); return; }
    if (groundTargeting.isActive) {
      groundTargeting.end();
      airstrikePendingSlot = -1;
      return;
    }
  }

  if (e.code === bindings.killstreakTablet && !e.repeat) {
    killstreakTablet.toggle();
    return;
  }

  // Direct slot keys are ignored while the tablet owns input.
  if (killstreakTablet.isRaised) return;
  const slot = KILLSTREAK_BINDS.findIndex((action) => bindings[action] === e.code);
  if (slot < 0) return;
  const def = killstreakManager.slots[slot];
  if (!def) return;
  if (def.activationType === 'directional') {
    // Auto-opens the laptop straight onto the map — but ONLY when the slot is
    // actually ready. A locked/cooling/active refusal goes through the
    // manager instead, so the HUD flashes the slot red rather than letting
    // the player designate a target for a streak that then refuses to fire.
    if (killstreakManager.stateOf(def.id) === 'ready') {
      killstreakTablet.openForDesignation(slot);
    } else {
      killstreakManager.activate(slot); // refuses + emits killstreak:denied
    }
  } else {
    killstreakManager.activate(slot);
  }
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (killstreakTablet.isRaised) { killstreakTablet.primaryPressed(); return; }
  if (groundTargeting.isActive) confirmAirstrike();
});

// --- PLACEHOLDER vehicle showcase (F7) — see the new models in motion ------
// Scaffolding until Document H's KillstreakManager owns vehicle spawning.
void vehicleShowcase.load(engine.assetLoader, levelLoader.scene);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'F7' || !gameStateManager.is(GameState.PLAYING)) return;
  if (vehicleShowcase.isActive) vehicleShowcase.hide();
  else vehicleShowcase.show(playerController.getPosition().clone());
});

// --- Document G: the ONE shared explosion system ---------------------------
void explosionEffect.load(engine.assetLoader, levelLoader.scene, physics);
// Visuals are driven off the same event as damage and shake, but know nothing
// about either — that split is what lets a stun grenade reuse these visuals
// with zero blast damage.
eventBus.on('combat:explosion', (payload) => {
  const p = payload as {
    point?: { x: number; y: number; z: number };
    presetId?: string;
  };
  if (!p.point) return;
  const preset = EXPLOSION_PRESETS[p.presetId ?? 'rocketLauncher']
    ?? EXPLOSION_PRESETS.rocketLauncher;
  explosionEffect.spawn(
    new THREE.Vector3(p.point.x, p.point.y, p.point.z), preset,
  );
});

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
  // FPS/TPS Spec §1 "Hide 1PS Arms": in third person the viewmodel pass is
  // skipped entirely — cheaper than hiding the meshes, and it also drops the
  // masked 3PS head meshes (which live on the viewmodel layer in 1PS) from
  // ever being drawn.
  if (perspective.viewmodelVisible) {
    viewmodel.renderPass(renderer, engine.sceneManager.getScene());
  }
  drawCalls.viewmodel = renderer.info.render.calls;
  // Live minimap: the top-down capture must render AFTER the world pass and
  // be composited into the dish canvas BEFORE this frame presents, or the
  // 2D drawImage would read an undefined backbuffer. The HUD throttles; the
  // settings preview runs only while its canvas is on screen.
  const scene = engine.sceneManager.getScene();
  minimap.renderLiveFrame(renderer, scene, minimapCapture);
  minimapPreview.renderIfActive(latestFrameDt, renderer, scene, minimapCapture, {
    x: playerController.getPosition().x,
    z: playerController.getPosition().z,
  }, () => levelLoader.current !== null);
  // Killstreak tablet's whole-map designation view — same live capture
  // family, retargeted at the tablet screen's own render texture.
  tabletMapAccumulator += latestFrameDt;
  if (killstreakTablet.currentScreen === 'map'
    && tabletMapAccumulator >= 1 / 12) {
    tabletMapAccumulator = 0;
    tabletLiveMap.render(renderer, scene, killstreakTablet.displayAspect);
  }
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
    latestFrameDt = dt;
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
    // Document E §2.3/§2.4: a barely-perceptible "exertion" trauma trickle
    // while sprinting — continuous enough to read as physical effort, small
    // enough never to read as damage. Gated on input ownership and ground, so
    // pauses, cinematics and airborne slides never leak trauma.
    if (inputContexts.gameplayOwnsInput && playerController.isGrounded()) {
      if (playerController.isTacticalSprinting) {
        cameraShake.addTrauma(CAMERA_SHAKE.TAC_SPRINT_TRAUMA_TRICKLE * dt);
      } else if (playerController.currentState === PlayerState.SPRINT) {
        cameraShake.addTrauma(CAMERA_SHAKE.SPRINT_TRAUMA_TRICKLE * dt);
      }
    }
    // Doc C §5: the OperatorAnimEngine owns the animation frame — layers run
    // in the enforced order (locomotion → additive → spring → ik → oneshot);
    // the internal order still matches Document A/§6.1 exactly (springs
    // integrate → mixer steps → IK solves → applied same-frame).
    playerController.camera.setAdsWeight(viewmodel.adsWeight); // Doc C §6.4
    // §5: the one-shot arbiter tracks the viewmodel's LIVE clip state.
    animationEngine.syncOneShot(viewmodel.isOneShotRunning ? viewmodel.activeOneShotName : null);

    // --- UNIFIED CHARACTER: body BEFORE the animation engine ---------------
    // Strict order, and the reason the arms used to hang limp: this rig
    // restores its rest pose and writes the root/spine transform, so it must
    // finish before the engine's spring + IK layers pose the arms on top.
    // Driven from the SAME authoritative sim the camera reads, so aim pitch,
    // speed and stance can never diverge between perspectives.
    perspectiveSync.update(dt);
    thirdPersonBody.update(dt, {
      position: playerController.getPosition(),
      aimYaw: playerController.getYaw(),
      aimPitch: playerController.getPitch(),
      speed: playerController.getHorizontalSpeed(),
      localVelocity,
      isGrounded: playerController.isGrounded(),
      capsuleHeight: playerController.getCapsuleHeight(),
      movementState: playerController.currentState,
      traversalActive: playerController.isVaulting(),
      traversalProgress: playerController.vault.state.progress,
      traversalKind: playerController.isVaulting()
        ? (characterState.traversal === 'MANTLE' ? 'mantle' : 'vault')
        : null,
    });

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
    // Runs AFTER PlayerCamera wrote the eye transform (PlayerController is an
    // earlier updatable): it consumes that as the 1PS end of the S-curve.
    traversalPrompt.update(playerController.traversalPrompt);

    // --- Document C §8.4/§8.5 + D §6.5: magnified-optic scope --------------
    // Engage only at near-full ADS weight so the tunnel snaps in as the eye
    // reaches the glass, rather than fading over the whole raise.
    const scopeEngaged = scopeSystem.isScoped
      && viewmodel.adsWeight >= SCOPE.ENGAGE_AT_ADS_WEIGHT;
    const scopeSway = scopeSystem.update(dt, playerController.getHorizontalSpeed());
    playerController.camera.setScopeSway(scopeSway.yaw, scopeSway.pitch);
    scopeOverlay.setVisible(scopeEngaged);
    if (scopeEngaged) {
      const prof = weaponManager.activeWeapon.def.presentation;
      scopeOverlay.setMagnification(
        scopeSystem.currentMagnification, prof.minMagnification ?? 1,
      );
      scopeOverlay.setBreath(scopeSystem.breathFraction, scopeSystem.isHoldingBreath);
    }
    // §8.4 step 1: at full scope the eye is pressed to the glass, so the
    // arms and weapon are not visible at all.
    viewmodel.setHiddenByScope(scopeEngaged);
  perspective.update(dt);

    meleeCombo.update(dt);
    meleeHit.update(dt);
    casingPhysics.update(dt);
    // Document D §2.2: advance in-flight rockets (swept collision + detonation).
    projectileSystem.update(dt);
    explosionEffect.update(dt);
    vehicleShowcase.update(dt);
    killstreakManager.update(dt);
    killstreakHUD.update();

    // --- tablet ------------------------------------------------------------
    const fireHeld = engine.inputManager.isActionDown('fire');
    killstreakTablet.update(dt, fireHeld);
    if (killstreakTablet.isRaised) {
      // The tablet is a POINTING device: the mouse drives the cursor. The
      // camera's own guard means it is not consuming the delta right now.
      const look = engine.inputManager.getMouseDelta();
      if (look.x !== 0 || look.y !== 0) {
        killstreakTablet.moveCursorByMouse(look.x, look.y);
      }
      // The wheel cycles the streak selection while the tablet owns input —
      // WeaponManager's guard means it is not consuming the delta either.
      const wheelTick = engine.inputManager.getWheelDelta();
      if (wheelTick !== 0) killstreakTablet.cycle(wheelTick > 0 ? 1 : -1);
    }

    // --- guided missile -----------------------------------------------------
    cinematicCamera.update(dt);
    const missileCtrl = killstreakManager.activeControllerOfType(
      MissileKillstreakController,
    );
    if (missileCtrl) {
      const flying = inputContexts.is('missileControl');
      if (flying) {
        // Boost: the dedicated key, OR holding FIRE — the Predator-in-CoD
        // gesture, and what the missile feed's HUD text tells the player.
        missileCtrl.setSteering(
          engine.inputManager.getMouseDelta(),
          engine.inputManager.isActionDown('missileBoost')
            || engine.inputManager.isActionDown('fire'),
        );
      }
      const st = missileCtrl.flightState;
      const inMissileCam = st.phase === 'flying';
      missileHUD.setVisible(inMissileCam);
      missileHUD.update(
        st.fuel, st.pitch, st.altitude, st.heading, st.boosting, st.x, st.z,
      );

      // The camera is inside the missile's nose: the player's own arms, the
      // combat HUD and the minimap have no business being on screen. Hide
      // them for the whole cinematic AND the flight, restoring after.
      const cinematicActive = cinematicCamera.isActive || inMissileCam
        || st.phase === 'impact';
      // Ground fog is tuned for eye level; from 200 m up it turns the missile
      // feed into a grey wash. Fly fog-free, restore on return.
      levelLoader.setFogSuppressed(cinematicActive);
      viewmodel.setHiddenByScope(scopeEngaged || cinematicActive);
      hud.element.classList.toggle('hud--suppressed', cinematicActive);
      killstreakHUD.element.classList.toggle('hud--suppressed', cinematicActive);
      minimap.element.classList.toggle('hud--suppressed', cinematicActive);
      equipmentHUD.element.classList.toggle('hud--suppressed', cinematicActive);
    } else {
      missileHUD.setVisible(false);
      levelLoader.setFogSuppressed(false);
      for (const el of [hud.element, killstreakHUD.element,
        minimap.element, equipmentHUD.element]) {
        el.classList.remove('hud--suppressed');
      }
    }
    statusEffects.update(dt);
    inputContexts.update(dt);
    equipmentManager.update(dt);
    smokeVolume.update(dt);
    audioManager.update(dt);
    equipmentHUD.update();
    disorientOverlays.setSmokeAmount(smokeVolume.occlusionAt(eyeOf()));
    disorientOverlays.update();
    minimap.update(dt);
    if (groundTargeting.isActive) {
      const eye = playerController.camera.threeCamera.getWorldPosition(new THREE.Vector3());
      const fwd = playerController.camera.threeCamera.getWorldDirection(new THREE.Vector3());
      groundTargeting.update(eye, fwd);
    }
    fidgets.update(dt, viewmodel.currentWeaponId ?? '', playerController.getHorizontalSpeed() > 0.5, viewmodel.isOneShotRunning);
    // Weapon DROP while the tablet is actively used: the low-ready spring
    // carries the gun out of frame during the first half of the raise, then
    // the mesh leaves the render set entirely until the tablet lowers.
    viewmodel.setWeaponHidden(killstreakTablet.raiseAmount > 0.45);
    muzzleFlash.update(dt);
    impactEffect.update(dt);
    tracerEffect.update(dt);
    arena.update(dt);
  },
});

// Layer-7 pose input (movement state → weapon pose offsets, §4.7). The tablet
// flag parks the weapon at a deep low-ready so it never crowds the laptop's
// read space (Document I §2.3 / Document J §4.3-era behaviour); speed and
// grounding power Document E §2's stride-synced hand bob and air drift.
viewmodel.setPoseInputProvider(() => ({
  movementState: playerController.currentState,
  isTacticalSprinting: playerController.isTacticalSprinting,
  isSnappingToReady: weaponManager.isSnappingToReady,
  landingImpactVelocity: playerController.consumeLandingImpact(),
  tabletRaised: killstreakTablet.isRaised,
  horizontalSpeed: playerController.getHorizontalSpeed(),
  isGrounded: playerController.isGrounded(),
}));

void weaponManager.equipInitial();

// ===========================================================================
// DOCUMENT 5 — UI, HUD, AUDIO AND THE MATCH LIFECYCLE
// ===========================================================================

const audioManager = new AudioManager(engine.assetLoader, settingsStore);
audioManager.attach(engine.sceneManager.getCamera(), levelLoader.scene);
setUIAudio(audioManager);

const skinManager = new SkinManager(engine.assetLoader);
// Preload skins at boot, not only at match load: the Loadout screen is
// reachable straight from the main menu and needs them immediately.
void skinManager.preload();
const playerHealth = new PlayerHealth();

/** What the player is standing on — drives footstep and landing audio. */
const groundSurface = (): string => {
  const p = playerController.getPosition();
  return playerCollider.groundSurfaceAt(
    new THREE.Vector3(p.x, p.y + 0.4, p.z),
  ) ?? 'concrete';
};
playerController.footstepSystem.setSurfaceProvider(groundSurface);

bindGameAudio({
  audio: audioManager,
  weaponManager,
  getPlayerPosition: () => playerController.getPosition(),
  getGroundSurface: groundSurface,
});

matchStats.start();

// --- HUD -------------------------------------------------------------------
const hud = new HUDManager({
  audio: audioManager,
  getSpreadDegrees: () => {
    const weapon = weaponManager.activeWeapon;
    return weapon.getCurrentSpreadAngle(
      playerController.getState(),
      weaponManager.isADSActive,
      !playerController.isGrounded,
    );
  },
  getCameraYaw: () => playerController.camera.threeCamera.rotation.y,
  getPlayerPosition: () => playerController.getPosition(),
});
// The HUD ticks even while paused so a hit marker cannot freeze mid-flash.
engine.registerAlwaysUpdatable(hud);

// --- screens ---------------------------------------------------------------
const ui = new UIManager();
let activeLevelId = LEVELS[0].id;

/** Start (or restart) a match on a level: load it, then show the click gate. */
const beginLoad = async (levelId: string): Promise<void> => {
  activeLevelId = levelId;
  loadingScreen.setLevelName(getLevel(levelId).displayName);
  gameStateManager.setState(GameState.LOADING);
  // Audio first so nothing pops in on the first shot (§7.2/§9.2).
  await audioManager.preload(allAudioPaths());
  await skinManager.preload();
  await levelLoader.load(levelId);
};

/** The click gate: pointer lock and AudioContext both need a real gesture. */
const enterMatch = (): void => {
  const level = getLevel(activeLevelId);
  playerController.debugTeleport(level.spawn[0], level.spawn[1], level.spawn[2]);
  playerController.debugSetOrientation(level.spawnYaw, 0);
  playerHealth.reset();
  matchStats.reset();
  // A new match starts CLEAN: full ammo, no streaks running/cooling, no
  // tablet raised, no input context but gameplay, camera on the player rig.
  // Previously only position+health reset here, which is how leftover
  // cooldowns, half-empty magazines and the odd leaked tabletUI context rode
  // the menu back into the next session ("stuff doesn't reset").
  weaponManager.refillAllAmmo();
  killstreakManager.resetForNewMatch();
  killstreakTablet.forceLower();
  if (cinematicCamera.isActive || cinematicCamera.isDetached) cinematicCamera.cancel();
  inputContexts.reset();
  void audioManager.resume();
  engine.inputManager.requestPointerLock(canvas);
  gameStateManager.setState(GameState.PLAYING);
};

const mainMenu = new MainMenu((levelId) => { void beginLoad(levelId); });
const loadingScreen = new LoadingScreen(enterMatch);
const settingsMenu = new SettingsMenu(
  engine.inputManager,
  audioManager,
  (fov) => playerController.camera.setBaseFOV(fov),
);
const loadoutMenu = new LoadoutMenu(engine.assetLoader, skinManager);

const quitToMenu = (): void => {
  // Unwind gameplay-side ownership BEFORE unloading the level: a context or
  // a detached camera that outlives the menu transition freezes the player
  // the moment they come back.
  killstreakManager.resetForNewMatch();
  killstreakTablet.forceLower();
  if (cinematicCamera.isActive || cinematicCamera.isDetached) cinematicCamera.cancel();
  inputContexts.reset();
  levelLoader.unloadCurrentLevel();
  audioManager.stopAll();
  document.exitPointerLock?.();
  gameStateManager.setState(GameState.MAIN_MENU);
};

const endMatch = (reason: string): void => {
  gameOverScreen.setReason(reason);
  document.exitPointerLock?.();
  gameStateManager.setState(GameState.GAME_OVER);
};

const pauseMenu = new PauseMenu({
  onResume: () => {
    engine.inputManager.requestPointerLock(canvas);
    gameStateManager.setState(GameState.PLAYING);
  },
  onOpenSettings: () => {
    settingsMenu.setReturnTarget('pause');
    eventBus.emit('ui:overlay', { name: 'settings', open: true });
  },
  onQuitToMenu: quitToMenu,
  onEndMatch: () => endMatch('Match Ended'),
});

const gameOverScreen = new GameOverScreen({
  onRetry: () => { void beginLoad(activeLevelId); },
  onMainMenu: quitToMenu,
});

ui.register('mainMenu', mainMenu, GameState.MAIN_MENU);
ui.register('loadout', loadoutMenu, GameState.LOADOUT);
ui.register('settings', settingsMenu, GameState.SETTINGS);
ui.register('loading', loadingScreen, GameState.LOADING);
ui.register('pause', pauseMenu, GameState.PAUSED);
ui.register('gameOver', gameOverScreen, GameState.GAME_OVER);
ui.registerPersistent(hud.element);
ui.registerPersistent(killstreakHUD.element);
ui.registerPersistent(equipmentHUD.element);
ui.registerPersistent(minimap.element);
ui.registerPersistent(disorientOverlays.element);
ui.registerPersistent(missileHUD.element);
ui.registerPersistent(missileHUD.barsElement);
equipmentHUD.setKeyLabel(
  prettyKey(engine.inputManager.getBindings().throwTactical),
);
ui.start();

// Settings reached from the main menu returns to the main menu.
eventBus.on('game:stateChanged', (p) => {
  if ((p as { current: string }).current === GameState.SETTINGS) {
    settingsMenu.setReturnTarget('menu');
  }
});

// --- pause / resume --------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.code !== engine.inputManager.getBindings().pause) return;
  const state = gameStateManager.getState();
  if (state === GameState.PLAYING) {
    document.exitPointerLock?.();
    gameStateManager.setState(GameState.PAUSED);
  } else if (state === GameState.PAUSED && ui.openOverlays.length === 0) {
    engine.inputManager.requestPointerLock(canvas);
    gameStateManager.setState(GameState.PLAYING);
  }
});

// Losing pointer lock unexpectedly (alt-tab, browser Escape) must pause, or
// the player keeps taking damage behind a window they cannot see.
eventBus.on('input:pointerlock:lost', () => {
  if (gameStateManager.getState() === GameState.PLAYING) {
    gameStateManager.setState(GameState.PAUSED);
  }
});

// --- player damage ---------------------------------------------------------
engine.registerUpdatable({ update: (dt: number) => playerHealth.update(dt) });

// The rocket launcher's own blast is a real, working damage path (Document D
// §7.1 made the shooter a legitimate target), so health is reachable in
// normal play, not only via the debug bind below.
eventBus.on('player:damaged', () => { /* HUD binds this itself */ });
explosionDamage.setPlayerTarget(
  () => playerController.getPosition().clone(),
  (amount) => playerHealth.takeDamage(amount, undefined),
);

eventBus.on('player:died', () => endMatch('You Died'));

// Debug damage bind (F6): a guaranteed trigger path for the HUD's health,
// vignette and damage-direction widgets, per §8.1's requirement that at least
// one demonstrable path exists.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'F6' || !gameStateManager.is(GameState.PLAYING)) return;
  const p = playerController.getPosition();
  const angle = Math.random() * Math.PI * 2;
  playerHealth.takeDamage(HEALTH.DEBUG_DAMAGE, new THREE.Vector3(
    p.x + Math.sin(angle) * 6, p.y, p.z + Math.cos(angle) * 6,
  ));
});

engine.start();

// Document 5: the game now boots to a real main menu rather than straight
// into gameplay. LevelLoader.load() is still what actually starts a match —
// it just has real UI in front of it now.
gameStateManager.setState(GameState.MAIN_MENU);

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
  /** THE state authority — inspect current channels, log and rejections. */
  characterState: typeof characterState;
  projectileSystem: typeof projectileSystem;
  scopeSystem: typeof scopeSystem;
  cameraShake: typeof cameraShake;
  explosionEffect: typeof explosionEffect;
  vehicleShowcase: typeof vehicleShowcase;
  killstreakManager: typeof killstreakManager;
  killstreakHUD: KillstreakHUD;
  radarContacts: typeof radarContacts;
  groundTargeting: typeof groundTargeting;
  killstreakTablet: typeof killstreakTablet;
  cinematicCamera: typeof cinematicCamera;
  inputContexts: typeof inputContexts;
  missileHUD: MissileHUD;
  equipmentManager: typeof equipmentManager;
  throwableEffects: typeof throwableEffects;
  statusEffects: typeof statusEffects;
  smokeVolume: typeof smokeVolume;
  visionObstructions: typeof visionObstructions;
  equipmentHUD: EquipmentHUD;
  disorientOverlays: DisorientOverlays;
  minimap: Minimap;
  scopeOverlay: typeof scopeOverlay;
  gameStateManager: typeof gameStateManager;
  eventBus: typeof eventBus;
  playerController: PlayerController;
  resolveNextState: typeof resolveNextState;
  inputManager: Engine['inputManager'];
  // Document 3 additions (headless acceptance harness).
  weaponManager: WeaponManager;
  viewmodel: WeaponViewmodel;
  ballistics: typeof ballistics;
  arena: LevelLoader;
  levelLoader: LevelLoader;
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
  // FPS/TPS Spec acceptance seams.
  thirdPersonBody: ThirdPersonBody;
  perspective: PerspectiveController;
  perspectiveSync: PerspectiveSync;
  physics: PhysicsWorld;
  drawCalls: () => { world: number; viewmodel: number };
  // Document 2.5 §3.3 acceptance seams.
  descriptorLog: () => ResolvedAnimationDescriptor[];
  mockAnimationTarget: AnimationTarget;
}
(window as unknown as { __OPERATOR__: OperatorTestHook }).__OPERATOR__ = {
  engine,
  characterState,
  projectileSystem,
  scopeSystem,
  scopeOverlay,
  cameraShake,
  explosionEffect,
  vehicleShowcase,
  killstreakManager,
  killstreakHUD,
  radarContacts,
  groundTargeting,
  killstreakTablet,
  cinematicCamera,
  inputContexts,
  missileHUD,
  equipmentManager,
  throwableEffects,
  statusEffects,
  smokeVolume,
  visionObstructions,
  equipmentHUD,
  disorientOverlays,
  minimap,
  gameStateManager,
  eventBus,
  playerController,
  resolveNextState,
  inputManager: engine.inputManager,
  weaponManager,
  viewmodel,
  ballistics,
  arena,
  levelLoader,
  animationStateMachine,
  blender,
  compositor,
  sway,
  recoilSystem,
  handsRig,
  thirdPersonBody,
  perspective,
  perspectiveSync,
  physics,
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
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.cheatsStore = cheatsStore;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.playerHealth = playerHealth;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.quitToMenu = quitToMenu;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.getProfile = getProfile;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.input = engine.inputManager;
// Document 5 surfaces, for the acceptance harness.
Object.assign((window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__, {
  audioManager, hud, ui, matchStats, playerHealth, loadoutManager, skinManager,
  settingsStore, levelLoader, mainMenu, loadingScreen, settingsMenu, loadoutMenu,
});
// ---------------------------------------------------------------------------
// End TEMPORARY block.
// ---------------------------------------------------------------------------
