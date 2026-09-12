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

export type RecoilPatternId = 'assault_rifle' | 'pistol' | 'smg';

export const RECOIL_PATTERNS: Record<RecoilPatternId, RecoilPatternEntry[]> = {
  assault_rifle: [
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
  smg: [
    { pitchDeg: 0.35, yawDeg: 0.1 },
    { pitchDeg: 0.4, yawDeg: -0.14 },
    { pitchDeg: 0.38, yawDeg: 0.16 },
    { pitchDeg: 0.42, yawDeg: -0.18 },
    { pitchDeg: 0.4, yawDeg: 0.2 },
    { pitchDeg: 0.38, yawDeg: -0.22 },
    { pitchDeg: 0.42, yawDeg: 0.18 },
    { pitchDeg: 0.4, yawDeg: -0.16 },
    { pitchDeg: 0.36, yawDeg: 0.12 },
    { pitchDeg: 0.38, yawDeg: -0.1 },
    { pitchDeg: 0.4, yawDeg: 0.14 },
    { pitchDeg: 0.36, yawDeg: -0.18 },
    { pitchDeg: 0.38, yawDeg: 0.2 },
    { pitchDeg: 0.42, yawDeg: -0.14 },
    { pitchDeg: 0.4, yawDeg: 0.1 },
    { pitchDeg: 0.36, yawDeg: -0.08 },
  ],
};

export default RECOIL_PATTERNS;
