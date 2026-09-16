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
import { DEFAULT_KILLSTREAK_LOADOUT } from './killstreaks/definitions';
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
// --- Document V: vehicles ---------------------------------------------------
import { VehicleSystem } from './vehicles/VehicleSystem';
import { VehicleHUD } from './ui/VehicleHUD';
import { VehiclePrompt } from './ui/VehiclePrompt';
import { TeleportPadSystem } from './world/TeleportPadSystem';
import PROTOTYPE_TELEPORTS from './world/PrototypeTeleports';
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
import RAPIER from '@dimforge/rapier3d-compat';
import calloutZoneRegistry from './world/CalloutZoneRegistry';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { ColliderFactory } from './physics/ColliderFactory';
import PlayerCharacterController from './physics/PlayerCharacterController';
import { SWAY, SCOPE } from './utils/Constants';
import AnimationStateMachine from './animation/AnimationStateMachine';
import AnimationBlender from './animation/AnimationBlender';
import AnimationLayerCompositor from './animation/AnimationLayerCompositor';
import ThirdPersonBody from './character/ThirdPersonBody';
import RemotePlayers from './character/RemotePlayers';
import PerspectiveController from './player/PerspectiveController';
import PerspectiveSync from './animation/PerspectiveSync';
import type { ResolvedAnimationDescriptor, AnimationTarget } from './animation/AnimationBlender';
import { createLocalSession, type GameSession } from './net/GameSession';
import {
  createHostedSession, joinHostedSession, type HostedGameSession,
} from './net/HostedSession';
import { resolveLobbyUrl, resolveLobbyHttpBase } from './net/lobbyUrl';
import type { GameListing } from './net/LobbyProtocol';
import type { GameClientEvents } from './net/GameClient';
import { InputRelay } from './net/InputRelay';
import { httpLevelFetcher } from './server/LevelStore';
import loadProgress, { DEPLOY_STAGES } from './core/LoadProgress';
import { OperatorShowcase } from './ui/showcase/OperatorShowcase';
import OperatorsMenu from './ui/menus/OperatorsMenu';
import operatorRoster from './customization/OperatorRoster';
import { WORLD_PASS_MASK } from './core/RenderLayers';
import DeathCamera from './player/DeathCamera';
import DeathOverlay from './ui/hud/DeathOverlay';
import Killfeed from './ui/hud/Killfeed';
import MatchBar from './ui/hud/MatchBar';
import { WEAPON_LABELS } from './ui/menus/LoadoutMenu';
import type { DeathWire, MatchRulesWire, Vec3 } from './net/Protocol';
// Mode metadata is shared DATA, not server behaviour: the client reads it to
// label the loading screen. Same direction as the menu already reads it.
import { getGameMode } from './server/GameModes';

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
  quality: engine.quality,
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
// The sun's shadow box follows the player (ShadowDirector): sharper shadows
// from a small fraction of the casters. Registered here rather than inside
// the Engine, which must never import gameplay systems.
engine.setFocusProvider(() => playerController.getPosition());

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

// --- Document V: vehicle system + teleport pads -----------------------------
// VehicleSystem is the single owner of character<->vehicle: entering,
// exiting, seat occupancy and camera placement. It sits above the per-domain
// handling models (land/air/sea) and below nothing — gameplay talks to it,
// never to a Vehicle directly.
const vehicleHUD = new VehicleHUD();
const vehiclePrompt = new VehiclePrompt();
const vehicleSystem = new VehicleSystem({
  scene: levelLoader.scene,
  camera: engine.sceneManager.getCamera(),
  input: engine.inputManager,
  physics,
  assetLoader: engine.assetLoader,
  player: playerController,
  hud: vehicleHUD,
  prompt: vehiclePrompt,
});
engine.registerUpdatable(vehicleSystem);

const teleportPads = new TeleportPadSystem(
  levelLoader.scene, playerController, engine.inputManager,
);
engine.registerUpdatable({
  update: (dt: number): void => {
    // Pads are disabled while driving: the confirm key is the same one that
    // gets you out of a vehicle, and a car parked on a pad would otherwise
    // pop the chooser every frame.
    if (!vehicleSystem.isRiding) teleportPads.update(dt);
  },
});

/**
 * Populate the prototype map once it finishes loading.
 *
 * Bound to the level-loaded event rather than called once at boot, because
 * the pads live in the shell .glb and the vehicles must be re-spawned every
 * time the level is (re)loaded.
 */
async function populatePrototype(levelId: string): Promise<void> {
  if (levelId !== 'prototype') return;
  const bound = teleportPads.bindFromScene(levelLoader.scene, PROTOTYPE_TELEPORTS);
  console.info(`[prototype] bound ${bound} teleport pads`);

  // Two Humvees at the hub, one of each variant, angled so the player can
  // see both from spawn.
  await vehicleSystem.spawn('military_car', new THREE.Vector3(-9, 0.6, 14), 0.25);
  await vehicleSystem.spawn('military_car_gunner', new THREE.Vector3(9, 0.6, 14), -0.25);
  // One on the driving course, so teleporting there has something to drive.
  await vehicleSystem.spawn('military_car', new THREE.Vector3(70, 0.6, 70), Math.PI / 2);

  // Helicopters on the pads. The HELIPADS teleport drops the player at
  // (-46, -24) facing +X, so the nearest pad at (-62, -24) is dead ahead.
  // Nose them -Z (north, down the open apron) so a first take-off is not
  // immediately into the hangars.
  await vehicleSystem.spawn('utility_helicopter', new THREE.Vector3(-62, 0.1, -24), 0);
  await vehicleSystem.spawn('utility_helicopter', new THREE.Vector3(-95, 0.1, -40), 0.4);
}

eventBus.on('level:loaded', (payload: unknown) => {
  const id = (payload as { levelId?: string } | undefined)?.levelId
    ?? levelLoader.current?.id;
  if (id) void populatePrototype(id);
});

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
// Everyone who is not you. Until this existed the client drew a single
// character and the lobby was invisible.
const remotePlayers = new RemotePlayers(engine.assetLoader);
remotePlayers.attach(arena.scene);
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
/**
 * Which layers the world pass draws.
 *
 * Normally the perspective controller decides — first person hides the head
 * (you cannot see inside your own skull) and the body's arms (the viewmodel
 * supplies those).
 *
 * But those exclusions are only correct for a camera INSIDE the player's
 * head. The moment the camera is somewhere else — the death cam orbiting the
 * body, a killstreak cinematic, a future killcam — they become a bug: the
 * character renders as a headless, armless torso. That was exactly the
 * reported symptom, "other cameras must see the full body, not just the
 * torso".
 *
 * So an external camera forces the third-person mask. One rule, applied
 * wherever the camera actually is, rather than every external-camera feature
 * having to remember to fix the layers itself.
 */
engine.setWorldPassMaskProvider(() => (
  cinematicCamera.isActive || cinematicCamera.isDetached
    ? WORLD_PASS_MASK.THIRD
    : perspective.worldPassMask
));

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
/** Tracks the last applied weapon-HUD visibility so it is only written on
 *  change, not every frame. */
let weaponHudHidden = false;
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
  // Radar reads the server's own player list. Anything else is a guess: the
  // client's hit-test registry only holds locally-spawned props, so a UAV
  // fed from it swept the training dummies and never showed a single real
  // enemy.
  getPlayers: () => {
    const client = session?.client;
    if (!client) return [];
    const myId = client.id;
    const me = client.players.find((p) => p.id === myId);
    const myTeam = me?.team ?? 'FFA';
    return client.players.map((p) => ({
      id: p.id,
      x: p.pos[0],
      z: p.pos[2],
      alive: p.alive,
      isLocal: p.id === myId,
      // In a free-for-all there are no allies, so everyone else is a contact.
      isFriendly: myTeam !== 'FFA' && p.team === myTeam,
    }));
  },
});
// Restore the player's saved killstreak loadout. Without this the menu's
// choice only took effect while the menu was open -- the manager fell back
// to DEFAULT_KILLSTREAK_LOADOUT on every boot.
killstreakManager.setLoadout(settingsStore.get<string[]>(
  'loadout.killstreaks', [...DEFAULT_KILLSTREAK_LOADOUT],
));
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
  // Document V: riding a vehicle is a forced third-person exterior view, so
  // the first-person arms/weapon pass is skipped for the same reason as 3PS.
  // Without this the rifle floats in front of the chase camera.
  if (perspective.viewmodelVisible && !vehicleSystem.isRiding) {
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
      deathBlend: deathCollapse,
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
      // The combat HUD belongs to a LIVING player: a crosshair over your own
      // corpse and a killstreak tray you cannot press both read as bugs. The
      // match bar and killfeed are deliberately NOT in this list -- the match
      // is still running without you, and showing that is the point of the
      // death cam.
      for (const el of [hud.element, killstreakHUD.element,
        minimap.element, equipmentHUD.element]) {
        el.classList.toggle('hud--suppressed', awaitingRespawn);
      }
    }
    statusEffects.update(dt);
    inputContexts.update(dt);
    equipmentManager.update(dt);
    smokeVolume.update(dt);
    audioManager.update(dt);
    equipmentHUD.update();
    // Weapon-only HUD follows the ride state. The ammo counter and crosshair
    // describe a gun the driver is not holding, and the ammo block sits
    // exactly where the vehicle HUD draws speed and gear.
    const ridingNow = vehicleSystem.isRiding;
    if (ridingNow !== weaponHudHidden) {
      weaponHudHidden = ridingNow;
      hud.setWeaponHudVisible(!ridingNow);
      equipmentHUD.element.style.display = ridingNow ? 'none' : '';
    }
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
    // Batched-cell LOD selection, driven ONCE from the player's camera (see
    // LevelLoader.updateLODs for why THREE.LOD.autoUpdate is off).
    levelLoader.updateLODs(engine.sceneManager.getCamera());
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

// --- match presentation ----------------------------------------------------
// These exist BEFORE the session because the session's callbacks drive them.
const deathCamera = new DeathCamera(cinematicCamera);
const deathOverlay = new DeathOverlay();
const killfeed = new Killfeed();
const matchBar = new MatchBar();

// --- authoritative session -------------------------------------------------
// The server is driven from the ALWAYS-updatables list, never the gated one.
// Engine's gated list only ticks in PLAYING, which would make pausing stop
// the simulation -- correct for a solo game, wrong for a multiplayer one, and
// the requirement is that the game behaves as multiplayer even when one
// player is in it. The server decides whether a pause request is honoured
// (solo: yes; with others present: no) and reports back; the client renders
// that answer instead of assuming it.
let session: GameSession | null = null;
/** Set while this tab is HOSTING, so the lobby listing can be kept current. */
let hostedSession: HostedGameSession | null = null;
let simulationRunning = true;

let inputRelay: InputRelay | null = null;

/**
 * The death presentation, driven entirely by the server.
 *
 * `respawnAt` is a client-local deadline derived from the server's
 * `respawnIn`: the countdown has to tick every frame, and asking the server
 * for the remaining time sixty times a second would be absurd. The SERVER
 * still decides when you actually respawn — this is only the display, and if
 * the two ever disagree the server's `respawned` message wins, because that
 * is what moves the player.
 */
let respawnAt = 0;
let awaitingRespawn = false;
/**
 * 0 = standing, 1 = collapsed. Eased every frame rather than set outright so
 * the body falls over instead of snapping flat the instant health hits zero.
 */
let deathCollapse = 0;

const beginDeathPresentation = (death: DeathWire, respawnIn: number): void => {
  awaitingRespawn = true;
  respawnAt = performance.now() / 1000 + respawnIn;

  // Stop driving a body that is no longer alive: without this the corpse
  // keeps walking because the input relay never stopped sending intent.
  inputRelay?.setEnabled(false);
  document.exitPointerLock?.();

  deathCamera.begin({
    subject: new THREE.Vector3(...death.victimPos),
    from: death.killerPos ? new THREE.Vector3(...death.killerPos) : null,
    victimYaw: playerController.getYaw(),
  });

  deathOverlay.show({
    killerName: death.killerName,
    weaponLabel: death.weaponId ? (WEAPON_LABELS[death.weaponId] ?? null) : null,
    headshot: death.headshot,
    distance: death.distance,
    // The killer's health is not in the wire payload yet; a killcam will
    // carry it. Null hides the bar rather than showing a wrong one.
    killerHealth: null,
  });
  deathOverlay.setRespawnIn(respawnIn);
};

const endDeathPresentation = (pos: Vec3, yaw: number): void => {
  awaitingRespawn = false;
  deathCamera.end();
  deathOverlay.hide();
  // Put the body where the server says it is. The server picked this spawn
  // with the full spawn-selection model (enemy sightlines, recent deaths,
  // teammate positions); the client's job is to agree with it.
  playerController.debugTeleport(pos[0], pos[1], pos[2]);
  playerController.debugSetOrientation(yaw, 0);
  playerHealth.reset();
  weaponManager.refillAllAmmo();
  inputRelay?.setEnabled(true);
  if (gameStateManager.is(GameState.PLAYING)) {
    engine.inputManager.requestPointerLock(canvas);
  }
};

/**
 * Everything the client does in response to the server.
 *
 * Extracted so a hosted or joined session gets EXACTLY the same handlers as
 * single-player. A guest's killfeed, death cam and scoreboard are driven by
 * the host's server through this same bundle, which is what makes the two
 * arrangements behave identically rather than merely similarly.
 */
const sessionEvents: GameClientEvents = {
  onSimulationState: (running, reason) => {
    simulationRunning = running;
    eventBus.emit('net:simulationState', { running, reason });
  },
  onMatchEnded: (reason) => { eventBus.emit('net:matchEnded', { reason }); },
  onMatchState: (state) => {
    matchBar.render(state, session?.client.id ?? null);
    // Hold the local player still while the round counts in. The server
    // already refuses the input; this stops the client PREDICTING movement
    // the server will reject, which looked like severe lag as each snapshot
    // dragged the player back to the spawn.
    playerController.setMovementFrozen(inputShouldBeHeld(state.phase));
    eventBus.emit('net:matchState', state);
  },
  onPlayerStates: (states) => {
    remotePlayers.setLocalId(session?.client.id ?? '');
    remotePlayers.sync(states);
  },
  onDied: (death, respawnIn) => beginDeathPresentation(death, respawnIn),
  onRespawned: (pos, yaw) => endDeathPresentation(pos, yaw),
  onKillfeed: (entry) => {
    // Compare IDS, not display names. Names are unique by policy, not by
    // construction, and a duplicate would highlight the wrong row.
    const myId = session?.client.id ?? null;
    const myTeam = entry.killerId === myId ? entry.killerTeam
      : entry.victimId === myId ? entry.victimTeam
        : (session?.client.players.find((p) => p.id === myId)?.team ?? 'FFA');
    // In FFA nobody is an ally, so "friendly" means "is me".
    const friendly = (team: 'A' | 'B' | 'FFA' | null, id: string | null): boolean => {
      if (id === myId) return true;
      if (!team || team === 'FFA' || myTeam === 'FFA') return false;
      return team === myTeam;
    };
    killfeed.push({
      killerName: entry.killerName,
      victimName: entry.victimName,
      weaponId: entry.weaponId,
      headshot: entry.headshot,
      killerIsLocal: entry.killerId === myId,
      victimIsLocal: entry.victimId === myId,
      killerIsFriendly: friendly(entry.killerTeam, entry.killerId),
      victimIsFriendly: friendly(entry.victimTeam, entry.victimId),
    });
  },
};

/** Point the game at a session: it owns the input relay and the client. */
const adoptSession = (s: GameSession): GameSession => {
  session = s;
  // The relay reports INTENT every frame; the server decides the outcome.
  inputRelay = new InputRelay(s.client, engine.inputManager, playerController);
  // Keep the test hook pointed at the LIVE session. Without this, swapping to
  // a hosted session would leave tests inspecting the disposed one -- which
  // reads as "the server stopped responding" rather than "wrong object".
  const hook = (window as unknown as { __OPERATOR__?: Record<string, unknown> }).__OPERATOR__;
  if (hook) {
    hook.session = s;
    hook.gameClient = s.client;
    hook.gameServer = s.server;
  }
  return s;
};

const sessionReady = createLocalSession(
  sessionEvents, { levelFetcher: httpLevelFetcher() },
).then(adoptSession);
void sessionReady;

engine.registerAlwaysUpdatable({
  update: (dt: number) => {
    // Input only flows while actually playing -- a player in a menu is not
    // steering. The SERVER still ticks regardless, which is the whole point.
    if (gameStateManager.getState() === GameState.PLAYING) inputRelay?.update(dt);
    session?.update(dt);

    // The death camera is on the ALWAYS list for the same reason the server
    // is: it must keep moving while the player has no control. A death cam
    // that freezes because input stopped is just a screenshot.
    // Collapse over ~0.45 s on death, and pop straight back up on respawn:
    // a body that eases UP out of the ground looks like it is being winched.
    const collapseTarget = awaitingRespawn ? 1 : 0;
    deathCollapse = collapseTarget > deathCollapse
      ? Math.min(1, deathCollapse + dt / 0.45)
      : 0;

    deathCamera.update(dt);
    killfeed.update(dt);
    // Always updated, never gated on PLAYING: the death camera orbits a body
    // while other players keep moving, and frozen bodies during the respawn
    // countdown would look like the game had hung.
    remotePlayers.update(dt);
    if (awaitingRespawn) {
      deathOverlay.setRespawnIn(respawnAt - performance.now() / 1000);
    }
  },
});

/**
 * Replace the live session, disposing whatever was there.
 *
 * Every arrangement (single-player, hosting, joining) produces a GameSession,
 * so swapping is the only thing that differs between them. Disposing first is
 * what makes "end the match and start another" actually end the old server
 * rather than leaving it ticking in the background.
 */
const swapSession = async (next: Promise<GameSession>): Promise<GameSession> => {
  const previous = session;
  session = null;
  inputRelay = null;
  previous?.dispose();
  return adoptSession(await next);
};

/** Back to a private, in-tab match. */
const swapToLocalSession = (): Promise<GameSession> => {
  if (session && session.server && !hostedSession) return Promise.resolve(session);
  hostedSession = null;
  return swapSession(createLocalSession(
    sessionEvents, { levelFetcher: httpLevelFetcher() },
  ));
};

/** Host a game other players can find in the server browser. */
const startHosting = async (
  levelId: string,
  options: { modeId?: string; overrides?: MatchRulesWire; lobbyName?: string; bots?: boolean },
): Promise<GameSession> => {
  const mode = getGameMode(options.modeId ?? 'ffa');
  const created = await swapSession(createHostedSession({
    lobbyUrl: resolveLobbyUrl(),
    name: options.lobbyName
      ?? `${operatorRoster.selected.name.toUpperCase()}'S GAME`,
    levelId,
    modeId: options.modeId ?? 'ffa',
    maxPlayers: options.overrides?.maxPlayers ?? mode.maxPlayers,
    ...(options.bots ? { bots: true } : {}),
    levelFetcher: httpLevelFetcher(),
  }, sessionEvents));
  hostedSession = created as HostedGameSession;
  return created;
};

/** Join a game somebody else is hosting. */
const joinGame = async (game: GameListing, password?: string): Promise<void> => {
  activeModeId = game.modeId;
  activeRules = null;
  hostedSession = null;
  await swapSession(joinHostedSession({
    lobbyUrl: resolveLobbyUrl(),
    gameId: game.id,
    ...(password ? { password } : {}),
  }, sessionEvents));
  await beginLoad(game.levelId);
};

// --- screens ---------------------------------------------------------------
const ui = new UIManager();
let activeLevelId = LEVELS[0].id;
/** Which game mode the next match runs. FFA is the default, as in COD. */
let activeModeId = 'ffa';
/** Custom-match rule patch for the next join, or null for the mode defaults. */
let activeRules: MatchRulesWire | null = null;

/** Start (or restart) a match on a level: load it, then show the click gate. */
const beginLoad = async (levelId: string): Promise<void> => {
  activeLevelId = levelId;
  const level = getLevel(levelId);
  loadingScreen.setLevel(level.displayName, level.description, levelId);
  loadingScreen.setMode(getGameMode(activeModeId).displayName);
  gameStateManager.setState(GameState.LOADING);

  // Declare the whole run up front so the bar is weighted by real work
  // rather than by which phase happens to report.
  loadProgress.begin(DEPLOY_STAGES);

  // Audio first so nothing pops in on the first shot (§7.2/§9.2).
  loadProgress.enter('audio');
  await audioManager.preload(allAudioPaths());
  loadProgress.complete('audio');

  loadProgress.enter('skins');
  await skinManager.preload();
  loadProgress.complete('skins');

  // LevelLoader reports its own four stages from inside.
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
  // The server owns match state; the client asks to join and resets its own
  // presentation. Every authoritative reset (entities, pools, effect queues)
  // happens server-side in response to this.
  // Join with the operator and weapons the player actually chose. This is
  // what makes the operator selection REAL rather than a menu that changes a
  // picture: the server stores it, puts it in the public player state, and
  // every other client renders you as that operator.
  const chosen = loadoutManager.getCurrentLoadout();
  session?.client.joinMatch(activeLevelId, {
    primaryId: chosen.primaryId,
    secondaryId: chosen.secondaryId,
    tacticalId: 'flash',
    killstreakIds: killstreakManager.slots.map((s) => s.id),
    operatorId: operatorRoster.selectedId_,
  }, {
    modeId: activeModeId,
    ...(activeRules ? { rules: activeRules } : {}),
  });
  gameStateManager.setState(GameState.PLAYING);
};

/**
 * Should the local player be held still?
 *
 * True during the pre-match countdown, and whenever a menu is open over a
 * live match. Note this holds the PLAYER, not the simulation: gravity,
 * collision and the server all keep running, so the client never drifts out
 * of agreement with the server the way a hard pause did.
 */
const inputShouldBeHeld = (phase?: string): boolean => (
  phase === 'countdown' || !gameStateManager.is(GameState.PLAYING)
);

/** Re-evaluate the hold whenever the UI state changes, not just on snapshots. */
eventBus.on('game:stateChanged', () => {
  playerController.setMovementFrozen(
    inputShouldBeHeld(session?.client.match?.phase),
  );
});

const mainMenu = new MainMenu((levelId, options) => {
  // The lobby's choices are recorded here and applied at join time, because
  // the SERVER owns the mode -- the client is only reporting what the host
  // asked for.
  activeModeId = options?.modeId ?? 'ffa';
  activeRules = options?.overrides ?? null;
  levelLoader.setWeather(options?.weather ?? null);

  // Hosting swaps the in-tab single-player server for one that also admits
  // remote peers. Everything downstream -- loading, the click gate, the HUD
  // -- is unchanged, because a hosted session is the same GameSession shape.
  if (options?.host) {
    void startHosting(levelId, options).then(() => beginLoad(levelId));
    return;
  }
  void swapToLocalSession().then(() => beginLoad(levelId));
}, joinGame);
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
  // Clear the death presentation, or a player who quits while dead returns
  // to a menu with a death overlay and an orbiting camera still on top.
  awaitingRespawn = false;
  deathCamera.end();
  deathOverlay.hide();
  killfeed.clear();
  // Bodies belong to the match that made them.
  remotePlayers.clear();
  inputRelay?.setEnabled(true);
  // Leaving the match ends it server-side too, which runs the authoritative
  // cleanup (entities pooled, players dropped, effect queues drained, bot
  // roster discarded, scoreboard wiped). Quit used to unwind only the
  // client's half, so server-owned state would have ridden back into the
  // next session -- which is precisely how "starting a new game reopens the
  // previous one" happened.
  session?.client.leaveMatch();
  levelLoader.unloadCurrentLevel();
  audioManager.stopAll();
  document.exitPointerLock?.();
  gameStateManager.setState(GameState.MAIN_MENU);
};

/**
 * Show the debrief.
 *
 * Called ONLY when the match is genuinely over — the score limit, the clock,
 * or the player ending it. Death does not come here any more; it runs the
 * death camera and a respawn countdown instead.
 */
const endMatch = (reason: string): void => {
  // Whatever the death cam was doing, it is not doing it any more.
  awaitingRespawn = false;
  deathCamera.end();
  deathOverlay.hide();
  inputRelay?.setEnabled(true);
  gameOverScreen.setReason(reason);
  // The final standings are the server's, not ours.
  gameOverScreen.setFinalState(
    session?.client.match ?? null, session?.client.id ?? null,
  );
  document.exitPointerLock?.();
  gameStateManager.setState(GameState.GAME_OVER);
};

// The SERVER decides a match is over (score limit, clock). Before this the
// event was emitted and nothing listened, so a match could reach its limit
// server-side and the player would simply keep playing.
eventBus.on('net:matchEnded', (payload) => {
  const reason = (payload as { reason?: string })?.reason ?? 'Match Over';
  // 'match empty' is our own leaveMatch echoing back while we are already on
  // our way to the menu; showing a debrief for it would fight the transition.
  if (reason === 'match empty' || reason === 'server shutdown') return;
  if (gameStateManager.is(GameState.MAIN_MENU)) return;
  endMatch(prettyEndReason(reason));
});

/** Server reasons are terse and lower-case; the debrief is not. */
function prettyEndReason(reason: string): string {
  if (reason.includes('score limit')) return 'Score Limit Reached';
  if (reason.includes('time')) return 'Time Expired';
  return reason.replace(/^./, (c) => c.toUpperCase());
}

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

// --- the live operator standing in the menus -------------------------------
// One showcase instance shared by the main menu and operator select: two live
// WebGL contexts rendering the same soldier would double the cost for nothing.
const operatorShowcase = new OperatorShowcase(engine.assetLoader);
const operatorsMenu = new OperatorsMenu();
mainMenu.attachShowcase(operatorShowcase);
operatorsMenu.attachShowcase(operatorShowcase);

// Driven from the ALWAYS-updatables list so it animates in the menu, where
// the gameplay simulation is deliberately not running.
engine.registerAlwaysUpdatable({
  update: (dt: number) => {
    const state = gameStateManager.getState();
    if (state === GameState.MAIN_MENU || state === GameState.OPERATORS) {
      operatorShowcase.update(dt);
    }
    // The deploy screen's background drift must keep moving while the main
    // thread is busy building the level -- that is the whole point of it.
    if (state === GameState.LOADING) loadingScreen.update(dt);
  },
});
window.addEventListener('resize', () => operatorShowcase.resize());

ui.register('operators', operatorsMenu, GameState.OPERATORS);
ui.register('mainMenu', mainMenu, GameState.MAIN_MENU);
ui.register('loadout', loadoutMenu, GameState.LOADOUT);
ui.register('settings', settingsMenu, GameState.SETTINGS);
ui.register('loading', loadingScreen, GameState.LOADING);
ui.register('pause', pauseMenu, GameState.PAUSED);
ui.register('gameOver', gameOverScreen, GameState.GAME_OVER);
ui.registerMatchHud(hud.element);
ui.registerMatchHud(killstreakHUD.element);
ui.registerMatchHud(equipmentHUD.element);
ui.registerMatchHud(minimap.element);
ui.registerMatchHud(disorientOverlays.element);
ui.registerMatchHud(missileHUD.element);
ui.registerMatchHud(missileHUD.barsElement);
ui.registerMatchHud(matchBar.element);
ui.registerMatchHud(matchBar.countdownElement);
ui.registerMatchHud(killfeed.element);
// The death overlay is PERSISTENT, not a routed screen: the death camera is
// still rendering the world behind it, and a routed screen would hide the
// canvas. That distinction is the whole reason death is no longer a screen.
ui.registerMatchHud(deathOverlay.element);
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
    // Ask -- do not assume. The menu still opens either way (a player can
    // always reach settings and quit), but whether the WORLD stops is the
    // server's call. In a populated match it keeps running behind the menu.
    session?.client.requestPause(true);
    gameStateManager.setState(GameState.PAUSED);
  } else if (state === GameState.PAUSED && ui.openOverlays.length === 0) {
    engine.inputManager.requestPointerLock(canvas);
    session?.client.requestPause(false);
    gameStateManager.setState(GameState.PLAYING);
  }
});

// Losing pointer lock unexpectedly (alt-tab, browser Escape) must pause, or
// the player keeps taking damage behind a window they cannot see.
/**
 * Whether the pointer lock this PLAYING session was ever actually granted.
 *
 * Losing a lock you never held is not the player alt-tabbing, and must not
 * pause the match. Without this the following race pauses a brand-new match
 * the instant it starts: quitToMenu() calls exitPointerLock(), the browser
 * delivers that `pointerlockchange` asynchronously, and if the player has
 * already picked a new map the event arrives when the state is once again
 * PLAYING -- so the new match pauses because the OLD one released the mouse.
 */
let pointerLockHeld = false;
eventBus.on('input:pointerlock:acquired', () => { pointerLockHeld = true; });

eventBus.on('input:pointerlock:lost', () => {
  const wasHeld = pointerLockHeld;
  pointerLockHeld = false;
  // A release we never owned: a stale event from a previous match, or a
  // request the browser refused. Not a reason to pause.
  if (!wasHeld) return;
  // Dying releases pointer lock on purpose -- the death camera is running and
  // the player has no body to steer. Pausing here would drop the menu over
  // the death cam and, worse, read as the match being interrupted by the
  // player rather than by the bullet.
  if (awaitingRespawn) return;
  if (gameStateManager.getState() === GameState.PLAYING) {
    session?.client.requestPause(true);
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

// Dying is NOT the end of the match. This used to be
// `endMatch('You Died')`, which tore down the whole session — the single
// worst bug in the client, and the reason a new game could open on top of
// the previous one. The server now owns death entirely and tells us about
// it; all the client does is present it.
//
// The local health system still emits `player:died` for its own HUD
// purposes, but it no longer decides anything.

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
  THREE: typeof THREE;
  loadoutManager: typeof loadoutManager;
  operatorRoster: typeof operatorRoster;
  operatorShowcase: OperatorShowcase;
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
  THREE,
  loadoutManager,
  operatorRoster,
  operatorShowcase,
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
// Expose the session once it resolves, so tests can inspect the authoritative
// side directly rather than inferring it from what the client happens to render.
void sessionReady.then((s) => {
  const hook = (window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__;
  hook.session = s;
  hook.gameClient = s.client;
  hook.gameServer = s.server;
  hook.isSimulationRunning = () => simulationRunning;
});
// P2P entry points, so the two-browser acceptance suite drives the same code
// paths the menu buttons do rather than a test-only shortcut.
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.hostGame = (
  levelId: string,
  options: { modeId?: string; overrides?: MatchRulesWire; lobbyName?: string; bots?: boolean },
) => startHosting(levelId, options).then(() => beginLoad(levelId));
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.joinGame = joinGame;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.listGames = async () => {
  const res = await fetch(`${resolveLobbyHttpBase()}/games`);
  return (await res.json() as { games: GameListing[] }).games;
};
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.animationEngine = animationEngine;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.cheatsStore = cheatsStore;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.playerHealth = playerHealth;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.quitToMenu = quitToMenu;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.getProfile = getProfile;
(window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__.input = engine.inputManager;
// Document 5 surfaces, for the acceptance harness.
Object.assign((window as unknown as { __OPERATOR__: Record<string, unknown> }).__OPERATOR__, {
  audioManager, hud, ui, matchStats, playerHealth, loadoutManager, skinManager,
  remotePlayers,
  settingsStore, levelLoader, mainMenu, loadingScreen, settingsMenu, loadoutMenu,
  // Document N: the acceptance harness ray-casts the live world to verify
  // terrain relief, door openings and perimeter containment — assertions a
  // screenshot cannot make. RAPIER rides along because constructing a Ray
  // needs the same module instance the world was built with.
  physics, RAPIER, playerCollider, calloutZones: calloutZoneRegistry,
  // Document V: the harness drives the vehicle system headlessly to prove
  // entering, driving and exiting actually work.
  vehicleSystem, teleportPads,
  // Killstreak behaviour harness: reads the shared hittable registry to prove
  // the gunship is destructible by the same path as everything else.
  ballistics,
  // Match/death/respawn harness: the death presentation and the killfeed are
  // pure UI, so the only way to prove they ran is to read them.
  deathCamera, deathOverlay, killfeed, matchBar, gameOverScreen,
  operatorRoster,
  isAwaitingRespawn: () => awaitingRespawn,
  getWorldPassMask: () => (
    cinematicCamera.isActive || cinematicCamera.isDetached
      ? WORLD_PASS_MASK.THIRD
      : perspective.worldPassMask
  ),
});
// ---------------------------------------------------------------------------
// End TEMPORARY block.
// ---------------------------------------------------------------------------
