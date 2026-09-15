#!/usr/bin/env node
/**
 * model-preview.mjs — render a .glb from several angles to PNG, headless.
 *
 *   node tools/verify/model-preview.mjs assets/models/vehicles/military_car.glb out/dir
 *
 * Exists because "the model is probably fine" is not verification. Builders
 * are written blind; the only way to know a vehicle reads correctly is to
 * look at it from the angles a player will, and compare against reference.
 *
 * Renders with the same lighting setup the game uses (hemi + directional key)
 * so what you see here matches what ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';

const glbPath = process.argv[2];
const outDir = process.argv[3] || 'tools/verify/shots/models';
if (!glbPath || !fs.existsSync(glbPath)) {
  console.error('usage: model-preview.mjs <file.glb> [outDir]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const b64 = fs.readFileSync(glbPath).toString('base64');
const name = path.basename(glbPath, '.glb');

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 620 });

const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e)));

// Served from the dev server so the three.js import map resolves.
await page.goto('http://localhost:5174', { waitUntil: 'domcontentloaded', timeout: 60000 });

const result = await page.evaluate(async (payload) => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { GLTFLoader } = await import(
    '/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
  );

  const bin = Uint8Array.from(atob(payload.b64), (c) => c.charCodeAt(0));
  const gltf = await new Promise((res, rej) => {
    new GLTFLoader().parse(bin.buffer, '', res, rej);
  });
  const model = gltf.scene;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(900, 620, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb9c3cc);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x5a5348, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
  sun.position.set(6, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  // Fit the shadow frustum to the MODEL, not a fixed +-6 m box. A 13.6 m
  // helicopter fell outside the hard-coded frustum and rendered with its
  // tail shadow sliced off square.
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x8d8a7e, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z);

  // Now that the model's extent is known, size the shadow frustum to it.
  const shadowHalf = radius * 0.8;
  sc.left = -shadowHalf; sc.right = shadowHalf;
  sc.top = shadowHalf; sc.bottom = -shadowHalf;
  sc.far = radius * 6 + 20;
  sun.position.copy(centre).add(
    new THREE.Vector3(radius * 0.6, radius * 1.1, radius * 0.5),
  );
  sun.target.position.copy(centre);
  scene.add(sun.target);
  sc.updateProjectionMatrix();

  const cam = new THREE.PerspectiveCamera(38, 900 / 620, 0.1, 200);
  const shots = {};
  // VIEW LABELS ARE DIRECTIONS THE CAMERA SITS IN, and the model faces -Z.
  //
  // The first version of this table had them backwards: `side: [0,0,1]` puts
  // the camera behind the vehicle, so the file called "side" showed the rear
  // and "rear34" showed the front. Reviewing a model against reference is
  // worthless if the filenames lie about what you are looking at, so these
  // are now derived from the -Z forward convention explicitly.
  const views = {
    // Camera on +X, looking across the flank.
    side: [1, 0.18, 0],
    // Camera ahead of the nose, i.e. on -Z.
    front: [0, 0.16, -1],
    // Camera behind the tail, on +Z.
    rear: [0, 0.18, 1],
    // Front three-quarter: ahead and to the right.
    front34: [0.85, 0.32, -0.85],
    // Rear three-quarter: behind and to the right.
    rear34: [0.85, 0.30, 0.85],
    top: [0.01, 1, 0.01],
  };
  for (const [label, dir] of Object.entries(views)) {
    const d = new THREE.Vector3(...dir).normalize();
    cam.position.copy(centre).addScaledVector(d, radius * 1.85);
    cam.lookAt(centre);
    renderer.render(scene, cam);
    shots[label] = renderer.domElement.toDataURL('image/png');
  }

  let tris = 0; let meshes = 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    const i = o.geometry.getIndex();
    tris += i ? i.count / 3 : o.geometry.getAttribute('position').count / 3;
  });
  renderer.dispose();
  return {
    shots,
    info: {
      tris, meshes,
      size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
      minY: +box.min.y.toFixed(3),
    },
  };
}, { b64 });

for (const [label, dataUrl] of Object.entries(result.shots)) {
  const file = path.join(outDir, `${name}-${label}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
console.log(JSON.stringify(result.info));
console.log('shots ->', outDir);
const errs = logs.filter((l) => l.includes('PAGEERROR') || l.includes('Error'));
if (errs.length) console.log('LOGS:', errs.slice(0, 3).join(' | '));
await browser.close();
