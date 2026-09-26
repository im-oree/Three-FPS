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
/**
 * Below this much movement in a tick the body counts as jammed. Walk speed
 * is 5.4 m/s, i.e. 0.09 m per tick, so this is roughly a fifth of walking.
 */
const MIN_PROGRESS_PER_TICK = 0.018;

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
  /** Movement-tech timers. Per-behaviour so each bot has its own cadence. */
  private lastPx = 0;
  private lastPz = 0;
  private unstickAttempts = 0;
  private sidestepFor = 0;
  private sidestepDir = 1;
  private slideFor = 0;
  private sinceTech = 0;
  private techGap = 3;
  private sinceHop = 0;
  private hopGap = 2;

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

  /**
   * Slide and hop while travelling, on this bot's skill budget.
   *
   * Timers live on the behaviour, so the cadence is per-bot and survives
   * across ticks; the RNG is the agent's seeded stream, so a replay of the
   * same match moves identically.
   */
  private techButtons(ctx: AgentContext, sprinting: boolean, distance: number): number {
    const { skill } = ctx;

    // A slide has to be finished before anything else is considered.
    if (this.slideFor > 0) {
      this.slideFor -= ctx.dt;
      return Button.Sprint | Button.Crouch;
    }

    this.sinceTech += ctx.dt;

    // Slide: only worth it at sprint, with somewhere to be, and only for
    // players who have the hands. Recruits sit at 0.05 and never qualify.
    if (sprinting && distance > 9 && skill.slideUsageSkill > 0.15
      && this.sinceTech > this.techGap) {
      if (ctx.rng.next() < skill.slideUsageSkill * 0.5) {
        this.slideFor = 0.4 + skill.slideUsageSkill * 0.35;
        this.sinceTech = 0;
        this.techGap = ctx.rng.range(2.5, 6.0);
        return Button.Sprint | Button.Crouch;
      }
      // Failed the roll -- wait a beat before rolling again so a bot does
      // not spam the dice every single tick.
      this.sinceTech = this.techGap * 0.5;
    }

    // Bunny hop: pros keep momentum by hopping as they travel.
    if (sprinting && skill.bunnyHopSkill > 0.2 && ctx.self.grounded
      && this.sinceHop > this.hopGap) {
      this.sinceHop = 0;
      this.hopGap = ctx.rng.range(1.2, 3.5) / Math.max(0.2, skill.bunnyHopSkill);
      return Button.Sprint | Button.Jump;
    }
    this.sinceHop += ctx.dt;

    return 0;
  }

  private repath(ctx: AgentContext): void {
    // A fresh, longer route means real progress is possible again.
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

    // Unstick, measured on the BODY rather than on the goal.
    //
    // Distance-to-goal shrinks while a bot slides along a wall, so the old
    // check was satisfied even when the body was pinned -- killhouse bots
    // stood pressing forward into a wall indefinitely. What matters is
    // whether the body actually went anywhere.
    const travelled = Math.hypot(self.px - this.lastPx, self.pz - this.lastPz);
    this.lastPx = self.px;
    this.lastPz = self.pz;

    if (travelled < MIN_PROGRESS_PER_TICK) {
      this.stuckFor += ctx.dt;
      if (this.stuckFor > 0.6) {
        this.stuckFor = 0;
        this.unstickAttempts += 1;
        // Give up rather than grinding forever. Some goals simply cannot be
        // walked to -- the nav grid is a 2 m approximation, so a route can
        // clip a wall the body cannot pass. Failing here lets the capability
        // end and the bot choose a different goal, instead of shuffling
        // against the same corner for the rest of the match.
        if (this.unstickAttempts > 3) { this.failed = true; return {}; }
        this.repath(ctx);
        // A repath alone does not help when the route is fine and the body
        // is simply jammed on a corner. Sidestep for a moment: pick a
        // direction, commit to it, and let the next ticks carry the body
        // clear before resuming. This is what a human does when they clip a
        // doorframe.
        this.sidestepFor = 0.35;
        this.sidestepDir = ctx.rng.next() < 0.5 ? -1 : 1;
      }
    } else {
      this.stuckFor = 0;
    }

    // Serve an in-progress sidestep before anything else.
    if (this.sidestepFor > 0) {
      this.sidestepFor -= ctx.dt;
      return {
        moveX: this.sidestepDir,
        moveZ: -0.35,
        yaw: self.yaw,
        buttons: 0,
      };
    }

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
    const sprinting = this.options.sprint === true && distance > 6;
    if (sprinting) buttons |= Button.Sprint;

    // Movement tech, applied to every capability that travels rather than
    // competing with them as separate goals.
    //
    // This is the only locomotion path in the AI, so putting slide and hop
    // here is what makes bots stop looking like they are on rails -- and it
    // means a future capability gets the same hands for free. Each is gated
    // on this bot's own skill roll, so recruits still trudge in a line.
    buttons |= this.techButtons(ctx, sprinting, distance);

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
