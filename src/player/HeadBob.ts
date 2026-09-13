/**
 * HeadBob.ts — pure procedural bob offset generator (Document 2 §10).
 *
 * Phase advances with DISTANCE travelled while grounded, locked to the same
 * per-gait stride constants the FootstepSystem uses: exactly one lateral
 * cycle (and two vertical bumps) per footstep, so the bob rhythm IS the gait
 * cadence and can never drift into high-frequency vibration. Amplitudes come
 * from per-gait constant sets and blend smoothly on gait changes. No
 * reference to the camera: output is a plain {x,y,z} offset that PlayerCamera
 * applies additively. `enabled` exists so Document 3 can switch bob off
 * while ADSing.
 */
import { FOOTSTEP, HEAD_BOB } from '../utils/Constants';
import { lerp } from '../utils/MathUtils';

export type BobGait = 'WALK' | 'SPRINT' | 'CROUCH' | 'NONE';

export interface BobOffset {
  x: number;
  y: number;
  z: number;
}

export class HeadBob {
  private phase = 0;
  private ampY = 0;
  private ampX = 0;
  private cyclesPerStep: number = HEAD_BOB.WALK.CYCLES_PER_STEP;
  private stride: number = FOOTSTEP.STRIDE_WALK_METERS;
  readonly offset: BobOffset = { x: 0, y: 0, z: 0 };

  update(dt: number, horizontalSpeed: number, isGrounded: boolean, gait: BobGait, enabled: boolean): BobOffset {
    const params = gait === 'SPRINT' ? HEAD_BOB.SPRINT : gait === 'CROUCH' ? HEAD_BOB.CROUCH : HEAD_BOB.WALK;
    const stride =
      gait === 'SPRINT' ? FOOTSTEP.STRIDE_SPRINT_METERS : gait === 'CROUCH' ? FOOTSTEP.STRIDE_CROUCH_METERS : FOOTSTEP.STRIDE_WALK_METERS;
    const active = enabled && isGrounded && gait !== 'NONE' && horizontalSpeed > 0.4;
    const targetAmpY = active ? params.AMP_Y : 0;
    const targetAmpX = active ? params.AMP_X : 0;

    // Smooth parameter blending avoids amplitude pops on gait changes.
    const blend = Math.min(1, dt * 10);
    this.ampY = lerp(this.ampY, targetAmpY, blend);
    this.ampX = lerp(this.ampX, targetAmpX, blend);
    this.cyclesPerStep = lerp(this.cyclesPerStep, params.CYCLES_PER_STEP, blend);
    this.stride = lerp(this.stride, stride, blend);

    // One lateral cycle per stride travelled: phase in radians.
    if (active) this.phase += ((horizontalSpeed * dt) / this.stride) * Math.PI * 2 * this.cyclesPerStep;

    this.offset.y = Math.sin(this.phase * 2) * this.ampY;
    this.offset.x = Math.sin(this.phase) * this.ampX;
    this.offset.z = 0;
    return this.offset;
  }
}

export default HeadBob;
