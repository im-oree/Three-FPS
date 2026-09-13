/**
 * generateHandModel.js — Document A §3.3: builds the rigid low-poly arm rig
 * ONCE and saves real .glb assets. The game only loads these files.
 *
 *   node tools/generateHandModel.js
 *     -> assets/models/characters/arms_standard.glb
 *     -> assets/models/characters/arms_gloved.glb
 */
// Node polyfill: GLTFExporter reads Blobs through FileReader.
class FileReaderShim {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      if (this.onloadend) this.onloadend();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(buf).toString('base64');
      if (this.onloadend) this.onloadend();
    });
  }
}
globalThis.FileReader = globalThis.FileReader ?? FileReaderShim;
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'node:fs';
import { buildArmsRoot, PALETTE } from './builders/HandRigBuilder.js';

function save(root, path) {
  const exporter = new GLTFExporter();
  exporter.parse(root, (gltf) => {
    fs.writeFileSync(path, Buffer.from(gltf));
    console.log(`[generateHandModel] ${path} (${gltf.byteLength ?? gltf.length} bytes)`);
  }, (err) => { console.error(err); process.exit(1); }, { binary: true });
}

const standard = buildArmsRoot({ skinColor: PALETTE.skin, sleeveColor: PALETTE.sleeve });
save(standard.root, 'assets/models/characters/arms_standard.glb');

const gloved = buildArmsRoot({ skinColor: PALETTE.glove, sleeveColor: PALETTE.gloveSleeve });
save(gloved.root, 'assets/models/characters/arms_gloved.glb');
