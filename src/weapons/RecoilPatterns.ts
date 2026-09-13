/**
 * RecoilPatterns.ts — PURE DATA tables (Document 3 §10.1). No logic lives
 * here. Each entry is one shot's view kick in degrees {pitch, yaw}; RecoilSystem
 * walks the array as shots land and holds the last entry past the pattern
 * length. Jitter (±RECOIL.JITTER_FRACTION) is applied by the system, not here.
 * Three visibly distinct signatures, tuned per weapon definition:
 *   assault_rifle → steady vertical climb drifting right (classic rifle),
 *   pistol        → small tight pop, almost pure vertical (4 shots),
 *   smg           → fast low-kick with aggressive horizontal zigzag.
 */
export interface RecoilPatternEntry {
  pitchDeg: number;
  yawDeg: number;
}

export type RecoilPatternId = 'rifle' | 'pistol' | 'shotgun' | 'smg' | 'sniper';

export const RECOIL_PATTERNS: Record<RecoilPatternId, RecoilPatternEntry[]> = {
  rifle: [
    { pitchDeg: 0.55, yawDeg: 0.0 },
    { pitchDeg: 0.75, yawDeg: 0.05 },
    { pitchDeg: 0.9, yawDeg: 0.1 },
    { pitchDeg: 1.0, yawDeg: 0.16 },
    { pitchDeg: 1.05, yawDeg: 0.22 },
    { pitchDeg: 1.1, yawDeg: 0.3 },
    { pitchDeg: 1.1, yawDeg: 0.36 },
    { pitchDeg: 1.05, yawDeg: 0.42 },
    { pitchDeg: 1.0, yawDeg: 0.46 },
    { pitchDeg: 0.95, yawDeg: 0.5 },
    { pitchDeg: 0.9, yawDeg: 0.52 },
    { pitchDeg: 0.85, yawDeg: 0.5 },
  ],
  pistol: [
    { pitchDeg: 0.5, yawDeg: 0.0 },
    { pitchDeg: 0.6, yawDeg: 0.02 },
    { pitchDeg: 0.65, yawDeg: 0.03 },
    { pitchDeg: 0.7, yawDeg: 0.0 },
  ],
  /**
   * Document D §5.4 acceptance: the SMG's pattern must be visibly, distinctly
   * MORE HORIZONTAL than the rifle's, using nothing but data.
   *
   * The rifle climbs steadily and drifts one way (max |yaw| 0.52, monotonic).
   * This zigzags hard and alternates sign every step or two, so the cumulative
   * horizontal wander dominates while per-shot pitch stays low. Sprayed at
   * 950 RPM that reads as a weapon you must burst-fire to control.
   */
  smg: [
    { pitchDeg: 0.42, yawDeg: 0.0 },
    { pitchDeg: 0.50, yawDeg: -0.55 },
    { pitchDeg: 0.58, yawDeg: 0.75 },
    { pitchDeg: 0.62, yawDeg: -0.95 },
    { pitchDeg: 0.66, yawDeg: 1.10 },
    { pitchDeg: 0.68, yawDeg: -1.25 },
    { pitchDeg: 0.70, yawDeg: 1.30 },
    { pitchDeg: 0.70, yawDeg: -1.20 },
    { pitchDeg: 0.68, yawDeg: 1.35 },
    { pitchDeg: 0.66, yawDeg: -1.40 },
    { pitchDeg: 0.64, yawDeg: 1.25 },
    { pitchDeg: 0.62, yawDeg: -1.30 },
  ],
  /** One enormous, near-vertical kick — there is no second shot to control. */
  sniper: [
    { pitchDeg: 3.6, yawDeg: 0.05 },
    { pitchDeg: 3.4, yawDeg: -0.05 },
  ],
  shotgun: [
    { pitchDeg: 2.6, yawDeg: 0.0 },
    { pitchDeg: 2.4, yawDeg: 0.2 },
    { pitchDeg: 2.2, yawDeg: -0.15 },
    { pitchDeg: 2.0, yawDeg: 0.1 },
    { pitchDeg: 1.8, yawDeg: -0.1 },
    { pitchDeg: 1.6, yawDeg: 0.05 },
  ],
};

export default RECOIL_PATTERNS;
