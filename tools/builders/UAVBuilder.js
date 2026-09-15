/**
 * UAVBuilder.js — detailed procedural fixed-wing reconnaissance/strike UAV.
 *
 * Real-world reference: MQ-9 Reaper proportions.
 *   Fuselage length : ~11.0 m
 *   Wingspan        : ~20.0 m  (main wing)
 *   V-tail spread   : ~4.0  m
 *
 * Origin convention (matches COORDINATE_CONVENTIONS.md):
 *   Y = 0  at the ground plane (bottom of landing gear).
 *   -Z     is forward (nose points along -Z).
 *   +X     is right.
 *
 * Node contract (consumed by VehicleAnimator / killstreak controllers):
 *   Root_Vehicle
 *   Bone_PropHub          — spun every frame (pusher prop)
 *   Socket_Pilot          — ground-control POV / camera anchor
 *   Socket_CameraGimbal   — underside FLIR/EO gimbal anchor
 *   Socket_CameraTail     — chase camera boom origin
 *   Socket_Hardpoint_R/L  — wing hardpoints (missiles / bombs)
 *   Socket_Muzzle_R/L     — forward of each hardpoint store
 *   Socket_Exhaust        — engine exhaust (particle anchor)
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const COL = {
  fuselage:  0xa9ab9d, // light grey UAV skin
  darkPanel: 0x76786a, // panel seams, vents
  glass:     0x3a5a62, // sensor dome glass
  metal:     0x585a4e, // control surfaces, hinges
  blade:     0x4c4e42, // prop blades
  exhaust:   0x44443e, // engine exhaust
  hardpoint: 0x4c4e42, // pylon / store
  light:     0xffddaa, // nav light stubs
  sensor:    0x45484a, // sensor dome body
  rubber:    0x3c3c38, // gear tyres
};

function box(size, color, name, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.05, flatShading: true,
    }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(radiusTop, radiusBot, height, segs, color, name,
             pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBot, height, segs),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.8, metalness: 0.15, flatShading: true,
    }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

function socket(name, pos, parent) {
  const s = new THREE.Object3D();
  s.name = name;
  s.position.set(...pos);
  if (parent) parent.add(s);
  return s;
}

// ---------------------------------------------------------------------------
// Sub-builders
// ---------------------------------------------------------------------------

function buildUAVFuselage(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Fuselage';

  grp.add(box([0.90, 0.85, 5.40], COL.fuselage,
    'Fuselage_MidSection', [0, 1.90, 0.30]));

  grp.add(box([0.80, 0.80, 1.20], COL.fuselage,
    'Fuselage_NoseMid', [0, 1.88, -3.20]));
  grp.add(cyl(0.38, 0.40, 0.90, 10, COL.fuselage,
    'Fuselage_NoseCone', [0, 1.88, -3.90], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.30, 0.08, 0.55, 10, COL.fuselage,
    'Fuselage_NoseTip', [0, 1.88, -4.55], [Math.PI / 2, 0, 0]));

  grp.add(box([0.75, 0.45, 2.40], COL.fuselage,
    'Fuselage_DorsalHump', [0, 2.38, 0.60]));
  grp.add(box([0.60, 0.30, 0.80], COL.fuselage,
    'Fuselage_DorsalFair', [0, 2.58, 1.60]));

  grp.add(box([0.65, 0.62, 3.20], COL.fuselage,
    'Fuselage_TailBoom', [0, 1.92, 3.40]));
  grp.add(box([0.44, 0.42, 1.60], COL.fuselage,
    'Fuselage_TailTaper', [0, 1.94, 5.20]));

  grp.add(box([0.92, 0.010, 5.40], COL.darkPanel,
    'Fuselage_TopSeam', [0, 2.33, 0.30]));
  grp.add(box([0.92, 0.010, 5.40], COL.darkPanel,
    'Fuselage_BotSeam', [0, 1.47, 0.30]));
  grp.add(box([0.010, 0.85, 5.40], COL.darkPanel,
    'Fuselage_PortSeam', [-0.46, 1.90, 0.30]));
  grp.add(box([0.010, 0.85, 5.40], COL.darkPanel,
    'Fuselage_StbdSeam', [0.46, 1.90, 0.30]));

  grp.add(box([0.04, 0.22, 0.30], COL.darkPanel,
    'Fuselage_BellyAntenna', [0, 1.52, 0.40]));

  grp.add(cyl(0.22, 0.22, 0.14, 10, COL.fuselage,
    'Fuselage_SatcomDome', [0, 2.76, 0.40]));
  grp.add(cyl(0.20, 0.22, 0.08, 10, COL.glass,
    'Fuselage_SatcomLens', [0, 2.84, 0.40]));

  root.add(grp);
  return grp;
}

function buildUAVCockpit(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Cockpit';

  grp.add(box([0.65, 0.45, 0.08], COL.glass,
    'Cockpit_SensorWinFwd', [0, 2.00, -2.62]));
  grp.add(box([0.55, 0.30, 0.06], COL.glass,
    'Cockpit_SensorWinTop', [0, 2.28, -2.72], [0.30, 0, 0]));

  grp.add(cyl(0.28, 0.30, 0.08, 10, COL.sensor,
    'Cockpit_RadomeFace', [0, 1.88, -4.60], [Math.PI / 2, 0, 0]));

  root.add(grp);
  return grp;
}

function buildUAVMainWing(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_MainWing';

  grp.add(box([2.20, 0.22, 1.80], COL.fuselage,
    'Wing_CentreSection', [0, 1.96, 0.10]));

  grp.add(box([4.80, 0.16, 1.40], COL.fuselage,
    'Wing_MidR', [3.50, 1.94, 0.20]));
  grp.add(box([4.80, 0.16, 1.40], COL.fuselage,
    'Wing_MidL', [-3.50, 1.94, 0.20]));

  grp.add(box([4.40, 0.10, 1.10], COL.fuselage,
    'Wing_OuterR', [8.20, 1.92, 0.30]));
  grp.add(box([4.40, 0.10, 1.10], COL.fuselage,
    'Wing_OuterL', [-8.20, 1.92, 0.30]));

  grp.add(box([0.22, 0.18, 0.55], COL.darkPanel,
    'Wing_TipPodR', [10.52, 1.92, 0.20]));
  grp.add(box([0.22, 0.18, 0.55], COL.darkPanel,
    'Wing_TipPodL', [-10.52, 1.92, 0.20]));

  grp.add(box([3.60, 0.06, 0.35], COL.metal,
    'Wing_AileronR', [8.00, 1.90, 0.70]));
  grp.add(box([3.60, 0.06, 0.35], COL.metal,
    'Wing_AileronL', [-8.00, 1.90, 0.70]));

  grp.add(box([3.80, 0.07, 0.38], COL.metal,
    'Wing_FlapR', [3.40, 1.91, 0.72]));
  grp.add(box([3.80, 0.07, 0.38], COL.metal,
    'Wing_FlapL', [-3.40, 1.91, 0.72]));

  grp.add(box([9.20, 0.10, 0.10], COL.darkPanel,
    'Wing_LEStripR', [5.60, 1.98, -0.40]));
  grp.add(box([9.20, 0.10, 0.10], COL.darkPanel,
    'Wing_LEStripL', [-5.60, 1.98, -0.40]));

  grp.add(box([0.07, 0.07, 0.07], 0x22ff22, 'Light_WingTipR', [10.52, 1.96, 0.20]));
  grp.add(box([0.07, 0.07, 0.07], 0xff2200, 'Light_WingTipL', [-10.52, 1.96, 0.20]));

  root.add(grp);
  return grp;
}

function buildUAVVTail(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_VTail';

  grp.add(box([1.80, 0.10, 1.55], COL.fuselage,
    'VTail_FinR', [1.10, 2.55, 5.80], [0, 0, -0.52]));
  grp.add(box([1.80, 0.10, 1.55], COL.fuselage,
    'VTail_FinL', [-1.10, 2.55, 5.80], [0, 0, 0.52]));

  grp.add(box([1.40, 0.06, 0.42], COL.metal,
    'VTail_RuddervatorR', [1.10, 2.55, 6.56], [0, 0, -0.52]));
  grp.add(box([1.40, 0.06, 0.42], COL.metal,
    'VTail_RuddervatorL', [-1.10, 2.55, 6.56], [0, 0, 0.52]));

  grp.add(box([0.06, 0.06, 0.06], COL.light, 'Light_VTailR', [2.00, 2.90, 5.80]));
  grp.add(box([0.06, 0.06, 0.06], COL.light, 'Light_VTailL', [-2.00, 2.90, 5.80]));

  root.add(grp);
  return grp;
}

/** Pusher propeller at the tail — Bone_PropHub spun by VehicleAnimator. */
function buildUAVProp(root) {
  const hub = new THREE.Group();
  hub.name = 'Bone_PropHub';
  hub.position.set(0, 1.92, 6.10);

  hub.add(cyl(0.12, 0.12, 0.18, 8, COL.metal,
    'Prop_Hub', [0, 0, 0], [Math.PI / 2, 0, 0]));
  hub.add(cyl(0.08, 0.12, 0.10, 8, COL.metal,
    'Prop_HubCap', [0, 0, 0.14], [Math.PI / 2, 0, 0]));

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const blade = new THREE.Group();
    blade.name = `Prop_BladeArm${i}`;
    blade.rotation.z = angle;

    blade.add(box([0.18, 0.06, 0.10], COL.metal,
      `Prop_BladeCuff${i}`, [0, 0.18, 0]));
    blade.add(box([0.14, 1.10, 0.06], COL.blade,
      `Prop_BladeSpan${i}`, [0, 0.90, 0]));
    blade.add(box([0.10, 0.18, 0.04], COL.blade,
      `Prop_BladeTip${i}`, [0, 1.60, 0]));

    hub.add(blade);
  }

  root.add(hub);
  return hub;
}

function buildUAVEngine(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Engine';

  grp.add(box([0.45, 0.20, 0.60], COL.darkPanel,
    'Engine_IntakeScoop', [0, 2.50, -0.14]));
  grp.add(box([0.38, 0.14, 0.06], COL.metal,
    'Engine_IntakeMesh', [0, 2.50, -0.46]));

  grp.add(cyl(0.16, 0.14, 0.12, 8, COL.exhaust,
    'Engine_ExhaustRing', [0, 1.92, 5.80], [Math.PI / 2, 0, 0]));

  root.add(grp);
  return grp;
}

function buildUAVSensorPod(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_SensorPod';

  grp.add(cyl(0.28, 0.28, 0.20, 12, COL.sensor,
    'Sensor_TurretBall', [0, 1.54, -2.80], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.22, 0.22, 0.12, 12, COL.sensor,
    'Sensor_TurretRing', [0, 1.54, -2.96], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.14, 0.14, 0.08, 10, COL.glass,
    'Sensor_TurretLens', [0, 1.54, -3.06], [Math.PI / 2, 0, 0]));

  grp.add(cyl(0.04, 0.04, 0.22, 6, COL.metal,
    'Sensor_LaserStub', [0.10, 1.54, -3.14], [Math.PI / 2, 0, 0]));

  root.add(grp);
  return grp;
}

function buildUAVLandingGear(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_LandingGear';

  grp.add(box([0.06, 0.55, 0.06], COL.metal,
    'Gear_NoseStrut', [0, 1.52, -2.40]));
  grp.add(cyl(0.09, 0.09, 0.10, 8, COL.rubber,
    'Gear_NoseTyre', [0, 1.20, -2.40], [0, 0, Math.PI / 2]));
  grp.add(box([0.22, 0.06, 0.14], COL.metal,
    'Gear_NoseAxle', [0, 1.22, -2.40]));

  grp.add(box([0.07, 0.55, 0.07], COL.metal,
    'Gear_MainStrutR', [0.65, 1.52, 0.50]));
  grp.add(box([0.07, 0.55, 0.07], COL.metal,
    'Gear_MainStrutL', [-0.65, 1.52, 0.50]));
  grp.add(cyl(0.11, 0.11, 0.12, 8, COL.rubber,
    'Gear_MainTyreR', [0.65, 1.18, 0.50], [0, 0, Math.PI / 2]));
  grp.add(cyl(0.11, 0.11, 0.12, 8, COL.rubber,
    'Gear_MainTyreL', [-0.65, 1.18, 0.50], [0, 0, Math.PI / 2]));

  root.add(grp);
  return grp;
}

function buildUAVHardpoints(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Hardpoints';

  grp.add(box([0.14, 0.22, 0.60], COL.hardpoint,
    'Pylon_InnerR', [2.80, 1.76, 0.10]));
  grp.add(box([0.14, 0.22, 0.60], COL.hardpoint,
    'Pylon_InnerL', [-2.80, 1.76, 0.10]));
  grp.add(box([0.14, 0.22, 0.60], COL.hardpoint,
    'Pylon_OuterR', [5.20, 1.76, 0.14]));
  grp.add(box([0.14, 0.22, 0.60], COL.hardpoint,
    'Pylon_OuterL', [-5.20, 1.76, 0.14]));

  root.add(grp);
  return grp;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function buildUAVPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Vehicle';

  buildUAVFuselage(root);
  buildUAVCockpit(root);
  buildUAVMainWing(root);
  buildUAVVTail(root);
  buildUAVEngine(root);
  buildUAVSensorPod(root);
  buildUAVLandingGear(root);
  buildUAVHardpoints(root);

  const propHub = buildUAVProp(root);

  socket('Socket_Pilot',         [0, 2.10, -2.00], root);
  socket('Socket_CameraGimbal',  [0, 1.46, -2.80], root);
  socket('Socket_CameraTail',    [0, 2.20, 6.60],  root);
  socket('Socket_Hardpoint_R',   [5.20, 1.62, 0.14], root);
  socket('Socket_Hardpoint_L',   [-5.20, 1.62, 0.14], root);
  socket('Socket_Muzzle_R',      [2.80, 1.62, -0.24], root);
  socket('Socket_Muzzle_L',      [-2.80, 1.62, -0.24], root);
  socket('Socket_Exhaust',       [0, 1.92, 6.00], root);

  return { root, propHub };
}

export default buildUAVPattern;
