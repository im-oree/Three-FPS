/**
 * VehiclePrompt.ts — the "press F to get in" hint.
 *
 * Mirrors TraversalPrompt deliberately: same placement, same typography, same
 * fade. A player who has learned to read one hint should not have to learn a
 * second visual language for the next one.
 *
 * Unlike the traversal hint this one names the SEAT, because walking up to a
 * Humvee offers four different outcomes and the player has to know which one
 * they are about to get before they press the key.
 */
export interface VehiclePromptData {
  /** Vehicle display name, e.g. "LTV Humvee". */
  vehicle: string;
  /** Seat label, e.g. "DRIVER" or "GUNNER". */
  seat: string;
  /** Key label to show, e.g. "F". */
  key: string;
}

export class VehiclePrompt {
  private readonly element: HTMLDivElement;
  private lastSignature: string | null = null;
  private visible = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'vehicle-prompt';
    this.element.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:62%',
      'transform:translateX(-50%)',
      'font:600 14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
      'letter-spacing:0.08em',
      'color:#f2f4f8',
      'text-shadow:0 1px 3px rgba(0,0,0,0.9)',
      'padding:7px 16px',
      'background:rgba(8,10,14,0.55)',
      'border:1px solid rgba(255,255,255,0.20)',
      'border-radius:3px',
      'pointer-events:none',
      'opacity:0',
      'text-align:center',
      'transition:opacity 120ms ease-out',
      'white-space:nowrap',
    ].join(';');
    const root = document.getElementById('ui-root');
    if (root) root.appendChild(this.element);
  }

  update(data: VehiclePromptData | null): void {
    if (!data) {
      if (this.visible) {
        this.element.style.opacity = '0';
        this.visible = false;
        this.lastSignature = null;
      }
      return;
    }

    // Only touch the DOM when the text actually changes. This runs every
    // frame while the player stands near a vehicle, and writing innerHTML
    // unconditionally forces a layout each time for no reason.
    const signature = `${data.vehicle}|${data.seat}|${data.key}`;
    if (signature !== this.lastSignature) {
      this.element.innerHTML =
        `<span style="opacity:0.72">${escapeHtml(data.vehicle)}</span><br>`
        + `<span style="color:#ffd76a">[${escapeHtml(data.key)}]</span> `
        + `ENTER AS ${escapeHtml(data.seat)}`;
      this.lastSignature = signature;
    }

    if (!this.visible) {
      this.element.style.opacity = '1';
      this.visible = true;
    }
  }

  dispose(): void { this.element.remove(); }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

export default VehiclePrompt;
