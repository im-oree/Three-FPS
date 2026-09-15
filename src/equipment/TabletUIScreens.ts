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
import type { TabletMapView } from './TabletLiveMap';
// The tablet's map uses the same radar vocabulary as the HUD minimap: one
// contact colour table, one player marker, one designator glyph (Document
// I §2.5 — "the same radar feed, bigger"). What sits UNDER the overlay is
// the live whole-map world capture (TabletLiveMap) — one capture system
// serves every radar surface in the project.
import {
  RADAR_CONTACT_COLORS, drawPlayerTriangle, drawRadarDesignator,
  projectToRadar,
} from '../ui/radarMapDraw';

export const TabletScreen = {
  BOOT: 'boot',
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
  /** Whole-map world-fit view (same math as the live capture camera). */
  mapView: TabletMapView | null;
  /** True while the device is rolled into its wide-face map pose. */
  landscape: boolean;
  contacts: RadarContact[];
  /** True when the cursor is over valid ground. */
  cursorValid: boolean;
  time: number;
  /** Seconds since the tablet raised — drives the boot intro every open. */
  bootElapsed: number;
  /** Seconds since the map screen appeared — drives the map reveal sweep. */
  mapAge: number;
}

/** Icon glyphs, pre-decoded by the owner. */
export type IconImages = Record<string, CanvasImageSource | undefined>;

export function drawTabletScreen(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  snap: TabletSnapshot, icons: IconImages,
): void {
  ctx.clearRect(0, 0, w, h);

  // Every raise begins with the sci-fi/military boot introduction: field-
  // relay OS spin-up — log checks cascading, progress bar, sweep. Portrait
  // layout (the device only rolls to landscape once the map transitions in).
  if (snap.screen === TabletScreen.BOOT) {
    drawBoot(ctx, w, h, snap);
    return;
  }

  if (snap.screen === TabletScreen.MAP && snap.landscape) {
    // The device is physically rolled 90°: the overlay canvas is still a
    // portrait raster glued to the plane, so draw the landscape layout by
    // rotating the drawing context. Translations: rotate +90° about the
    // centre, then the logical (h × w) frame maps onto the raster.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-h / 2, -w / 2);
    drawMapLayout(ctx, h, w, snap);
    ctx.restore();
    return;
  }

  if (snap.screen === TabletScreen.MAP) {
    drawMapLayout(ctx, w, h, snap);
    return;
  }

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  drawScanlines(ctx, w, h);
  drawHeader(ctx, w, snap);

  switch (snap.screen) {
    case TabletScreen.SELECT: drawSelect(ctx, w, h, snap, icons); break;
    case TabletScreen.CONFIRM: drawConfirm(ctx, w, h, snap, icons); break;
    default: drawActivating(ctx, w, h, snap); break;
  }
}

/**
 * Transparent-background chrome that sits over the LIVE whole-map capture
 * rendered onto the base screen layer (TabletLiveMap): header, footer hint,
 * grid, contacts, player marker, designation cursor. NO background fill —
 * the live image is the background.
 */
function drawMapLayout(
  ctx: CanvasRenderingContext2D, w: number, h: number, snap: TabletSnapshot,
): void {
  drawMapHeader(ctx, w, h, snap);
  drawMap(ctx, w, h, snap);
  // Boot → map transition: the curtain reveal rides on top of everything
  // for the first half-second of the map's life (snapshot.mapAge).
  drawMapReveal(ctx, w, h, snap.mapAge);
}

function drawMapHeader(
  ctx: CanvasRenderingContext2D, w: number, h: number, snap: TabletSnapshot,
): void {
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('TACNET', 10, 16);
  ctx.textAlign = 'center';
  ctx.fillStyle = snap.cursorValid ? COLORS.accentDim : COLORS.danger;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText(
    snap.cursorValid ? 'MOVE MOUSE TO AIM      CLICK TO LAUNCH' : 'NO VALID GROUND',
    w / 2, h - 12,
  );
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
 * Designation overlay over the LIVE whole-map capture. The base screen layer
 * carries the world image; this function draws only the tactical chrome on
 * top, in the SAME projection the capture camera used (computeTabletView via
 * KillstreakTablet's snapshot.mapView), so the cursor lands pixel-exact on
 * the world feature the player aimed at.
 *
 * The projection is derived from mapView: world-space view half-extents vs
 * the logical screen size give one uniform pixel-per-metre scale (the view
 * was aspect-fitted, so both axes agree by construction). Any RadarProjection
 * whose cx/cy place the VIEW CENTRE (not the player) at screen centre lets
 * the shared radar helpers (projectToRadar / designer / player triangle)
 * produce the same result with zero duplicated math.
 */
function drawMap(
  ctx: CanvasRenderingContext2D, w: number, h: number, snap: TabletSnapshot,
): void {
  const view = snap.mapView;
  if (!view) return;

  const pxPerMetre = w / (view.halfWidth * 2);
  // Synthetic shared projection: the helper maps (world - player) * scale
  // against cx/cy; choose cx/cy so world-view-centre lands at screen centre.
  const radar = {
    cx: w / 2 - (view.centerX - snap.playerX) * pxPerMetre,
    cy: h / 2 - (view.centerZ - snap.playerZ) * pxPerMetre,
    scale: pxPerMetre,
    clipPx: Number.MAX_SAFE_INTEGER,
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  // Field tint — light scrim so grid/cursor stay legible over bright terrain.
  ctx.fillStyle = 'rgba(4, 12, 8, 0.30)';
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(92,255,176,0.13)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i += 1) {
    const p = (w / 8) * i;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
    const q = (h / 8) * i;
    ctx.beginPath(); ctx.moveTo(0, q); ctx.lineTo(w, q); ctx.stroke();
  }

  // Contacts through the SHARED colour table — every consumer (HUD minimap,
  // tablet map) paints the same dot at the same spot for the same world point.
  for (const c of snap.contacts) {
    const pt = projectToRadar(radar, c.x, c.z, snap.playerX, snap.playerZ);
    if (pt.x < 0 || pt.x > w || pt.y < 0 || pt.y > h) continue;
    ctx.fillStyle = RADAR_CONTACT_COLORS[c.type] ?? COLORS.contact;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player marker — same triangle as the minimap, drawn where the player
  // actually IS on the whole map (not pinned to the centre).
  const playerPx = projectToRadar(radar, snap.playerX, snap.playerZ, snap.playerX, snap.playerZ);
  drawPlayerTriangle(ctx, playerPx.x, playerPx.y, snap.playerYaw, 7, COLORS.text);

  // Designation cursor — the shared designator glyph.
  drawRadarDesignator(
    ctx, radar, snap.cursorX, snap.cursorZ, snap.playerX, snap.playerZ,
    snap.time, snap.cursorValid,
  );

  ctx.restore();

  // Border
  ctx.strokeStyle = COLORS.accentDim;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  // Range readout — a designation screen tells you how far out the point is.
  const range = Math.hypot(snap.cursorX - snap.playerX, snap.cursorZ - snap.playerZ);
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.accentDim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(`RNG ${Math.round(range)}m`, 8, h - 30);
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

/**
 * Boot intro (user brief: sci-fi military spin-up before the map appears).
 * Cascades staged log lines with the classic OK cadence, a progress bar and
 * an acquisition sweep. Stage timing lives in BOOT_LOG so the cadence always
 * matches KillstreakTablet.BOOT_SECONDS.
 */
const BOOT_LOG: Array<[number, string]> = [
  [0.10, 'INIT FIELD RELAY ...... OK'],
  [0.30, 'SAT UPLINK HSHAKE ..... OK'],
  [0.52, 'GEO LOCK ............. OK'],
  [0.72, 'SECURE CHANNEL ....... OK'],
  [0.90, 'SENSOR GRID SYNC ..... OK'],
];

function drawBoot(
  ctx: CanvasRenderingContext2D, w: number, h: number, snap: TabletSnapshot,
): void {
  const t = snap.bootElapsed;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  // Acquisition brackets in the corners — targeting UI, not a menu.
  ctx.strokeStyle = COLORS.accentDim;
  ctx.lineWidth = 1;
  const m = 8;
  for (const [x, y, sx, sy] of [
    [m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x + sx * 14, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * 14);
    ctx.stroke();
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 15px ui-monospace, monospace';
  ctx.fillText('TACNET // FIELD RELAY', 16, 40);
  ctx.fillStyle = COLORS.accentDim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('OS v4.2  //  SECURE CHANNEL', 16, 62);

  // Log cascade: freshest line bright, completed lines dim. The cursor
  // blinks ahead of the next pending stage.
  ctx.font = '10px ui-monospace, monospace';
  let nextRow = 0;
  BOOT_LOG.forEach(([at, line], i) => {
    if (t >= at) {
      nextRow = i + 1;
      ctx.fillStyle = t < at + 0.18 ? COLORS.text : COLORS.accentDim;
      ctx.fillText(line, 16, 96 + i * 22);
    }
  });
  if (nextRow < BOOT_LOG.length && Math.floor(t * 8) % 2 === 0) {
    ctx.fillStyle = COLORS.accent;
    ctx.fillText('>', 16, 96 + nextRow * 22);
  }

  // Progress bar.
  const progress = Math.min(1, t / 1.05);
  const barW = w - 32;
  ctx.strokeStyle = COLORS.accentDim;
  ctx.strokeRect(16.5, h - 60.5, barW, 10);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(18, h - 58, (barW - 4) * progress, 6);
  ctx.fillStyle = COLORS.accentDim;
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(progress * 100)}%`, w - 16, h - 72);
  ctx.textAlign = 'left';

  // Acquisition sweep — a bright line rolling down the display.
  const sweepY = ((t * 3) % 1) * h;
  const grad = ctx.createLinearGradient(0, sweepY - 26, 0, sweepY + 4);
  grad.addColorStop(0, 'rgba(92,255,176,0)');
  grad.addColorStop(1, 'rgba(92,255,176,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, sweepY - 26, w, 30);
  ctx.fillStyle = 'rgba(92,255,176,0.6)';
  ctx.fillRect(0, sweepY + 4.5, w, 1.5);

  // Static-noise shimmer.
  ctx.fillStyle = 'rgba(92,255,176,0.05)';
  for (let i = 0; i < 26; i++) {
    const px = ((i * 97 + Math.floor(t * 19) * 41) % (w - 8)) + 4;
    const py = ((i * 53 + Math.floor(t * 23) * 29) % (h - 8)) + 4;
    ctx.fillRect(px, py, 2, 2);
  }
}

/**
 * Map transition: boot flows into the map with a reveal (user brief), not a
 * hard cut. Over the first ~0.55 s a black curtain sweeps down, revealing
 * the LIVE capture top-to-bottom behind a scanner line; tactical chrome
 * fades in with it.
 */
function drawMapReveal(
  ctx: CanvasRenderingContext2D, w: number, h: number, age: number,
): void {
  if (age >= 0.56) return;
  const k = Math.min(1, age / 0.55);
  const revealY = (1 - k) * h;
  if (revealY > 0) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, revealY);
  }
  ctx.fillStyle = 'rgba(92,255,176,0.9)';
  ctx.fillRect(0, revealY, w, 2);
  if (k < 0.35) {
    ctx.fillStyle = COLORS.accentDim;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ACQUIRING SAT LINK...', w / 2, revealY + h * 0.28);
  }
}
