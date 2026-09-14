/**
 * InputContextStack.ts — Document I §6.5.
 *
 * Names WHO currently owns raw input. In 'gameplay', WASD drives
 * PlayerMovement. In 'missileControl', the same raw input drives the missile
 * and PlayerMovement explicitly ignores it. In 'tabletUI', fire is consumed
 * by the tablet and never reaches WeaponManager.
 *
 * This is the ENTIRE mechanism by which control transfers. Consumers gain one
 * guard line each; nothing is refactored internally. Add seams, don't rewrite.
 */
import eventBus from './EventBus';

export type InputContext =
  | 'gameplay'
  | 'tabletUI'
  | 'groundTargeting'
  | 'missileControl'
  | 'cinematic';

export class InputContextStack {
  private readonly stack: InputContext[] = ['gameplay'];

  current(): InputContext {
    return this.stack[this.stack.length - 1];
  }

  is(context: InputContext): boolean {
    return this.current() === context;
  }

  /** True when normal player movement and weapon input should run. */
  get gameplayOwnsInput(): boolean {
    return this.current() === 'gameplay';
  }

  push(context: InputContext): void {
    this.stack.push(context);
    eventBus.emit('input:contextChanged', { context: this.current() });
  }

  /**
   * Pop a specific context. Passing the expected name makes this safe against
   * double-pops from an async sequence that was already torn down — popping
   * blind could otherwise strand the player in 'missileControl' forever with
   * no way to move, which is unrecoverable without a reload.
   */
  pop(expected?: InputContext): void {
    if (this.stack.length <= 1) return; // never pop the gameplay base
    if (expected && this.current() !== expected) return;
    this.stack.pop();
    eventBus.emit('input:contextChanged', { context: this.current() });
  }

  /** Hard reset — level unload, death, quit to menu. */
  reset(): void {
    this.stack.length = 0;
    this.stack.push('gameplay');
    eventBus.emit('input:contextChanged', { context: 'gameplay' });
  }

  /** Test seam. */
  get depth(): number { return this.stack.length; }
}

export const inputContexts = new InputContextStack();
export default inputContexts;
