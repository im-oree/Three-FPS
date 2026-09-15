/**
 * VehicleDefinitions.ts — the stat block for every drivable vehicle.
 *
 * Socket names here MUST match the node contracts asserted by
 * tools/generateVehicleFleet.js. That generator fails the build if a node is
 * missing, which is what stops a renamed socket becoming a silent runtime
 * null.
 */
import type { VehicleCameraConfig, VehicleDefinition } from './VehicleTypes';

/**
 * Chase camera for a ground vehicle.
 *
 * `alignRate` is the important number. At 0 the camera never follows the
 * vehicle's heading and you drive sideways; at a high value it snaps to the
 * tail and every flick of the wheel throws the view around. ~2.2 lets the
 * car rotate visibly under the camera during a turn and settle behind it
 * afterwards.
 */
const CAR_CAMERA: VehicleCameraConfig = {
  distance: 6.4,
  height: 2.5,
  lookHeight: 1.1,
  distancePerSpeed: 0.10,
  stiffness: 7.5,
  alignRate: 2.2,
  fov: 75,
  fovBoost: 12,
  freeLook: false,
  pitchMin: -0.5,
  pitchMax: 0.7,
};

/** Passengers and gunners get a free orbit — they are not driving. */
const CAR_PASSENGER_CAMERA: VehicleCameraConfig = {
  ...CAR_CAMERA,
  distance: 5.6,
  height: 2.3,
  alignRate: 0,
  freeLook: true,
  fovBoost: 6,
};

/**
 * Suspension tuning notes, because these numbers look arbitrary:
 *
 *   suspensionStiffness is force per metre of compression, expressed as a
 *   multiple of the vehicle's weight so it stays sane if mass changes. At
 *   rest each wheel carries mass*g/4 = 2400*9.81/4 = 5886 N. With a rest
 *   length of 0.42 m we want roughly a third of the travel used statically,
 *   so k ≈ 5886 / 0.14 ≈ 42000 N/m. Rounded to 44000.
 *
 *   Damping is set near critical for a comfortable truck:
 *   c_crit = 2*sqrt(k*m_corner) = 2*sqrt(44000*600) ≈ 10280. Real vehicles
 *   run 0.25-0.4 of critical, so ~3400.
 */
const MILITARY_CAR: VehicleDefinition = {
  id: 'military_car',
  displayName: 'LTV Humvee',
  domain: 'land',
  model: 'vehicles/military_car.glb',
  collisionHalfExtents: [1.08, 0.62, 2.28],
  collisionOffsetY: 1.00,
  maxHealth: 1000,
  seats: [
    {
      id: 'driver', label: 'DRIVER', role: 'driver',
      socket: 'Socket_Seat_Driver', doorSocket: 'Socket_Door_Driver',
      canUsePersonalWeapon: false,
    },
    {
      id: 'passenger', label: 'PASSENGER', role: 'passenger',
      socket: 'Socket_Seat_Passenger', doorSocket: 'Socket_Door_Passenger',
      canUsePersonalWeapon: true, camera: CAR_PASSENGER_CAMERA,
    },
    {
      id: 'rear_left', label: 'REAR LEFT', role: 'passenger',
      socket: 'Socket_Seat_RearLeft', doorSocket: 'Socket_Door_RearLeft',
      canUsePersonalWeapon: true, camera: CAR_PASSENGER_CAMERA,
    },
    {
      id: 'rear_right', label: 'REAR RIGHT', role: 'passenger',
      socket: 'Socket_Seat_RearRight', doorSocket: 'Socket_Door_RearRight',
      canUsePersonalWeapon: true, camera: CAR_PASSENGER_CAMERA,
    },
  ],
  weapons: [],
  camera: CAR_CAMERA,
  land: {
    mass: 2400,
    enginePower: 19000,
    brakePower: 26000,
    topSpeed: 31,          // ~112 km/h, the real M998's governed top speed
    reverseTopSpeed: 9,
    steerAngleLow: 0.58,
    steerAngleHigh: 0.14,  // steering tightens down at speed or it spins
    steerRate: 3.4,
    suspensionRest: 0.42,
    suspensionTravel: 0.26,
    suspensionStiffness: 44000,
    suspensionDamping: 3400,
    lateralGrip: 5.2,
    handbrakeGripScale: 0.22,
    wheelRadius: 0.44,
    // FL, FR, RL, RR — half of wheelbase 3.30 and track 1.83.
    wheelAnchors: [
      [-0.915, 0.44, -1.65],
      [0.915, 0.44, -1.65],
      [-0.915, 0.44, 1.65],
      [0.915, 0.44, 1.65],
    ],
    steeredWheels: [0, 1],
    drivenWheels: [0, 1, 2, 3],   // the Humvee is full-time 4WD
    downforce: 2.0,
    drag: 0.42,
    rollingResistance: 10.5,
  },
  sounds: {
    engineLoop: 'vehicle_engine_diesel',
    engineStart: 'vehicle_start',
    horn: 'vehicle_horn',
    enter: 'vehicle_door',
    exit: 'vehicle_door',
    explode: 'explosion_large',
  },
  enginePitch: { idle: 0.62, redline: 1.85 },
  exhaustSockets: ['Socket_Exhaust'],
};

/**
 * Gunner variant: same chassis, plus a roof station.
 *
 * Built by spreading MILITARY_CAR so the two can never drift apart in
 * handling — only the model, the extra seat and the weapon differ.
 */
const MILITARY_CAR_GUNNER: VehicleDefinition = {
  ...MILITARY_CAR,
  id: 'military_car_gunner',
  displayName: 'LTV Humvee (M2)',
  model: 'vehicles/military_car_gunner.glb',
  seats: [
    ...MILITARY_CAR.seats,
    {
      id: 'gunner', label: 'GUNNER', role: 'gunner',
      socket: 'Socket_Seat_Gunner',
      canUsePersonalWeapon: false,
      weaponStation: 0,
      camera: {
        ...CAR_PASSENGER_CAMERA,
        distance: 4.8,
        height: 2.9,
        lookHeight: 1.9,
        pitchMin: -0.35,
        pitchMax: 0.62,
      },
    },
  ],
  weapons: [
    {
      id: 'm2', label: 'M2 .50 CAL', kind: 'hitscan',
      damage: 95, rpm: 520, splashRadius: 0,
      magazine: 100, reloadSeconds: 4.2,
      muzzleSocket: 'Socket_Muzzle_Turret',
      yawNode: 'Turret_Yaw', pitchNode: 'Turret_Pitch',
      pitchMin: -0.28, pitchMax: 0.70,
      traverseRate: 2.1,
      fireSound: 'turret_fire',
      shake: 0.55,
    },
  ],
};

export const VEHICLE_DEFINITIONS: ReadonlyArray<VehicleDefinition> = [
  MILITARY_CAR,
  MILITARY_CAR_GUNNER,
];

const BY_ID = new Map(VEHICLE_DEFINITIONS.map((d) => [d.id, d]));

export function getVehicleDefinition(id: string): VehicleDefinition {
  const def = BY_ID.get(id);
  if (!def) {
    throw new Error(
      `Unknown vehicle '${id}'. Known: ${[...BY_ID.keys()].join(', ')}`,
    );
  }
  return def;
}

export function hasVehicleDefinition(id: string): boolean {
  return BY_ID.has(id);
}
