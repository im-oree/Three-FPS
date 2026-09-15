/**
 * InputRelay.ts — turns local input into the intent stream the server needs.
 *
 * This is the client's only job in the movement loop: report what the player
 * is TRYING to do. It never reports outcomes. The server decides whether the
 * sprint applied, whether the jump was legal and where the body ended up.
 *
 * The local PlayerController still runs, because waiting for a round trip
 * before the view moves feels broken even on a LAN. That local simulation is
 * a prediction; ServerReconciler is what corrects it when the two disagree.
 */
import type { GameClient } from './GameClient';
import { Button } from './Protocol';
import type { InputManager } from '../core/InputManager';
import type { PlayerController } from '../player/PlayerController';

export class InputRelay {
  /** Sequence numbers of frames sent but not yet acknowledged. */
  private readonly unacked: { seq: number; dt: number }[] = [];
  private accumulator = 0;

  constructor(
    private readonly client: GameClient,
    private readonly input: InputManager,
    private readonly player: PlayerController,
  ) {}

  /** Frames sent and still awaiting acknowledgement. */
  get pendingCount(): number { return this.unacked.length; }

  /**
   * Sample input and send one frame.
   *
   * Called every rendered frame rather than on a fixed schedule: the server
   * clamps dt anyway, and sending at the render rate keeps latency at one
   * frame instead of up to a whole tick.
   */
  update(dt: number): void {
    if (!this.client.isConnected) return;

    this.accumulator += dt;
    // Never send a zero-length frame; it costs bandwidth and means nothing.
    if (this.accumulator < 1 / 120) return;
    const frameDt = this.accumulator;
    this.accumulator = 0;

    const down = (action: string): boolean => this.input.isActionDown(action);

    // Build the movement vector in the same convention the server expects:
    // +Z is forward, +X is right.
    let moveX = 0;
    let moveZ = 0;
    if (down('moveForward')) moveZ += 1;
    if (down('moveBackward')) moveZ -= 1;
    if (down('moveRight')) moveX += 1;
    if (down('moveLeft')) moveX -= 1;

    let buttons = 0;
    if (down('fire')) buttons |= Button.Fire;
    if (down('ads')) buttons |= Button.ADS;
    if (down('jump')) buttons |= Button.Jump;
    if (down('crouch')) buttons |= Button.Crouch;
    if (down('sprint')) buttons |= Button.Sprint;
    if (down('reload')) buttons |= Button.Reload;
    // 'vehicleEnter' is the project's interact bind (E); there is no separate
    // 'interact' action, and naming one that does not exist would silently
    // report the button as never pressed.
    if (down('vehicleEnter')) buttons |= Button.Interact;
    if (down('melee')) buttons |= Button.Melee;

    const seq = this.client.sendInput({
      dt: frameDt,
      moveX,
      moveZ,
      yaw: this.player.getYaw(),
      pitch: this.player.getPitch(),
      buttons,
    });

    this.unacked.push({ seq, dt: frameDt });
    // Drop acknowledged frames. Bounded regardless, so a server that stops
    // acknowledging cannot grow this without limit.
    const ack = this.client.acknowledgedSeq;
    while (this.unacked.length && this.unacked[0].seq <= ack) this.unacked.shift();
    while (this.unacked.length > 128) this.unacked.shift();
  }

  reset(): void {
    this.unacked.length = 0;
    this.accumulator = 0;
  }
}
