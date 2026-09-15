/**
 * MapShellBuilder.js — Document L §2: shared, reusable toolkit for building
 * a map's SHELL (ground / perimeter / boundary collision / background
 * dressing) as procedural primitives → real .glb. Imported by per-map
 * generator scripts (e.g. tools/generateShipmentShell.js). Not map-specific:
 * a future map composes these same functions with different parameters.
 *
 * Convention: collision-only nodes carry the `COL_` name prefix and use an
 * invisible material; LevelLoader discovers them with the `^COL_` name
 * pattern and registers them as static colliders, never as visuals.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------- Shared shell material palette (distinct from props) ------
export const ShellMaterials = {
  asphalt: new THREE.MeshStandardMaterial({
    color: 0x3c3f41, roughness: 0.96, metalness: 0.02, flatShading: true,
  }),
  asphaltSeam: new THREE.MeshStandardMaterial({
    color: 0x2f3234, roughness: 0.96, metalness: 0.02, flatShading: true,
  }),
  concreteWall: new THREE.MeshStandardMaterial({
    color: 0x7b7d7f, roughness: 0.93, metalness: 0.04, flatShading: true,
  }),
  concreteWallDark: new THREE.MeshStandardMaterial({
    color: 0x58595c, roughness: 0.93, metalness: 0.04, flatShading: true,
  }),
  rebarMetal: new THREE.MeshStandardMaterial({
    color: 0x2a2c2e, roughness: 0.6, metalness: 0.6, flatShading: true,
  }),
  distantSilhouette: new THREE.MeshStandardMaterial({
    color: 0x23262b, roughness: 1, metalness: 0, flatShading: true,
  }),
  distantContainerA: new THREE.MeshStandardMaterial({
    color: 0x3a2b28, roughness: 1, metalness: 0, flatShading: true,
  }),
  distantContainerB: new THREE.MeshStandardMaterial({
    color: 0x21313a, roughness: 1, metalness: 0, flatShading: true,
  }),
  fenceChainlink: new THREE.MeshStandardMaterial({
    color: 0x9aa2a6, roughness: 0.5, metalness: 0.4, flatShading: true,
    transparent: true, opacity: 0.42, side: THREE.DoubleSide,
  }),
  invisible: new THREE.MeshBasicMaterial({ visible: false }),
};

function _seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Ground plane. The VISUAL keeps a subtle vertex jitter so it doesn't read
 * as one sterile quad; COLLISION is a separate, perfectly flat, invisible
 * plane (`COL_GroundPlane`) — visual/collision split per Document 4's policy.
 * Optionally lays asphalt seam strips (expansion joints) for scale cues.
 */
export function buildGroundPlane({
  width, depth, segments = 24,
  surfaceMaterial = ShellMaterials.asphalt, jitterAmount = 0.03, seed = 7,
}) {
  const group = new THREE.Group();
  group.name = 'Ground';

  const visualGeo = new THREE.PlaneGeometry(width, depth, segments, segments);
  visualGeo.rotateX(-Math.PI / 2);
  const pos = visualGeo.attributes.position;
  const rng = _seededRandom(seed);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i), z = pos.getZ(i);
    const edgeDist = Math.min(width / 2 - Math.abs(x), depth / 2 - Math.abs(z));
    if (edgeDist < 1.0) continue;                 // seat flush against walls
    pos.setY(i, (rng() - 0.5) * jitterAmount);
  }
  visualGeo.computeVertexNormals();
  const mesh = new THREE.Mesh(visualGeo, surfaceMaterial);
  mesh.name = 'Ground_Visual';
  mesh.receiveShadow = true;
  group.add(mesh);

  // Expansion seams: thin darker strips across the ground — the concrete-pad
  // scale cue visible in every dockyard reference.
  const seamCount = Math.floor(width / 8);
  for (let i = 1; i < seamCount; i += 1) {
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.008, depth * 0.98), ShellMaterials.asphaltSeam,
    );
    seam.position.set(-width / 2 + (width / seamCount) * i, 0.004, 0);
    group.add(seam);
  }
  const jSeamCount = Math.floor(depth / 8);
  for (let j = 1; j < jSeamCount; j += 1) {
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.98, 0.008, 0.06), ShellMaterials.asphaltSeam,
    );
    seam.position.set(0, 0.004, -depth / 2 + (depth / jSeamCount) * j);
    group.add(seam);
  }

  const collisionMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth, 1, 1).rotateX(-Math.PI / 2),
    ShellMaterials.invisible,
  );
  collisionMesh.name = 'COL_GroundPlane';
  return { group, collisionMesh };
}

/**
 * ONE straight perimeter wall segment: low concrete base + chainlink fence
 * topper (the classic COD dockyard silhouette) with wear/rebar detail, and a
 * single collision box spanning the full visual height.
 */
export function buildPerimeterWallSegment({
  length, wallHeight = 1.35, fenceHeight = 1.75, thickness = 0.35,
}) {
  const group = new THREE.Group();
  group.name = 'PerimeterWallSegment';

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(length, wallHeight, thickness), ShellMaterials.concreteWall,
  );
  base.position.y = wallHeight / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const wear = new THREE.Mesh(
    new THREE.BoxGeometry(length * 0.92, 0.12, thickness * 1.04),
    ShellMaterials.concreteWallDark,
  );
  wear.position.y = wallHeight * 0.34;
  group.add(wear);

  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, fenceHeight, 6);
  const postCount = Math.max(2, Math.round(length / 2.4) + 1);
  for (let i = 0; i < postCount; i += 1) {
    const post = new THREE.Mesh(postGeo, ShellMaterials.rebarMetal);
    post.position.set(
      -length / 2 + (length / (postCount - 1)) * i,
      wallHeight + fenceHeight / 2, 0,
    );
    group.add(post);
  }
  const fence = new THREE.Mesh(
    new THREE.PlaneGeometry(length, fenceHeight), ShellMaterials.fenceChainlink,
  );
  fence.position.y = wallHeight + fenceHeight / 2;
  group.add(fence);
  // Diagonal wire scores, cheap chainlink read from mid distance.
  const scoreGeo = new THREE.PlaneGeometry(length, 0.018);
  for (let k = 0; k < 4; k += 1) {
    const score = new THREE.Mesh(scoreGeo, ShellMaterials.rebarMetal);
    score.position.set(0, wallHeight + 0.3 + k * 0.42, 0.006);
    score.rotation.y = 0;
    group.add(score);
  }
  const topRail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.024, length, 6), ShellMaterials.rebarMetal,
  );
  topRail.rotation.z = Math.PI / 2;
  topRail.position.y = wallHeight + fenceHeight - 0.03;
  group.add(topRail);

  const totalHeight = wallHeight + fenceHeight;
  const collisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, totalHeight, thickness), ShellMaterials.invisible,
  );
  collisionMesh.position.y = totalHeight / 2;
  return { group, collisionMesh };
}

function _computeSegmentsWithGaps(totalLength, openings) {
  if (!openings.length) return [{ length: totalLength, center: totalLength / 2 }];
  const segments = [];
  let cursor = 0;
  for (const o of [...openings].sort((a, b) => a.startFraction - b.startFraction)) {
    const gapStart = o.startFraction * totalLength;
    const gapEnd = o.endFraction * totalLength;
    if (gapStart > cursor) {
      segments.push({ length: gapStart - cursor, center: cursor + (gapStart - cursor) / 2 });
    }
    cursor = gapEnd;
  }
  if (cursor < totalLength) {
    segments.push({ length: totalLength - cursor, center: cursor + (totalLength - cursor) / 2 });
  }
  return segments.filter((s) => s.length > 0.5);
}

/**
 * Full rectangular perimeter (4 sides) with OPTIONAL lane gaps — the gaps
 * exist for maps that want open entries; a fenced map (Shipment-style) just
 * passes openings: [] for a fully sealed arena.
 */
export function buildRectangularPerimeter({
  width, depth, wallHeight, fenceHeight, thickness, openings = [],
}) {
  const group = new THREE.Group();
  group.name = 'Perimeter';
  const collisionMeshes = [];

  const sides = [
    { side: 'north', length: width, position: [0, 0, -depth / 2], rotationY: 0 },
    { side: 'south', length: width, position: [0, 0, depth / 2], rotationY: 0 },
    { side: 'east', length: depth, position: [width / 2, 0, 0], rotationY: Math.PI / 2 },
    { side: 'west', length: depth, position: [-width / 2, 0, 0], rotationY: Math.PI / 2 },
  ];

  for (const sideDef of sides) {
    const sideOpenings = openings.filter((o) => o.side === sideDef.side);
    for (const seg of _computeSegmentsWithGaps(sideDef.length, sideOpenings)) {
      const { group: wallGroup, collisionMesh } = buildPerimeterWallSegment({
        length: seg.length, wallHeight, fenceHeight, thickness,
      });
      const along = seg.center - sideDef.length / 2;
      const off = new THREE.Vector3(along, 0, 0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), sideDef.rotationY);
      wallGroup.position.set(
        sideDef.position[0] + off.x, sideDef.position[1], sideDef.position[2] + off.z,
      );
      wallGroup.rotation.y = sideDef.rotationY;
      collisionMesh.position.set(wallGroup.position.x, wallGroup.position.y + (wallHeight + fenceHeight) / 2, wallGroup.position.z);
      collisionMesh.rotation.y = sideDef.rotationY;
      collisionMesh.name = `COL_PerimeterWall_${sideDef.side}_${collisionMeshes.length}`;
      group.add(wallGroup);
      collisionMeshes.push(collisionMesh);
    }
  }
  return { group, collisionMeshes };
}

/** Invisible out-of-bounds walls just beyond the visual perimeter. */
export function buildOutOfBoundsBoundary({
  width, depth, margin = 3, height = 20,
}) {
  const meshes = [];
  const ow = width + margin * 2, od = depth + margin * 2;
  const defs = [
    { length: ow, position: [0, height / 2, -od / 2], rotationY: 0 },
    { length: ow, position: [0, height / 2, od / 2], rotationY: 0 },
    { length: od, position: [ow / 2, height / 2, 0], rotationY: Math.PI / 2 },
    { length: od, position: [-ow / 2, height / 2, 0], rotationY: Math.PI / 2 },
  ];
  defs.forEach((d, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(d.length, height, 0.5), ShellMaterials.invisible,
    );
    mesh.position.set(...d.position);
    mesh.rotation.y = d.rotationY;
    mesh.name = `COL_OutOfBounds_${i}`;
    meshes.push(mesh);
  });
  return meshes;
}

/** Kill-plane is metadata, not geometry — a Y threshold LevelLoader checks. */
export function computeKillPlaneY(groundY, depthBelow = 25) {
  return groundY - depthBelow;
}

/**
 * Distant, NON-COLLIDABLE background dressing: silhouette container stacks
 * and gantry-crane silhouettes beyond the out-of-bounds boundary. Reduced
 * detail and flat materials by design — distance + fog hide the seams.
 */
export function buildDistantSkyline({
  innerRadius, count = 26, seed = 1337,
  minHeight = 4, maxHeight = 12, includeCranes = true,
}) {
  const group = new THREE.Group();
  group.name = 'DistantSkyline_NoCollision';
  const rng = _seededRandom(seed);

  // Bucket by material, then merge each bucket into ONE mesh — the whole
  // skyline should cost a handful of draw calls, never one per silhouette.
  const buckets = new Map(); // material -> geometry[]

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const radius = innerRadius + rng() * innerRadius * 0.8;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    let mesh;
    const kind = rng();
    if (kind < 0.4) {
      // Stacked container wall (2-4 high), mixed distant paints.
      const stacks = 2 + Math.floor(rng() * 3);
      const w = 2.4, d = 6 + rng() * 8;
      const stackGroup = new THREE.Group();
      for (let s = 0; s < stacks; s += 1) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(w, 2.55, d),
          rng() > 0.5 ? ShellMaterials.distantContainerA : ShellMaterials.distantContainerB,
        );
        box.position.y = 1.28 + s * 2.56;
        box.rotation.y = (rng() - 0.5) * 0.06;
        stackGroup.add(box);
      }
      mesh = stackGroup;
    } else if (kind < 0.75) {
      const w = 8 + rng() * 14, h = minHeight + rng() * (maxHeight - minHeight);
      const d = 8 + rng() * 14;
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d), ShellMaterials.distantSilhouette,
      );
      mesh.position.y = h / 2;
    } else if (includeCranes) {
      // Gantry crane silhouette: 2 pairs of legs + a long cantilever boom.
      const crane = new THREE.Group();
      const legH = 15 + rng() * 6;
      const legGeo = new THREE.BoxGeometry(0.6, legH, 0.6);
      for (const lx of [-3, 3]) for (const lz of [-2, 2]) {
        const leg = new THREE.Mesh(legGeo, ShellMaterials.distantSilhouette);
        leg.position.set(lx, legH / 2, lz);
        crane.add(leg);
      }
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(7.2, 1.0, 1.4), ShellMaterials.distantSilhouette,
      );
      beam.position.y = legH;
      const boom = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.8, 12 + rng() * 8), ShellMaterials.distantSilhouette,
      );
      boom.position.set(0, legH + 0.9, 6);
      crane.add(beam, boom);
      mesh = crane;
    } else {
      continue;
    }
    mesh.position.x = x;
    mesh.position.z = z;
    mesh.rotation.y = rng() * Math.PI * 2;
    mesh.updateMatrixWorld(true);
    // Re-bucket each concrete submesh by material; meshes bake their world
    // transform into the geometry so the merge is exact.
    mesh.traverse((n) => {
      if (!n.isMesh || !n.geometry) return;
      const geo = (n.geometry.index ? n.geometry.toNonIndexed() : n.geometry.clone())
        .applyMatrix4(n.matrixWorld);
      for (const key of Object.keys(geo.attributes)) {
        if (key !== 'position' && key !== 'normal') geo.deleteAttribute(key);
      }
      if (!buckets.has(n.material)) buckets.set(n.material, []);
      buckets.get(n.material).push(geo);
    });
  }
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;  // visual only: NEVER passed to collision registration
}
