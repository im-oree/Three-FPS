/**
 * ServerClock.ts — drives a hosted server independently of rendering.
 *
 * Why this exists: when one player's browser hosts the match, every other
 * player's simulation runs at the host's frame rate. Driving the server from
 * `requestAnimationFrame` makes the host's GPU load into everyone's netcode
 * problem -- a host that drops to 20 fps sends 20 snapshots a second, and a
 * host whose tab loses focus stops the match dead for everybody, because rAF
 * is suspended entirely in a background tab.
 *
 * A timer is not subject to that. `setInterval` keeps firing when the tab is
 * occluded, and it is throttled far less aggressively than rAF when the tab
 * is fully backgrounded. The simulation is fixed-step and already accumulates
 * real elapsed time, so an irregular timer costs nothing in correctness: the
 * server consumes whatever wall-clock time actually passed.
 *
 * This is also the arrangement a dedicated backend uses (`server/index.mjs`
 * ticks on a timer, with no renderer at all), so hosting in a browser and
 * hosting on a server now differ in transport only -- which is exactly the
 * "no divergence" property the project requires.
 */
export class ServerClock {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;

  /**
   * @param tickHz  How often to wake up. The server's own fixed-step
   *                accumulator decides how many simulation ticks that buys.
   */
  constructor(
    private readonly step: (realSeconds: number) => void,
    private readonly tickHz = 60,
  ) {}

  start(): void {
    if (this.timer) return;
    this.last = now();
    this.timer = setInterval(() => {
      const t = now();
      const dt = (t - this.last) / 1000;
      this.last = t;
      // Clamp: a throttled background tab can hand back a multi-second gap,
      // and replaying all of it at once would teleport every entity.
      this.step(Math.min(dt, 0.25));
    }, 1000 / this.tickHz);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean { return this.timer !== null; }
}

const now = (): number => (
  typeof performance !== 'undefined' ? performance.now() : Date.now()
);
