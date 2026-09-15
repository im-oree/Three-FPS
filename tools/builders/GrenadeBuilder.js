/**
 * GrenadeBuilder.js — the three tactical throwables.
 *
 * Real-world reference: M18 smoke canister, M84 stun grenade.
 *   Body height : ~0.14 m
 *   Body radius : ~0.033 m
 *
 * Origin convention: centred on the body, so a spinning grenade tumbles
 * about its own centre of mass rather than an offset corner.
 *
 * Node contract: Root_Throwable, plus Socket_Fuse for the spark/hiss anchor.
 */
import * as THREE from 'three';

const COL = {
  smokeBody:  0x4f6b4a, // olive canister
  stunBody:   0x5c5f52, // grey-green steel
  flashBody:  0x6a6d62, // lighter alloy
  cap:        0x8a8d80, // spoon / fuse assembly
  band:       0xc4a032, // yellow identification band
  lever:      0x9aa08e,
  darkMetal:  0x4a4d42,
  ring:       0xb8bcae, // pull ring
  vent:       0x3f423a,
};

function cyl(rTop, rBot, h, segs, color, name, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, segs),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.72, metalness: 0.28, flatShading: true,
    }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

function box(size, color, name, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.75, metalness: 0.2, flatShading: true,
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

/** Shared fuse assembly: cap, spoon lever and pull ring. */
function addFuseAssembly(root, bodyTopY) {
  root.add(cyl(0.020, 0.024, 0.020, 8, COL.cap,
    'Fuse_Cap', [0, bodyTopY + 0.010, 0]));
  root.add(cyl(0.009, 0.009, 0.014, 6, COL.darkMetal,
    'Fuse_Striker', [0, bodyTopY + 0.026, 0]));
  // Spoon runs down one side of the body.
  root.add(box([0.010, 0.052, 0.016], COL.lever,
    'Fuse_Spoon', [0.026, bodyTopY - 0.018, 0]));
  root.add(box([0.010, 0.014, 0.016], COL.lever,
    'Fuse_SpoonTop', [0.022, bodyTopY + 0.008, 0], [0, 0, 0.5]));
  // Pull ring, offset to the other side.
  root.add(cyl(0.011, 0.011, 0.004, 10, COL.ring,
    'Fuse_PullRing', [-0.026, bodyTopY + 0.016, 0], [Math.PI / 2, 0, 0]));

  socket('Socket_Fuse', [0, bodyTopY + 0.03, 0], root);
}

/** M18-style smoke canister: tall, straight-sided, vented top. */
export function buildSmokeGrenadePattern() {
  const root = new THREE.Group();
  root.name = 'Root_Throwable';

  root.add(cyl(0.034, 0.034, 0.132, 12, COL.smokeBody, 'Body_Canister', [0, 0, 0]));
  root.add(cyl(0.035, 0.035, 0.008, 12, COL.darkMetal, 'Body_RimTop', [0, 0.066, 0]));
  root.add(cyl(0.035, 0.035, 0.008, 12, COL.darkMetal, 'Body_RimBottom', [0, -0.066, 0]));
  // Identification band.
  root.add(cyl(0.0345, 0.0345, 0.016, 12, COL.band, 'Body_Band', [0, 0.020, 0]));
  // Emission vents around the top face.
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2;
    root.add(cyl(0.006, 0.006, 0.010, 6, COL.vent,
      `Body_Vent${i}`, [Math.cos(a) * 0.018, 0.070, Math.sin(a) * 0.018]));
  }

  addFuseAssembly(root, 0.066);
  return root;
}

/** M84-style stun grenade: shorter body inside a perforated outer sleeve. */
export function buildStunGrenadePattern() {
  const root = new THREE.Group();
  root.name = 'Root_Throwable';

  root.add(cyl(0.030, 0.030, 0.098, 12, COL.stunBody, 'Body_Core', [0, 0, 0]));
  // Perforated sleeve: two rings of ports, which is what visually says "stun".
  for (let ring = 0; ring < 2; ring += 1) {
    const y = -0.020 + ring * 0.040;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + ring * 0.25;
      root.add(cyl(0.005, 0.005, 0.012, 6, COL.vent,
        `Body_Port${ring}${i}`,
        [Math.cos(a) * 0.030, y, Math.sin(a) * 0.030],
        [Math.PI / 2, 0, -a]));
    }
  }
  root.add(cyl(0.032, 0.032, 0.010, 12, COL.darkMetal, 'Body_RimTop', [0, 0.049, 0]));
  root.add(cyl(0.032, 0.032, 0.010, 12, COL.darkMetal, 'Body_RimBottom', [0, -0.049, 0]));
  root.add(cyl(0.0305, 0.0305, 0.012, 12, COL.band, 'Body_Band', [0, 0.014, 0]));

  addFuseAssembly(root, 0.049);
  return root;
}

/** Flashbang: like the stun but lighter alloy and a wider emission head. */
export function buildFlashbangPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Throwable';

  root.add(cyl(0.028, 0.028, 0.090, 12, COL.flashBody, 'Body_Core', [0, -0.004, 0]));
  // Flared emission head — the bit that actually puts out the light.
  root.add(cyl(0.034, 0.028, 0.026, 12, COL.flashBody, 'Body_Head', [0, 0.054, 0]));
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    root.add(cyl(0.004, 0.004, 0.014, 6, COL.vent,
      `Body_Port${i}`,
      [Math.cos(a) * 0.031, 0.054, Math.sin(a) * 0.031],
      [Math.PI / 2, 0, -a]));
  }
  root.add(cyl(0.030, 0.030, 0.008, 12, COL.darkMetal, 'Body_RimBottom', [0, -0.049, 0]));
  root.add(cyl(0.0285, 0.0285, 0.010, 12, COL.band, 'Body_Band', [0, -0.020, 0]));

  addFuseAssembly(root, 0.067);
  return root;
}

export default buildStunGrenadePattern;

/**
 * Killstreak command tablet (Document I §2.2).
 *
 * The Screen is a SEPARATE mesh with its own material so a CanvasTexture can
 * be swapped onto it at runtime without touching the body.
 */
export function buildTabletPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Device';

  const BODY = 0x3c4048;
  const BEZEL = 0x2b2e34;
  const RUBBER = 0x24262a;

  // Chassis
  root.add(box([0.225, 0.300, 0.016], BODY, 'Body', [0, 0, 0]));
  // Raised bezel lip so the screen sits recessed
  root.add(box([0.235, 0.310, 0.008], BEZEL, 'Bezel', [0, 0, -0.005]));
  // Rubberised corner bumpers
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    root.add(box([0.030, 0.030, 0.022], RUBBER,
      `Bumper_${sx > 0 ? 'R' : 'L'}${sy > 0 ? 'T' : 'B'}`,
      [sx * 0.104, sy * 0.142, 0]));
  }
  // Hand strap across the back
  root.add(box([0.190, 0.034, 0.006], RUBBER, 'Strap', [0, -0.02, -0.011]));
  // Status LED
  root.add(cyl(0.005, 0.005, 0.004, 6, 0x66ff99, 'StatusLED',
    [0.092, 0.132, 0.009], [Math.PI / 2, 0, 0]));

  // SCREEN — its own mesh/material, replaced at runtime with a CanvasTexture.
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.196, 0.256),
    new THREE.MeshBasicMaterial({ color: 0x0c1210, toneMapped: false }),
  );
  screen.name = 'Screen';
  screen.position.set(0, 0.008, 0.0085);
  root.add(screen);

  socket('Socket_Grip', [0, -0.115, 0], root);
  return root;
}
