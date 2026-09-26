/**
 * CalloutZoneRegistry.ts — Document N §7: named map regions.
 *
 * A callout zone is a designer-authored 2D polygon with a name ("Mid",
 * "Tower", "A Long"). Today it drives minimap labelling and HUD position
 * readout; it exists in this shape because it is also the seam a future AI
 * document's patrol/behaviour logic will query ("what named zone is this
 * entity standing in") without needing to invent its own spatial-region
 * system, and the seam is cheaper to add now than to retrofit.
 *
 * Deliberately geometry-only: no rendering, no game state, no events beyond a
 * change notification. Zones come from level data (a JSON file referenced by
 * the level definition), never from code.
 *
 * Lookup is first-match by registration order, so where two zones legitimately
 * abut (a doorway between "Alley" and "Tin Building") the authored order is
 * the tie-break — stable and inspectable, rather than whichever polygon the
 * iteration happened to reach first.
 */

export interface CalloutZone {
  readonly name: string;
  /** Closed polygon, world XZ, in order. */
  readonly polygon: readonly (readonly [number, number])[];
  /** Cached centroid — label anchors and distance queries. */
  readonly centroid: readonly [number, number];
  /** Cached AABB — the cheap rejection test before the ray cast. */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function polygonBounds(polygon: readonly (readonly [number, number])[]) {
  let minX = Infinity; let maxX = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (const [x, z] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** Area-weighted centroid; falls back to the vertex mean for degenerate rings. */
export function polygonCentroid(
  polygon: readonly (readonly [number, number])[],
): [number, number] {
  let area = 0; let cx = 0; let cz = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const cross = polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    area += cross;
    cx += (polygon[j][0] + polygon[i][0]) * cross;
    cz += (polygon[j][1] + polygon[i][1]) * cross;
  }
  if (Math.abs(area) < 1e-6) {
    const n = polygon.length || 1;
    return [
      polygon.reduce((s, p) => s + p[0], 0) / n,
      polygon.reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  area *= 0.5;
  return [cx / (6 * area), cz / (6 * area)];
}

/** Standard ray-casting point-in-polygon test. */
export function pointInPolygon(
  x: number, z: number, polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export class CalloutZoneRegistry {
  private readonly zonesInternal: CalloutZone[] = [];
  /** Last resolved zone name, so consumers can detect transitions cheaply. */
  private lastZone: string | null = null;

  get zones(): readonly CalloutZone[] { return this.zonesInternal; }

  get count(): number { return this.zonesInternal.length; }

  register(name: string, polygon: readonly (readonly [number, number])[]): void {
    if (polygon.length < 3) {
      console.warn(`CalloutZoneRegistry: '${name}' has ${polygon.length} points — skipped`);
      return;
    }
    this.zonesInternal.push({
      name,
      polygon,
      centroid: polygonCentroid(polygon),
      bounds: polygonBounds(polygon),
    });
  }

  /** Replace every zone (level swap). */
  loadZones(data: readonly { name: string; polygon: [number, number][] }[]): void {
    this.clear();
    for (const zone of data) this.register(zone.name, zone.polygon);
  }

  clear(): void {
    this.zonesInternal.length = 0;
    this.lastZone = null;
  }

  /**
   * THE core query: which named zone contains this world position?
   * Returns null outside every zone (out of bounds, or an unnamed gap).
   */
  getZoneAt(worldX: number, worldZ: number): string | null {
    for (const zone of this.zonesInternal) {
      const b = zone.bounds;
      if (worldX < b.minX || worldX > b.maxX || worldZ < b.minZ || worldZ > b.maxZ) continue;
      if (pointInPolygon(worldX, worldZ, zone.polygon)) return zone.name;
    }
    return null;
  }

  /**
   * Nearest zone by centroid — used when a position falls in an unnamed gap
   * (a wall cavity, the lip of a roof) so a callout consumer always has
   * something to say rather than going blank mid-match.
   */
  getNearestZone(worldX: number, worldZ: number): string | null {
    const exact = this.getZoneAt(worldX, worldZ);
    if (exact) return exact;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const zone of this.zonesInternal) {
      const d = (zone.centroid[0] - worldX) ** 2 + (zone.centroid[1] - worldZ) ** 2;
      if (d < bestDist) { bestDist = d; best = zone.name; }
    }
    return best;
  }

  /**
   * Resolve a position and report whether the zone CHANGED since the last
   * call — the shape a HUD readout or a future "entering B Site" radio
   * callout wants, without every consumer keeping its own previous value.
   */
  resolveWithChange(worldX: number, worldZ: number): { zone: string | null; changed: boolean } {
    const zone = this.getZoneAt(worldX, worldZ);
    const changed = zone !== this.lastZone;
    this.lastZone = zone;
    return { zone, changed };
  }
}

/** Project-wide singleton — one registry, every consumer reads the same zones. */
export const calloutZoneRegistry = new CalloutZoneRegistry();
export default calloutZoneRegistry;
