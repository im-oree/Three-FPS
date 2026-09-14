/**
 * TabletUIScreens.ts — Document I §2.5 + Document J §5.
 *
 * Four sub-screens drawn with Canvas2D onto the tablet's screen mesh:
 *   SELECT     — three streak tiles, cycle with the wheel
 *   CONFIRM    — hold-to-confirm with a fill ring
 *   MAP        — top-down tactical map with a MOVABLE CURSOR, used to
 *                designate a ground target for the airstrike and missile
 *   ACTIVATING — brief INBOUND flash before the tablet lowers
 *
 * The screens are pure functions of a snapshot: the tablet never owns game
 * state, matching the project's "UIManager is the only state owner" rule
 * extended into an in-world surface.
 */
import type { SlotSnapshot } from '../killstreaks/KillstreakManager';
import type { RadarContact } from '../world/RadarContactRegistry';

export const TabletScreen = {
  SELECT: 'select',
  CONFIRM: 'confirm',
  MAP: 'map',
  ACTIVATING: 'activating',
} as const;
export type TabletScreenValue = (typeof TabletScreen)[keyof typeof TabletScreen];

const COLORS = {
  bg: '#0c1210',
  grid: 'rgba(92,255,176,0.09)',
  accent: '#5CFFB0',
  accentDim: 'rgba(92,255,176,0.35)',
  locked: '#3a4440',
  text: '#d8ffe9',
  danger: '#ff5c5c',
  contact: '#ff6a55',
};

export interface TabletSnapshot {
  screen: TabletScreenValue;
  slots: SlotSnapshot[];
  selectedIndex: number;
  confirmProgress: number;
  /** Map view. */
  cursorX: number;
  cursorZ: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  mapRadius: number;
  contacts: RadarContact[];
  /** True when the cursor is over valid ground. */
  cursorValid: boolean;
  time: number;
}

/** Icon glyphs, pre-decoded by the owner. */
export type IconImages = Record<string, CanvasImageSource | undefined>;

export function drawTabletScreen(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  snap: TabletSnapshot, icons: IconImages,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  drawScanlines(ctx, w, h);
  drawHeader(ctx, w, snap);

  switch (snap.screen) {
    case TabletScreen.SELECT: drawSelect(ctx, w, h, snap, icons); break;
    case TabletScreen.CONFIRM: drawConfirm(ctx, w, h, snap, icons); break;
    case TabletScreen.MAP: drawMap(ctx, w, h, snap); break;
    default: drawActivating(ctx, w, h, snap); break;
  }
}

function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
}

function drawHeader(ctx: CanvasRenderingContext2D, w: number, snap: TabletSnapshot): void {
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('TACNET', 10, 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.accentDim;
  ctx.font = '10px ui-monospace, monospace';
  const label = snap.screen === TabletScreen.MAP ? 'DESIGNATE' : 'SUPPORT';
  ctx.fillText(label, w - 10, 16);
  ctx.strokeStyle = COLORS.accentDim;
  ctx.beginPath();
  ctx.moveTo(8, 28.5);
  ctx.lineTo(w - 8, 28.5);
  ctx.stroke();
}

function drawSelect(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  snap: TabletSnapshot, icons: IconImages,
): void {
  const tile = 62;
  const gap = 10;
  const startY = 48;

  snap.slots.forEach((slot, i) => {
    const y = startY + i * (tile + gap);
    const selected = i === snap.selectedIndex;
    const ready = slot.state === 'ready';

    // Tile plate
    ctx.fillStyle = ready ? 'rgba(92,255,176,0.10)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(12, y, w - 24, tile);
    if (selected) {
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(12, y, w - 24, tile);
    }

    // Icon, tinted by state via an offscreen composite
    const img = icons[slot.id];
    if (img) {
      ctx.save();
      ctx.globalAlpha = ready ? 1 : slot.state === 'locked' ? 0.3 : 0.65;
      ctx.drawImage(img, 20, y + 7, tile - 14, tile - 14);
      ctx.restore();
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = slot.state === 'locked' ? COLORS.locked : COLORS.text;
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.fillText(slot.displayName.toUpperCase(), 20 + tile, y + 26);

    ctx.font = '11px ui-monospace, monospace';
    if (slot.state === 'locked') {
      ctx.fillStyle = COLORS.locked;
      ctx.fillText(`${slot.progress}/${slot.required} KILLS`, 20 + tile, y + 44);
    } else if (slot.state === 'active') {
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(`ACTIVE ${Math.ceil(slot.remaining)}s`, 20 + tile, y + 44);
    } else if (slot.state === 'cooling') {
      ctx.fillStyle = '#7fa8d0';
      ctx.fillText(`REARM ${Math.ceil(slot.remaining)}s`, 20 + tile, y + 44);
    } else {
      const pulse = 0.55 + 0.45 * Math.sin(snap.time * 4);
      ctx.fillStyle = `rgba(92,255,176,${pulse.toFixed(2)})`;
      ctx.fillText('READY', 20 + tile, y + 44);
    }
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.accentDim;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('WHEEL: CYCLE     FIRE: SELECT', w / 2, h - 12);
}

function drawConfirm(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  snap: TabletSnapshot, icons: IconImages,
): void {
  const slot = snap.slots[snap.selectedIndex];
  if (!slot) return;

  const img = icons[slot.id];
  if (img) ctx.drawImage(img, w / 2 - 32, 52, 64, 64);

  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.fillText(slot.displayName.toUpperCase(), w / 2, 140);

  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = COLORS.accent;
  ctx.fillText('HOLD FIRE TO CONFIRM', w / 2, 164);

  // Fill ring
  const cx = w / 2;
  const cy = 218;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COLORS.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 26, -Math.PI / 2, -Math.PI / 2 + snap.confirmProgress * Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = COLORS.accentDim;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('WHEEL: BACK', w / 2, h - 12);
}

/**
 * Top-down designation map. This is what makes the tablet a real targeting
 * device rather than a menu: the player MOVES A CURSOR over a map of the area
 * instead of point-and-clicking through their gun sight.
 */
function drawMap(
  ctx: CanvasRenderingContext2D, w: number, h: number, snap: TabletSnapshot,
): void {
  const top = 36;
  const size = Math.min(w - 20, h - top - 34);
  const left = (w - size) / 2;
  const cx = left + size / 2;
  const cy = top + size / 2;
  const scale = (size / 2) / snap.mapRadius;

  // Map field
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(left, top, size, size);
  ctx.strokeStyle = COLORS.accentDim;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, size - 1, size - 1);

  // Grid
  ctx.strokeStyle = 'rgba(92,255,176,0.13)';
  for (let i = 1; i < 6; i += 1) {
    const p = left + (size / 6) * i;
    ctx.beginPath(); ctx.moveTo(p, top); ctx.lineTo(p, top + size); ctx.stroke();
    const q = top + (size / 6) * i;
    ctx.beginPath(); ctx.moveTo(left, q); ctx.lineTo(left + size, q); ctx.stroke();
  }

  // Contacts (world +X right, world -Z up: matches the -Z-forward convention)
  for (const c of snap.contacts) {
    const mx = cx + (c.x - snap.playerX) * scale;
    const my = cy + (c.z - snap.playerZ) * scale;
    if (mx < left || mx > left + size || my < top || my > top + size) continue;
    ctx.fillStyle = COLORS.contact;
    ctx.beginPath();
    ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player marker, rotating with facing
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-snap.playerYaw);
  ctx.fillStyle = COLORS.text;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Designation cursor
  const ux = cx + (snap.cursorX - snap.playerX) * scale;
  const uy = cy + (snap.cursorZ - snap.playerZ) * scale;
  const col = snap.cursorValid ? COLORS.accent : COLORS.danger;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  const blink = 0.6 + 0.4 * Math.sin(snap.time * 6);
  ctx.globalAlpha = blink;
  ctx.beginPath();
  ctx.arc(ux, uy, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ux - 14, uy); ctx.lineTo(ux - 4, uy);
  ctx.moveTo(ux + 4, uy); ctx.lineTo(ux + 14, uy);
  ctx.moveTo(ux, uy - 14); ctx.lineTo(ux, uy - 4);
  ctx.moveTo(ux, uy + 4); ctx.lineTo(ux, uy + 14);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Range readout — a designation screen tells you how far out the point is.
  const range = Math.hypot(snap.cursorX - snap.playerX, snap.cursorZ - snap.playerZ);
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.accentDim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(`RNG ${Math.round(range)}m`, left + 4, top + size + 14);

  ctx.textAlign = 'center';
  ctx.fillStyle = snap.cursorValid ? COLORS.accentDim : COLORS.danger;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText(
    snap.cursorValid ? 'MOVE MOUSE TO AIM      CLICK TO LAUNCH' : 'NO VALID GROUND',
    w / 2, h - 12,
  );
}

function drawActivating(
  ctx: CanvasRenderingContext2D, w: number, h: number, snap: TabletSnapshot,
): void {
  const flash = 0.5 + 0.5 * Math.sin(snap.time * 18);
  ctx.fillStyle = `rgba(92,255,176,${(0.12 + flash * 0.22).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 18px ui-monospace, monospace';
  ctx.fillText('INBOUND', w / 2, h / 2);
}
