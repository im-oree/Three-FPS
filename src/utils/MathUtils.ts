/**
 * MathUtils.ts — pure numeric helpers, no Three.js dependency.
 * Seeded in Document 1; Document 2 (movement/camera math) extends this file.
 */

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation between `a` and `b` by factor `t` (t=0 -> a, t=1 -> b). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Degrees -> radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Radians -> degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Quadratic ease-out: fast start, smooth stop (t in [0,1] -> [0,1]). */
export function easeOutQuad(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) * (1 - x);
}
