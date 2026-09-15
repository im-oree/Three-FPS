/**
 * DisorientOverlays.ts — Document F §7.
 *
 * Flashbang whiteout, concussion blur and in-smoke vision, as three
 * INDEPENDENT layered DOM elements. They stack by ordinary CSS compositing,
 * so being flashed while standing in your own smoke needs no special-case
 * combination code — each simply has its own opacity.
 *
 * All three gate on PLAYING, like every other HUD element.
 */
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import statusEffects from '../../player/ActiveStatusEffects';
import { div } from '../dom';

export class DisorientOverlays {
  readonly element = div('hud__disorient');
  private readonly flash = div('overlay-flash');
  private readonly concussion = div('overlay-concussion');
  private readonly smoke = div('overlay-smoke');
  private playing = false;
  /** Smoke occlusion is sampled per-frame by the owner. */
  private smokeAmount = 0;

  constructor() {
    this.element.append(this.smoke, this.concussion, this.flash);
    eventBus.on('game:stateChanged', (payload) => {
      this.playing = (payload as { current: string }).current === GameState.PLAYING;
      this.element.classList.toggle('hud--active', this.playing);
      if (!this.playing) this.clearAll();
    });

    // A direct flash SNAPS to full white, then fades — the snap is what sells
    // it. Ramping in would read as a light being switched on slowly.
    eventBus.on('effect:flashed', (payload) => {
      const { strength } = payload as { strength: number };
      this.flash.style.transition = 'none';
      this.flash.style.opacity = String(Math.min(1, strength * 1.15));
    });
  }

  setSmokeAmount(amount: number): void {
    this.smokeAmount = amount;
  }

  private clearAll(): void {
    this.flash.style.opacity = '0';
    this.concussion.style.opacity = '0';
    this.smoke.style.opacity = '0';
  }

  update(): void {
    if (!this.playing) return;

    // Flash: fade from wherever the snap left it, over the remaining blind.
    const flashed = statusEffects.strength('flashed');
    if (flashed > 0.001) {
      this.flash.style.transition = 'opacity 0.25s linear';
      this.flash.style.opacity = String(Math.min(1, flashed * 1.15));
    } else {
      this.flash.style.opacity = '0';
    }

    // Concussion blur rides the sway-loosen effect, which is what a stun
    // applies — so the visual and the mechanical penalty cannot desync.
    const loosen = statusEffects.multiplier('swayLoosen');
    const concussed = loosen < 0.999 ? 1 - loosen : 0;
    if (concussed > 0.01) {
      this.concussion.style.opacity = String(Math.min(1, concussed * 1.4));
      this.concussion.style.backdropFilter =
        `blur(${(concussed * 7).toFixed(1)}px) saturate(${(1 - concussed * 0.5).toFixed(2)})`;
    } else {
      this.concussion.style.opacity = '0';
      this.concussion.style.backdropFilter = 'none';
    }

    this.smoke.style.opacity = this.smokeAmount > 0.01
      ? String(Math.min(0.88, this.smokeAmount)) : '0';
  }

  /** Test seams. */
  get flashOpacity(): number { return parseFloat(this.flash.style.opacity || '0'); }
  get concussionOpacity(): number { return parseFloat(this.concussion.style.opacity || '0'); }
  get smokeOpacity(): number { return parseFloat(this.smoke.style.opacity || '0'); }
}

export default DisorientOverlays;
