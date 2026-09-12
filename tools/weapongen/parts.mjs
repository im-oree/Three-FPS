/**
 * parts.mjs — geometry/skeleton/clip builders for the weapon GLB pipeline.
 * Convention (applied uniformly to all three weapons, per spec §5):
 *   - ONE skinned mesh, rigid per-vertex weights (weight 1.0 to a single bone).
 *   - Shared rig: root -> weapon_root -> {muzzle socket, mag, hand_r, hand_l}.
 *   - `muzzle` is an empty node at the barrel tip (effect socket contract).
 *   - Rest pose is baked into vertex positions; inverse bind matrices cancel
 *     each joint's rest transform so the skinned rest pose == baked geometry.
 */

export class MeshAccumulator {
  constructor() {
    this.byMaterial = new Map();
  }

  /** Axis-aligned box part, rigidly skinned to `joint`. */
  addBox({ cx, cy, cz, sx, sy, sz, joint, material }) {
    let prim = this.byMaterial.get(material);
    if (!prim) {
      prim = { positions: [], normals: [], joints: [], weights: [], indices: [] };
      this.byMaterial.set(material, prim);
    }
    const hx = sx / 2; const hy = sy / 2; const hz = sz / 2;
    const faces = [
      { n: [0, 0, 1], corners: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], corners: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
      { n: [1, 0, 0], corners: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
      { n: [-1, 0, 0], corners: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
      { n: [0, 1, 0], corners: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
      { n: [0, -1, 0], corners: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    ];
    for (const face of faces) {
      const v = prim.positions.length / 3;
      for (const corner of face.corners) {
        prim.positions.push(cx + corner[0], cy + corner[1], cz + corner[2]);
        prim.normals.push(...face.n);
        prim.joints.push(joint, 0, 0, 0);
        prim.weights.push(1, 0, 0, 0);
      }
      prim.indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }
}

/** Column-major 4x4 translation matrix (for inverse bind matrices). */
export function translationMat4(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function identityQuat() {
  return [0, 0, 0, 1];
}

/** Axis-angle -> quaternion (radians). */
export function quatAxis(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

/**
 * Adds one named animation clip from track descriptors:
 * tracks: [{ node, path: 'translation'|'rotation', times: number[], values: number[][] }]
 */
export function addClip(builder, name, tracks) {
  const samplers = [];
  const channels = [];
  for (const track of tracks) {
    const times = new Float32Array(track.times);
    const input = builder.addAccessor(times, 5126, 'SCALAR', track.times.length, {
      min: [Math.min(...track.times)],
      max: [Math.max(...track.times)],
    });
    const flat = track.values.flat();
    const type = track.path === 'rotation' ? 'VEC4' : 'VEC3';
    const output = builder.addFloatAccessor(flat, type);
    samplers.push({ input, output, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: track.node, path: track.path } });
  }
  return builder.addAnimation({ name, channels, samplers });
}
