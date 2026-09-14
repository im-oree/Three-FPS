/**
 * BodyRigBuilder.js — detailed procedural low-poly RIGID third-person body rig
 * (FPS/TPS Architectural Specification §1 "Invisible Master Skeleton").
 *
 * NOTE: All gameplay-critical node names, socket names, joint positions and
 * hierarchy are IDENTICAL to the original. Extra cosmetic meshes are added as
 * siblings inside each pivot Group. No pivot Y-offsets change, no socket
 * positions change, so ThirdPersonBody.ts lookups, foot-IK, spring-arm,
 * 1PS masking and the shared arm rig all continue to work unchanged.
 *
 * Cosmetic additions per segment:
 *   Pelvis   — belt, two side pouches, holster stub
 *   Spine    — back plate, two spine pouches, radio stub
 *   Chest    — front plate, four MOLLE pouches, shoulder pad lips, collar
 *   Neck     — balaclava wrap
 *   Head     — face detail (brow ridge, nose, chin), ear guards
 *   Helmet   — brim, four bolts, NVG mount stub
 *   Thigh    — thigh pouch, knee pad
 *   Shin     — shin guard strip
 *   Foot     — boot sole, boot toe cap, lace panel
 */
import * as THREE from 'three';
import { buildArmRig, PALETTE as ARM_PALETTE } from './HandRigBuilder.js';

// ---------------------------------------------------------------------------
// Dimensions and joints — UNCHANGED from original
// ---------------------------------------------------------------------------
export const BODY_DIMS = {
  pelvis:  [0.30, 0.18, 0.20],
  spine:   [0.32, 0.20, 0.21],
  chest:   [0.38, 0.26, 0.23],
  neck:    [0.11, 0.09, 0.11],
  head:    [0.21, 0.23, 0.22],
  helmet:  [0.24, 0.11, 0.25],
  thigh:   [0.15, 0.42, 0.16],
  shin:    [0.13, 0.40, 0.14],
  foot:    [0.14, 0.09, 0.26],
};

export const BODY_JOINTS = {
  pelvisY:        0.94,
  hipOffsetX:     0.105,
  hipDropY:       -0.04,
  spineY:         0.16,
  chestY:         0.17,
  neckY:          0.20,
  headY:          0.07,
  shoulderOffsetX:0.20,
  shoulderY:      0.07,
  shoulderZ:      0.0,
};

export const BODY_PALETTE = {
  skin:     ARM_PALETTE.skin,
  fatigues: 0x3a3f26,
  vest:     0x2c2f22,
  helmet:   0x24261c,
  boots:    0x16171a,
};

// ---------------------------------------------------------------------------
// Detail palette — extra tones for gear, not exposed as runtime parameters
// ---------------------------------------------------------------------------
const D = {
  gear:      0x1e2016, // dark MOLLE webbing / straps
  pouch:     0x30341f, // individual pouches
  radio:     0x141510, // radio/electronics
  kneePad:   0x22241a, // knee/shin guard
  laces:     0x0e0e0c, // boot laces
  metal:     0x1a1a18, // buckles, snaps, bolt heads
  nvg:       0x111210, // NVG mount arm
  skin:      ARM_PALETTE.skin,
  balaclava: 0x20221a,
};

// ---------------------------------------------------------------------------
// Local primitive helpers (keep consistent with WeaponBuilderKit style)
// ---------------------------------------------------------------------------
function seg(size, color, name, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.9, metalness: 0.0, flatShading: true,
    }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cdet(radius, height, color, name, pos = [0, 0, 0], rot = [0, 0, 0], segs = 6) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, segs),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.1, flatShading: true,
    }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Segment constructors — unchanged signatures, unchanged mesh offsets
// ---------------------------------------------------------------------------
function makeSegment(size, color, name) {
  return seg(size, color, name);
}

/** Hangs BELOW its pivot (thigh, shin). */
function makeHangingSegment(size, color, name) {
  const mesh = makeSegment(size, color, name);
  mesh.position.y = -size[1] / 2;
  return mesh;
}

/** Rises ABOVE its pivot (spine stack). */
function makeRisingSegment(size, color, name) {
  const mesh = makeSegment(size, color, name);
  mesh.position.y = size[1] / 2;
  return mesh;
}

// ---------------------------------------------------------------------------
// Cosmetic detail helpers — add meshes INTO an existing pivot Group as
// siblings of the primary mesh (never move the primary mesh or the pivot).
// ---------------------------------------------------------------------------

/**
 * Add cosmetic children into `pivotGroup` around a rising segment
 * (segment top is at pivotGroup.y + segH, bottom at pivotGroup.y).
 */
function detailPelvis(group, fatigue, vest) {
  const [w, h] = BODY_DIMS.pelvis;
  // Belt strip across the top of the pelvis block.
  group.add(seg([w + 0.01, 0.025, BODY_DIMS.pelvis[2] + 0.01], D.gear,
    'Detail_Belt', [0, h - 0.012, 0]));
  // Belt buckle centre.
  group.add(seg([0.04, 0.03, 0.015], D.metal,
    'Detail_BeltBuckle', [0, h - 0.012, -(BODY_DIMS.pelvis[2] / 2 + 0.007)]));
  // Side cargo pouches.
  group.add(seg([0.06, 0.10, 0.07], D.pouch,
    'Detail_HipPouchR', [w / 2 + 0.033, h * 0.5, 0]));
  group.add(seg([0.06, 0.10, 0.07], D.pouch,
    'Detail_HipPouchL', [-(w / 2 + 0.033), h * 0.5, 0]));
  // Holster stub on right.
  group.add(seg([0.045, 0.055, 0.03], D.gear,
    'Detail_HolsterStub', [w / 2 + 0.03, h * 0.2, -0.02]));
  // Back strap.
  group.add(seg([w * 0.6, 0.018, 0.012], D.gear,
    'Detail_BackStrap', [0, h * 0.7, BODY_DIMS.pelvis[2] / 2 + 0.006]));
}

function detailSpine(group, vest) {
  const [w, h] = BODY_DIMS.spine;
  // Back plate.
  group.add(seg([w * 0.9, h * 0.85, 0.018], D.gear,
    'Detail_BackPlate', [0, h * 0.5, BODY_DIMS.spine[2] / 2 + 0.01]));
  // Two MOLLE spine pouches.
  group.add(seg([0.055, 0.08, 0.05], D.pouch,
    'Detail_SpinePouchR', [w * 0.28, h * 0.62, BODY_DIMS.spine[2] / 2 + 0.038]));
  group.add(seg([0.055, 0.08, 0.05], D.pouch,
    'Detail_SpinePouchL', [-w * 0.28, h * 0.62, BODY_DIMS.spine[2] / 2 + 0.038]));
  // Radio/comms brick upper-left back.
  group.add(seg([0.04, 0.09, 0.03], D.radio,
    'Detail_RadioBrick', [-w * 0.36, h * 0.82, BODY_DIMS.spine[2] / 2 + 0.022]));
  group.add(cdet(0.006, 0.05, D.radio,
    'Detail_RadioAntenna', [-w * 0.36, h + 0.02, BODY_DIMS.spine[2] / 2 + 0.022],
    [0, 0, 0.18]));
  // Horizontal MOLLE rows on back.
  for (let i = 0; i < 3; i++) {
    group.add(seg([w * 0.88, 0.006, 0.012], D.gear,
      `Detail_BackMOLLE${i}`, [0, h * (0.30 + i * 0.22), BODY_DIMS.spine[2] / 2 + 0.019]));
  }
}

function detailChest(group, vest) {
  const [w, h, d] = BODY_DIMS.chest;
  // Front armour plate.
  group.add(seg([w * 0.82, h * 0.78, 0.022], D.gear,
    'Detail_ChestPlate', [0, h * 0.46, -(d / 2 + 0.012)]));
  // Four front MOLLE pouches (2×2 grid).
  const pW = 0.075, pH = 0.09, pD = 0.055;
  const pXs = [-w * 0.24, w * 0.24];
  const pYs = [h * 0.70, h * 0.40];
  let pi = 0;
  for (const px of pXs) for (const py of pYs) {
    group.add(seg([pW, pH, pD], D.pouch,
      `Detail_FrontPouch${pi++}`, [px, py, -(d / 2 + 0.045)]));
  }
  // Grenade pouch left.
  group.add(seg([0.045, 0.065, 0.05], D.pouch,
    'Detail_GrenadePouch', [-w * 0.44, h * 0.55, -(d / 2 + 0.04)]));
  // Horizontal MOLLE rows on front plate.
  for (let i = 0; i < 4; i++) {
    group.add(seg([w * 0.8, 0.006, 0.024], D.gear,
      `Detail_FrontMOLLE${i}`, [0, h * (0.25 + i * 0.18), -(d / 2 + 0.024)]));
  }
  // Left/right shoulder pad lips (where the arm sockets sit).
  group.add(seg([0.05, 0.025, d * 0.9], D.gear,
    'Detail_ShoulderLipR', [w / 2 + 0.005, h * 0.92, 0]));
  group.add(seg([0.05, 0.025, d * 0.9], D.gear,
    'Detail_ShoulderLipL', [-(w / 2 + 0.005), h * 0.92, 0]));
  // Collar strip.
  group.add(seg([w * 0.55, 0.018, 0.018], D.gear,
    'Detail_CollarStrip', [0, h + 0.007, -(d * 0.3)]));
  // ID patch front centre.
  group.add(seg([0.04, 0.025, 0.004], D.metal,
    'Detail_IDPatch', [0, h * 0.72, -(d / 2 + 0.056)]));
}

function detailNeck(group) {
  const [nw, nh, nd] = BODY_DIMS.neck;
  // Balaclava wrap — slightly proud of the skin block on all sides.
  group.add(seg([nw + 0.008, nh * 0.80, nd + 0.008], D.balaclava,
    'Detail_BalaclavaNeck', [0, nh * 0.45, 0]));
}

function detailHead(group, skin) {
  const [hw, hh, hd] = BODY_DIMS.head;
  // Balaclava lower face cover (nose–chin region).
  group.add(seg([hw * 0.70, hh * 0.32, 0.018], D.balaclava,
    'Detail_BalaclavaCover', [0, hh * 0.22, -(hd / 2 + 0.01)]));
  // Brow ridge.
  group.add(seg([hw * 0.80, 0.022, 0.018], skin,
    'Detail_BrowRidge', [0, hh * 0.78, -(hd / 2 + 0.01)]));
  // Nose stub.
  group.add(seg([0.022, 0.025, 0.025], skin,
    'Detail_Nose', [0, hh * 0.56, -(hd / 2 + 0.014)]));
  // Ear guards (side).
  group.add(seg([0.016, 0.055, 0.045], D.gear,
    'Detail_EarGuardR', [hw / 2 + 0.01, hh * 0.58, 0.01]));
  group.add(seg([0.016, 0.055, 0.045], D.gear,
    'Detail_EarGuardL', [-(hw / 2 + 0.01), hh * 0.58, 0.01]));
  // Goggle strap band across forehead.
  group.add(seg([hw + 0.01, 0.018, 0.014], D.gear,
    'Detail_GogglesStrap', [0, hh * 0.72, -(hd / 2 + 0.008)]));
}

function detailHelmet(group, helmetColor) {
  const [mw, mh, md] = BODY_DIMS.helmet;
  // Forward brim.
  group.add(seg([mw + 0.01, 0.012, 0.04], helmetColor,
    'Detail_HelmetBrim', [0, -mh / 2 + 0.005, -(md / 2 + 0.02)]));
  // Four bolt heads at corners.
  const boltXs = [-mw * 0.35, mw * 0.35];
  const boltZs = [-md * 0.32, md * 0.32];
  let bi = 0;
  for (const bx of boltXs) for (const bz of boltZs) {
    group.add(cdet(0.008, 0.01, D.metal,
      `Detail_HelmetBolt${bi++}`, [bx, mh / 2, bz]));
  }
  // NVG mount bracket stub (front centre).
  group.add(seg([0.04, 0.03, 0.025], D.metal,
    'Detail_NVGMountBase', [0, mh / 2, -(md / 2 + 0.015)]));
  group.add(seg([0.012, 0.05, 0.008], D.nvg,
    'Detail_NVGArm', [0, mh / 2 + 0.04, -(md / 2 + 0.018)]));
  // Side rail strips.
  group.add(seg([0.008, 0.018, md * 0.70], D.gear,
    'Detail_HelmetRailR', [mw / 2 + 0.005, 0, 0]));
  group.add(seg([0.008, 0.018, md * 0.70], D.gear,
    'Detail_HelmetRailL', [-(mw / 2 + 0.005), 0, 0]));
  // Paracord loop rear.
  group.add(seg([0.03, 0.012, 0.012], D.gear,
    'Detail_ParacordLoop', [0, 0, md / 2 + 0.006]));
}

function detailThigh(side, hipGroup) {
  // Find the thigh mesh (the hanging segment) and annotate around it.
  // We add to hipGroup because the thigh mesh is already a child of hip.
  const [tw, th, td] = BODY_DIMS.thigh;
  const sign = side === 'R' ? 1 : -1;
  // Thigh drop pouch (outboard).
  hipGroup.add(seg([0.065, 0.10, 0.07], D.pouch,
    `Detail_ThighPouch_${side}`,
    [sign * (tw / 2 + 0.035), -(th * 0.38), 0]));
  // Pouch strap top + bottom.
  hipGroup.add(seg([0.07, 0.012, td + 0.01], D.gear,
    `Detail_ThighStrapTop_${side}`,
    [sign * (tw / 2 + 0.035), -(th * 0.20), 0]));
  hipGroup.add(seg([0.07, 0.012, td + 0.01], D.gear,
    `Detail_ThighStrapBot_${side}`,
    [sign * (tw / 2 + 0.035), -(th * 0.56), 0]));
  // Knee pad — at the bottom of the thigh segment.
  hipGroup.add(seg([tw + 0.01, 0.055, td + 0.012], D.kneePad,
    `Detail_KneePad_${side}`, [0, -(th - 0.028), 0]));
}

function detailShin(side, kneeGroup) {
  const [sw, sh, sd] = BODY_DIMS.shin;
  const sign = side === 'R' ? 1 : -1;
  // Shin guard strip (front face).
  kneeGroup.add(seg([sw * 0.65, sh * 0.55, 0.018], D.kneePad,
    `Detail_ShinGuard_${side}`, [0, -(sh * 0.38), -(sd / 2 + 0.01)]));
  // Two horizontal strap bands.
  kneeGroup.add(seg([sw + 0.01, 0.012, sd + 0.01], D.gear,
    `Detail_ShinStrapU_${side}`, [0, -(sh * 0.22), 0]));
  kneeGroup.add(seg([sw + 0.01, 0.012, sd + 0.01], D.gear,
    `Detail_ShinStrapL_${side}`, [0, -(sh * 0.60), 0]));
}

function detailFoot(side, ankleGroup) {
  const [fw, fh, fd] = BODY_DIMS.foot;
  // Boot sole (slightly wider/longer than the foot block).
  ankleGroup.add(seg([fw + 0.01, 0.012, fd + 0.015], D.gear,
    `Detail_BootSole_${side}`, [0, -(fh + 0.006), -0.05]));
  // Toe cap.
  ankleGroup.add(seg([fw * 0.75, fh * 0.55, 0.018], D.gear,
    `Detail_ToeCap_${side}`, [0, -(fh * 0.5), -(fd / 2 + 0.005 + 0.05)]));
  // Lace panel strip.
  ankleGroup.add(seg([fw * 0.45, fh * 0.70, 0.012], D.laces,
    `Detail_LacePanel_${side}`, [0, -(fh * 0.36), -(fd / 2 + 0.001 + 0.05)]));
  // Ankle collar.
  ankleGroup.add(seg([fw + 0.006, 0.022, fd + 0.006], D.gear,
    `Detail_AnkleCollar_${side}`, [0, -(fh * 0.05), -0.05]));
}

// ---------------------------------------------------------------------------
// Leg builder — IDENTICAL logic to original, detail added after construction
// ---------------------------------------------------------------------------
function buildLeg(side) {
  const sign = side === 'R' ? 1 : -1;

  const hip = new THREE.Group();
  hip.name = `HipPivot_${side}`;
  hip.position.set(sign * BODY_JOINTS.hipOffsetX, BODY_JOINTS.hipDropY, 0);
  hip.add(makeHangingSegment(BODY_DIMS.thigh, BODY_PALETTE.fatigues, `Thigh_${side}`));

  const knee = new THREE.Group();
  knee.name = `KneePivot_${side}`;
  knee.position.y = -BODY_DIMS.thigh[1];
  knee.add(makeHangingSegment(BODY_DIMS.shin, BODY_PALETTE.fatigues, `Shin_${side}`));
  hip.add(knee);

  const ankle = new THREE.Group();
  ankle.name = `AnklePivot_${side}`;
  ankle.position.y = -BODY_DIMS.shin[1];
  knee.add(ankle);

  const foot = makeSegment(BODY_DIMS.foot, BODY_PALETTE.boots, `Foot_${side}`);
  foot.position.set(0, -BODY_DIMS.foot[1] / 2, -0.05);
  ankle.add(foot);

  // Foot IK trace target — UNCHANGED position (gameplay contract).
  const solePoint = new THREE.Object3D();
  solePoint.name = `Socket_Sole_${side}`;
  solePoint.position.set(0, -BODY_DIMS.foot[1], -0.05);
  ankle.add(solePoint);

  // --- cosmetic detail (added AFTER sockets/pivots so nothing is displaced) --
  detailThigh(side, hip);
  detailShin(side, knee);
  detailFoot(side, ankle);

  return {
    hip, knee, ankle, foot,
    lengths: { thigh: BODY_DIMS.thigh[1], shin: BODY_DIMS.shin[1] },
  };
}

// ---------------------------------------------------------------------------
// Main export — IDENTICAL node contract to original
// ---------------------------------------------------------------------------
/**
 * Node contract consumed by src/character/ThirdPersonBody.ts (UNCHANGED):
 *   Root_Body, Bone_Pelvis, Bone_Spine, Bone_Chest, Bone_Neck, Bone_Head,
 *   Mesh_Head, Mesh_Helmet, Mesh_Neck            (1PS-masked set)
 *   Socket_Eyes                                   (1PS camera anchor)
 *   Socket_CameraPivot                            (3PS spring-arm origin)
 *   Shoulder_R/L … WristPivot_R/L, Socket_HandGrip_R/L
 *   HipPivot_*, KneePivot_*, AnklePivot_*, Socket_Sole_*
 */
export function buildBodyRig({
  skinColor    = BODY_PALETTE.skin,
  fatigueColor = BODY_PALETTE.fatigues,
  vestColor    = BODY_PALETTE.vest,
  helmetColor  = BODY_PALETTE.helmet,
} = {}) {
  const root = new THREE.Group();
  root.name = 'Root_Body';

  // --- pelvis ---------------------------------------------------------------
  const pelvis = new THREE.Group();
  pelvis.name = 'Bone_Pelvis';
  pelvis.position.y = BODY_JOINTS.pelvisY;
  const pelvisMesh = makeRisingSegment(BODY_DIMS.pelvis, fatigueColor, 'Mesh_Pelvis');
  pelvis.add(pelvisMesh);
  detailPelvis(pelvis, fatigueColor, vestColor); // adds siblings to pelvisMesh
  root.add(pelvis);

  // --- spine ----------------------------------------------------------------
  const spine = new THREE.Group();
  spine.name = 'Bone_Spine';
  spine.position.y = BODY_JOINTS.spineY;
  spine.add(makeRisingSegment(BODY_DIMS.spine, vestColor, 'Mesh_Spine'));
  detailSpine(spine, vestColor);
  pelvis.add(spine);

  // --- chest ----------------------------------------------------------------
  const chest = new THREE.Group();
  chest.name = 'Bone_Chest';
  chest.position.y = BODY_JOINTS.chestY;
  chest.add(makeRisingSegment(BODY_DIMS.chest, vestColor, 'Mesh_Chest'));
  detailChest(chest, vestColor);
  spine.add(chest);

  // --- neck -----------------------------------------------------------------
  const neck = new THREE.Group();
  neck.name = 'Bone_Neck';
  neck.position.y = BODY_JOINTS.neckY;
  neck.add(makeRisingSegment(BODY_DIMS.neck, skinColor, 'Mesh_Neck'));
  detailNeck(neck);
  chest.add(neck);

  // --- head -----------------------------------------------------------------
  const head = new THREE.Group();
  head.name = 'Bone_Head';
  head.position.y = BODY_JOINTS.headY;
  head.add(makeRisingSegment(BODY_DIMS.head, skinColor, 'Mesh_Head'));
  detailHead(head, skinColor);
  neck.add(head);

  // --- helmet (sibling mesh inside Bone_Head, same as original) -------------
  const helmet = makeSegment(BODY_DIMS.helmet, helmetColor, 'Mesh_Helmet');
  helmet.position.y = BODY_DIMS.head[1] * 0.86;
  head.add(helmet);
  // Helmet detail added to a wrapper so it moves with the helmet mesh offset.
  const helmetDetail = new THREE.Group();
  helmetDetail.name = 'Group_HelmetDetail';
  helmetDetail.position.y = BODY_DIMS.head[1] * 0.86;
  detailHelmet(helmetDetail, helmetColor);
  head.add(helmetDetail);

  // --- sockets (UNCHANGED positions, UNCHANGED parent nodes) ----------------
  const eyes = new THREE.Object3D();
  eyes.name = 'Socket_Eyes';
  eyes.position.set(
    0,
    BODY_DIMS.head[1] * 0.62,
    -BODY_DIMS.head[2] * 0.18,
  );
  head.add(eyes);

  const camPivot = new THREE.Object3D();
  camPivot.name = 'Socket_CameraPivot';
  camPivot.position.set(0, BODY_DIMS.chest[1] * 0.9, 0);
  chest.add(camPivot);

  // --- arms (UNCHANGED, shared builder + names with viewmodel rig) ----------
  const right = buildArmRig('R', { skinColor, sleeveColor: fatigueColor });
  const left  = buildArmRig('L', { skinColor, sleeveColor: fatigueColor });
  for (const [arm, sign] of [[right, 1], [left, -1]]) {
    arm.shoulder.position.set(
      sign * BODY_JOINTS.shoulderOffsetX,
      BODY_JOINTS.shoulderY,
      BODY_JOINTS.shoulderZ,
    );
  }
  chest.add(right.shoulder, left.shoulder);

  // --- legs (detail added inside buildLeg) ----------------------------------
  const legR = buildLeg('R');
  const legL = buildLeg('L');
  pelvis.add(legR.hip, legL.hip);

  return {
    root, pelvis, spine, chest, neck, head, helmet, eyes, camPivot,
    arms: { R: right, L: left },
    legs: { R: legR, L: legL },
  };
}
