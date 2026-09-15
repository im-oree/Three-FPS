/**
 * EquipmentHUD.ts — Document F §7.
 *
 * Sibling to AmmoCounter: shows the equipped tactical device, its remaining
 * count, its keybind, and a cook-timer bar while the pin is out.
 *
 * ANSWERING "how do I know which grenade I have?": the tile always names the
 * equipped device and shows its key, so the binding is discoverable in-game
 * rather than something you have to remember.
 */
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import { div } from '../dom';
import type { EquipmentManager } from '../../equipment/EquipmentManager';

export class EquipmentHUD {
  readonly element = div('hud__equipment');
  private readonly label = div('eq__label', 'SMOKE');
  private readonly count = div('eq__count', 'x2');
  private readonly key = div('eq__key', 'G');
  private readonly cookBar = div('eq__cook');
  private readonly cookFill = div('eq__cook-fill');

  constructor(private readonly manager: EquipmentManager) {
    this.cookBar.appendChild(this.cookFill);
    const row = div('eq__row');
    row.append(this.label, this.count);
    this.element.append(row, this.key, this.cookBar);

    eventBus.on('game:stateChanged', (payload) => {
      const current = (payload as { current: string }).current;
      this.element.classList.toggle('hud--active', current === GameState.PLAYING);
    });
  }

  /** Bind label, so a rebound key stays truthful on screen. */
  setKeyLabel(label: string): void {
    this.key.textContent = label;
  }

  update(): void {
    const profile = this.manager.tactical;
    this.label.textContent = profile.iconLabel;
    this.count.textContent = `x${this.manager.count}`;
    this.element.classList.toggle('hud__equipment--empty', this.manager.count <= 0);

    const cooking = this.manager.isCooking;
    this.cookBar.style.opacity = cooking ? '1' : '0';
    this.cookFill.style.transform = `scaleX(${this.manager.cookProgress.toFixed(3)})`;
    // The bar goes red as the safety cutoff approaches — cooking a grenade
    // should feel like a countdown, not a neutral progress bar.
    this.cookFill.style.background = this.manager.cookProgress > 0.72
      ? 'var(--ui-danger)' : 'var(--ui-accent)';
  }

  /** Test seams. */
  get labelText(): string { return this.label.textContent ?? ''; }
  get countText(): string { return this.count.textContent ?? ''; }
}

export default EquipmentHUD;
