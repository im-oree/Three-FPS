/**
 * LoadingScreen.ts — Document 5 §7.2.
 *
 * Real progress bar driven by AssetLoader's `assets:progress`, then a
 * "Click to Play" prompt on `level:loaded`.
 *
 * The click is REQUIRED, not decoration: pointer lock and AudioContext resume
 * both need a genuine user gesture. Requesting them automatically the instant
 * loading finishes silently fails in every browser, which is exactly the bug
 * this pattern exists to avoid.
 */
import eventBus from '../../core/EventBus';
import { button, div, el } from '../dom';
import type { Screen } from '../UIManager';

export class LoadingScreen implements Screen {
  readonly element = div('screen');
  private readonly fill = div('loading__fill');
  private readonly pct = div('loading__pct', '0%');
  private readonly levelName = el('h1', 'title');
  private readonly barWrap = div('loading__bar');
  private readonly promptWrap = div('btn-row');
  private ready = false;

  constructor(private readonly onEnter: () => void) {
    const inner = div('screen__inner');
    inner.style.alignItems = 'center';
    inner.style.textAlign = 'center';

    this.levelName.style.fontSize = 'clamp(26px, 4vw, 46px)';
    this.barWrap.appendChild(this.fill);

    const enter = button('Click to Play', 'btn btn--primary', () => {
      if (!this.ready) return;
      this.onEnter();
    });
    enter.style.fontSize = '18px';
    enter.style.padding = '16px 40px';
    this.promptWrap.appendChild(enter);
    this.promptWrap.style.display = 'none';
    this.promptWrap.style.justifyContent = 'center';

    inner.append(
      el('p', 'subtitle', 'Deploying'),
      this.levelName,
      this.barWrap,
      this.pct,
      this.promptWrap,
    );
    this.element.appendChild(inner);

    eventBus.on('assets:progress', (payload) => {
      const { loaded, total } = payload as { loaded: number; total: number };
      if (!total) return;
      this.setProgress(loaded / total);
    });
    eventBus.on('level:loaded', (payload) => {
      const { displayName } = payload as { displayName?: string };
      if (displayName) this.levelName.textContent = displayName.toUpperCase();
      this.setProgress(1);
      this.showEnterPrompt();
    });
  }

  onShow(): void {
    this.ready = false;
    this.promptWrap.style.display = 'none';
    this.barWrap.style.display = '';
    this.pct.style.display = '';
    this.setProgress(0);
  }

  setLevelName(name: string): void {
    this.levelName.textContent = name.toUpperCase();
  }

  setProgress(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.fill.style.width = `${(clamped * 100).toFixed(1)}%`;
    this.pct.textContent = `${Math.round(clamped * 100)}%`;
  }

  private showEnterPrompt(): void {
    this.ready = true;
    this.barWrap.style.display = 'none';
    this.pct.style.display = 'none';
    this.promptWrap.style.display = 'flex';
  }

  /** Test seam. */
  get isReadyToEnter(): boolean { return this.ready; }
}

export default LoadingScreen;
