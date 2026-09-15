/**
 * MoveTo.ts — walk somewhere, by pushing a stick.
 *
 * The pathfinder produces waypoints; this converts the next one into the
 * `moveX`/`moveZ`/`yaw` fields of an InputFrame. It never writes a position.
 * The bot is moved by MovementSystem, through the same code that moves a
 * human, so it inherits acceleration, step height, wall sliding and fall
 * damage without any of that being reimplemented here.
 *
 * Movement input is in the agent's local frame — MovementSystem rotates it by
 * the player's yaw, exactly as it does for a human's WASD. So walking
 * somewhere means facing it and pushing forward, which is also why a bot
 * turns to move rather than strafing everywhere like a turret on wheels.
 */
import type { Vec3 } from '../../../net/Protocol';
import { Button } from '../../../net/Protocol';
import type { AgentContext } from '../AgentContext';
import type { Behaviour, InputIntent } from '../Capability';
import { approachAngle } from '../Difficulty';
import { findPath, type NavGrid, type TraversalCaps } from '../Navigation';

/** How close counts as having reached a waypoint. */
const WAYPOINT_TOLERANCE = 1.4;
/** Recompute the route if the goal drifts further than this from the plan. */
const REPLAN_DISTANCE = 4;

export interface MoveToOptions {
  /** Hold sprint while travelling. */
  readonly sprint?: boolean;
  /** Stop once within this distance of the goal, rather than standing on it. */
  readonly stopWithin?: number;
  /** Face the travel direction (false while strafing around a target). */
  readonly faceTravel?: boolean;
}

export class MoveTo implements Behaviour {
  private path: Vec3[] = [];
  private index = 0;
  private goal: Vec3;
  private failed = false;
  /** Seconds spent without the distance-to-goal improving. */
  private stuckFor = 0;
  private lastDistance = Infinity;

  constructor(
    private readonly grid: NavGrid | null,
    private readonly caps: TraversalCaps,
    goal: Vec3,
    ctx: AgentContext,
    private readonly options: MoveToOptions = {},
  ) {
    this.goal = goal;
    this.repath(ctx);
  }

  /** Point the behaviour at a new destination without rebuilding it. */
  retarget(goal: Vec3, ctx: AgentContext): void {
    const moved = Math.hypot(goal[0] - this.goal[0], goal[2] - this.goal[2]);
    this.goal = goal;
    if (moved > REPLAN_DISTANCE) this.repath(ctx);
  }

  private repath(ctx: AgentContext): void {
    this.index = 0;
    if (!this.grid) {
      // No grid (a level with no baked geometry): steer straight at the goal.
      // Worse, but a bot that cannot move at all is worse still.
      this.path = [this.goal];
      return;
    }
    const from: Vec3 = [ctx.self.px, ctx.self.py, ctx.self.pz];
    const route = findPath(this.grid, from, this.goal, this.caps);
    if (!route) { this.failed = true; this.path = []; return; }
    this.path = route;
    this.failed = false;
  }

  tick(ctx: AgentContext): InputIntent {
    const { self } = ctx;
    if (this.failed || this.path.length === 0) return {};

    // Advance through any waypoints already reached.
    while (this.index < this.path.length) {
      const wp = this.path[this.index];
      if (Math.hypot(wp[0] - self.px, wp[2] - self.pz) > WAYPOINT_TOLERANCE) break;
      this.index += 1;
    }
    if (this.index >= this.path.length) return {};

    const wp = this.path[this.index];
    const dx = wp[0] - self.px;
    const dz = wp[2] - self.pz;
    const distance = Math.hypot(dx, dz);

    // Unstick: if progress has stalled (a doorway clipped, a prop in the way)
    // rebuild the route rather than grinding against the obstacle forever.
    if (distance >= this.lastDistance - 0.01) {
      this.stuckFor += ctx.dt;
      if (this.stuckFor > 1.2) { this.stuckFor = 0; this.repath(ctx); return {}; }
    } else {
      this.stuckFor = 0;
    }
    this.lastDistance = distance;

    // Yaw convention, derived from MovementSystem rather than guessed:
    // it computes wishX = moveX*cos - moveZ*sin and wishZ = moveX*sin +
    // moveZ*cos, so pushing straight forward (moveZ = 1) travels along
    // (-sin(yaw), cos(yaw)). Facing a direction (dx, dz) therefore needs
    // yaw = atan2(-dx, dz). Getting the sign of dz wrong here makes the bot
    // rotate a little further every tick and walk in slow circles.
    const desiredYaw = Math.atan2(-dx, dz);
    const yaw = this.options.faceTravel === false
      ? self.yaw
      : approachAngle(self.yaw, desiredYaw, ctx.profile.maxTurnDegPerSecond, ctx.dt);

    // Push the stick forward in whatever direction the body now faces. When
    // not facing travel, decompose the world direction into local strafe.
    let moveX = 0;
    let moveZ = 1;
    if (this.options.faceTravel === false && distance > 1e-3) {
      // Inverse of the same basis: project the desired world direction onto
      // the body's right (cos, sin) and forward (-sin, cos) axes.
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const nx = dx / distance;
      const nz = dz / distance;
      moveX = nx * cos + nz * sin;
      moveZ = -nx * sin + nz * cos;
    }

    let buttons = 0;
    if (this.options.sprint && distance > 6) buttons |= Button.Sprint;

    return { moveX, moveZ, yaw, buttons };
  }

  isDone(ctx: AgentContext): boolean {
    if (this.failed) return true;
    const stop = this.options.stopWithin ?? WAYPOINT_TOLERANCE;
    const distance = Math.hypot(this.goal[0] - ctx.self.px, this.goal[2] - ctx.self.pz);
    return distance <= stop || this.index >= this.path.length;
  }

  get didFail(): boolean { return this.failed; }
  get waypointCount(): number { return this.path.length; }
}
