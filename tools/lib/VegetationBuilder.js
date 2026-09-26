/**
 * VegetationBuilder.js — Document N §5.1: procedural jungle vegetation.
 *
 * The brief called out three.js's TreeGenerator / TerrainGenerator /
 * ForestGenerator examples as the shape of the thing, with the note that ours
 * should be MORE realistic than the sample (whose trees are distorted
 * icospheres). Two problems with using them directly: they live in
 * `examples/jsm/generators`, which does not exist in the pinned three 0.170.0
 * this project builds against, and the ones that do exist are TSL/WebGPU
 * material based while this whole project is WebGL + MeshStandardMaterial.
 *
 * So this module takes TreeGenerator's *technique* and implements it against
 * the project's actual stack:
 *
 *   - a recursive branch skeleton swept as TAPERED TUBES,
 *   - a PARALLEL-TRANSPORT frame along each sweep so tubes never twist,
 *   - the PIPE MODEL for child radii (a child is thinner than its parent by
 *     a fixed ratio, the way real wood divides cross-sectional area),
 *   - GOLDEN-ANGLE roll between siblings so branches spiral instead of
 *     stacking in a plane,
 *   - phototropism (children bend back up toward the light) and gravity
 *     droop, which is what stops procedural trees looking like antennae,
 *   - a flared root, non-linear taper, and everything baked into ONE indexed
 *     BufferGeometry with position + normal only.
 *
 * Deterministic for a given seed, and fluent-builder configured, matching the
 * TreeGenerator API shape the brief described.
 *
 * Firing Range specifically needs coconut palms (the jungle band and the
 * skyline behind the compound) and broadleaf jungle bushes, so two concrete
 * presets are exported on top of the generic generator.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Sweep a tapered tube along a list of {point, radius} samples using a
 * parallel-transport frame. Returns a non-indexed-safe BufferGeometry with
 * position + normal.
 */
function sweepTube(samples, radialSegments = 6, capEnd = false) {
  if (samples.length < 2) return null;

  // --- parallel transport frames -------------------------------------------
  const tangents = [];
  for (let i = 0; i < samples.length; i += 1) {
    const prev = samples[Math.max(0, i - 1)].point;
    const next = samples[Math.min(samples.length - 1, i + 1)].point;
    tangents.push(new THREE.Vector3().subVectors(next, prev).normalize());
  }
  // Seed an arbitrary normal perpendicular to the first tangent...
  const up = Math.abs(tangents[0].y) > 0.95
    ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  let normal = new THREE.Vector3().crossVectors(tangents[0], up).normalize();
  const normals = [normal.clone()];
  // ...then transport it, rotating by the minimal turn between tangents. This
  // is what keeps the tube from spinning about its own axis as it curves.
  for (let i = 1; i < samples.length; i += 1) {
    const t0 = tangents[i - 1];
    const t1 = tangents[i];
    const axis = new THREE.Vector3().crossVectors(t0, t1);
    const len = axis.length();
    if (len > 1e-6) {
      const angle = Math.atan2(len, t0.dot(t1));
      normal = normal.clone().applyAxisAngle(axis.normalize(), angle);
    } else {
      normal = normal.clone();
    }
    // Re-orthogonalise against drift.
    normal.sub(t1.clone().multiplyScalar(normal.dot(t1))).normalize();
    normals.push(normal.clone());
  }

  const positions = [];
  const norms = [];
  const indices = [];
  const binormal = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const vnormal = new THREE.Vector3();

  for (let i = 0; i < samples.length; i += 1) {
    const { point, radius } = samples[i];
    binormal.crossVectors(tangents[i], normals[i]).normalize();
    for (let j = 0; j <= radialSegments; j += 1) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      vnormal.copy(normals[i]).multiplyScalar(cos)
        .add(binormal.clone().multiplyScalar(sin)).normalize();
      vertex.copy(point).add(vnormal.clone().multiplyScalar(radius));
      positions.push(vertex.x, vertex.y, vertex.z);
      norms.push(vnormal.x, vnormal.y, vnormal.z);
    }
  }
  const ring = radialSegments + 1;
  for (let i = 0; i < samples.length - 1; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * ring + j;
      const b = a + ring;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (capEnd) {
    const last = samples[samples.length - 1];
    const baseIndex = positions.length / 3;
    positions.push(last.point.x, last.point.y, last.point.z);
    const t = tangents[tangents.length - 1];
    norms.push(t.x, t.y, t.z);
    const ringStart = (samples.length - 1) * ring;
    for (let j = 0; j < radialSegments; j += 1) {
      indices.push(ringStart + j, baseIndex, ringStart + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * TreeGenerator — fluent, deterministic procedural branch skeleton baked into
 * one indexed BufferGeometry. Produces BRANCHES only; foliage is a separate
 * layer (see buildPalmTree / buildJungleTree below), exactly like the
 * three.js generator this mirrors.
 */
export class TreeGenerator {
  constructor(material = null) {
    this.material = material;
    this.params = {
      seed: 1,
      levels: 4,
      children: 3,
      trunkHeight: 5.0,
      trunkRadius: 0.22,
      radiusFalloff: 0.62,     // pipe model: child radius = parent * this
      lengthFalloff: 0.72,
      curvature: 0.22,         // how much a branch bends along its own length
      spread: 0.72,            // child branch angle away from its parent
      phototropism: 0.32,      // how hard children pull back up toward light
      gravity: 0.12,           // droop applied along the branch
      segmentsPerBranch: 6,
      radialSegments: 6,
      childStart: 0.35,        // children only on the upper part of a branch
      rootFlare: 1.7,
    };
    // Fluent setters for every parameter (setSeed, setLevels, ...).
    for (const key of Object.keys(this.params)) {
      const name = `set${key[0].toUpperCase()}${key.slice(1)}`;
      this[name] = (value) => { this.params[key] = value; return this; };
    }
    /** @type {THREE.Vector3[]} terminal branch ends, filled by build(). */
    this.branchTips = [];
  }

  /** Returns a fresh, independent mesh the caller owns. */
  build() {
    const p = this.params;
    const rng = makeRng(p.seed);
    const parts = [];
    this.branchTips = [];

    const grow = (origin, direction, length, radius, level, rollSeed) => {
      const samples = [];
      const dir = direction.clone().normalize();
      const point = origin.clone();
      const segs = p.segmentsPerBranch;
      // Bend axis, stable per branch.
      const bendAxis = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize();

      for (let i = 0; i <= segs; i += 1) {
        const t = i / segs;
        // Non-linear taper: wood thins fast near the tip, plus a root flare.
        const taper = (1 - t) ** 1.35;
        const flare = level === 0 ? 1 + (p.rootFlare - 1) * (1 - t) ** 6 : 1;
        samples.push({
          point: point.clone(),
          radius: Math.max(0.012, radius * (0.25 + 0.75 * taper) * flare),
        });
        if (i === segs) break;
        // Advance, then curve: bend + gravity droop + phototropism.
        point.add(dir.clone().multiplyScalar(length / segs));
        dir.applyAxisAngle(bendAxis, p.curvature / segs);
        dir.y -= p.gravity / segs;
        dir.y += p.phototropism * 0.25 / segs;
        dir.normalize();
      }
      const tube = sweepTube(samples, Math.max(3, p.radialSegments - level), level >= p.levels - 1);
      if (tube) parts.push(tube);

      if (level + 1 >= p.levels) {
        // Terminal branch: remember where it ended. Leaf clusters are sited
        // on these, so the foliage covers the branches that actually exist
        // instead of an assumed dome the upper limbs poke out of.
        this.branchTips.push(samples[samples.length - 1].point.clone());
        return;
      }

      const childCount = Math.max(1, Math.round(p.children - level * 0.35));
      for (let c = 0; c < childCount; c += 1) {
        // Children spread along the UPPER part of the parent...
        const t = p.childStart + (1 - p.childStart) * ((c + 0.5) / childCount);
        const idx = Math.min(samples.length - 1, Math.round(t * segs));
        const base = samples[idx].point;
        // ...rolled by the golden angle so they spiral, never stack in a plane.
        const roll = rollSeed + c * GOLDEN_ANGLE + rng() * 0.25;
        const parentDir = new THREE.Vector3()
          .subVectors(samples[Math.min(idx + 1, samples.length - 1)].point, base)
          .normalize();
        if (parentDir.lengthSq() < 1e-6) parentDir.set(0, 1, 0);
        // Build a frame around the parent direction and tilt out by `spread`.
        const side = new THREE.Vector3(Math.cos(roll), 0, Math.sin(roll));
        side.sub(parentDir.clone().multiplyScalar(side.dot(parentDir)));
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        const spread = p.spread * (0.75 + rng() * 0.5);
        const childDir = parentDir.clone().multiplyScalar(Math.cos(spread))
          .add(side.multiplyScalar(Math.sin(spread)));
        // Phototropism: pull the child back toward vertical.
        childDir.y += p.phototropism;
        childDir.normalize();

        grow(
          base,
          childDir,
          length * p.lengthFalloff * (0.85 + rng() * 0.3),
          radius * p.radiusFalloff,
          level + 1,
          roll,
        );
      }
    };

    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0),
      p.trunkHeight, p.trunkRadius, 0, rng() * Math.PI * 2);

    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) return new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.name = 'TreeBranches';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * World-space end points of the terminal branches from the last build().
   * Highest-first, so a caller drawing N leaf clusters covers the crown
   * before it fills in the lower limbs.
   */
  getBranchTips() {
    return [...this.branchTips].sort((a, b) => b.y - a.y);
  }
}

// --------------------------------------------------------------- materials --
const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, ...o });

export const FoliageMaterials = {
  palmBark: std({ color: 0x5c4a33, roughness: 0.95, metalness: 0.0 }),
  palmFrond: std({ color: 0x4a6b2e, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide }),
  palmFrondDry: std({ color: 0x6b6330, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide }),
  jungleBark: std({ color: 0x4f4330, roughness: 0.95, metalness: 0.0 }),
  jungleLeaf: std({ color: 0x3d5c28, roughness: 0.90, metalness: 0.0, side: THREE.DoubleSide }),
  bushLeaf: std({ color: 0x3f5c2c, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide }),
  grassBlade: std({ color: 0x6b7038, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide }),
  coconut: std({ color: 0x4a3a24, roughness: 0.90, metalness: 0.0 }),
};

/**
 * One palm frond: a central rachis with leaflets ribbed off both sides,
 * drooping along its length. Built as real geometry (not an alpha-mapped
 * quad) so it holds up at the close range this map is played at.
 */
function buildFrondGeometry({ length = 2.6, leafletCount = 14, droop = 1.15, seed = 1 }) {
  const rng = makeRng(seed);
  const parts = [];

  // Rachis: a tapered tube that arcs downward.
  const rachisSamples = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    rachisSamples.push({
      point: new THREE.Vector3(0, -droop * t * t * 0.55, t * length),
      radius: 0.035 * (1 - t * 0.8) + 0.006,
    });
  }
  const rachis = sweepTube(rachisSamples, 4, true);
  if (rachis) parts.push(rachis);

  // Leaflets: thin tapered blades alternating off each side, angled back.
  for (let i = 1; i <= leafletCount; i += 1) {
    const t = i / (leafletCount + 1);
    const z = t * length;
    const y = -droop * t * t * 0.55;
    // Leaflets are longest mid-frond, short at base and tip.
    const span = Math.sin(t * Math.PI) ** 0.7 * 0.62 + 0.08;
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(span * 0.35, 0.035);
      shape.lineTo(span, 0.004);
      shape.lineTo(span * 0.4, -0.03);
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      // Orient: fan out sideways, sweep back toward the tip, droop down.
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        -0.35 - t * 0.5 - rng() * 0.12,
        side > 0 ? Math.PI / 2 - 0.55 - t * 0.35 : -Math.PI / 2 + 0.55 + t * 0.35,
        side * (0.25 + rng() * 0.1),
        'YXZ',
      ));
      m.compose(new THREE.Vector3(0, y, z), q, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m);
      parts.push(geo);
    }
  }
  const merged = mergeGeometries(parts.map((g) => {
    const clean = g.index ? g.toNonIndexed() : g;
    for (const key of Object.keys(clean.attributes)) {
      if (key !== 'position' && key !== 'normal') clean.deleteAttribute(key);
    }
    if (!clean.attributes.normal) clean.computeVertexNormals();
    return clean;
  }), false);
  merged.computeVertexNormals();
  return merged;
}

/**
 * COCONUT PALM — curved trunk swept as a tapered tube with ring scars, a
 * crown of real fronds, and a coconut cluster. The jungle band and the
 * skyline behind the compound are made of these.
 */
export function buildPalmTree({ seed = 1, height = 7.0, lean = 0.5, frondCount = 11 } = {}) {
  const rng = makeRng(seed);
  const root = new THREE.Group();
  root.name = 'PalmTree';

  // --- trunk: a real curved sweep, thicker at the flared base --------------
  const samples = [];
  const SEGS = 14;
  const bendDir = new THREE.Vector2(Math.cos(rng() * 6.283), Math.sin(rng() * 6.283));
  for (let i = 0; i <= SEGS; i += 1) {
    const t = i / SEGS;
    // Palms lean in an arc that steepens toward the crown.
    const bend = lean * t * t;
    samples.push({
      point: new THREE.Vector3(bendDir.x * bend, t * height, bendDir.y * bend),
      radius: 0.30 * (1 - t) ** 1.25 * 0.55 + 0.085 + (1 - t) ** 8 * 0.16,
    });
  }
  const trunkGeo = sweepTube(samples, 7, false);
  const trunk = new THREE.Mesh(trunkGeo, FoliageMaterials.palmBark);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.name = 'PalmTrunk';
  root.add(trunk);

  // Leaf-scar rings up the trunk — the signature palm texture, as geometry.
  const ringGeos = [];
  for (let i = 2; i < SEGS - 1; i += 1) {
    const t = i / SEGS;
    const s = samples[i];
    const ring = new THREE.TorusGeometry(s.radius * 1.06, 0.018, 3, 7);
    const m = new THREE.Matrix4().compose(
      s.point.clone(),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    ring.applyMatrix4(m);
    ringGeos.push(ring);
    void t;
  }
  if (ringGeos.length) {
    const rings = new THREE.Mesh(mergeGeometries(ringGeos, false), FoliageMaterials.palmBark);
    rings.castShadow = false;
    root.add(rings);
  }

  // --- crown -----------------------------------------------------------------
  const crown = samples[SEGS].point.clone();
  const frondGeos = [];
  const dryGeos = [];
  for (let i = 0; i < frondCount; i += 1) {
    const isDry = i >= frondCount - 2;
    const geo = buildFrondGeometry({
      length: 2.3 + rng() * 0.9,
      leafletCount: 13,
      droop: isDry ? 2.0 : 0.9 + rng() * 0.7,
      seed: seed * 31 + i,
    });
    const yaw = (i / frondCount) * Math.PI * 2 + rng() * 0.2;
    const pitch = isDry ? -0.95 : (0.22 - (i % 3) * 0.3);
    const m = new THREE.Matrix4().compose(
      crown,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    geo.applyMatrix4(m);
    (isDry ? dryGeos : frondGeos).push(geo);
  }
  const fronds = new THREE.Mesh(mergeGeometries(frondGeos, false), FoliageMaterials.palmFrond);
  fronds.name = 'PalmCrown';
  fronds.castShadow = true;
  root.add(fronds);
  if (dryGeos.length) {
    const dry = new THREE.Mesh(mergeGeometries(dryGeos, false), FoliageMaterials.palmFrondDry);
    dry.name = 'PalmCrownDry';
    dry.castShadow = true;
    root.add(dry);
  }

  // Coconut cluster under the crown.
  const nutGeos = [];
  for (let i = 0; i < 5; i += 1) {
    const nut = new THREE.IcosahedronGeometry(0.11, 0);
    nut.translate(
      crown.x + (rng() - 0.5) * 0.4,
      crown.y - 0.18 - rng() * 0.15,
      crown.z + (rng() - 0.5) * 0.4,
    );
    nutGeos.push(nut);
  }
  const nuts = new THREE.Mesh(mergeGeometries(nutGeos, false), FoliageMaterials.coconut);
  nuts.castShadow = true;
  root.add(nuts);

  root.userData.windSwayTargets = ['PalmCrown', 'PalmCrownDry'];
  root.userData.trunkRadius = 0.28;
  root.userData.height = height;
  return root;
}

/**
 * BROADLEAF JUNGLE TREE — TreeGenerator skeleton + clustered leaf canopy.
 * Used for the dense treeline outside the boundary.
 */
export function buildJungleTree({ seed = 2, levels = 4 } = {}) {
  const root = new THREE.Group();
  root.name = 'JungleTree';
  const rng = makeRng(seed * 7717);

  const generator = new TreeGenerator(FoliageMaterials.jungleBark)
    .setSeed(seed)
    .setLevels(levels)
    .setChildren(3)
    .setTrunkHeight(4.2)
    .setTrunkRadius(0.26)
    .setSpread(0.78)
    .setCurvature(0.3)
    .setPhototropism(0.38)
    .setGravity(0.16);
  const branches = generator.build();
  branches.name = 'JungleTrunk';
  root.add(branches);

  // Canopy: overlapping low-poly leaf clusters sited on the ACTUAL branch
  // tips. Placing them on a guessed dome instead leaves the upper branches
  // poking out bare above the foliage — the tree reads as a dead brown
  // skeleton with a bush stuck halfway up it. The generator knows where its
  // branches ended, so ask it.
  const tips = generator.getBranchTips ? generator.getBranchTips() : [];
  const leafGeos = [];
  const clusterCount = 22;
  for (let i = 0; i < clusterCount; i += 1) {
    let cx; let cy; let cz;
    if (tips.length) {
      // Bias towards the highest tips so the crown is densest on top.
      const t = tips[Math.floor(rng() * tips.length)];
      cx = t.x + (rng() - 0.5) * 0.7;
      cy = t.y + (rng() - 0.35) * 0.55;
      cz = t.z + (rng() - 0.5) * 0.7;
    } else {
      const theta = rng() * Math.PI * 2;
      const r = (0.5 + rng() * 0.5) * 2.5;
      cx = Math.cos(theta) * r;
      cy = 4.0 + rng() * 1.9 - (r / 2.5) * 0.9;
      cz = Math.sin(theta) * r;
    }
    const blob = new THREE.IcosahedronGeometry(0.78 + rng() * 0.52, 0);
    // Squash + jitter each blob so the canopy is lumpy, not a ball of spheres.
    blob.scale(1.3, 0.74, 1.3);
    blob.rotateY(rng() * 3.14);
    blob.translate(cx, cy, cz);
    leafGeos.push(blob);
  }
  const canopy = new THREE.Mesh(mergeGeometries(leafGeos, false), FoliageMaterials.jungleLeaf);
  canopy.name = 'JungleCanopy';
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  root.add(canopy);

  root.userData.windSwayTargets = ['JungleCanopy'];
  return root;
}

/** JUNGLE BUSH — a low broadleaf clump; the instanced ground-cover layer. */
export function buildJungleBush({ seed = 3 } = {}) {
  const rng = makeRng(seed * 104729);
  const root = new THREE.Group();
  root.name = 'JungleBush';
  const parts = [];
  // Body clumps.
  for (let i = 0; i < 5; i += 1) {
    const blob = new THREE.IcosahedronGeometry(0.34 + rng() * 0.18, 0);
    blob.scale(1.15, 0.85, 1.15);
    blob.translate((rng() - 0.5) * 0.55, 0.26 + rng() * 0.22, (rng() - 0.5) * 0.55);
    parts.push(blob);
  }
  // Big splayed leaf blades — what makes it read as jungle, not shrubbery.
  for (let i = 0; i < 7; i += 1) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.14, 0.34, 0.03, 0.78);
    shape.quadraticCurveTo(-0.11, 0.35, 0, 0);
    const blade = new THREE.ShapeGeometry(shape);
    const yaw = (i / 7) * Math.PI * 2 + rng() * 0.5;
    const pitch = -0.5 - rng() * 0.6;
    blade.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3((rng() - 0.5) * 0.3, 0.3 + rng() * 0.2, (rng() - 0.5) * 0.3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')),
      new THREE.Vector3(1, 1.25, 1),
    ));
    parts.push(blade);
  }
  const merged = mergeGeometries(parts.map((g) => {
    const clean = g.index ? g.toNonIndexed() : g;
    for (const key of Object.keys(clean.attributes)) {
      if (key !== 'position' && key !== 'normal') clean.deleteAttribute(key);
    }
    if (!clean.attributes.normal) clean.computeVertexNormals();
    return clean;
  }), false);
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, FoliageMaterials.bushLeaf);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  root.userData.windSwayTargets = [];
  return root;
}

/** GRASS TUFT — cheap crossed blades; the densest instanced layer. */
export function buildGrassTuft({ seed = 4 } = {}) {
  const rng = makeRng(seed * 15485863);
  const root = new THREE.Group();
  root.name = 'GrassTuft';
  const parts = [];
  for (let i = 0; i < 6; i += 1) {
    const h = 0.32 + rng() * 0.3;
    const shape = new THREE.Shape();
    shape.moveTo(-0.028, 0);
    shape.lineTo(0.028, 0);
    shape.quadraticCurveTo(0.02, h * 0.6, 0.004, h);
    shape.quadraticCurveTo(-0.014, h * 0.6, -0.028, 0);
    const blade = new THREE.ShapeGeometry(shape);
    blade.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3((rng() - 0.5) * 0.22, 0, (rng() - 0.5) * 0.22),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        (rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.45, 'YXZ',
      )),
      new THREE.Vector3(1, 1, 1),
    ));
    parts.push(blade);
  }
  const merged = mergeGeometries(parts.map((g) => {
    const clean = g.index ? g.toNonIndexed() : g;
    for (const key of Object.keys(clean.attributes)) {
      if (key !== 'position' && key !== 'normal') clean.deleteAttribute(key);
    }
    if (!clean.attributes.normal) clean.computeVertexNormals();
    return clean;
  }), false);
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, FoliageMaterials.grassBlade);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  root.add(mesh);
  return root;
}

export default {
  TreeGenerator, buildPalmTree, buildJungleTree, buildJungleBush, buildGrassTuft,
  FoliageMaterials,
};
