/**
 * generateTraversalClips.js — authors the MANTLE and VAULT hand animations.
 *
 * Run manually:   node tools/generateTraversalClips.js
 * Writes:         assets/animations/mantle_climb.json
 *                 assets/animations/vault_over.json
 *
 * These are real, committed static assets, per tools/README.md — no geometry
 * or keyframes are constructed inside /src at runtime.
 *
 * DESIGN NOTES
 * ------------
 * A mantle is a TWO-HANDED action. Both arms leave the weapon entirely (the
 * CharacterStateSystem forces carry -> STOWED for the duration), so these
 * clips own BOTH arm chains — `ownsIK: "both"` — and the weapon IK is
 * suppressed while they run. That is what lets the hands actually plant on the
 * ledge instead of staying welded to a rifle.
 *
 * The climb is authored as five distinct phases so it reads as real effort
 * rather than a slide upward:
 *
 *   0.00  reach      arms extend up and forward toward the lip
 *   0.22  plant      both palms land on the ledge, elbows high and flared
 *   0.45  pull       elbows drive down past the ribs as the body rises
 *   0.70  press      arms straighten underneath, torso clears the lip
 *   0.88  recover    hands release forward, arms swing down to neutral
 *   1.00  neutral    back to rest so the weapon re-grip has no pop
 *
 * Per Document A the fingers are NEVER individually posed; the grip read comes
 * entirely from shoulder/elbow/wrist orientation.
 *
 * Rig convention (COORDINATE_CONVENTIONS.md): a joint's local -Y runs down the
 * limb toward its child, -Z is forward. Rotating the -Y limb axis by +theta
 * about local +X gives (0, -cos, -sin), i.e. the segment swings toward -Z:
 * POSITIVE X rotation raises the limb FORWARD and UP. All reach/plant poses
 * below are therefore positive on X; negative X would swing the arms behind
 * the back.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'assets', 'animations');

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
const round = (v) => Math.round(v * 1e4) / 1e4;
const D = Math.PI / 180;

/**
 * Build one track from a list of [time, xDeg, yDeg, zDeg] poses.
 */
function track(node, poses) {
  return {
    node,
    times: poses.map((p) => p[0]),
    quaternions: poses.map((p) => quatFromEuler(p[1] * D, p[2] * D, p[3] * D)),
  };
}

// ---------------------------------------------------------------------------
// MANTLE — the full two-handed pull-up.
// ---------------------------------------------------------------------------
const MANTLE_DURATION = 1.0; // LOGICAL length; playback rate retimes per use.

// Phase times as fractions of the logical duration.
const T = { reach: 0.0, plant: 0.22, pull: 0.45, press: 0.70, recover: 0.88, end: 1.0 }
;
const t = (k) => round(T[k] * MANTLE_DURATION);

const mantle = {
  name: 'mantle_climb',
  duration: MANTLE_DURATION,
  // Both chains are clip-owned: the weapon IK must not fight the climb.
  ownsIK: 'both',
  tracks: [
    // --- RIGHT ARM --------------------------------------------------------
    // POSE VALUES ARE MEASURED, NOT GUESSED.
    //
    // The first-person camera sits essentially at the shoulder line, so arm
    // poses that read fine on the third-person body can either fill the whole
    // lens or fall completely below the frustum. These angles were found by
    // sweeping (shoulderX, shoulderZ, elbowX) in-engine and projecting the
    // wrist into NDC, selecting for hands in the lower corners of the frame
    // (around x = +/-0.34, y = -0.42) with the ledge visible between them:
    //
    //   shoulderX ~75-90 deg   raises the arm to ledge height
    //   shoulderZ ~15-30 deg   abducts outward (RIGHT arm takes POSITIVE Z,
    //                          left negative — verified by projection) so the
    //                          hands are shoulder-width apart like a real
    //                          climber's, instead of stacked in front of the
    //                          face
    //   elbowX    ~70-100 deg  carries the fold of the pull-up
    //
    // Fingers are never posed (Document A) — the grip reads from these three
    // joints alone.
    track('Shoulder_R', [
      [t('reach'), 86, 18, 16],    // arm thrown up and forward toward the lip
      [t('plant'), 78, 22, 28],   // palms land, shoulders loaded
      [t('pull'), 62, 20, 24],    // shoulder drops as the body rises
      [t('press'), 30, 14, 12],    // arm straightening underneath, pressing
      [t('recover'), 8, 6, 2],     // released, swinging down to neutral
      [t('end'), 0, 0, 0],
    ]),
    // The elbow carries the fold: extended at the reach, deeply flexed through
    // the pull, snapping straight at the press.
    track('ElbowPivot_R', [
      [t('reach'), 44, 0, 0],
      [t('plant'), 84, 0, -8],     // deep flex, elbow high and flared out
      [t('pull'), 100, 0, -6],     // peak fold — the body is being hauled up
      [t('press'), 26, 0, 0],      // locks out
      [t('recover'), 22, 0, 0],
      [t('end'), 0, 0, 0],
    ]),
    // Wrist: palm flattens onto the ledge at the plant, rolls off at recover.
    track('WristPivot_R', [
      [t('reach'), 10, 0, 0],
      [t('plant'), -34, 8, -10],   // dorsiflexed: palm flat on the lip
      [t('pull'), -28, 6, -8],
      [t('press'), -8, 2, -3],
      [t('recover'), 4, 0, 0],
      [t('end'), 0, 0, 0],
    ]),

    // --- LEFT ARM (lateral axes mirrored; offset a few degrees so the two
    //     arms are not in perfect lockstep, which reads as mechanical) ------
    track('Shoulder_L', [
      [t('reach'), 88, -18, -16],
      [t('plant'), 80, -22, -28],
      [t('pull'), 60, -20, -24],
      [t('press'), 28, -14, -12],
      [t('recover'), 7, -6, -2],
      [t('end'), 0, 0, 0],
    ]),
    track('ElbowPivot_L', [
      [t('reach'), 48, 0, 0],
      [t('plant'), 88, 0, 8],
      [t('pull'), 97, 0, 6],
      [t('press'), 23, 0, 0],
      [t('recover'), 19, 0, 0],
      [t('end'), 0, 0, 0],
    ]),
    track('WristPivot_L', [
      [t('reach'), 11, 0, 0],
      [t('plant'), -36, -8, 10],
      [t('pull'), -26, -6, 8],
      [t('press'), -7, -2, 3],
      [t('recover'), 3, 0, 0],
      [t('end'), 0, 0, 0],
    ]),
  ],
  events: [
    { atProgress: T.plant, event: 'mantle_hands_planted' },
    { atProgress: T.press, event: 'mantle_body_over' },
    { atProgress: T.recover, event: 'mantle_release' },
  ],
};

// ---------------------------------------------------------------------------
// VAULT — faster, one decisive hand plant, trailing arm stays low.
// ---------------------------------------------------------------------------
const VAULT_DURATION = 0.62;
const V = { start: 0.0, plant: 0.28, push: 0.55, clear: 0.8, end: 1.0 };
const v = (k) => round(V[k] * VAULT_DURATION);

const vault = {
  name: 'vault_over',
  duration: VAULT_DURATION,
  // Only the leading (right) hand plants; the left stays free.
  ownsIK: 'R',
  tracks: [
    track('Shoulder_R', [
      [v('start'), 14, -4, 2],
      [v('plant'), 78, 20, -12],
      [v('push'), 30, -8, 6],
      [v('clear'), -6, -2, 2],
      [v('end'), -0, 0, 0],
    ]),
    track('ElbowPivot_R', [
      [v('start'), 18, 0, 0],
      [v('plant'), 82, 0, -8],
      [v('push'), 14, 0, -2],     // snaps straight to push off the lip
      [v('clear'), 20, 0, 0],
      [v('end'), -0, 0, 0],
    ]),
    track('WristPivot_R', [
      [v('start'), 8, 0, 0],
      [v('plant'), -30, 6, -10],
      [v('push'), -16, 3, -5],
      [v('clear'), 4, 0, 0],
      [v('end'), -0, 0, 0],
    ]),
  ],
  events: [
    { atProgress: V.plant, event: 'vault_hand_planted' },
    { atProgress: V.push, event: 'vault_push_off' },
  ],
};

mkdirSync(outDir, { recursive: true });
for (const clip of [mantle, vault]) {
  const file = path.join(outDir, `${clip.name}.json`);
  writeFileSync(file, `${JSON.stringify(clip, null, 1)}\n`);
  const tracks = clip.tracks.length;
  const keys = clip.tracks[0].times.length;
  console.log(`[traversal] ${clip.name}.json  ${clip.duration}s  ${tracks} tracks x ${keys} keys  ownsIK=${clip.ownsIK}`);
}
