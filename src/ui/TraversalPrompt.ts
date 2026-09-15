/**
 * TraversalPrompt.ts — the on-screen "press JUMP to climb" hint.
 *
 * Traversal is manually triggered (see /CHARACTER_STATE.md §6): standing in
 * front of a climbable ledge does nothing until the player presses jump. That
 * only works as a mechanic if the player can see when a ledge is in reach, so
 * this reads PlayerController.traversalPrompt each frame and shows the hint.
 *
 * This is a pure CONSUMER of state — it never requests a transition.
 */
import characterState, { Traversal } from '../character/CharacterStateSystem';

export class TraversalPrompt {
  private readonly element: HTMLDivElement;
  private lastKind: string | null = null;
  private readonly jumpKeyLabel: string;

  constructor(jumpKeyLabel = 'SPACE') {
    this.jumpKeyLabel = jumpKeyLabel;
    this.element = document.createElement('div');
    this.element.id = 'traversal-prompt';
    this.element.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:58%',
      'transform:translateX(-50%)',
      'font:600 14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
      'letter-spacing:0.08em',
      'color:#f2f4f8',
      'text-shadow:0 1px 3px rgba(0,0,0,0.9)',
      'padding:6px 14px',
      'background:rgba(8,10,14,0.45)',
      'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:3px',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 120ms ease-out',
    ].join(';');
    const root = document.getElementById('ui-root');
    if (root) root.appendChild(this.element);
  }

  /** @param kind result of PlayerController.traversalPrompt for this frame. */
  update(kind: 'vault' | 'mantle' | null): void {
    // Hide the hint while a climb is already running — the state authority
    // knows that better than the geometry probe does.
    const climbing = characterState.traversal !== Traversal.NONE;
    const show = kind !== null && !climbing && characterState.canTraverse();

    if (show && kind !== this.lastKind) {
      const verb = kind === 'mantle' ? 'CLIMB' : 'VAULT';
      this.element.textContent = `[${this.jumpKeyLabel}]  ${verb}`;
      this.lastKind = kind;
    }
    if (!show) this.lastKind = null;
    this.element.style.opacity = show ? '1' : '0';
  }

  dispose(): void {
    this.element.remove();
  }
}
