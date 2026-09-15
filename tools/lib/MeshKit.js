/**
 * MeshKit.js — the low-poly modelling toolkit.
 *
 * WHY THIS EXISTS
 * ---------------
 * The older builders in tools/builders/ model by stacking axis-aligned boxes.
 * That reads as "detailed" in source but is catastrophic in practice:
 *
 *   - A box is 12 triangles and 24 vertices with NO shared verts between
 *     neighbours, so a 60-box vehicle is 720 tris / 1440 verts before a single
 *     interesting shape exists.
 *   - Every box is a separate Mesh => a separate draw call, and the interior
 *     faces where boxes overlap are all rendered and depth-tested for nothing.
 *   - The silhouette is still boxy, which is the one thing that actually
 *     signals "cheap" to a player.
 *
 * Real low-poly art gets its detail from the SILHOUETTE and from shading, not
 * from part count. The techniques in this file are the ones used by hand
 * modellers, expressed as code:
 *
 *   extrude()  — sweep a 2D profile along an axis. One profile of N points
 *                becomes a closed solid of ~4N triangles with every vertex
 *                shared. This is how you get a sloped hood, a hull chine or
 *                a wheel arch for almost nothing.
 *   loft()     — sweep a profile through a series of stations, each with its
 *                own offset/scale. Gives tapering fuselages and boat hulls.
 *   lathe()    — revolve a profile around Y. Wheels, tyres, turret rings.
 *   bevelBox() — a box whose edges are cut. 32 tris instead of 12, but it
 *                catches light on the bevel and instantly stops reading as
 *                programmer-art.
 *
 * All builders return plain BufferGeometry in a known local frame, so the
 * caller can merge them. MERGING IS THE POINT: one vehicle should be a
 * handful of meshes (one per material, plus the moving parts), not sixty.
 *
 * CONVENTIONS (shared with the rest of the project)
 *   - Y up, -Z forward, +X right.
 *   - Units are metres.
 *   - Geometry is returned centred on its own logical origin; the caller
 *     positions it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Core: extrude a closed 2D profile along an axis
// ---------------------------------------------------------------------------

/**
 * Sweep a closed 2D profile along +X, producing a capped solid.
 *
 * @param {Array<[number,number]>} profile  Closed loop in the ZY plane, wound
 *        COUNTER-CLOCKWISE when viewed from +X. Points are [z, y].
 * @param {number} width    Total extent along X.
 * @param {object} [opts]
 * @param {number} [opts.taper=1]     Scale applied to the +X end (1 = prism).
 * @param {[number,number]} [opts.shift=[0,0]]  ZY offset of the +X end,
 *        which is what gives you a slanted or swept solid.
 * @returns {THREE.BufferGeometry} Centred on X, with flat-shaded normals.
 */
export function extrude(profile, width, opts = {}) {
  const { taper = 1, shift = [0, 0] } = opts;
  const n = profile.length;
  const hw = width / 2;

  const positions = [];
  const indices = [];

  // See loft(): normalise winding rather than trusting the caller, because
  // an inverted extrusion is an invisible bug from most viewing angles.
  let area2 = 0;
  for (let i = 0; i < n; i += 1) {
    const [z0, y0] = profile[i];
    const [z1, y1] = profile[(i + 1) % n];
    area2 += z0 * y1 - z1 * y0;
  }
  const ring = area2 > 0 ? profile : profile.slice().reverse();

  // Two rings of vertices: -X face and +X face.
  for (const [z, y] of ring) positions.push(-hw, y, z);
  for (const [z, y] of ring) {
    positions.push(hw, y * taper + shift[1], z * taper + shift[0]);
  }

  // Side wall: one quad per profile edge, vertices shared with the caps.
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const a = i;
    const b = j;
    const c = j + n;
    const d = i + n;
    indices.push(a, c, b, a, d, c);
  }

  // Caps: fan from vertex 0 of each ring. Valid for convex profiles, which
  // is all we author — concave shapes are built as two convex solids.
  for (let i = 1; i < n - 1; i += 1) {
    indices.push(0, i, i + 1);                     // -X cap
    indices.push(n, n + i + 1, n + i);             // +X cap (reverse winding)
  }

  return finish(positions, indices);
}

/**
 * Sweep a profile through a series of stations along -Z (forward).
 *
 * This is the workhorse for anything that changes cross-section along its
 * length: a fuselage that tapers to a nose, a boat hull that narrows to a
 * bow, a tank hull with a sloped glacis.
 *
 * @param {Array<[number,number]>} profile  Closed loop in the XY plane,
 *        wound counter-clockwise viewed from -Z. Points are [x, y].
 * @param {Array<{z:number, scale?:number|[number,number], offset?:[number,number]}>} stations
 *        Ordered cross-sections. `scale` may be uniform or [sx, sy].
 * @param {object} [opts]
 * @param {boolean} [opts.capStart=true]
 * @param {boolean} [opts.capEnd=true]
 * @returns {THREE.BufferGeometry}
 */
export function loft(profile, stations, opts = {}) {
  const { capStart = true, capEnd = true } = opts;
  const n = profile.length;
  const positions = [];
  const indices = [];

  // Normalise the profile's winding instead of trusting the caller.
  //
  // "Counter-clockwise" is ambiguous for a 2D loop that will be swept into
  // 3D: a profile drawn CCW on paper (x right, y up) is CW when viewed down
  // the +Z sweep axis, and getting it backwards silently produces an
  // inside-out solid. That failure is invisible from most angles — you only
  // catch it when the far side of the body vanishes and you see the interior
  // — so detect it here with the shoelace formula and flip when needed.
  let area2 = 0;
  for (let i = 0; i < n; i += 1) {
    const [x0, y0] = profile[i];
    const [x1, y1] = profile[(i + 1) % n];
    area2 += x0 * y1 - x1 * y0;
  }
  // Sweep DIRECTION matters as much as profile winding: stations ordered from
  // +Z to -Z reverse the handedness of every side quad and turn the solid
  // inside out. Authoring a vehicle back-to-front is natural (rear bumper
  // first), so rather than forbid it, detect it and flip the profile to
  // compensate.
  const descending = stations.length > 1
    && stations[stations.length - 1].z < stations[0].z;
  const wantPositive = descending ? area2 < 0 : area2 > 0;
  const ring = wantPositive ? profile : profile.slice().reverse();

  for (const st of stations) {
    const sc = st.scale ?? 1;
    const sx = Array.isArray(sc) ? sc[0] : sc;
    const sy = Array.isArray(sc) ? sc[1] : sc;
    const ox = st.offset ? st.offset[0] : 0;
    const oy = st.offset ? st.offset[1] : 0;
    for (const [x, y] of ring) positions.push(x * sx + ox, y * sy + oy, st.z);
  }

  // Connect consecutive rings.
  for (let s = 0; s < stations.length - 1; s += 1) {
    const base = s * n;
    const next = (s + 1) * n;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      // Profile is CCW viewed from -Z and stations advance along +Z, so the
      // outward face of the side wall is (i -> j -> next). Getting this
      // backwards inverts every side normal, which lights the model from
      // inside out — subtle on a flat-shaded prism, glaring on a hull.
      indices.push(base + i, base + j, next + i);
      indices.push(base + j, next + j, next + i);
    }
  }

  // Cap winding is the mirror of the side walls: the -Z cap's outward normal
  // points along -Z, the +Z cap's along +Z.
  if (capStart) {
    for (let i = 1; i < n - 1; i += 1) indices.push(0, i + 1, i);
  }
  if (capEnd) {
    const base = (stations.length - 1) * n;
    for (let i = 1; i < n - 1; i += 1) indices.push(base, base + i, base + i + 1);
  }

  return finish(positions, indices);
}

/**
 * Revolve a profile around the Y axis.
 *
 * @param {Array<[number,number]>} profile  [radius, y] pairs, ordered along Y.
 *        A radius of 0 at an end closes that end into a point.
 * @param {number} segments  Radial divisions. 8-10 is plenty for a wheel.
 * @param {object} [opts]
 * @param {boolean} [opts.closed=true]  Cap the ends with fans.
 * @returns {THREE.BufferGeometry}
 */
export function lathe(profile, segments, opts = {}) {
  const { closed = true } = opts;
  const positions = [];
  const indices = [];
  const rings = profile.length;

  for (let s = 0; s < segments; s += 1) {
    const a = (s / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (const [r, y] of profile) positions.push(ca * r, y, sa * r);
  }

  for (let s = 0; s < segments; s += 1) {
    const base = s * rings;
    const next = ((s + 1) % segments) * rings;
    for (let i = 0; i < rings - 1; i += 1) {
      indices.push(base + i, base + i + 1, next + i);
      indices.push(base + i + 1, next + i + 1, next + i);
    }
  }

  if (closed) {
    // Cap whichever ends have a non-zero radius.
    const capEnd = (ringIndex, flip) => {
      if (Math.abs(profile[ringIndex][0]) < 1e-6) return; // already a point
      const centre = positions.length / 3;
      positions.push(0, profile[ringIndex][1], 0);
      for (let s = 0; s < segments; s += 1) {
        const a = s * rings + ringIndex;
        const b = ((s + 1) % segments) * rings + ringIndex;
        if (flip) indices.push(centre, a, b);
        else indices.push(centre, b, a);
      }
    };
    capEnd(0, true);
    capEnd(rings - 1, false);
  }

  return finish(positions, indices);
}

/**
 * A box with chamfered edges.
 *
 * Bevels are the cheapest way to make a hard-surface model look deliberate:
 * the narrow chamfer face catches a different amount of light than the two
 * faces it joins, so every edge reads as a highlight instead of a hard seam.
 * 32 triangles versus a box's 12 — a trade worth making on anything the
 * player sees up close.
 *
 * @param {number} w @param {number} h @param {number} d
 * @param {number} [bevel=0.02]  Chamfer size in metres.
 */
export function bevelBox(w, h, d, bevel = 0.02) {
  const b = Math.min(bevel, w / 2.5, h / 2.5, d / 2.5);
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;

  // The chamfered cross-section: a rectangle with its four corners cut.
  // `inset` shrinks the bounding rectangle; the corner chamfer keeps its own
  // constant width b measured from the (already inset) rectangle corner.
  // Adding the inset to the chamfer as well double-counts it and pinches the
  // end caps — that bug cost 35% of the volume.
  const ring = (inset) => {
    const x = hx - inset;
    const y = hy - inset;
    return [
      [-x + b, -y], [x - b, -y],
      [x, -y + b], [x, y - b],
      [x - b, y], [-x + b, y],
      [-x, y - b], [-x, -y + b],
    ];
  };

  // Four stations. The end rings are inset by a CONSTANT b on each axis, not
  // scaled by a ratio: scaling shrinks the profile toward the origin, which
  // on a 1 m box with a 0.1 m bevel cost 36% of the volume and visibly
  // pinched the ends. Building the rings explicitly keeps the bevel the same
  // physical width everywhere, which is what a chamfer actually is.
  const rings = [ring(b), ring(0), ring(0), ring(b)];
  const zs = [-hz, -hz + b, hz - b, hz];

  const n = 8;
  const positions = [];
  const indices = [];
  for (let s2 = 0; s2 < 4; s2 += 1) {
    for (const [x, y] of rings[s2]) positions.push(x, y, zs[s2]);
  }
  for (let s2 = 0; s2 < 3; s2 += 1) {
    const base = s2 * n;
    const next = (s2 + 1) * n;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      indices.push(base + i, base + j, next + i);
      indices.push(base + j, next + j, next + i);
    }
  }
  for (let i = 1; i < n - 1; i += 1) indices.push(0, i + 1, i);
  const last = 3 * n;
  for (let i = 1; i < n - 1; i += 1) indices.push(last, last + i, last + i + 1);

  return finish(positions, indices);
}

/**
 * A rounded slab: a bevelBox that is much wider than it is thick. Used for
 * armour plate, doors, wings and fins, where the silhouette should read as a
 * plate with thickness rather than an infinitely thin quad.
 */
export function plate(w, h, thickness, bevel = 0.015) {
  return bevelBox(w, thickness, h, bevel);
}

/**
 * A tube between two points, as a low-segment prism. For roll bars, exhaust
 * pipes, gun barrels, aerials and railings.
 *
 * @param {[number,number,number]} from
 * @param {[number,number,number]} to
 * @param {number} radius
 * @param {number} [segments=6]
 */
export function tube(from, to, radius, segments = 6) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-6) return new THREE.BufferGeometry();
  dir.normalize();

  const positions = [];
  const indices = [];
  // Any vector not parallel to dir works as the seed for the perpendicular
  // frame; pick the world axis dir is least aligned with to stay stable.
  const seed = Math.abs(dir.y) > 0.9
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(seed, dir).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();

  for (let s = 0; s < segments; s += 1) {
    const ang = (s / segments) * Math.PI * 2;
    const ox = u.x * Math.cos(ang) * radius + v.x * Math.sin(ang) * radius;
    const oy = u.y * Math.cos(ang) * radius + v.y * Math.sin(ang) * radius;
    const oz = u.z * Math.cos(ang) * radius + v.z * Math.sin(ang) * radius;
    positions.push(a.x + ox, a.y + oy, a.z + oz);
    positions.push(b.x + ox, b.y + oy, b.z + oz);
  }
  for (let s = 0; s < segments; s += 1) {
    const i0 = s * 2;
    const i1 = i0 + 1;
    const j0 = ((s + 1) % segments) * 2;
    const j1 = j0 + 1;
    indices.push(i0, j0, i1, i1, j0, j1);
  }
  // Caps.
  const ca = positions.length / 3;
  positions.push(a.x, a.y, a.z);
  const cb = positions.length / 3;
  positions.push(b.x, b.y, b.z);
  for (let s = 0; s < segments; s += 1) {
    const i0 = s * 2;
    const j0 = ((s + 1) % segments) * 2;
    indices.push(ca, j0, i0);
    indices.push(cb, i0 + 1, j0 + 1);
  }
  return finish(positions, indices);
}

// ---------------------------------------------------------------------------
// Assembly helpers
// ---------------------------------------------------------------------------

/** Translate a geometry in place and return it (chainable). */
export function at(geo, x, y, z) {
  geo.translate(x, y, z);
  return geo;
}

/** Rotate a geometry in place (radians, XYZ order) and return it. */
export function rot(geo, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  return geo;
}

/** Uniform or per-axis scale, in place. */
export function scale(geo, sx, sy = sx, sz = sx) {
  geo.scale(sx, sy, sz);
  return geo;
}

/** Mirror across X, flipping winding so normals stay outward. */
export function mirrorX(geo) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  const idx = g.getIndex();
  if (idx) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Merge many geometries into one. THE most important call in this file: it is
 * what turns "40 parts" into "1 draw call".
 *
 * @param {THREE.BufferGeometry[]} geos
 * @returns {THREE.BufferGeometry}
 */
export function merge(geos) {
  const clean = geos.filter((g) => g && g.getAttribute('position'));
  if (clean.length === 0) return new THREE.BufferGeometry();
  if (clean.length === 1) return clean[0];
  // mergeGeometries requires identical attribute sets; ours are all
  // position+normal from finish(), so this is safe.
  const merged = mergeGeometries(clean, false);
  for (const g of clean) g.dispose();
  return merged;
}

/** Count triangles in a geometry (index-aware). */
export function triCount(geo) {
  const idx = geo.getIndex();
  if (idx) return idx.count / 3;
  const pos = geo.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Finalise a raw position/index pair.
 *
 * Normals are computed per-vertex from the shared topology, which gives the
 * faceted-but-smooth look that reads as intentional low-poly rather than
 * flat-shaded blocks. Callers wanting hard edges split the geometry instead.
 */
function finish(positions, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export default {
  extrude, loft, lathe, bevelBox, plate, tube,
  at, rot, scale, mirrorX, merge, triCount,
};
