#!/usr/bin/env node
/**
 * generateTabletClips.js — authors the KILLSTREAK TABLET hand animations.
 *
 * Run manually:   node tools/generateTabletClips.js
 * Writes:         assets/animations/tablet_raise.json
 *                 assets/animations/tablet_lower.json
 *
 * Real committed static assets, per tools/README.md — no keyframes are built
 * inside /src at runtime.
 *
 * DESIGN NOTES
 * ------------
 * Calling in a killstreak is a physical act. The LEFT arm brings the tablet up
 * and holds it steady at reading height; the right hand keeps the weapon, which
 * drops to a low-ready pose (handled separately by the carry-pose spring, not
 * by this clip).
 *
 * These clips therefore own the LEFT chain only — `ownsIK: "L"` — so the right
 * arm's weapon IK keeps running underneath and the gun does not snap to a rest
 * pose while the tablet is up.
 *
 * Phases:
 *   0.00  rest     arm hanging, tablet out of frame below the lens
 *   0.30  swing    elbow folds hard, arm sweeps up and inward across the body
 *   0.55  settle   slight overshoot past the hold pose, as a real arm does
 *   0.75  hold     steady at reading height, tablet angled toward the face
 *
 * tablet_lower is the same motion reversed with a shorter tail: dropping a
 * device is faster than raising and steadying one.
 *
 * Rig convention (COORDINATE_CONVENTIONS.md): a joint's local -Y runs down the
 * limb, -Z is forward, so POSITIVE X rotation swings the segment forward and
 * UP. Every raise pose below is positive on X; negative would swing the arm
 * behind the back. The LEFT arm abducts on NEGATIVE Z (the right takes
 * positive) — verified by projection during the mantle work.
 *
 * Fingers are never individually posed (Document A); the hold reads entirely
 * from shoulder/elbow/wrist orientation.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'assets', 'animations');
mkdirSync(outDir, { recursive: true });

const round = (v) => Math.round(v * 1e4) / 1e4;
const D = Math.PI / 180;

/** Quaternion from an XYZ Euler triple (radians). Mirrors THREE's 'XYZ'. */
function quatFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2); const s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2); const s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2); const s3 = Math.sin(z / 2);
  return [
    round(s1 * c2 * c3 + c1 * s2 * s3),
    round(c1 * s2 * c3 - s1 * c2 * s3),
    round(c1 * c2 * s3 + s1 * s2 * c3),
    round(c1 * c2 * c3 - s1 * s2 * s3),
  ];
}

function track(node, poses) {
  return {
    node,
    times: poses.map((p) => round(p[0])),
    quaternions: poses.map((p) => quatFromEuler(p[1] * D, p[2] * D, p[3] * D)),
  };
}

// ---------------------------------------------------------------------------
// TABLET RAISE — left arm brings the device up to reading height.
// ---------------------------------------------------------------------------
const RAISE_DURATION = 0.75;
const R = { rest: 0.0, swing: 0.30, settle: 0.55, hold: 0.75 };

/**
 * Pose bands, chosen to put the tablet in the lower-left of the lens at
 * reading distance rather than filling the frame:
 *   shoulderX ~62-70 deg   lifts the upper arm to chest height
 *   shoulderZ ~-20 deg     LEFT arm abducts negative, tucking it inward
 *   elbowX    ~95-108 deg  the hard fold that brings the hand up to the face
 *   wrist                  tilts the screen toward the eyeline
 */
const raise = {
  name: 'tablet_raise',
  duration: RAISE_DURATION,
  // LEFT chain only: the right arm keeps its weapon IK running underneath.
  ownsIK: 'L',
  tracks: [
    track('Shoulder_L', [
      [R.rest, 6, 0, -4],      // hanging at the side
      [R.swing, 48, -8, -16],  // sweeping up and inward
      [R.settle, 70, -12, -22],// slight overshoot above the hold
      [R.hold, 64, -10, -20],  // settled at reading height
    ]),
    track('ElbowPivot_L', [
      [R.rest, 10, 0, 0],
      [R.swing, 72, 0, 0],
      [R.settle, 108, 0, 0],   // overshoot: a real arm does not stop dead
      [R.hold, 98, 0, 0],
    ]),
    track('WristPivot_L', [
      [R.rest, 0, 0, 0],
      [R.swing, 12, -6, 8],
      [R.settle, 26, -12, 16], // screen rolls toward the face
      [R.hold, 22, -10, 14],
    ]),
  ],
  // The screen only becomes readable once the arm has settled.
  events: [{ atProgress: 0.72, event: 'tablet_ready' }],
};

// ---------------------------------------------------------------------------
// TABLET LOWER — reversed, and deliberately quicker.
// ---------------------------------------------------------------------------
const LOWER_DURATION = 0.45;
const L = { hold: 0.0, drop: 0.24, rest: 0.45 };

const lower = {
  name: 'tablet_lower',
  duration: LOWER_DURATION,
  ownsIK: 'L',
  tracks: [
    track('Shoulder_L', [
      [L.hold, 64, -10, -20],
      [L.drop, 34, -6, -12],
      [L.rest, 6, 0, -4],
    ]),
    track('ElbowPivot_L', [
      [L.hold, 98, 0, 0],
      [L.drop, 52, 0, 0],
      [L.rest, 10, 0, 0],
    ]),
    track('WristPivot_L', [
      [L.hold, 22, -10, 14],
      [L.drop, 8, -4, 6],
      [L.rest, 0, 0, 0],
    ]),
  ],
  events: [],
};

for (const clip of [raise, lower]) {
  const file = path.join(outDir, `${clip.name}.json`);
  writeFileSync(file, `${JSON.stringify(clip, null, 2)}\n`);
  console.log(
    `[generateTabletClips] ${clip.name}.json — ${clip.duration}s, `
    + `${clip.tracks.length} tracks, ownsIK ${clip.ownsIK}`,
  );
}
