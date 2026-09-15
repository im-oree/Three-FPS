/**
 * VehicleTypes.ts — the vocabulary every vehicle system shares.
 *
 * A vehicle is DATA (a VehicleDefinition) plus a HANDLING MODEL (one class
 * per domain: land, air, sea). This file holds only the types, so the
 * definitions, the handling models and the runtime can all depend on it
 * without depending on each other.
 *
 * DOMAIN vs TYPE
 *   domain  — how it moves. Chooses the handling model and the HUD layout.
 *   typeId  — which specific vehicle. Chooses the model, the stats and the
 *             per-vehicle script (turret, rotor, etc.).
 * A hybrid (a hovercraft, an amphibious APC) declares `domain: 'hybrid'` and
 * lists the domains it can transition between.
 */
import type * as THREE from 'three';

export type VehicleDomain = 'land' | 'air' | 'sea' | 'hybrid';

/** Which handling model drives this vehicle right now (hybrids switch). */
export type ActiveMedium = 'ground' | 'air' | 'water';

/**
 * A seat in a vehicle.
 *
 * Every seat is addressable and enterable; `role` decides what the occupant
 * can DO, which is what separates a driver from a gunner from a passenger.
 */
export interface VehicleSeat {
  readonly id: string;
  /** Human-readable, shown in the enter prompt: "ENTER AS GUNNER". */
  readonly label: string;
  readonly role: 'driver' | 'gunner' | 'passenger';
  /** Node name in the .glb the occupant is parented to. */
  readonly socket: string;
  /** Node name the player must be NEAR to be offered this seat. */
  readonly doorSocket?: string;
  /** Occupants of this seat can fire their personal weapon. */
  readonly canUsePersonalWeapon: boolean;
  /** Occupants control this weapon station (index into definition.weapons). */
  readonly weaponStation?: number;
  /** Camera boom used while in this seat; falls back to the vehicle's. */
  readonly camera?: VehicleCameraConfig;
}

/**
 * Third-person chase camera parameters.
 *
 * Deliberately NOT a socket in the model: a camera welded to the vehicle
 * whips violently on every yaw change. These describe a spring-damped boom
 * that lags behind the vehicle, which is what every driving game actually
 * ships and what the user asked for ("like GTA").
 */
export interface VehicleCameraConfig {
  /** Metres behind the vehicle origin. */
  readonly distance: number;
  /** Metres above the vehicle origin. */
  readonly height: number;
  /** Look-at point offset above the origin. */
  readonly lookHeight: number;
  /** Extra distance per m/s of speed, so fast vehicles frame wider. */
  readonly distancePerSpeed: number;
  /** Boom stiffness; higher snaps tighter to the vehicle. */
  readonly stiffness: number;
  /** How quickly the boom yaws to align behind the vehicle (0 = free look). */
  readonly alignRate: number;
  /** Field of view at rest, and the extra FOV at top speed. */
  readonly fov: number;
  readonly fovBoost: number;
  /** Allow the player to orbit with the mouse (true for gunners/passengers). */
  readonly freeLook: boolean;
  /** Vertical look limits in radians when freeLook is on. */
  readonly pitchMin: number;
  readonly pitchMax: number;
}

/** A weapon station mounted on a vehicle. */
export interface VehicleWeapon {
  readonly id: string;
  readonly label: string;
  /** 'hitscan' for MGs and cannons, 'projectile' for rockets/bombs. */
  readonly kind: 'hitscan' | 'projectile';
  readonly damage: number;
  /** Rounds per minute. */
  readonly rpm: number;
  /** Muzzle speed, projectile only. */
  readonly muzzleSpeed?: number;
  /** Splash radius in metres; 0 for pure impact damage. */
  readonly splashRadius: number;
  readonly magazine: number;
  readonly reloadSeconds: number;
  /** Node name of the muzzle in the .glb. */
  readonly muzzleSocket: string;
  /** Node rotated in yaw by aim, if any. */
  readonly yawNode?: string;
  /** Node rotated in pitch by aim, if any. */
  readonly pitchNode?: string;
  readonly pitchMin: number;
  readonly pitchMax: number;
  /** Radians/second the turret can traverse — heavy guns feel heavy. */
  readonly traverseRate: number;
  readonly fireSound: string;
  /** Camera shake magnitude when this fires. */
  readonly shake: number;
}

/** Suspension + engine parameters for the raycast land model. */
export interface LandHandling {
  readonly mass: number;
  /** Peak engine force in newtons, before the torque curve. */
  readonly enginePower: number;
  readonly brakePower: number;
  /** Top speed in m/s. */
  readonly topSpeed: number;
  readonly reverseTopSpeed: number;
  /** Max steering angle at rest (radians) and at top speed. */
  readonly steerAngleLow: number;
  readonly steerAngleHigh: number;
  /** Steering lerp rate, radians/second. */
  readonly steerRate: number;
  /** Suspension rest length, travel, stiffness and damping. */
  readonly suspensionRest: number;
  readonly suspensionTravel: number;
  readonly suspensionStiffness: number;
  readonly suspensionDamping: number;
  /** Sideways grip coefficient; lower slides more. */
  readonly lateralGrip: number;
  /** Grip while handbraking, as a fraction of lateralGrip. */
  readonly handbrakeGripScale: number;
  readonly wheelRadius: number;
  /** Local-space wheel anchors, in model order FL, FR, RL, RR. */
  readonly wheelAnchors: ReadonlyArray<readonly [number, number, number]>;
  /** Which of those wheels steer. */
  readonly steeredWheels: ReadonlyArray<number>;
  /** Which of those wheels are driven. */
  readonly drivenWheels: ReadonlyArray<number>;
  /** Downforce coefficient; keeps fast vehicles planted. */
  readonly downforce: number;
  /** Aerodynamic drag coefficient. */
  readonly drag: number;
  /** Rolling resistance. */
  readonly rollingResistance: number;
}

/** Fixed-wing / rotary flight parameters. */
export interface AirHandling {
  readonly mass: number;
  /** 'rotary' hovers and has no stall; 'fixed' needs airspeed for lift. */
  readonly wing: 'rotary' | 'fixed';
  readonly maxThrust: number;
  readonly topSpeed: number;
  /** Airspeed below which a fixed wing stalls. */
  readonly stallSpeed: number;
  /** Lift per (m/s)^2 of airspeed. */
  readonly liftCoefficient: number;
  /**
   * Quadratic drag, as a pure 1/m coefficient in `a = -k * v * |v|` (an
   * ACCELERATION, like maxThrust — not a force). This is what sets top speed:
   * at equilibrium `k * topSpeed^2` equals the forward acceleration the craft
   * can generate, so `k ~= availableAccel / topSpeed^2`.
   */
  readonly dragCoefficient: number;
  /**
   * Quadratic drag on the vertical axis only, same units as
   * `dragCoefficient`. Much larger for rotary craft, which climb into their
   * own downwash. Sets the climb rate: `sqrt(excessThrust / k)`.
   */
  readonly verticalDragCoefficient?: number;
  /**
   * Rotary only. Maximum nose-down/up angle the cyclic will command, radians.
   * This caps forward acceleration, so it also caps achievable top speed:
   * `a_fwd = maxThrust * sin(maxPitchAngle)`.
   */
  readonly maxPitchAngle?: number;
  /** Rotary only. Maximum commanded bank angle, radians. */
  readonly maxBankAngle?: number;
  /** Control authority in radians/second at full deflection. */
  readonly pitchRate: number;
  readonly rollRate: number;
  readonly yawRate: number;
  /** How strongly the airframe self-levels; 0 for a jet, high for a heli. */
  readonly stability: number;
  /**
   * How fast the stick's commanded rate is reached, per second. Low values
   * feel heavy and cargo-like; high values feel twitchy and aerobatic.
   */
  readonly controlResponse?: number;
  /**
   * Engine/rotor spool rate, fraction of full power per second. 0.35 means
   * roughly three seconds from cold to full thrust — enough that a helicopter
   * has to wind up before it will leave the pad.
   */
  readonly spoolRate?: number;
  /** Visual rotor speed in radians/second at full spool. */
  readonly rotorRPM?: number;
  /** Height of the origin above the ground when resting on the gear. */
  readonly groundRestHeight?: number;
  /** Ground friction while the gear carries weight. */
  readonly groundFriction?: number;
  /** Altitude above which thrust bleeds off, giving a soft ceiling. */
  readonly serviceCeiling?: number;
  /** Rotary only: vertical thrust range. */
  readonly collectiveMin?: number;
  readonly collectiveMax?: number;
  readonly rotorNodes?: ReadonlyArray<{ node: string; axis: 'x' | 'y' | 'z'; rpm: number }>;
}

/** Buoyancy + hull parameters for boats. */
export interface SeaHandling {
  readonly mass: number;
  readonly enginePower: number;
  readonly topSpeed: number;
  readonly reverseTopSpeed: number;
  readonly turnRate: number;
  /** Water plane the hull floats on (world Y). */
  readonly waterLevel: number;
  /** Sample points on the hull used for buoyancy, local space. */
  readonly buoyancyPoints: ReadonlyArray<readonly [number, number, number]>;
  /** Upward force per metre of submersion, per point. */
  readonly buoyancyStrength: number;
  readonly waterDrag: number;
  readonly angularDrag: number;
}

/** Everything the runtime needs to instantiate and drive one vehicle. */
export interface VehicleDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly domain: VehicleDomain;
  /** Path under assets/models/, e.g. 'vehicles/military_car.glb'. */
  readonly model: string;
  /** Collision half-extents used for the chassis body. */
  readonly collisionHalfExtents: readonly [number, number, number];
  /** Vertical offset of the collision box from the model origin. */
  readonly collisionOffsetY: number;
  readonly seats: ReadonlyArray<VehicleSeat>;
  readonly weapons: ReadonlyArray<VehicleWeapon>;
  readonly camera: VehicleCameraConfig;
  readonly land?: LandHandling;
  readonly air?: AirHandling;
  readonly sea?: SeaHandling;
  /** Hybrids list the mediums they can operate in. */
  readonly mediums?: ReadonlyArray<ActiveMedium>;
  readonly maxHealth: number;
  /** Sound keys. */
  readonly sounds: {
    readonly engineLoop: string;
    readonly engineStart?: string;
    readonly horn?: string;
    readonly enter?: string;
    readonly exit?: string;
    readonly explode?: string;
  };
  /** Engine pitch at idle and at redline, multiplying the loop's rate. */
  readonly enginePitch: { readonly idle: number; readonly redline: number };
  /** Exhaust/dust emitter sockets. */
  readonly exhaustSockets?: ReadonlyArray<string>;
}

/** Live state shared by every handling model, read by HUD and camera. */
export interface VehicleState {
  /** Metres/second along the vehicle's forward axis (signed). */
  forwardSpeed: number;
  /** Full velocity vector, world space. */
  velocity: THREE.Vector3;
  /** 0..1 normalised engine load, drives audio pitch. */
  throttleLoad: number;
  /** Current steering angle in radians (land). */
  steerAngle: number;
  /** True while any wheel/hull is in contact. */
  grounded: boolean;
  /** Altitude above the ground directly below (air). */
  altitude: number;
  /** Which medium the handling model is currently using. */
  medium: ActiveMedium;
  health: number;
}

/** Per-frame control input, produced by the player or an AI. */
export interface VehicleInput {
  /** -1..1; forward positive. */
  throttle: number;
  /** -1..1; left positive (matches three.js yaw). */
  steer: number;
  /** 0..1 */
  brake: number;
  handbrake: boolean;
  /** Air: -1..1 stick inputs. */
  pitch: number;
  roll: number;
  yaw: number;
  /** Air: 0..1 vertical thrust for rotary craft. */
  collective: number;
  /** Fire the seat's weapon station. */
  firing: boolean;
  /** Mouse delta for turret/free-look aiming, radians. */
  aimYaw: number;
  aimPitch: number;
}

export function emptyInput(): VehicleInput {
  return {
    throttle: 0, steer: 0, brake: 0, handbrake: false,
    pitch: 0, roll: 0, yaw: 0, collective: 0,
    firing: false, aimYaw: 0, aimPitch: 0,
  };
}
