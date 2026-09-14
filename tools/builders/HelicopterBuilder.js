/**
 * HelicopterBuilder.js — detailed procedural military utility helicopter.
 *
 * Real-world reference: UH-60 Black Hawk proportions.
 *   Fuselage length : ~15.3 m  (nose to tail boom end)
 *   Cabin width     : ~2.6  m
 *   Overall height  : ~3.8  m  (skid ground to rotor hub)
 *   Main rotor dia  : ~16.4 m  (radius ~8.2 m modelled as 4 blades)
 *   Tail rotor dia  : ~3.4  m  (radius ~1.7 m, 4 blades)
 *
 * Origin convention (matches COORDINATE_CONVENTIONS.md):
 *   Y = 0  at the ground plane (bottom of skids).
 *   -Z     is forward (nose points along -Z).
 *   +X     is right.
 *
 * Node contract (consumed by VehicleAnimator / killstreak controllers):
 *   Root_Vehicle
 *   Bone_MainRotorHub   — spun every frame
 *   Bone_TailRotorHub   — spun every frame
 *   Socket_Pilot        — pilot seat camera / IK anchor
 *   Socket_Copilot      — co-pilot seat
 *   Socket_CameraLeft   — external left-door camera
 *   Socket_CameraRight  — external right-door camera
 *   Socket_CameraTail   — chase camera boom origin
 *   Socket_Muzzle_L/R   — stub wing hardpoint muzzles
 *   Socket_Hardpoint_L/R— missile / rocket pod attachment
 *   Socket_Skid_L/R     — ground contact / landing-gear IK
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const COL = {
  fuselage:   0x6f7459, // olive drab
  darkPanel:  0x53573f, // panel seams / vents
  glass:      0x3a5a62, // cockpit glazing
  metal:      0x4a4d42, // rotor hub, skids, hinges
  blade:      0x4d5040, // rotor blades
  exhaust:    0x45453f, // engine exhaust stacks
  interior:   0x4a4c3e, // visible cabin interior faces
  light:      0xffddaa, // nav / position light stubs
  rubber:     0x3c3c38, // tyre / skid pad
};

// ---------------------------------------------------------------------------
// Local primitive helpers
// ---------------------------------------------------------------------------
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

/** Main fuselage cabin box + nose + tail taper shells. */
function buildFuselage(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Fuselage';

  grp.add(box([2.60, 1.80, 7.20], COL.fuselage,
    'Fuselage_CabinCore', [0, 2.20, -0.50]));

  grp.add(box([2.00, 1.40, 2.20], COL.fuselage,
    'Fuselage_NoseMid', [0, 2.10, -4.50]));
  grp.add(box([1.20, 1.00, 1.40], COL.fuselage,
    'Fuselage_NoseTip', [0, 1.95, -5.70]));
  grp.add(box([0.50, 0.60, 0.60], COL.fuselage,
    'Fuselage_NoseCone', [0, 1.88, -6.40]));

  grp.add(box([1.40, 0.50, 1.20], COL.fuselage,
    'Fuselage_ChinBulge', [0, 1.45, -5.20]));

  grp.add(box([2.20, 1.60, 1.60], COL.fuselage,
    'Fuselage_RearTransition', [0, 2.20, 3.30]));

  grp.add(box([0.72, 0.72, 6.40], COL.fuselage,
    'Fuselage_TailBoom', [0, 2.50, 7.10]));
  grp.add(box([0.55, 0.55, 1.20], COL.fuselage,
    'Fuselage_TailTaper', [0, 2.60, 10.30]));

  grp.add(box([2.60, 0.18, 1.10], COL.fuselage,
    'Fuselage_HStabR', [1.55, 2.62, 9.60]));
  grp.add(box([2.60, 0.18, 1.10], COL.fuselage,
    'Fuselage_HStabL', [-1.55, 2.62, 9.60]));
  grp.add(box([0.12, 0.55, 1.00], COL.fuselage,
    'Fuselage_HStabEndR', [2.86, 2.80, 9.60]));
  grp.add(box([0.12, 0.55, 1.00], COL.fuselage,
    'Fuselage_HStabEndL', [-2.86, 2.80, 9.60]));

  grp.add(box([0.14, 1.60, 1.00], COL.fuselage,
    'Fuselage_VertFin', [0, 3.42, 9.80]));

  grp.add(box([1.80, 0.55, 3.50], COL.fuselage,
    'Fuselage_EngineFairingTop', [0, 3.15, 0.20]));
  grp.add(box([2.00, 0.40, 1.60], COL.fuselage,
    'Fuselage_GearboxFairing', [0, 3.38, -0.80]));

  grp.add(box([2.62, 0.012, 7.20], COL.darkPanel,
    'Fuselage_BeltlineSeam', [0, 2.60, -0.50]));
  grp.add(box([0.012, 1.80, 7.20], COL.darkPanel,
    'Fuselage_CentrelineSeam', [0, 2.20, -0.50]));

  root.add(grp);
  return grp;
}

/** Cockpit glazing panels. */
function buildCockpit(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Cockpit';

  grp.add(box([0.90, 0.80, 0.08], COL.glass,
    'Cockpit_WindscreenR', [0.52, 2.48, -4.98], [0.18, 0, 0.06]));
  grp.add(box([0.90, 0.80, 0.08], COL.glass,
    'Cockpit_WindscreenL', [-0.52, 2.48, -4.98], [0.18, 0, -0.06]));

  grp.add(box([0.55, 0.40, 0.06], COL.glass,
    'Cockpit_ChinWinR', [0.42, 1.90, -5.40], [0.30, 0, 0]));
  grp.add(box([0.55, 0.40, 0.06], COL.glass,
    'Cockpit_ChinWinL', [-0.42, 1.90, -5.40], [0.30, 0, 0]));

  grp.add(box([0.07, 0.85, 0.10], COL.darkPanel,
    'Cockpit_CentrePost', [0, 2.48, -4.98]));

  grp.add(box([0.06, 0.65, 1.00], COL.glass,
    'Cockpit_DoorWinR', [1.32, 2.38, -3.40]));
  grp.add(box([0.06, 0.65, 1.00], COL.glass,
    'Cockpit_DoorWinL', [-1.32, 2.38, -3.40]));

  grp.add(box([0.06, 0.60, 1.80], COL.glass,
    'Cockpit_CabinWinR', [1.32, 2.35, 0.50]));
  grp.add(box([0.06, 0.60, 1.80], COL.glass,
    'Cockpit_CabinWinL', [-1.32, 2.35, 0.50]));

  root.add(grp);
  return grp;
}

/** Engine exhausts + air intakes on top of the fuselage. */
function buildEngines(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Engines';

  grp.add(box([0.62, 0.55, 1.80], COL.darkPanel,
    'Engine_NacelleL', [-0.72, 3.18, -0.10]));
  grp.add(box([0.62, 0.55, 1.80], COL.darkPanel,
    'Engine_NacelleR', [0.72, 3.18, -0.10]));

  grp.add(cyl(0.14, 0.12, 0.55, 8, COL.exhaust,
    'Engine_ExhaustL', [-0.80, 3.50, 0.50], [0, 0, -0.20]));
  grp.add(cyl(0.14, 0.12, 0.55, 8, COL.exhaust,
    'Engine_ExhaustR', [0.80, 3.50, 0.50], [0, 0, 0.20]));

  grp.add(cyl(0.18, 0.16, 0.45, 8, COL.darkPanel,
    'Engine_IRSupL', [-0.80, 3.72, 0.62], [0, 0, -0.20]));
  grp.add(cyl(0.18, 0.16, 0.45, 8, COL.darkPanel,
    'Engine_IRSupR', [0.80, 3.72, 0.62], [0, 0, 0.20]));

  grp.add(box([0.58, 0.40, 0.14], COL.darkPanel,
    'Engine_IntakeL', [-0.72, 3.20, -1.05]));
  grp.add(box([0.58, 0.40, 0.14], COL.darkPanel,
    'Engine_IntakeR', [0.72, 3.20, -1.05]));
  grp.add(box([0.52, 0.34, 0.06], COL.metal,
    'Engine_IntakeMeshL', [-0.72, 3.20, -1.14]));
  grp.add(box([0.52, 0.34, 0.06], COL.metal,
    'Engine_IntakeMeshR', [0.72, 3.20, -1.14]));

  root.add(grp);
  return grp;
}

/**
 * Main rotor hub + 4 blades.
 * The whole group is Bone_MainRotorHub — VehicleAnimator spins it on Y.
 */
function buildMainRotor(root) {
  const hub = new THREE.Group();
  hub.name = 'Bone_MainRotorHub';
  hub.position.set(0, 3.82, -0.30);

  hub.add(cyl(0.28, 0.28, 0.22, 10, COL.metal,
    'MainRotor_Hub', [0, 0, 0]));
  hub.add(cyl(0.18, 0.28, 0.10, 10, COL.metal,
    'MainRotor_HubCap', [0, 0.16, 0]));
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    hub.add(cyl(0.03, 0.03, 0.35, 6, COL.metal,
      `MainRotor_PitchLink${i}`,
      [Math.sin(angle) * 0.32, -0.08, Math.cos(angle) * 0.32],
      [0, 0, Math.PI / 2]));
  }

  const bladeAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  bladeAngles.forEach((angle, i) => {
    const blade = new THREE.Group();
    blade.name = `MainRotor_BladeArm${i}`;
    blade.rotation.y = angle;

    blade.add(box([0.55, 0.18, 0.90], COL.metal,
      `MainRotor_BladeCuff${i}`, [0, 0, -0.55]));
    blade.add(box([0.44, 0.10, 6.60], COL.blade,
      `MainRotor_BladeSpan${i}`, [0, -0.04, -4.55]));
    blade.add(box([0.36, 0.08, 0.60], COL.blade,
      `MainRotor_BladeTip${i}`, [0, -0.06, -8.05]));
    blade.add(box([0.05, 0.11, 7.60], COL.metal,
      `MainRotor_BladeLE${i}`, [0.22, -0.04, -4.90]));

    hub.add(blade);
  });

  root.add(hub);
  return hub;
}

/**
 * Tail rotor hub + 4 blades. Pre-rotated to face left; spun on local Y.
 */
function buildTailRotor(root) {
  const hub = new THREE.Group();
  hub.name = 'Bone_TailRotorHub';
  hub.position.set(-0.42, 3.30, 10.70);
  hub.rotation.z = Math.PI / 2;

  hub.add(cyl(0.14, 0.14, 0.16, 8, COL.metal,
    'TailRotor_Hub', [0, 0, 0]));
  hub.add(cyl(0.09, 0.14, 0.08, 8, COL.metal,
    'TailRotor_HubCap', [0, 0.12, 0]));

  const bladeAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  bladeAngles.forEach((angle, i) => {
    const blade = new THREE.Group();
    blade.name = `TailRotor_BladeArm${i}`;
    blade.rotation.y = angle;

    blade.add(box([0.20, 0.07, 0.45], COL.metal,
      `TailRotor_BladeCuff${i}`, [0, 0, -0.28]));
    blade.add(box([0.18, 0.05, 1.30], COL.blade,
      `TailRotor_BladeSpan${i}`, [0, -0.015, -1.30]));
    blade.add(box([0.14, 0.04, 0.20], COL.blade,
      `TailRotor_BladeTip${i}`, [0, -0.02, -1.98]));

    hub.add(blade);
  });

  root.add(hub);
  return hub;
}

/** Landing skids — two longitudinal tubes with two cross-tubes. */
function buildSkids(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Skids';

  grp.add(box([0.09, 0.09, 7.00], COL.metal,
    'Skid_TubeR', [1.22, 0.12, -0.20]));
  grp.add(box([0.09, 0.09, 7.00], COL.metal,
    'Skid_TubeL', [-1.22, 0.12, -0.20]));

  grp.add(box([2.60, 0.09, 0.09], COL.metal,
    'Skid_CrossFwd', [0, 0.75, -1.80], [0, 0, 0.22]));
  grp.add(box([2.60, 0.09, 0.09], COL.metal,
    'Skid_CrossRear', [0, 0.75, 1.80], [0, 0, -0.22]));

  grp.add(box([0.07, 0.90, 0.07], COL.metal,
    'Skid_StrutFwdR', [1.22, 0.50, -2.10], [0, 0, 0.18]));
  grp.add(box([0.07, 0.90, 0.07], COL.metal,
    'Skid_StrutFwdL', [-1.22, 0.50, -2.10], [0, 0, -0.18]));

  grp.add(box([0.07, 0.90, 0.07], COL.metal,
    'Skid_StrutRearR', [1.22, 0.50, 2.10], [0, 0, 0.18]));
  grp.add(box([0.07, 0.90, 0.07], COL.metal,
    'Skid_StrutRearL', [-1.22, 0.50, 2.10], [0, 0, -0.18]));

  for (let i = 0; i < 4; i++) {
    const z = -2.40 + i * 1.60;
    grp.add(box([0.11, 0.06, 0.28], COL.rubber,
      `Skid_PadR${i}`, [1.22, 0.065, z]));
    grp.add(box([0.11, 0.06, 0.28], COL.rubber,
      `Skid_PadL${i}`, [-1.22, 0.065, z]));
  }

  root.add(grp);
  return grp;
}

/** Stub wings + hardpoints (rockets / missiles). */
function buildStubWings(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_StubWings';

  grp.add(box([1.60, 0.18, 0.80], COL.fuselage,
    'StubWing_R', [1.98, 1.82, -0.50]));
  grp.add(box([1.60, 0.18, 0.80], COL.fuselage,
    'StubWing_L', [-1.98, 1.82, -0.50]));

  grp.add(box([0.18, 0.28, 0.55], COL.darkPanel,
    'Pylon_InnerR', [1.62, 1.55, -0.50]));
  grp.add(box([0.18, 0.28, 0.55], COL.darkPanel,
    'Pylon_InnerL', [-1.62, 1.55, -0.50]));
  grp.add(box([0.18, 0.28, 0.55], COL.darkPanel,
    'Pylon_OuterR', [2.34, 1.55, -0.50]));
  grp.add(box([0.18, 0.28, 0.55], COL.darkPanel,
    'Pylon_OuterL', [-2.34, 1.55, -0.50]));

  grp.add(box([0.38, 0.38, 1.20], COL.darkPanel,
    'RocketPod_R', [1.62, 1.30, -0.50]));
  grp.add(box([0.38, 0.38, 1.20], COL.darkPanel,
    'RocketPod_L', [-1.62, 1.30, -0.50]));

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const ox = (col - 0.5) * 0.14;
      const oy = (row - 0.5) * 0.14;
      grp.add(cyl(0.028, 0.028, 0.06, 6, COL.metal,
        `RocketTube_R${row}${col}`,
        [1.62 + ox, 1.30 + oy, -1.14], [Math.PI / 2, 0, 0]));
      grp.add(cyl(0.028, 0.028, 0.06, 6, COL.metal,
        `RocketTube_L${row}${col}`,
        [-1.62 + ox, 1.30 + oy, -1.14], [Math.PI / 2, 0, 0]));
    }
  }

  root.add(grp);
  return grp;
}

/** Navigation / position lights and sensor turret. */
function buildLightsAndSensors(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_LightsSensors';

  grp.add(box([0.06, 0.06, 0.06], 0xff2200, 'Light_PortRed', [-1.32, 2.00, -3.50]));
  grp.add(box([0.06, 0.06, 0.06], 0x22ff22, 'Light_StarboardGreen', [1.32, 2.00, -3.50]));
  grp.add(box([0.07, 0.07, 0.07], COL.light, 'Light_TailWhite', [0, 2.64, 10.90]));
  grp.add(box([0.08, 0.08, 0.08], COL.light, 'Light_AntiColTop', [0, 3.95, -0.30]));
  grp.add(box([0.08, 0.08, 0.08], COL.light, 'Light_AntiColBot', [0, 1.38, -0.50]));

  grp.add(cyl(0.22, 0.22, 0.30, 10, COL.metal,
    'Sensor_TurretBall', [0.20, 1.52, -5.80], [Math.PI / 2, 0, 0]));
  grp.add(cyl(0.10, 0.10, 0.10, 8, COL.glass,
    'Sensor_TurretLens', [0.20, 1.52, -5.98], [Math.PI / 2, 0, 0]));

  grp.add(box([0.30, 0.10, 0.55], COL.darkPanel,
    'Sensor_RadAlt', [0, 1.30, 1.00]));

  root.add(grp);
  return grp;
}

/** Crew doors outline (visual only — slide door track + frame). */
function buildDoors(root) {
  const grp = new THREE.Group();
  grp.name = 'Group_Doors';

  grp.add(box([0.06, 1.10, 1.80], COL.darkPanel,
    'Door_FrameR', [1.32, 2.15, 0.50]));
  grp.add(box([0.06, 1.10, 1.80], COL.darkPanel,
    'Door_FrameL', [-1.32, 2.15, 0.50]));
  grp.add(box([0.08, 0.06, 1.90], COL.metal,
    'Door_TrackR', [1.32, 2.75, 0.50]));
  grp.add(box([0.08, 0.06, 1.90], COL.metal,
    'Door_TrackL', [-1.32, 2.75, 0.50]));
  grp.add(box([0.06, 1.00, 1.00], COL.darkPanel,
    'Door_PilotFrameR', [1.32, 2.15, -3.20]));
  grp.add(box([0.06, 1.00, 1.00], COL.darkPanel,
    'Door_CopilotFrameL', [-1.32, 2.15, -3.20]));

  root.add(grp);
  return grp;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function buildHelicopterPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Vehicle';

  buildFuselage(root);
  buildCockpit(root);
  buildEngines(root);
  buildSkids(root);
  buildStubWings(root);
  buildLightsAndSensors(root);
  buildDoors(root);

  const mainRotorHub = buildMainRotor(root);
  const tailRotorHub = buildTailRotor(root);

  socket('Socket_Pilot',        [0.55, 2.38, -4.20], root);
  socket('Socket_Copilot',      [-0.55, 2.38, -4.20], root);
  socket('Socket_CameraLeft',   [-1.50, 2.50, 0.00], root);
  socket('Socket_CameraRight',  [1.50, 2.50, 0.00], root);
  socket('Socket_CameraTail',   [0, 2.80, 11.20], root);
  socket('Socket_Muzzle_R',     [1.62, 1.30, -1.20], root);
  socket('Socket_Muzzle_L',     [-1.62, 1.30, -1.20], root);
  socket('Socket_Hardpoint_R',  [2.34, 1.42, -0.50], root);
  socket('Socket_Hardpoint_L',  [-2.34, 1.42, -0.50], root);
  socket('Socket_Skid_R',       [1.22, 0.04, -0.20], root);
  socket('Socket_Skid_L',       [-1.22, 0.04, -0.20], root);

  return { root, mainRotorHub, tailRotorHub };
}

export default buildHelicopterPattern;
