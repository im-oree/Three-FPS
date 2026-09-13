/**
 * glb.mjs — minimal binary glTF 2.0 (GLB) assembler.
 * Accumulates bufferViews/accessors/nodes/meshes/skins/materials/textures/
 * animations and serialises one valid .glb (JSON chunk + BIN chunk).
 * Only what the weapon pipeline needs is implemented — deliberately tiny.
 */
import { writeFileSync } from 'node:fs';

const ALIGN = 4;

export class GLBBuilder {
  constructor() {
    this.json = {
      asset: { version: '2.0', generator: 'OPERATOR tools/generateWeaponModels' },
      scenes: [{ nodes: [] }],
      scene: 0,
      nodes: [],
      meshes: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [{ magFilter: 9729, minFilter: 9986, wrapS: 10497, wrapT: 10497 }],
      skins: [],
      animations: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
    };
    this.chunks = [];
    this.byteLength = 0;
  }

  /** Append bytes; returns bufferView index. */
  addBufferView(bytes, target) {
    const padded = (bytes.byteLength + (ALIGN - 1)) & ~(ALIGN - 1);
    const buffer = Buffer.alloc(padded);
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).copy(buffer);
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.json.bufferViews.push(view);
    this.chunks.push(buffer);
    this.byteLength += padded;
    return this.json.bufferViews.length - 1;
  }

  addAccessor(bytes, componentType, type, count, { min, max, target } = {}) {
    const view = this.addBufferView(bytes, target);
    const accessor = { bufferView: view, componentType, type, count };
    if (min) accessor.min = min;
    if (max) accessor.max = max;
    this.json.accessors.push(accessor);
    return this.json.accessors.length - 1;
  }

  addFloatAccessor(values, type, { min, max, target } = {}) {
    const components = type === 'SCALAR' ? 1 : type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : type === 'VEC4' ? 4 : 16;
    const arr = new Float32Array(values);
    return this.addAccessor(arr, 5126, type, values.length / components, { min, max, target });
  }

  addUByteAccessor(values, type) {
    const components = type === 'VEC4' ? 4 : 1;
    return this.addAccessor(new Uint8Array(values), 5121, type, values.length / components);
  }

  addUShortAccessor(values) {
    return this.addAccessor(new Uint16Array(values), 5123, 'SCALAR', values.length);
  }

  addNode(node) {
    this.json.nodes.push(node);
    return this.json.nodes.length - 1;
  }

  addMaterial(mat) {
    this.json.materials.push(mat);
    return this.json.materials.length - 1;
  }

  addImageURI(uri) {
    this.json.images.push({ uri });
    return this.json.images.length - 1;
  }

  addTexture(imageIndex) {
    this.json.textures.push({ sampler: 0, source: imageIndex });
    return this.json.textures.length - 1;
  }

  addMesh(mesh) {
    this.json.meshes.push(mesh);
    return this.json.meshes.length - 1;
  }

  addSkin(skin) {
    this.json.skins.push(skin);
    return this.json.skins.length - 1;
  }

  addAnimation(anim) {
    this.json.animations.push(anim);
    return this.json.animations.length - 1;
  }

  addSceneRoot(nodeIndex) {
    this.json.scenes[0].nodes.push(nodeIndex);
  }

  write(path) {
    this.json.buffers = [{ byteLength: this.byteLength }];
    const jsonBuffer = Buffer.from(JSON.stringify(this.json), 'utf8');
    const jsonPadded = Buffer.alloc((jsonBuffer.byteLength + 3) & ~3, 0x20);
    jsonBuffer.copy(jsonPadded);
    const bin = Buffer.concat(this.chunks);
    const total = 12 + 8 + jsonPadded.byteLength + 8 + bin.byteLength;
    const header = Buffer.alloc(12);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonPadded.byteLength, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(bin.byteLength, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
    writeFileSync(path, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, bin]));
    return total;
  }
}
