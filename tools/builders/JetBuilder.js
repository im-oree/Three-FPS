/**
 * JetBuilder.js — Document M §2: the fighter jet for the guided-missile
 * launch cinematic. Same procedural-primitive -> shared low-poly palette ->
 * named sockets pattern as the other vehicle builders. A generic-modern-
 * fighter silhouette (delta-ish wings, twin canted fins, single dorsal
 * intake) — deliberately not a specific real aircraft.
 *
 * Orientation contract (matches the other vehicles' convention INVERTED for
 * Object3D.lookAt-driven flight): the nose points along +Z, because the jet
 * is oriented with lookAt(position + tangent) each frame, and lookAt points
 * a non-camera object's +Z at the target. The guided_missile rider keeps
 * its native -Z nose and is yaw-flipped 180 deg when mounted to the pylon.
 *
 * Node contract (validated in generateVehicleModels.js):
 *   FighterJet            — builder root
 *   Socket_MissilePylon_L/R — underwing missile mounts (one is used per
 *                             launch, chosen at random)
 *   Socket_Afterburner_L/R  — exhaust flame VFX anchors
 *   Anchor_ChaseCam         — documented camera reference for the chase shot
 */
import * as THREE from 'three';

const matJetHull = new THREE.MeshStandardMaterial({
  color: 0x6e747a, roughness: 0.45, metalness: 0.6, flatShading: true,
});
const matJetDark = new THREE.MeshStandardMaterial({
  color: 0x2f3236, roughness: 0.5, metalness: 0.65, flatShading: true,
});
const matCanopyGlass = new THREE.MeshStandardMaterial({
  color: 0x1a2b33, roughness: 0.2, metalness: 0.4,
  flatShading: true, transparent: true, opacity: 0.7,
});
const matExhaustHot = new THREE.MeshStandardMaterial({
  color: 0x1c1c1c, roughness: 0.6, metalness: 0.8, flatShading: true,
});
const matWarningRed = new THREE.MeshStandardMaterial({
  color: 0xaa2b2b, roughness: 0.6, metalness: 0.3, flatShading: true,
});

export function buildJetPattern() {
  const root = new THREE.Group();
  root.name = 'FighterJet';

  // Fuselage: tapered box segments — a cheap "area-rule" silhouette.
  const fuselageSegments = [
    { z: 5.2, w: 0.5, h: 0.5 }, // nose tip
    { z: 3.0, w: 0.85, h: 0.7 },
    { z: 0.5, w: 1.15, h: 0.95 }, // widest point (canopy/intake area)
    { z: -2.5, w: 1.0, h: 0.85 },
    { z: -5.0, w: 0.55, h: 0.55 }, // tail taper into exhaust
  ];
  const fuselageGroup = new THREE.Group();
  fuselageGroup.name = 'Fuselage';
  for (let i = 0; i < fuselageSegments.length - 1; i += 1) {
    const a = fuselageSegments[i];
    const b = fuselageSegments[i + 1];
    const segLength = a.z - b.z;
    const avgW = (a.w + b.w) / 2;
    const avgH = (a.h + b.h) / 2;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(avgW, avgH, segLength), matJetHull);
    seg.position.z = (a.z + b.z) / 2;
    seg.name = `FuselageSeg_${i}`;
    fuselageGroup.add(seg);
  }

  // Nose cone cap.
  const noseCap = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 6), matJetDark);
  noseCap.rotation.x = Math.PI / 2;
  noseCap.position.z = 5.55;
  noseCap.name = 'NoseCap';

  // Canopy.
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 1.6), matCanopyGlass);
  canopy.position.set(0, 0.55, 1.6);
  canopy.name = 'Canopy';

  // Dorsal intake (single top scoop — avoids complex twin side-intakes at
  // this poly count).
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 1.4), matJetDark);
  intake.position.set(0, 0.75, -0.3);
  intake.name = 'DorsalIntake';

  // Delta main wings.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(3.4, -1.6);
  wingShape.lineTo(3.2, -2.6);
  wingShape.lineTo(0.4, -1.2);
  wingShape.lineTo(0, 0);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2);
  const wingR = new THREE.Mesh(wingGeo, matJetHull);
  wingR.position.set(0.55, -0.05, -0.6);
  wingR.name = 'WingRoot_R';
  const wingL = wingR.clone();
  wingL.scale.x = -1;
  wingL.name = 'WingRoot_L';

  // Wingtip pylons — the missile mount points this document exists for.
  const pylonGeo = new THREE.BoxGeometry(0.1, 0.18, 0.9);
  const pylonR = new THREE.Mesh(pylonGeo, matJetDark);
  pylonR.position.set(2.6, -0.5, -1.4);
  pylonR.name = 'Pylon_R';
  const pylonL = pylonR.clone();
  pylonL.position.x = -2.6;
  pylonL.name = 'Pylon_L';

  const missilePylonSocketR = new THREE.Object3D();
  missilePylonSocketR.name = 'Socket_MissilePylon_R';
  missilePylonSocketR.position.set(2.6, -0.6, -1.4);
  const missilePylonSocketL = new THREE.Object3D();
  missilePylonSocketL.name = 'Socket_MissilePylon_L';
  missilePylonSocketL.position.set(-2.6, -0.6, -1.4);

  // Twin canted tail fins + horizontal stabilizers.
  const finGeo = new THREE.BoxGeometry(0.06, 1.1, 1.3);
  const finR = new THREE.Mesh(finGeo, matJetDark);
  finR.position.set(0.35, 0.55, -4.4);
  finR.rotation.z = THREE.MathUtils.degToRad(-18);
  finR.name = 'TailFin_R';
  const finL = finR.clone();
  finL.position.x = -0.35;
  finL.rotation.z = THREE.MathUtils.degToRad(18);
  finL.name = 'TailFin_L';

  const stabGeo = new THREE.BoxGeometry(1.4, 0.06, 0.7);
  const stabR = new THREE.Mesh(stabGeo, matJetHull);
  stabR.position.set(0.9, 0.1, -4.6);
  stabR.name = 'Stab_R';
  const stabL = stabR.clone();
  stabL.position.x = -0.9;
  stabL.name = 'Stab_L';

  // Twin exhaust nozzles + afterburner sockets.
  const nozzleGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.6, 8);
  const nozzleR = new THREE.Mesh(nozzleGeo, matExhaustHot);
  nozzleR.rotation.x = Math.PI / 2;
  nozzleR.position.set(0.28, 0, -5.3);
  nozzleR.name = 'Nozzle_R';
  const nozzleL = nozzleR.clone();
  nozzleL.position.x = -0.28;
  nozzleL.name = 'Nozzle_L';

  const afterburnerSocketR = new THREE.Object3D();
  afterburnerSocketR.name = 'Socket_Afterburner_R';
  afterburnerSocketR.position.set(0.28, 0, -5.65);
  const afterburnerSocketL = new THREE.Object3D();
  afterburnerSocketL.name = 'Socket_Afterburner_L';
  afterburnerSocketL.position.set(-0.28, 0, -5.65);

  // Warning stripe (flat colored strip — no texture needed at this scale).
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.0), matWarningRed);
  stripe.position.set(0.58, -0.05, -3.5);
  stripe.name = 'WarningStripe';

  // Cinematic chase-cam anchor — a documented reference point so the chase
  // offset is authored against a real named node, not a magic vector.
  const chaseCamAnchor = new THREE.Object3D();
  chaseCamAnchor.name = 'Anchor_ChaseCam';
  chaseCamAnchor.position.set(0, 1.4, -8.5); // behind and above the jet

  root.add(
    fuselageGroup, noseCap, canopy, intake, wingR, wingL,
    pylonR, pylonL, missilePylonSocketR, missilePylonSocketL,
    finR, finL, stabR, stabL, nozzleR, nozzleL,
    afterburnerSocketR, afterburnerSocketL, stripe, chaseCamAnchor,
  );

  // Conservative bounding sphere for the path validator's clip checks.
  root.userData.boundingRadius = 5.8;
  return { root };
}

export default buildJetPattern;
