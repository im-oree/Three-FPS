/**
 * ScopeOverlay.ts — Document C §8.4, implementation method (a).
 *
 * A real sniper scope does not just show a narrower rectangle: you are
 * looking down a tube, so the sight picture is a circle and everything
 * outside it is the black wall of the scope body.
 *
 * Method (a) — the MANDATED BASELINE — is a full-screen DOM overlay with a
 * circular cutout driven by `clip-path: circle(...)`. It is cheap, needs no
 * render target, and is honest: the glass has no optical distortion to fake.
 * Method (b) (a post-process pass with edge blur) stays a Document 6 upgrade.
 *
 * The reticle scales INVERSELY with magnification, so it subtends a constant
 * real-world angle the way a genuine mil-dot reticle does.
 */
import { SCOPE } from '../utils/Constants';

export class ScopeOverlay {
  private root: HTMLDivElement | null = null;
  private reticle: HTMLDivElement | null = null;
  private meter: HTMLDivElement | null = null;
  private meterFill: HTMLDivElement | null = null;
  private zoomLabel: HTMLDivElement | null = null;
  private visible = false;

  mount(parent: HTMLElement = document.body): void {
    if (this.root) return;

    const root = document.createElement('div');
    root.id = 'scope-overlay';
    root.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none',
      'z-index:40', 'opacity:0',
      `transition:opacity ${SCOPE.OVERLAY_FADE_SECONDS}s linear`,
    ].join(';');

    // The black scope body: an opaque layer with a circular hole punched in
    // it. `circle(38% at 50% 50%)` keeps the sight picture centred and
    // proportional on any aspect ratio.
    const tunnel = document.createElement('div');
    tunnel.id = 'scope-tunnel';
    tunnel.style.cssText = [
      'position:absolute', 'inset:0', 'background:#000',
      // Even-odd trick: fill the whole screen, cut out the lens circle.
      'clip-path:polygon(0 0,100% 0,100% 100%,0 100%,0 0,'
        + '50% 0,50% 100%,50% 0,0 0)',
      '-webkit-mask-image:radial-gradient(circle at 50% 50%,'
        + 'transparent 0 var(--lens),#000 calc(var(--lens) + 1px) 100%)',
      'mask-image:radial-gradient(circle at 50% 50%,'
        + 'transparent 0 var(--lens),#000 calc(var(--lens) + 1px) 100%)',
    ].join(';');
    tunnel.style.setProperty('--lens', '38vmin');
    // Soft vignette just inside the glass edge, so the lens does not read as
    // a hard cardboard cut-out.
    const vignette = document.createElement('div');
    vignette.style.cssText = [
      'position:absolute', 'inset:0',
      'background:radial-gradient(circle at 50% 50%,'
        + 'rgba(0,0,0,0) 0 30vmin,rgba(0,0,0,0.55) 38vmin,rgba(0,0,0,0) 39vmin)',
    ].join(';');

    // Reticle: crosshair + centre dot, sized inversely to magnification.
    const reticle = document.createElement('div');
    reticle.id = 'scope-reticle';
    reticle.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%',
      'transform:translate(-50%,-50%)',
      'width:76vmin', 'height:76vmin',
    ].join(';');
    reticle.innerHTML = `
      <svg viewBox="0 0 200 200" width="100%" height="100%">
        <g stroke="#0b0b0b" stroke-width="0.9" fill="none">
          <line x1="100" y1="0"   x2="100" y2="78"  />
          <line x1="100" y1="122" x2="100" y2="200" />
          <line x1="0"   y1="100" x2="78"  y2="100" />
          <line x1="122" y1="100" x2="200" y2="100" />
        </g>
        <g stroke="#0b0b0b" stroke-width="0.7">
          <line x1="88" y1="110" x2="92" y2="110" />
          <line x1="88" y1="120" x2="92" y2="120" />
          <line x1="108" y1="110" x2="112" y2="110" />
          <line x1="108" y1="120" x2="112" y2="120" />
        </g>
        <circle cx="100" cy="100" r="0.9" fill="#0b0b0b" />
      </svg>`;

    // Breath-hold meter, bottom-centre, only while scoped.
    const meter = document.createElement('div');
    meter.id = 'scope-breath-meter';
    meter.style.cssText = [
      'position:absolute', 'left:50%', 'bottom:12vh',
      'transform:translateX(-50%)',
      'width:18vmin', 'height:3px', 'background:rgba(255,255,255,0.18)',
      'border-radius:2px', 'overflow:hidden',
    ].join(';');
    const meterFill = document.createElement('div');
    meterFill.style.cssText = [
      'width:100%', 'height:100%', 'background:rgba(235,235,235,0.85)',
      'transform-origin:left center',
    ].join(';');
    meter.appendChild(meterFill);

    const zoomLabel = document.createElement('div');
    zoomLabel.id = 'scope-zoom';
    zoomLabel.style.cssText = [
      'position:absolute', 'left:50%', 'bottom:15.5vh',
      'transform:translateX(-50%)',
      'font:600 12px/1 ui-monospace,Menlo,Consolas,monospace',
      'letter-spacing:0.08em', 'color:rgba(235,235,235,0.8)',
    ].join(';');

    tunnel.appendChild(vignette);
    root.append(tunnel, reticle, meter, zoomLabel);
    parent.appendChild(root);

    this.root = root;
    this.reticle = reticle;
    this.meter = meter;
    this.meterFill = meterFill;
    this.zoomLabel = zoomLabel;
  }

  /** Test seam. */
  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    if (!this.root || this.visible === visible) return;
    this.visible = visible;
    this.root.style.opacity = visible ? '1' : '0';
  }

  /**
   * Reticle apparent size is inversely proportional to magnification, so a
   * mil-dot subtends a constant angle on the target regardless of zoom.
   */
  setMagnification(magnification: number, minMagnification: number): void {
    if (!this.reticle || !this.zoomLabel) return;
    const scale = minMagnification / Math.max(1e-3, magnification);
    this.reticle.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(4)})`;
    this.zoomLabel.textContent = `${magnification.toFixed(1)}x`;
  }

  setBreath(fraction: number, holding: boolean): void {
    if (!this.meterFill || !this.meter) return;
    this.meterFill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(3)})`;
    this.meterFill.style.background = holding
      ? 'rgba(150,215,255,0.95)'
      : 'rgba(235,235,235,0.85)';
    this.meter.style.opacity = fraction >= 0.999 && !holding ? '0.35' : '1';
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
  }
}

export const scopeOverlay = new ScopeOverlay();
export default scopeOverlay;
