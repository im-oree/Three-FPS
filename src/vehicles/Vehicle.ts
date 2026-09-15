/**
 * Vehicle.ts — one live vehicle in the world.
 *
 * Owns the visual model, the seats, the weapons and whichever handling model
 * its domain calls for. Deliberately knows NOTHING about the player: the
 * player is represented only as an occupant id in a seat. That separation is
 * what lets the same class serve a player-driven car, an AI convoy truck and
 * a parked prop with no branching.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { LandHandlingModel } from './handling/LandHandlingModel';
import {
  emptyInput,
  type VehicleDefinition,
  type VehicleInput,
  type VehicleSeat,
  type VehicleState,
} from './VehicleTypes';

/** Runtime handle for one occupied seat. */
export interface SeatOccupancy {
  readonly seat: VehicleSeat;
  /** 'player' or an AI id. */
  occupant: string | null;
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

export class Vehicle {
  readonly id: string;
  readonly definition: VehicleDefinition;
  /** The scene node. Position/rotation are written by the handling model. */
  readonly root: THREE.Group;
  readonly state: VehicleState;
  readonly seats: SeatOccupancy[];

  /** Land vehicles only; null for air/sea until those models land. */
  readonly land: LandHandlingModel | null = null;

  private readonly input: VehicleInput = emptyInput();
  /** Wheel groups in model order FL, FR, RL, RR. */
  private readonly wheelNodes: (THREE.Object3D | null)[] = [];
  private readonly seatNodes = new Map<string, THREE.Object3D>();
  private steeringNode: THREE.Object3D | null = null;
  private turretYaw: THREE.Object3D | null = null;
  private turretPitch: THREE.Object3D | null = null;
  private exhaustNodes: THREE.Object3D[] = [];
  /** Turret aim, radians, relative to the chassis. */
  private turretYawAngle = 0;
  private turretPitchAngle = 0;

  constructor(
    id: string,
    definition: VehicleDefinition,
    model: THREE.Group,
    physics: PhysicsWorld,
  ) {
    this.id = id;
    this.definition = definition;
    this.root = model;
    this.root.name = `Vehicle_${id}`;

    this.state = {
      forwardSpeed: 0,
      velocity: new THREE.Vector3(),
      throttleLoad: 0,
      steerAngle: 0,
      grounded: false,
      altitude: 0,
      medium: definition.domain === 'air' ? 'air' : 'ground',
      health: definition.maxHealth,
    };

    this.seats = definition.seats.map((seat) => ({ seat, occupant: null }));

    this.bindNodes();

    if (definition.land) {
      this.land = new LandHandlingModel(definition.land, physics);
    }
  }

  /**
   * Resolve every node the runtime drives, once, at construction.
   *
   * getObjectByName walks the whole subtree on every call, so doing this per
   * frame for four wheels plus sockets would be a measurable cost for zero
   * benefit — the model's hierarchy never changes after load.
   */
  private bindNodes(): void {
    const find = (name: string) => this.root.getObjectByName(name) ?? null;

    for (const suffix of ['FL', 'FR', 'RL', 'RR']) {
      this.wheelNodes.push(find(`Wheel_${suffix}`));
    }
    this.steeringNode = find('Bone_SteeringWheel');
    this.turretYaw = find('Turret_Yaw');
    this.turretPitch = find('Turret_Pitch');

    for (const { seat } of this.seats) {
      const node = find(seat.socket);
      if (node) this.seatNodes.set(seat.id, node);
    }

    this.exhaustNodes = (this.definition.exhaustSockets ?? [])
      .map(find)
      .filter((n): n is THREE.Object3D => n !== null);
  }

  // --- Placement -----------------------------------------------------------

  spawn(position: THREE.Vector3, yaw: number): void {
    if (this.land) {
      this.land.reset(position, yaw);
      this.root.position.copy(this.land.position);
      this.root.quaternion.copy(this.land.quaternion);
    } else {
      this.root.position.copy(position);
      this.root.rotation.set(0, yaw, 0);
    }
  }

  getPosition(target = tmpV): THREE.Vector3 { return target.copy(this.root.position); }
  getQuaternion(target = tmpQ): THREE.Quaternion { return target.copy(this.root.quaternion); }

  /** Forward axis in world space (the model faces -Z). */
  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  get yaw(): number {
    const f = this.getForward();
    return Math.atan2(-f.x, -f.z);
  }

  // --- Seats ---------------------------------------------------------------

  get isEmpty(): boolean { return this.seats.every((s) => s.occupant === null); }

  get driver(): string | null {
    return this.seats.find((s) => s.seat.role === 'driver')?.occupant ?? null;
  }

  seatOf(occupant: string): SeatOccupancy | null {
    return this.seats.find((s) => s.occupant === occupant) ?? null;
  }

  isSeatFree(seatId: string): boolean {
    const s = this.seats.find((x) => x.seat.id === seatId);
    return s ? s.occupant === null : false;
  }

  occupy(seatId: string, occupant: string): boolean {
    const s = this.seats.find((x) => x.seat.id === seatId);
    if (!s || s.occupant !== null) return false;
    s.occupant = occupant;
    return true;
  }

  vacate(occupant: string): VehicleSeat | null {
    const s = this.seats.find((x) => x.occupant === occupant);
    if (!s) return null;
    s.occupant = null;
    if (s.seat.role === 'driver') {
      // Releasing the controls must not leave the throttle pinned.
      this.input.throttle = 0;
      this.input.steer = 0;
      this.input.brake = 1;
    }
    return s.seat;
  }

  /** World transform of a seat socket, for parenting the rider. */
  getSeatTransform(seatId: string, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    const node = this.seatNodes.get(seatId);
    if (!node) return false;
    node.getWorldPosition(pos);
    node.getWorldQuaternion(quat);
    return true;
  }

  /**
   * The closest seat the player may enter from a world position.
   *
   * Uses the DOOR sockets rather than the seat sockets: you walk up to the
   * outside of a door, not to the middle of the cabin, and ranking by seat
   * position makes the far-side seats win from the wrong side of the car.
   */
  findEntrySeat(from: THREE.Vector3, maxDistance: number): VehicleSeat | null {
    let best: VehicleSeat | null = null;
    let bestDist = maxDistance * maxDistance;

    for (const { seat, occupant } of this.seats) {
      if (occupant !== null) continue;
      const nodeName = seat.doorSocket ?? seat.socket;
      const node = this.root.getObjectByName(nodeName);
      if (!node) continue;
      const d = node.getWorldPosition(tmpV).distanceToSquared(from);
      if (d < bestDist) { bestDist = d; best = seat; }
    }
    return best;
  }

  // --- Control -------------------------------------------------------------

  /** Feed control input for this frame. Only the driver's input steers. */
  setInput(next: Partial<VehicleInput>): void {
    Object.assign(this.input, next);
  }

  clearInput(): void {
    Object.assign(this.input, emptyInput());
  }

  get currentInput(): Readonly<VehicleInput> { return this.input; }

  /** Aim the turret. Rates are limited so heavy guns feel heavy. */
  aimTurret(deltaYaw: number, deltaPitch: number, dt: number): void {
    const weapon = this.definition.weapons[0];
    if (!weapon) return;
    const maxStep = weapon.traverseRate * dt;
    this.turretYawAngle += THREE.MathUtils.clamp(deltaYaw, -maxStep, maxStep);
    this.turretPitchAngle = THREE.MathUtils.clamp(
      this.turretPitchAngle + THREE.MathUtils.clamp(deltaPitch, -maxStep, maxStep),
      weapon.pitchMin, weapon.pitchMax,
    );
  }

  get turretAim(): { yaw: number; pitch: number } {
    return { yaw: this.turretYawAngle, pitch: this.turretPitchAngle };
  }

  // --- Frame ---------------------------------------------------------------

  update(dt: number): void {
    if (this.land) {
      this.land.step(dt, this.input, this.state);
      this.root.position.copy(this.land.position);
      this.root.quaternion.copy(this.land.quaternion);
      this.applyWheelVisuals();
    }
    this.applyTurretVisuals();
  }

  /**
   * Push suspension compression and wheel spin into the scene graph.
   *
   * Each wheel group's local Y is the suspension travel, so the wheel visibly
   * moves in its arch. Steering is applied as Y rotation and rolling as X,
   * in that order — reversing them makes a steered wheel roll about the
   * wrong axis and wobble.
   */
  private applyWheelVisuals(): void {
    if (!this.land || !this.definition.land) return;
    const cfg = this.definition.land;

    for (let i = 0; i < this.wheelNodes.length; i += 1) {
      const node = this.wheelNodes[i];
      const w = this.land.wheels[i];
      if (!node || !w) continue;

      const anchor = cfg.wheelAnchors[i];
      node.position.set(
        anchor[0],
        anchor[1] - (cfg.suspensionRest - w.length),
        anchor[2],
      );
      node.quaternion.setFromEuler(new THREE.Euler(w.spin, w.steer, 0, 'YXZ'));
    }

    if (this.steeringNode) {
      // Exaggerate the wheel relative to the road wheels; a real rack is
      // several turns lock to lock and matching it 1:1 looks broken.
      this.steeringNode.rotation.z = -this.state.steerAngle * 3.2;
    }
  }

  private applyTurretVisuals(): void {
    if (this.turretYaw) this.turretYaw.rotation.y = this.turretYawAngle;
    if (this.turretPitch) this.turretPitch.rotation.x = -this.turretPitchAngle;
  }

  /** World transform of each exhaust socket, for the particle system. */
  getExhaustPoints(out: THREE.Vector3[]): number {
    let n = 0;
    for (const node of this.exhaustNodes) {
      if (n >= out.length) out.push(new THREE.Vector3());
      node.getWorldPosition(out[n]);
      n += 1;
    }
    return n;
  }

  /** Muzzle transform of the active weapon station. */
  getMuzzle(pos: THREE.Vector3, dir: THREE.Vector3): boolean {
    const weapon = this.definition.weapons[0];
    if (!weapon) return false;
    const node = this.root.getObjectByName(weapon.muzzleSocket);
    if (!node) return false;
    node.getWorldPosition(pos);
    dir.set(0, 0, -1).applyQuaternion(node.getWorldQuaternion(tmpQ)).normalize();
    return true;
  }

  applyDamage(amount: number): void {
    this.state.health = Math.max(0, this.state.health - amount);
  }

  get isDestroyed(): boolean { return this.state.health <= 0; }
}

export default Vehicle;
