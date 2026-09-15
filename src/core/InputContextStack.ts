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

  /**
   * SAFETY NET. A context that is pushed but never popped leaves the player
   * permanently unable to move or look, which is unrecoverable without a
   * page reload — by far the worst failure mode this system can have. Any
   * owner that pushes a context registers a deadline here; if it is still
   * held when the deadline passes, the stack unwinds itself and says so.
   */
  guard(context: InputContext, maxSeconds: number): void {
    this.deadlines.set(context, maxSeconds);
  }

  private readonly deadlines = new Map<InputContext, number>();

  /** Called every frame by main. */
  update(dt: number): void {
    for (const [context, remaining] of [...this.deadlines]) {
      if (!this.stack.includes(context)) {
        this.deadlines.delete(context);
        continue;
      }
      const next = remaining - dt;
      if (next > 0) {
        this.deadlines.set(context, next);
        continue;
      }
      console.warn(
        `[InputContextStack] "${context}" outlived its deadline and was force-`
        + 'released. Something failed to pop it; input is being restored.',
      );
      this.deadlines.delete(context);
      // Unwind everything above and including the offender.
      while (this.stack.length > 1 && this.stack.includes(context)) {
        this.stack.pop();
      }
      eventBus.emit('input:contextChanged', { context: this.current() });
    }
  }

  /** Hard reset — level unload, death, quit to menu. */
  reset(): void {
    this.deadlines.clear();
    this.stack.length = 0;
    this.stack.push('gameplay');
    eventBus.emit('input:contextChanged', { context: 'gameplay' });
  }

  /** Test seam. */
  get depth(): number { return this.stack.length; }
}

export const inputContexts = new InputContextStack();
export default inputContexts;
