# Coordinate & Orientation Conventions (Document C §3 — MANDATORY)

One convention, enforced project-wide. The root cause of "upside-down" and
"backwards" bugs is two parts of the codebase silently disagreeing about
axes. This file is the single source of truth; the F4 gizmo (Debug) and
`tools/validateModelOrientation.js` are its enforcement tools.

## World Space
- **+X** = world right, **+Y** = world up, **+Z** = toward the default camera start.
- **Forward (movement/facing) is −Z** at yaw = 0. Three.js is right-handed;
  −Z-forward is gospel.
- **Yaw** rotates around +Y, positive = counter-clockwise seen from above →
  increasing yaw turns the player LEFT. Rightward mouse input applies a
  NEGATIVE yaw delta (sign documented at the single application point in
  `PlayerCamera`).
- **Pitch** rotates around the camera's local +X; positive = look up.
  Clamped to [−89°, +89°].

## Viewmodel Root (camera-local)
- `ViewmodelRigRoot` is a child of the camera: its local −Z is always
  "into the screen", matching world convention exactly.
- Every viewmodel offset (sway, recoil, pose blend) is expressed in THIS
  local space, never world space.

## Arm-Rig Joint Local Space (critical)
> **A joint pivot's local −Y always points down the length of the limb
> segment it controls, toward its child joint, at rest pose.**

This is why `HandRigBuilder.makeSegment()` offsets each mesh by
`position.y = −size[1]/2` (segments hang below their pivots). The two-bone
IK solver's `aimQuat` (`setFromUnitVectors((0,−1,0), forward)`) depends on
this holding. A rig variant built with segments along +Y/+Z will IK-bend
90°/180° wrong.

**Enforcement:** every new rig builder variant must pass the §3.6 validation
(F4 gizmo + offline validator) before its asset is committed.

## Weapon Local Space
- `Root_Weapon` local **−Z points down the barrel, out the muzzle** — a
  weapon at rest with zero rotation aims at world −Z with no corrective
  rotation.
- `Socket_Muzzle` local −Z points down the barrel (drives muzzle flash,
  tracer, and casing eject direction is its local **+X**).
- `Socket_Grip` / `Socket_GripSecondary` local −Y points where the palm-to-
  fingers wrap curls (down, slightly forward) — matches the hand's −Y-down
  convention so the IK alignment never renders a hand backwards.
- `Socket_Optic` local −Z points out through the lens toward the target;
  local +Y is the shooter's "up". The ADS/scope system (Document C §8)
  depends entirely on this socket's orientation.

## Euler Order
Manual pitch/yaw/roll composition always uses **`'YXZ'`** (yaw first, then
local pitch, then roll):
```ts
new THREE.Euler(pitch, yaw, roll, 'YXZ')
```
Never rely on Three.js's default `'XYZ'` for FPS camera composition.

## Units
Metres, seconds, radians internally; degrees only in data files
(`WeaponProfile` tables, `Constants` `*_DEG` fields) converted at load.

## Validation Tools
1. **In-engine (primary):** press **F4** — renders an AxesHelper at every
   `Socket_*` on the equipped weapon and at every arm-rig joint pivot.
   Red = +X, Green = +Y, Blue = +Z.
2. **Offline:** `node tools/validateModelOrientation.js <path-to-glb>`
   loads the generated asset and prints each socket's world forward (−Z),
   up (+Y), right (+X) — cross-check against the visible geometry before
   committing any new model.
