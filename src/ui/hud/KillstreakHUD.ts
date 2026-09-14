/**
 * KillstreakHUD.ts — Document H §3.
 *
 * Three slots showing locked / ready / active / cooling, driven entirely by
 * KillstreakManager.snapshot(). No per-streak special-casing lives here: a
 * fourth killstreak appears automatically because the HUD renders whatever
 * the manager reports.
 */
import { div } from '../dom';
import type { KillstreakManager, SlotSnapshot } from '../../killstreaks/KillstreakManager';

interface SlotElements {
  root: HTMLDivElement;
  label: HTMLDivElement;
  status: HTMLDivElement;
  fill: HTMLDivElement;
  key: HTMLDivElement;
}

const SLOT_KEYS = ['Z', 'X', 'B'];

export class KillstreakHUD {
  readonly element = div('hud__killstreaks');
  private readonly slots: SlotElements[] = [];

  constructor(private readonly manager: KillstreakManager) {
    for (let i = 0; i < 3; i += 1) {
      const root = div('ks-slot');
      const key = div('ks-slot__key', SLOT_KEYS[i]);
      const label = div('ks-slot__label', '—');
      const status = div('ks-slot__status', '');
      const bar = div('ks-slot__bar');
      const fill = div('ks-slot__fill');
      bar.appendChild(fill);
      root.append(key, label, status, bar);
      this.element.appendChild(root);
      this.slots.push({ root, label, status, fill, key });
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
      el.label.textContent = data.iconLabel;

      el.root.classList.remove(
        'ks-slot--ready', 'ks-slot--active', 'ks-slot--cooling', 'ks-slot--locked',
      );
      el.root.classList.add(`ks-slot--${data.state}`);

      switch (data.state) {
        case 'ready':
          el.status.textContent = 'READY';
          el.fill.style.transform = 'scaleX(1)';
          break;
        case 'active':
          el.status.textContent = `${Math.ceil(data.remaining)}s`;
          el.fill.style.transform =
            `scaleX(${(data.remaining / data.totalForBar).toFixed(3)})`;
          break;
        case 'cooling':
          el.status.textContent = `${Math.ceil(data.remaining)}s`;
          // Cooling fills UP as it recharges, the inverse of an active drain.
          el.fill.style.transform =
            `scaleX(${(1 - data.remaining / data.totalForBar).toFixed(3)})`;
          break;
        default:
          el.status.textContent = `${data.progress}/${data.required}`;
          el.fill.style.transform =
            `scaleX(${(data.progress / Math.max(1, data.required)).toFixed(3)})`;
          break;
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
