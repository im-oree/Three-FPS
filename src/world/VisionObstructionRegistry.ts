/**
 * VisionObstructionRegistry.ts — Document F §6.1, SEAM ONLY.
 *
 * Smoke volumes register themselves here. Nothing consumes it yet: a future
 * AI document's line-of-sight checks will query blocksLineOfSight() so that
 * enemies genuinely cannot see through smoke.
 *
 * This document's obligation is to create the entries correctly, not to
 * consume them — same "register once, consumed later" pattern as
 * registerHittable() and RadarContactRegistry.
 */

export interface VisionObstruction {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

export class VisionObstructionRegistry {
  private readonly volumes = new Map<string, VisionObstruction>();

  add(id: string, x: number, y: number, z: number, radius: number): void {
    this.volumes.set(id, { id, x, y, z, radius });
  }

  remove(id: string): void {
    this.volumes.delete(id);
  }

  clear(): void {
    this.volumes.clear();
  }

  get size(): number { return this.volumes.size; }

  all(): VisionObstruction[] {
    return [...this.volumes.values()];
  }

  /**
   * Does any registered volume block the segment from -> to?
   *
   * Ray/sphere test by closest approach: if the nearest point on the segment
   * to a volume's centre falls inside its radius, sight is blocked. Ready for
   * an AI document to call; unused today, by design.
   */
  blocksLineOfSight(
    fromX: number, fromY: number, fromZ: number,
    toX: number, toY: number, toZ: number,
  ): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dz = toZ - fromZ;
    const lenSq = dx * dx + dy * dy + dz * dz;
    if (lenSq < 1e-9) return false;

    for (const v of this.volumes.values()) {
      const fx = v.x - fromX;
      const fy = v.y - fromY;
      const fz = v.z - fromZ;
      // Projection parameter of the volume centre onto the segment, clamped
      // so we test the SEGMENT rather than the infinite line.
      let t = (fx * dx + fy * dy + fz * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const cx = fromX + dx * t - v.x;
      const cy = fromY + dy * t - v.y;
      const cz = fromZ + dz * t - v.z;
      if (cx * cx + cy * cy + cz * cz <= v.radius * v.radius) return true;
    }
    return false;
  }
}

export const visionObstructions = new VisionObstructionRegistry();
export default visionObstructions;
