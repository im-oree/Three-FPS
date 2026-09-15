/**
 * radarMapDraw.ts — THE shared radar map renderer.
 *
 * One projection + one draw vocabulary, consumed by every surface that shows
 * the top-down tactical map: the HUD minimap dish (Document I §3.2) and the
 * killstreak tablet's designation screen (Document I §2.5 / Document J §5).
 * Future systems that paint onto radar — shot pings by distance, objective
 * diamonds, friendly dots — register a RadarContact ONCE through
 * RadarContactRegistry and appear identically on every consumer, with zero
 * per-surface code. That is exactly the "add seams, don't duplicate" rule.
 *
 * FIXED-NORTH convention: world -Z is map-up, world +X is map-right — the
 * standard modern-shooter orientation, matching every other consumer in the
 * project (PlayerCamera -Z forward).
 */

/** Contact types -> colour. One table for every radar surface. */
export const RADAR_CONTACT_COLORS: Record<string, string> = {
  hostile: '#e2503f',
  friendly: '#5aa9e6',
  objective: '#e0b53f',
};

export interface RadarProjection {
  /** Canvas pixel coordinate of the map centre. */
  readonly cx: number;
  readonly cy: number;
  /** Pixels per metre. */
  readonly scale: number;
  /** Clip: contacts beyond this pixel radius from centre are omitted. */
  readonly clipPx: number;
}

/**
 * @param centerX/centerY canvas pixel centre of the map
 * @param radiusPx pixel radius of the usable map circle
 * @param radiusMeters world metres from centre to edge
 */
export function makeRadarProjection(
  centerX: number, centerY: number, radiusPx: number, radiusMeters: number,
): RadarProjection {
  return { cx: centerX, cy: centerY, scale: radiusPx / radiusMeters, clipPx: radiusPx };
}

export interface RadarPoint { x: number; y: number; distPx: number; }

/** Project a world (x,z) into map pixels relative to the player. */
export function projectToRadar(
  p: RadarProjection, worldX: number, worldZ: number, playerX: number, playerZ: number,
): RadarPoint {
  const dx = (worldX - playerX) * p.scale;
  const dz = (worldZ - playerZ) * p.scale;
  return { x: p.cx + dx, y: p.cy + dz, distPx: Math.hypot(dx, dz) };
}

export interface RadarContactLike { x: number; z: number; type: string; }

/**
 * Draw one contact dot. Returns false when clipped (outside radar range),
 * so callers can count visible contacts if they care.
 */
export function drawRadarContact(
  ctx: CanvasRenderingContext2D, p: RadarProjection,
  contact: RadarContactLike, playerX: number, playerZ: number, dotPx = 3,
): boolean {
  const pt = projectToRadar(p, contact.x, contact.z, playerX, playerZ);
  if (pt.distPx > p.clipPx) return false;
  ctx.fillStyle = RADAR_CONTACT_COLORS[contact.type] ?? RADAR_CONTACT_COLORS.objective;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, dotPx, 0, Math.PI * 2);
  ctx.fill();
  return true;
}

/**
 * The player's own position/facing marker: a triangle rotated by yaw.
 * Screen-space rotation matches the fixed-north convention — yaw 0 faces
 * -Z, which is straight up on the map.
 */
export function drawPlayerTriangle(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  yawRadians: number, size = 6, color = '#f0f2f5',
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-yawRadians);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.75, size * 0.83);
  ctx.lineTo(0, size * 0.42);
  ctx.lineTo(-size * 0.75, size * 0.83);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * The designation cursor used by the tablet map: a pulsing targeting circle
 * with crosshair ticks. Lives here (not in the tablet screen file) so every
 * radar surface can mark "the designated point" identically.
 */
export function drawRadarDesignator(
  ctx: CanvasRenderingContext2D, p: RadarProjection,
  worldX: number, worldZ: number, playerX: number, playerZ: number,
  timeSeconds: number, valid: boolean,
): void {
  const pt = projectToRadar(p, worldX, worldZ, playerX, playerZ);
  ctx.strokeStyle = valid ? '#5CFFB0' : '#ff5c5c';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(timeSeconds * 6);
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pt.x - 14, pt.y); ctx.lineTo(pt.x - 4, pt.y);
  ctx.moveTo(pt.x + 4, pt.y); ctx.lineTo(pt.x + 14, pt.y);
  ctx.moveTo(pt.x, pt.y - 14); ctx.lineTo(pt.x, pt.y - 4);
  ctx.moveTo(pt.x, pt.y + 4); ctx.lineTo(pt.x, pt.y + 14);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
