/**
 * DeathOverlay.ts — the death card and respawn countdown.
 *
 * Replaces the old "YOU DIED / Retry / Main Menu" game-over screen, which was
 * the wrong model entirely: dying ended the match and dumped you to a menu.
 * Now you watch the body from the death camera, read who killed you, and a
 * countdown brings you back — the match never stopped.
 *
 * It is deliberately an OVERLAY, not a screen: the game is still rendering
 * behind it (that is the whole point of the death cam), so it must not be
 * routed by the UIManager's state machine, which shows exactly one screen and
 * hides the rest.
 *
 * KILLCAM PLACEHOLDER
 * -------------------
 * The user asked for the death presentation to be built ready for a killcam.
 * The banner slot at the top is that seam: `setKillcamBanner()` puts a label
 * over the shot ("KILLCAM"), and everything else — the killer card, the
 * countdown, the respawn line — is already correct for one, because a killcam
 * shows the same information over a different camera.
 */
import { div } from '../dom';

/** What the victim is told about their death. */
export interface DeathCardInfo {
  readonly killerName: string | null;
  readonly weaponLabel: string | null;
  readonly headshot: boolean;
  /** Metres between killer and victim. */
  readonly distance: number;
  /** The killer's remaining health, 0..1, or null if unknown. */
  readonly killerHealth: number | null;
}

export class DeathOverlay {
  readonly element = div('death-overlay');

  private readonly banner = div('death-banner');
  private readonly title = div('death-title', 'YOU WERE KILLED BY');
  private readonly killerName = div('death-killer');
  private readonly detail = div('death-detail');
  private readonly healthBar = div('death-killer-health');
  private readonly healthFill = div('death-killer-health-fill');
  private readonly countdown = div('death-countdown');
  private readonly countdownNumber = div('death-countdown-number');
  private readonly countdownLabel = div('death-countdown-label', 'RESPAWNING IN');

  private visible = false;

  constructor() {
    this.element.style.display = 'none';

    this.healthBar.appendChild(this.healthFill);

    const card = div('death-card');
    card.append(this.title, this.killerName, this.healthBar, this.detail);

    this.countdown.append(this.countdownLabel, this.countdownNumber);

    this.element.append(this.banner, card, this.countdown);
    this.banner.style.display = 'none';
  }

  /**
   * Show the card for a death.
   *
   * A death with no killer (fall, the map, your own grenade) says so rather
   * than showing an empty name — an unattributed death is a real case, not an
   * error to hide.
   */
  show(info: DeathCardInfo): void {
    this.visible = true;
    this.element.style.display = '';

    if (info.killerName) {
      this.title.textContent = 'YOU WERE KILLED BY';
      this.killerName.textContent = info.killerName;
      this.killerName.style.display = '';
    } else {
      this.title.textContent = 'YOU DIED';
      this.killerName.textContent = '';
      this.killerName.style.display = 'none';
    }

    const bits: string[] = [];
    if (info.weaponLabel) bits.push(info.weaponLabel);
    if (info.headshot) bits.push('HEADSHOT');
    if (info.distance > 0) bits.push(`${info.distance.toFixed(0)} M`);
    this.detail.textContent = bits.join('   •   ');

    if (info.killerHealth === null) {
      this.healthBar.style.display = 'none';
    } else {
      this.healthBar.style.display = '';
      const pct = Math.max(0, Math.min(1, info.killerHealth)) * 100;
      this.healthFill.style.width = `${pct}%`;
      // Red when you nearly had them — the information that makes a death
      // card sting, and the reason COD shows the killer's remaining health.
      this.healthFill.classList.toggle('critical', info.killerHealth < 0.35);
    }
  }

  /** Update the countdown. Seconds are shown rounded UP, as COD does. */
  setRespawnIn(seconds: number): void {
    if (!this.visible) return;
    const shown = Math.max(0, Math.ceil(seconds));
    if (shown <= 0) {
      this.countdownLabel.textContent = 'RESPAWNING';
      this.countdownNumber.textContent = '';
    } else {
      this.countdownLabel.textContent = 'RESPAWNING IN';
      this.countdownNumber.textContent = String(shown);
    }
  }

  /** The killcam seam: a label over the shot. */
  setKillcamBanner(text: string | null): void {
    if (text) {
      this.banner.textContent = text;
      this.banner.style.display = '';
    } else {
      this.banner.style.display = 'none';
    }
  }

  hide(): void {
    this.visible = false;
    this.element.style.display = 'none';
    this.setKillcamBanner(null);
  }

  get isVisible(): boolean { return this.visible; }
}

export default DeathOverlay;
