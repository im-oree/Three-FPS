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

/**
 * Helicopter chase camera.
 *
 * Aircraft need a looser, higher, further-back camera than a car: you fly by
 * reading the horizon line and the aircraft's attitude against it, so the
 * frame has to hold both. `alignRate` is deliberately lower than the car's
 * 2.2 — a helicopter yaws on the spot with the pedals, and a camera that
 * chased that would make every pedal input nauseating. It trails the nose
 * instead of locking to it.
 */
const HELI_CAMERA: VehicleCameraConfig = {
  distance: 11.5,
  height: 4.2,
  lookHeight: 1.8,
  distancePerSpeed: 0.14,
  stiffness: 5.0,
  alignRate: 1.25,
  fov: 75,
  fovBoost: 10,
  freeLook: false,
  pitchMin: -0.7,
  pitchMax: 0.8,
};

/** Crew ride along and can look around freely; they are not flying. */
const HELI_CREW_CAMERA: VehicleCameraConfig = {
  ...HELI_CAMERA,
  distance: 9.0,
  height: 3.4,
  alignRate: 0,
  freeLook: true,
  fovBoost: 4,
};

/**
 * Utility helicopter — a UH-60 class transport.
 *
 * Handling notes, because rotary numbers are unintuitive:
 *
 *   maxThrust is expressed as an acceleration (m/s^2), not a force, so it is
 *   directly comparable to gravity. At 9.81 the aircraft exactly hovers at
 *   full collective and can never climb; at 16.5 it has ~1.68 g available,
 *   giving a healthy climb rate while still demanding real collective
 *   management when manoeuvring hard. Bank 45 degrees and the vertical
 *   component drops by cos(45) = 0.71, so 16.5 * 0.71 = 11.7 — still above
 *   gravity, which means a 45-degree turn holds altitude but a 60-degree one
 *   (16.5 * 0.5 = 8.25) sinks. That is the correct feel.
 *
 *   stability is the self-levelling rate. A real helicopter is neutrally
 *   stable and would need constant correction; at 1.1 this one slowly rolls
 *   level when the stick is released, which is the arcade concession that
 *   makes it flyable on a mouse.
 */
const UTILITY_HELICOPTER: VehicleDefinition = {
  id: 'utility_helicopter',
  displayName: 'UH-60 Utility',
  domain: 'air',
  model: 'vehicles/utility_helicopter.glb',
  // The hull is 13.6 m long but the collider ignores the rotor disc — you
  // cannot land on your own blades, and a disc-sized box would stop the
  // aircraft entering a hangar it visually fits through.
  collisionHalfExtents: [1.5, 1.35, 5.6],
  collisionOffsetY: 1.55,
  maxHealth: 1400,
  seats: [
    {
      id: 'pilot', label: 'PILOT', role: 'driver',
      socket: 'Socket_Seat_Pilot', doorSocket: 'Socket_Door_Pilot',
      canUsePersonalWeapon: false,
    },
    {
      id: 'copilot', label: 'CO-PILOT', role: 'passenger',
      socket: 'Socket_Seat_Copilot', doorSocket: 'Socket_Door_Copilot',
      canUsePersonalWeapon: false, camera: HELI_CREW_CAMERA,
    },
    {
      id: 'door_left', label: 'LEFT GUN', role: 'gunner',
      socket: 'Socket_Seat_CrewLeft', doorSocket: 'Socket_Door_CrewLeft',
      canUsePersonalWeapon: false, weaponStation: 0,
      camera: HELI_CREW_CAMERA,
    },
    {
      id: 'door_right', label: 'RIGHT GUN', role: 'gunner',
      socket: 'Socket_Seat_CrewRight', doorSocket: 'Socket_Door_CrewRight',
      canUsePersonalWeapon: false, weaponStation: 1,
      camera: HELI_CREW_CAMERA,
    },
  ],
  weapons: [
    {
      id: 'door_gun_left', label: 'M240 (PORT)', kind: 'hitscan',
      damage: 55, rpm: 650, splashRadius: 0,
      magazine: 200, reloadSeconds: 5.0,
      muzzleSocket: 'Socket_Muzzle_DoorL',
      yawNode: 'Gun_DoorL', pitchNode: 'Gun_DoorL_Mount',
      // A pintle gun in a doorway cannot swing through the airframe, so its
      // traverse is clamped to the door aperture rather than a full circle.
      pitchMin: -0.85, pitchMax: 0.35, traverseRate: 2.6,
      fireSound: 'weapon_mg_fire', shake: 0.38,
    },
    {
      id: 'door_gun_right', label: 'M240 (STBD)', kind: 'hitscan',
      damage: 55, rpm: 650, splashRadius: 0,
      magazine: 200, reloadSeconds: 5.0,
      muzzleSocket: 'Socket_Muzzle_DoorR',
      yawNode: 'Gun_DoorR', pitchNode: 'Gun_DoorR_Mount',
      pitchMin: -0.85, pitchMax: 0.35, traverseRate: 2.6,
      fireSound: 'weapon_mg_fire', shake: 0.38,
    },
  ],
  camera: HELI_CAMERA,
  air: {
    wing: 'rotary',
    mass: 7700,
    maxThrust: 16.5,        // m/s^2 — see the note above; ~1.68 g
    topSpeed: 78,           // ~280 km/h, the Black Hawk's cruise
    stallSpeed: 0,          // rotary wings do not stall in forward flight
    liftCoefficient: 0,     // unused for rotary; thrust is the lift
    dragCoefficient: 0.00136,   // 8.25 m/s^2 forward balances at 78 m/s
    // Excess thrust at full collective is 16.5 - 9.81 = 6.69 m/s^2, so
    // k = 6.69 / 12^2 gives the Black Hawk's ~12 m/s best climb rate.
    verticalDragCoefficient: 0.046,
    // Nose-down 30 deg gives 16.5*sin(30) = 8.25 m/s^2 of forward
    // acceleration, which the dragCoefficient above balances at 78 m/s.
    maxPitchAngle: 0.52,
    maxBankAngle: 0.70,
    pitchRate: 1.15,
    rollRate: 1.55,
    yawRate: 1.05,
    stability: 1.1,
    controlResponse: 5.0,
    spoolRate: 0.32,        // ~3 s from cold to full rotor
    rotorRPM: 27,
    groundRestHeight: 0.42,
    groundFriction: 2.6,
    serviceCeiling: 190,
  },
  sounds: {
    engineLoop: 'vehicle_engine_diesel',
    engineStart: 'vehicle_start',
    horn: 'vehicle_horn',
    enter: 'vehicle_door',
    exit: 'vehicle_door',
    explode: 'explosion_large',
  },
  enginePitch: { idle: 0.45, redline: 1.25 },
  exhaustSockets: ['Socket_Exhaust_L', 'Socket_Exhaust_R'],
};

export const VEHICLE_DEFINITIONS: ReadonlyArray<VehicleDefinition> = [
  MILITARY_CAR,
  MILITARY_CAR_GUNNER,
  UTILITY_HELICOPTER,
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
