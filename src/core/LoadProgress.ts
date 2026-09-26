/**
 * LoadProgress.ts — an honest loading bar.
 *
 * THE PROBLEM THIS FIXES
 * ----------------------
 * The old bar was driven only by AssetLoader's file counter, but deploying a
 * level runs several phases: audio preload, skin preload, then the level
 * build itself (shell, terrain collision, callout zones, props, HDRI). The
 * bar therefore raced to 100% during audio and then sat there, frozen, for
 * the entire level build -- the part that actually takes the time. It was a
 * progress bar that stopped reporting exactly when progress mattered.
 *
 * HOW THIS WORKS
 * --------------
 * Loading is declared up front as a list of weighted stages. Each stage
 * reports its own 0..1 fraction, and the overall number is the weighted sum.
 * Weights are rough measured shares of wall-clock time, not equal slices:
 * equal slices are how you get a bar that crawls through one stage and jumps
 * through four.
 *
 * A stage that cannot report sub-progress simply goes 0 -> 1, which is still
 * honest, just coarse. What it must never do is claim progress it has not
 * made.
 */
import eventBus from './EventBus';

export interface LoadStage {
  readonly id: string;
  /** Shown to the player, e.g. "Loading terrain". */
  readonly label: string;
  /** Relative share of total time. Need not sum to 1; it is normalised. */
  readonly weight: number;
}

export class LoadProgress {
  private stages: readonly LoadStage[] = [];
  private readonly fractions = new Map<string, number>();
  private totalWeight = 0;
  private activeId: string | null = null;

  /** Declare the run. Resets everything. */
  begin(stages: readonly LoadStage[]): void {
    this.stages = stages;
    this.fractions.clear();
    for (const stage of stages) this.fractions.set(stage.id, 0);
    this.totalWeight = stages.reduce((sum, stage) => sum + stage.weight, 0) || 1;
    this.activeId = stages[0]?.id ?? null;
    this.emit();
  }

  /** Mark a stage as the one being worked on, without advancing it. */
  enter(id: string): void {
    if (!this.fractions.has(id)) return;
    this.activeId = id;
    this.emit();
  }

  /** Report sub-progress inside a stage. */
  set(id: string, fraction: number): void {
    if (!this.fractions.has(id)) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    // Never let a stage go backwards: a loader that retreats looks broken
    // even when the underlying number is genuine.
    const previous = this.fractions.get(id) ?? 0;
    if (clamped < previous) return;
    this.fractions.set(id, clamped);
    this.activeId = id;
    this.emit();
  }

  /** Finish a stage. */
  complete(id: string): void {
    if (!this.fractions.has(id)) return;
    this.fractions.set(id, 1);
    this.emit();
  }

  /** Overall 0..1 across every declared stage. */
  get overall(): number {
    if (!this.stages.length) return 0;
    let sum = 0;
    for (const stage of this.stages) {
      sum += (this.fractions.get(stage.id) ?? 0) * stage.weight;
    }
    return sum / this.totalWeight;
  }

  get activeLabel(): string {
    const stage = this.stages.find((candidate) => candidate.id === this.activeId);
    return stage?.label ?? '';
  }

  private emit(): void {
    eventBus.emit('load:progress', {
      fraction: this.overall,
      label: this.activeLabel,
      stageId: this.activeId,
    });
  }
}

export const loadProgress = new LoadProgress();
export default loadProgress;

/** The stages a level deployment runs through, with measured-ish weights. */
export const DEPLOY_STAGES: readonly LoadStage[] = [
  { id: 'audio', label: 'Loading audio', weight: 0.14 },
  { id: 'skins', label: 'Loading weapon skins', weight: 0.06 },
  { id: 'shell', label: 'Building map geometry', weight: 0.30 },
  { id: 'collision', label: 'Baking collision', weight: 0.10 },
  { id: 'props', label: 'Placing props', weight: 0.26 },
  { id: 'lighting', label: 'Resolving lighting', weight: 0.14 },
];
