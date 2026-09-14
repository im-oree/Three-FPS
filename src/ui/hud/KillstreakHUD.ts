/**
 * KillstreakHUD.ts — Document H §3.
 *
 * Three slots showing locked / ready / active / cooling, driven entirely by
 * KillstreakManager.snapshot(). No per-streak special-casing lives here: a
 * fourth killstreak appears automatically because the HUD renders whatever
 * the manager reports.
 */
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import { div } from '../dom';
import { killstreakIcon } from '../IconLibrary';
import type { KillstreakManager, SlotSnapshot } from '../../killstreaks/KillstreakManager';

interface SlotElements {
  root: HTMLDivElement;
  icon: HTMLDivElement;
  label: HTMLDivElement;
  status: HTMLDivElement;
  fill: HTMLDivElement;
  key: HTMLDivElement;
  ring: HTMLDivElement;
  lastIconId: string;
}

const SLOT_KEYS = ['Z', 'X', 'B'];

export class KillstreakHUD {
  readonly element = div('hud__killstreaks');
  private readonly slots: SlotElements[] = [];

  constructor(private readonly manager: KillstreakManager) {
    // IN-MATCH UI ONLY. Like HUDManager, this is a persistent element that
    // gates itself on the PLAYING state — it must never sit on top of the
    // main menu, the loadout screen or a pause overlay.
    eventBus.on('game:stateChanged', (payload) => {
      const current = (payload as { current: string }).current;
      this.element.classList.toggle('hud--active', current === GameState.PLAYING);
    });
    for (let i = 0; i < 3; i += 1) {
      const root = div('ks-slot');
      // Icon plate on the left, text block on the right — the standard
      // killstreak tile layout. A countdown ring sits over the plate while
      // the streak is running.
      const plate = div('ks-slot__plate');
      const icon = div('ks-slot__icon');
      const ring = div('ks-slot__ring');
      plate.append(ring, icon);

      const body = div('ks-slot__body');
      const label = div('ks-slot__label', '—');
      const status = div('ks-slot__status', '');
      const bar = div('ks-slot__bar');
      const fill = div('ks-slot__fill');
      bar.appendChild(fill);
      body.append(label, status, bar);

      const key = div('ks-slot__key', SLOT_KEYS[i]);
      root.append(plate, body, key);
      this.element.appendChild(root);
      this.slots.push({ root, icon, label, status, fill, key, ring, lastIconId: '' });
    }
  }

  update(): void {
    const snapshot = this.manager.snapshot();
    for (let i = 0; i < this.slots.length; i += 1) {
      const el = this.slots[i];
      const data: SlotSnapshot | undefined = snapshot[i];
      if (!data) {
        el.root.style.display = 'none';
        continue;
      }
      el.root.style.display = '';
      el.label.textContent = data.displayName.toUpperCase();

      // Swap the glyph only when the equipped streak actually changes.
      if (el.lastIconId !== data.id) {
        el.lastIconId = data.id;
        const path = killstreakIcon(data.id);
        el.icon.style.webkitMaskImage = path ? `url(${path})` : '';
        el.icon.style.maskImage = path ? `url(${path})` : '';
      }

      el.root.classList.remove(
        'ks-slot--ready', 'ks-slot--active', 'ks-slot--cooling', 'ks-slot--locked',
      );
      el.root.classList.add(`ks-slot--${data.state}`);

      switch (data.state) {
        case 'ready':
          el.status.textContent = 'READY';
          el.fill.style.transform = 'scaleX(1)';
          el.ring.style.background = 'none';
          break;
        case 'active': {
          el.status.textContent = `${Math.ceil(data.remaining)}s`;
          const frac = data.remaining / data.totalForBar;
          el.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
          // Conic countdown ring around the icon plate — the readable
          // "time left" cue a flat bar alone does not give.
          el.ring.style.background =
            `conic-gradient(var(--ui-good) ${(frac * 360).toFixed(1)}deg,`
            + ' rgba(255,255,255,0.10) 0deg)';
          break;
        }
        case 'cooling': {
          el.status.textContent = `${Math.ceil(data.remaining)}s`;
          // Cooling fills UP as it recharges, the inverse of an active drain.
          const frac = 1 - data.remaining / data.totalForBar;
          el.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
          el.ring.style.background =
            `conic-gradient(#6d8fb8 ${(frac * 360).toFixed(1)}deg,`
            + ' rgba(255,255,255,0.10) 0deg)';
          break;
        }
        default: {
          el.status.textContent = `${data.progress}/${data.required}`;
          const frac = data.progress / Math.max(1, data.required);
          el.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
          el.ring.style.background = 'none';
          break;
        }
      }
    }
  }

  /** Test seam. */
  get slotStates(): string[] {
    return this.slots.map((s) => {
      for (const cls of ['ready', 'active', 'cooling', 'locked']) {
        if (s.root.classList.contains(`ks-slot--${cls}`)) return cls;
      }
      return 'unknown';
    });
  }
}

export default KillstreakHUD;
