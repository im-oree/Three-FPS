/**
 * VehicleSystem.ts — the single owner of everything character <-> vehicle.
 *
 * This is the layer the user asked for: one script that owns entering,
 * exiting, seat occupancy and camera placement, sitting ABOVE the per-domain
 * handling models and BELOW nothing. Gameplay code talks to this; it never
 * talks to a Vehicle directly.
 *
 * RESPONSIBILITY SPLIT
 *   VehicleSystem     when you may enter, which seat, who is in it, which
 *                     camera is live, what the HUD shows, where input goes
 *   Vehicle           one vehicle's model, seats, weapons, visual state
 *   *HandlingModel    how that vehicle moves (land/air/sea)
 *
 * The player is suspended rather than destroyed while riding: their collider
 * is parked, their controller stops consuming input, and they are restored on
 * exit. Destroying and rebuilding the player would drop weapon state, health
 * and animation, and every one of those would have to be serialised somewhere.
 */
import * as THREE from 'three';
import type { InputManager } from '../core/InputManager';
import inputContexts from '../core/InputContextStack';
import type { AssetLoader } from '../core/AssetLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlayerController } from '../player/PlayerController';
import type { VehicleHUD } from '../ui/VehicleHUD';
import type { VehiclePrompt } from '../ui/VehiclePrompt';
import { Vehicle } from './Vehicle';
import { VehicleCamera } from './VehicleCamera';
import { getVehicleDefinition } from './VehicleDefinitions';
import { emptyInput, type VehicleInput, type VehicleSeat } from './VehicleTypes';

/** How close the player must be to a door socket to be offered a seat. */
const ENTRY_RANGE = 3.2;
/** Where the player is placed when they get out, relative to the door. */
const EXIT_CLEARANCE = 0.9;

const PLAYER = 'player';

/** Collective lever travel per second while a climb/descend key is held. */
const COLLECTIVE_RATE = 0.85;
/**
 * Hands-off collective. Slightly above the 1/maxThrust*g ratio needed for a
 * true hover so an unattended helicopter drifts gently up rather than sinking
 * into the terrain, which reads as "still flying" instead of "crashing".
 */
const HOVER_COLLECTIVE = 0.62;
/** How fast the lever eases back to HOVER_COLLECTIVE when released. */
const COLLECTIVE_SETTLE = 1.8;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface VehicleSystemDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: InputManager;
  physics: PhysicsWorld;
  assetLoader: AssetLoader;
  player: PlayerController;
  hud: VehicleHUD;
  prompt: VehiclePrompt;
  /** Called when the player enters/leaves so other systems can react. */
  onRidingChanged?: (riding: boolean) => void;
}

export class VehicleSystem {
  private readonly deps: VehicleSystemDeps;
  private readonly vehicles: Vehicle[] = [];
  private readonly camera: VehicleCamera;

  /** The vehicle the player is currently in, if any. */
  private riding: Vehicle | null = null;
  private ridingSeat: VehicleSeat | null = null;
  /** Nearest enterable vehicle+seat this frame, for the prompt. */
  private candidate: { vehicle: Vehicle; seat: VehicleSeat } | null = null;

  private readonly input: VehicleInput = emptyInput();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpVec = new THREE.Vector3();

  /** Guards against enter and exit firing on the same keypress. */
  private enterCooldown = 0;
  /** Set when the player asked to get out while still moving too fast. */
  private exitRequested = false;

  /** Pilot collective lever position, persisted between frames. */
  private collective = HOVER_COLLECTIVE;

  constructor(deps: VehicleSystemDeps) {
    this.deps = deps;
    this.camera = new VehicleCamera(deps.camera, deps.physics);
  }

  get isRiding(): boolean { return this.riding !== null; }
  get currentVehicle(): Vehicle | null { return this.riding; }
  get currentSeat(): VehicleSeat | null { return this.ridingSeat; }
  get all(): ReadonlyArray<Vehicle> { return this.vehicles; }

  /**
   * Load a vehicle model and place an instance in the world.
   *
   * The GLB is cloned per instance so several of the same vehicle can exist
   * with independent wheel/turret transforms; AssetLoader caches the parsed
   * source, so the clone is the only per-instance cost.
   */
  async spawn(
    typeId: string,
    position: THREE.Vector3,
    yaw = 0,
    instanceId?: string,
  ): Promise<Vehicle> {
    const def = getVehicleDefinition(typeId);
    const source = await this.deps.assetLoader.loadModel(def.model);
    const model = source.clone(true);

    // Shadows: without these the vehicle has no contact shadow and reads as a
    // flat cutout hovering over the ground, and its own panels get no
    // self-shading so the whole body flattens to one dark tone.
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    const id = instanceId ?? `${typeId}_${this.vehicles.length}`;
    const vehicle = new Vehicle(id, def, model, this.deps.physics);
    vehicle.spawn(position, yaw);

    this.deps.scene.add(vehicle.root);
    this.vehicles.push(vehicle);
    return vehicle;
  }

  despawn(vehicle: Vehicle): void {
    if (this.riding === vehicle) this.exitVehicle(true);
    const i = this.vehicles.indexOf(vehicle);
    if (i >= 0) this.vehicles.splice(i, 1);
    this.deps.scene.remove(vehicle.root);
  }

  /** Engine updatable entry. */
  update(dt: number): void {
    if (this.enterCooldown > 0) this.enterCooldown -= dt;

    this.readInput(dt);

    // Physics for every vehicle, ridden or not, so an unoccupied car still
    // settles on its suspension and does not hover after a level loads.
    for (const v of this.vehicles) v.update(dt);

    if (this.riding) {
      this.updateRiding(dt);
    } else {
      this.updatePrompt();
    }
  }

  // --- Input ---------------------------------------------------------------

  private readInput(dt: number): void {
    const { input } = this.deps;

    if (!this.riding) {
      // Not driving: the only vehicle input that matters is "get in".
      if (input.consumeActionPresses('vehicleEnter') > 0 && this.enterCooldown <= 0) {
        if (this.candidate) {
          this.enterVehicle(this.candidate.vehicle, this.candidate.seat);
        }
      }
      return;
    }

    if (input.consumeActionPresses('vehicleExit') > 0 && this.enterCooldown <= 0) {
      this.exitVehicle(false);
      return;
    }

    const seat = this.ridingSeat;
    const vehicle = this.riding;
    if (!seat || !vehicle) return;

    // A queued exit completes as soon as the vehicle is slow enough, without
    // the player having to press the key a second time.
    if (this.exitRequested) {
      if (Math.abs(vehicle.state.forwardSpeed) <= 6) {
        this.exitVehicle(false);
        return;
      }
      vehicle.setInput({ throttle: 0, steer: 0, brake: 1 });
      return;
    }

    const mouse = input.getMouseDelta();

    if (seat.role === 'driver' && vehicle.definition.domain === 'air') {
      this.readPilotInput(input, vehicle, dt);
    } else if (seat.role === 'driver') {
      // Driving reuses the on-foot movement binds so a player who rebinds
      // "left" gets a steering change too.
      const fwd = (input.isActionDown('moveForward') ? 1 : 0)
        - (input.isActionDown('moveBackward') ? 1 : 0);
      const steer = (input.isActionDown('moveLeft') ? 1 : 0)
        - (input.isActionDown('moveRight') ? 1 : 0);

      // S is brake-then-reverse, not instant reverse: pressing back while
      // rolling forward should stop the car, and only reverse once stopped.
      // Doing it the naive way makes the vehicle lurch backwards at speed.
      const rolling = vehicle.state.forwardSpeed;
      let throttle = fwd;
      let brake = 0;
      if (fwd < 0 && rolling > 0.8) { brake = 1; throttle = 0; }
      else if (fwd > 0 && rolling < -0.8) { brake = 1; throttle = 0; }

      this.input.throttle = throttle;
      this.input.steer = steer;
      this.input.brake = brake;
      this.input.handbrake = input.isActionDown('vehicleHandbrake');
      vehicle.setInput(this.input);

      if (input.consumeActionPresses('vehicleFlip') > 0) this.tryFlip(vehicle);
    } else if (seat.role === 'gunner' && seat.weaponStation !== undefined) {
      // The gunner aims with the mouse; the traverse-rate clamp inside
      // Vehicle.aimTurret is what makes a heavy gun feel heavy.
      vehicle.aimTurret(-mouse.x, -mouse.y, dt);
      this.input.firing = input.isActionDown('fire');
    }

    // Free-look seats pass the raw mouse to the camera instead.
    this.input.aimYaw = mouse.x;
    this.input.aimPitch = mouse.y;
  }

  /**
   * Flight controls for the pilot seat.
   *
   * Two things here are deliberate and easy to get wrong.
   *
   * First, pitch is INVERTED relative to driving: W is "nose down", because a
   * helicopter accelerates forward by tipping its rotor disc forward. Mapping
   * W to "nose up" would make the aircraft brake and climb when the player
   * expects to go faster.
   *
   * Second, collective is a HELD position, not an impulse. Releasing both
   * keys must not drop the collective to zero or the aircraft falls out of
   * the sky every time the player stops pressing; instead it settles toward
   * the hover setting so a hands-off helicopter roughly holds its height.
   */
  private readPilotInput(
    input: InputManager,
    vehicle: Vehicle,
    dt: number,
  ): void {
    const pitch = (input.isActionDown('moveForward') ? 1 : 0)
      - (input.isActionDown('moveBackward') ? 1 : 0);
    const roll = (input.isActionDown('moveLeft') ? 1 : 0)
      - (input.isActionDown('moveRight') ? 1 : 0);
    const yaw = (input.isActionDown('vehicleYawLeft') ? 1 : 0)
      - (input.isActionDown('vehicleYawRight') ? 1 : 0);
    const lift = (input.isActionDown('vehicleCollectiveUp') ? 1 : 0)
      - (input.isActionDown('vehicleCollectiveDown') ? 1 : 0);

    // Track the collective between frames so it behaves like a lever.
    if (lift !== 0) {
      this.collective = clamp(this.collective + lift * COLLECTIVE_RATE * dt, 0, 1);
    } else {
      // Ease back to the hover setting rather than cutting power.
      const toward = HOVER_COLLECTIVE - this.collective;
      this.collective += toward * Math.min(1, COLLECTIVE_SETTLE * dt);
    }

    this.input.pitch = pitch;
    this.input.roll = roll;
    this.input.yaw = yaw;
    this.input.collective = this.collective;
    // Land-only channels stay neutral so a stale value cannot leak across
    // domains if the player swaps from a car into a helicopter.
    this.input.throttle = 0;
    this.input.steer = 0;
    this.input.brake = 0;
    this.input.handbrake = false;
    vehicle.setInput(this.input);
  }

  // --- Enter / exit --------------------------------------------------------

  /** Nearest vehicle+seat the player could enter right now. */
  private findCandidate(): { vehicle: Vehicle; seat: VehicleSeat } | null {
    const from = this.deps.player.getPosition();
    let best: { vehicle: Vehicle; seat: VehicleSeat } | null = null;
    let bestDist = Infinity;

    for (const vehicle of this.vehicles) {
      if (vehicle.isDestroyed) continue;
      // Cheap reject before walking the seat list: a vehicle 40 m away can
      // never offer a seat within 3.2 m of a door.
      const rough = vehicle.getPosition(this.tmpVec).distanceToSquared(from);
      if (rough > 400) continue;

      const seat = vehicle.findEntrySeat(from, ENTRY_RANGE);
      if (!seat) continue;
      if (rough < bestDist) { bestDist = rough; best = { vehicle, seat }; }
    }
    return best;
  }

  private updatePrompt(): void {
    this.candidate = this.findCandidate();
    if (!this.candidate) {
      this.deps.prompt.update(null);
      return;
    }
    const key = this.deps.input.getBindings().vehicleEnter ?? 'E';
    this.deps.prompt.update({
      vehicle: this.candidate.vehicle.definition.displayName,
      seat: this.candidate.seat.label,
      key: keyLabel(key),
    });
  }

  enterVehicle(vehicle: Vehicle, seat: VehicleSeat): boolean {
    if (this.riding) return false;
    if (!vehicle.occupy(seat.id, PLAYER)) return false;

    this.riding = vehicle;
    this.ridingSeat = seat;
    this.enterCooldown = 0.35;
    // Start every flight from the hover setting, never from whatever the
    // previous pilot left the lever on.
    this.collective = HOVER_COLLECTIVE;

    // Park the player: they stop moving, stop colliding and stop drawing.
    this.deps.player.setVehicleSuspended(true);
    // Claim input+camera ownership through the existing seam. Without this
    // PlayerCamera keeps writing the first-person eye pose onto the same
    // THREE camera every frame and stomps the chase boom — the exact failure
    // the missile cinematic hit, and the reason the first driving screenshot
    // showed a rifle and the player falling instead of the car.
    inputContexts.push('vehicle');

    const cfg = seat.camera ?? vehicle.definition.camera;
    this.camera.enter(cfg, vehicle.yaw);

    this.deps.hud.show();
    this.deps.prompt.update(null);
    this.candidate = null;
    this.deps.onRidingChanged?.(true);
    return true;
  }

  exitVehicle(force: boolean): boolean {
    const vehicle = this.riding;
    const seat = this.ridingSeat;
    if (!vehicle || !seat) return false;

    // Refuse to get out at speed unless forced — stepping out of a moving
    // vehicle leaves the player inside the world geometry as often as not.
    //
    // Refusing SILENTLY is its own bug though: the player presses E, nothing
    // happens, and the vehicle looks broken. Brake instead, so holding the
    // key brings the car to a stop and then releases them.
    if (!force && Math.abs(vehicle.state.forwardSpeed) > 6) {
      vehicle.setInput({ throttle: 0, brake: 1 });
      this.exitRequested = true;
      return false;
    }
    this.exitRequested = false;

    const exitPoint = this.computeExitPoint(vehicle, seat);

    vehicle.vacate(PLAYER);
    this.riding = null;
    this.ridingSeat = null;
    this.enterCooldown = 0.35;

    inputContexts.pop('vehicle');
    this.camera.exit();
    this.deps.hud.hide();

    this.deps.player.setVehicleSuspended(false);
    this.deps.player.debugTeleport(exitPoint.x, exitPoint.y, exitPoint.z);
    // Face the player away from the vehicle so they are not staring at a door.
    this.deps.player.debugLook(this.camera.currentYaw, 0);

    this.deps.onRidingChanged?.(false);
    return true;
  }

  /**
   * Where to put the player when they step out.
   *
   * Starts at the door socket, pushed outward from the vehicle's centreline,
   * then validated: if that spot is inside geometry the player is placed on
   * the opposite side instead, and failing that on top of the vehicle. A
   * player dumped inside a wall is a far worse bug than one standing in the
   * wrong place.
   */
  private computeExitPoint(vehicle: Vehicle, seat: VehicleSeat): THREE.Vector3 {
    const doorName = seat.doorSocket ?? seat.socket;
    const door = vehicle.root.getObjectByName(doorName);
    const centre = vehicle.getPosition(this.tmpVec).clone();

    const base = door ? door.getWorldPosition(new THREE.Vector3()) : centre.clone();
    const outward = base.clone().sub(centre);
    outward.y = 0;
    if (outward.lengthSq() < 1e-4) outward.set(1, 0, 0);
    outward.normalize();

    const candidates = [
      base.clone().addScaledVector(outward, EXIT_CLEARANCE),
      base.clone().addScaledVector(outward, -EXIT_CLEARANCE * 2.4),
      centre.clone().add(new THREE.Vector3(0, 2.2, 0)),
    ];

    for (const c of candidates) {
      // Drop onto the ground from just above the candidate, then check the
      // player would actually fit standing there.
      const from = c.clone();
      from.y += 1.5;
      const drop = this.deps.physics.castRayDistance(
        from, new THREE.Vector3(0, -1, 0), 6,
      );
      if (drop === null) continue;
      const ground = from.y - drop;
      const stand = new THREE.Vector3(c.x, ground + 0.05, c.z);

      const headroom = this.deps.physics.castRayDistance(
        stand.clone().setY(ground + 0.3), new THREE.Vector3(0, 1, 0), 1.7,
      );
      if (headroom !== null && headroom < 1.6) continue;
      return stand;
    }

    return centre.clone().add(new THREE.Vector3(0, 2.5, 0));
  }

  /** Right an overturned vehicle in place. */
  private tryFlip(vehicle: Vehicle): void {
    if (!vehicle.land || !vehicle.land.isFlipped) return;
    const pos = vehicle.getPosition(this.tmpVec).clone();
    pos.y += 1.0;
    vehicle.land.reset(pos, vehicle.yaw);
  }

  // --- Riding --------------------------------------------------------------

  private updateRiding(dt: number): void {
    const vehicle = this.riding;
    const seat = this.ridingSeat;
    if (!vehicle || !seat) return;

    // Keep the player's logical position with the vehicle. Other systems
    // (audio listener, minimap, spatial queries) read it and would otherwise
    // still think the player is standing where they got in.
    if (vehicle.getSeatTransform(seat.id, this.tmpPos, this.tmpQuat)) {
      this.deps.player.setVehicleAnchor(this.tmpPos);
    }

    const cfg = seat.camera ?? vehicle.definition.camera;
    const yaw = cfg.freeLook ? this.input.aimYaw * 0.0022 : 0;
    const pitch = cfg.freeLook ? this.input.aimPitch * 0.0022 : 0;
    this.camera.update(dt, vehicle, yaw, pitch);

    this.deps.hud.update(dt, vehicle.definition, vehicle.state);

    // Offer the flip prompt when upside down.
    if (vehicle.land?.isFlipped) {
      const key = this.deps.input.getBindings().vehicleFlip ?? 'R';
      this.deps.prompt.update({
        vehicle: vehicle.definition.displayName,
        seat: 'RECOVER',
        key: keyLabel(key),
      });
    } else {
      this.deps.prompt.update(null);
    }

    if (vehicle.isDestroyed) this.exitVehicle(true);
  }

  dispose(): void {
    if (this.riding) this.exitVehicle(true);
    for (const v of [...this.vehicles]) this.despawn(v);
  }
}

/** 'KeyE' -> 'E', 'Space' -> 'SPACE', 'Mouse0' -> 'LMB'. */
function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  return code.toUpperCase();
}

export default VehicleSystem;
