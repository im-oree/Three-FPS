# DOCUMENT A: Procedural Low-Poly Hand, Arm & Weapon Rig — Full Realism Specification

## 1. Design Philosophy

This project intentionally adopts a **low-poly visual style** (flat-shaded blocky geometry, simple materials, small triangle counts) for two deliberate reasons: (1) it is entirely achievable with **procedural, code-generated geometry** — every asset in this system is produced by a script and saved as a real file, satisfying the project's standing "no runtime procedural generation, but code-generated build-time assets" policy — and (2) it puts the project's effort budget where it matters most: **physics-accurate movement, recoil, sway, and weapon mechanics**, rather than finger-level animation fidelity.

**Hard rule:** fingers are never individually modeled or animated. Grip realism is communicated entirely through **wrist, forearm, and shoulder joint rotation**, hand-block orientation, and weapon-socket alignment.

The aesthetic direction is project-wide: environments also favor simple, flat-shaded, low-poly geometry — but this document's scope is the character rig and weapons.

## 2. Foundational Definitions

**Rigid hierarchical rig (vs. skeletal/skinned mesh):** the arm rig is a **hierarchy of separate rigid meshes** (shoulder block, upper-arm block, forearm block, hand block), each parented to a pivot `THREE.Group` — a classic voxel-game character rig. Rotating a pivot rotates that segment and everything beneath it, with **no vertex deformation** — segments meet edge-to-edge or slightly overlap. Dramatically simpler and cheaper to generate, animate, and reason about than a skinned mesh.

**Joint pivot:** an empty `THREE.Group` positioned exactly at a rotation point (shoulder, elbow, wrist), with the visible segment mesh parented underneath and offset so the mesh's geometric center is *below* the pivot.

**Analytic two-bone solve (rigid version):** "rotate the upper-arm and forearm pivots so the wrist ends up exactly at the weapon's grip point" is pure trigonometry (law of cosines on a two-segment chain).

**Baked joint-keyframe clip:** a small table of `{time, jointName, rotation}` keyframes describing how each pivot's rotation changes over time — authored as plain data (JSON), not exported from a DCC tool. `THREE.AnimationMixer` plays these directly against a rigid, non-skinned hierarchy because Three.js animation targets **named objects and their properties**, not specifically bones.

**Physically-driven recoil:** recoil is an **impulse applied to the wrist and elbow joints themselves** (as if the gun's kick pushes back through the grip, up the forearm, absorbed partly at the elbow and shoulder), which then spring back to neutral.

**Shell casing physics:** ejected casings are small, individually-simulated physics objects (gravity + ground bounce + friction), not canned animation.

## 3. The Procedural Arm Rig

### 3.1 Segment & Joint Hierarchy

```
Shoulder_R (pivot — large-scale arm rotation: sprint pump, guard raise, idle shift)
└─ UpperArmPivot_R (pivot — shoulder joint rotation, solved by 2-bone IK)
     └─ [UpperArm mesh, box, sleeve-colored]
     └─ ElbowPivot_R (pivot — elbow joint rotation, solved by 2-bone IK)
          └─ [Forearm mesh, box, skin or sleeve-colored]
          └─ WristPivot_R (pivot — final fine-orientation joint; sway/recoil-kick/
                             look-layer offsets apply here)
               └─ [Hand mesh, small flattened box — the "mitt"]
                    └─ [ThumbNub mesh — silhouette read, never animated]
                    └─ Socket_HandGrip_R (empty — where a weapon's Socket_Grip aligns)
```

Mirrored `_L` side; both under a shared `Torso_Reference` empty under `ViewmodelRigRoot`.

**Why only three rotating joints per arm:** enough to (a) reach any weapon's grip via 2-bone IK, and (b) produce every required gesture (punch, reload, sprint pump, guard) without finger detail.

### 3.2 Rig-Builder (reference)

`buildArmRig(side, {skinColor, sleeveColor})` — see `tools/builders/HandRigBuilder.js` (exact dimensions from the spec's DIMS table; segments hang below their pivots; `Socket_HandGrip_${side}` at 65% down the hand block).

### 3.3 Generating & Saving the Rig as a Real Asset

`tools/generateHandModel.js` invokes the builder once and exports via `GLTFExporter` to `assets/models/characters/arms_standard.glb` (and `arms_gloved.glb`). The running game only loads the resulting files.

### 3.4 Skins / Variants — Data, Not Geometry

Skins are **material swaps** (`HandSkinRegistry`: named skin → `{ skinColor, sleeveColor }` applied to the existing materials at equip time), or a second saved `.glb` with different DIMS/colors — zero new code.

## 4. Procedural Weapon Models

### 4.1 Socket Contract

Every weapon exposes named empties: `Socket_Grip`, `Socket_GripSecondary`, `Socket_Muzzle`, `Socket_Magazine`, `Socket_Ejection`, `Socket_Optic` — added as `THREE.Object3D` children during procedural construction.

### 4.2 Builders

`tools/builders/RifleBuilder.js` / `PistolBuilder.js` / `ShotgunBuilder.js` — the same `box()`/`cyl()` primitive helpers; moving parts get names: `Bone_Magazine`, `Bone_ChargingHandle` (rifle), `Bone_Pump` (shotgun). A new weapon is a new arrangement of boxes/cylinders plus one socket pass — never new rendering code.

### 4.3 Saving Weapon Models

`tools/generateWeaponModels.js` builds each weapon, validates the six sockets, and exports to `assets/models/weapons/{rifle,pistol,shotgun}.glb` — run once, committed.

### 4.4 Materials

Flat-shaded `MeshStandardMaterial` with solid colors; optional canvas-baked grime textures at generation time.

## 5. Grip Alignment — Rigid Two-Bone Solve

`solveTwoBoneIK` (src/character/JointIK.ts): law of cosines; the upper-arm pivot aims local −Y at the elbow solution, the elbow pivot bends by `−(π − elbowAngle)` about the bend axis; clamped to max reach. Called every frame per arm with the weapon's grip socket in shoulder-local space. **Any new weapon with correctly-placed sockets works immediately.**

## 6. Rendering Pipeline

Unchanged: world (layer 0) → `clearDepth` → viewmodel (layer 1) → restore mask.

## 7. Animating a Rigid Rig

### 7.1 Two Motion Sources
- **Procedural:** sway, breathing, recoil-kick+recovery, look-layer, pose blending — computed every frame.
- **Baked joint-keyframe clips:** reload, switch, inspect, punches — JSON tables under `assets/animations/`, played via one shared `AnimationMixer` bound to `ViewmodelRigRoot`.

### 7.2 Clip Data Format
JSON: `{ name, duration, tracks: [{node, times, quaternions}], events: [{atProgress, event}] }` → `buildClipFromData()` → `THREE.AnimationClip` + event table.

### 7.3 Required Baked Clips (per weapon class)
`reload_tactical`, `reload_empty`, `switch_out`, `switch_in`, `inspect` (fire flourish optional). Sprint/tac-sprint/slide/crouch/ADS are **procedural pose blends**.

### 7.4 Layering
Baked one-shots temporarily override the joints they list; every joint NOT listed stays procedurally driven — no masking system needed.

## 8. Full Physical Realism Systems

### 8.1 Weapon Sway — per-joint spring-dampers (`JointSpring`): wrist spring takes the snappy look-delta component; forearm/elbow a slower, larger-radius component (two-stage "whip" settle). Movement velocity adds a small wrist wobble.

### 8.2 Idle Breathing — slow sine into the SHOULDER spring target.

### 8.3 Recoil — joint-distributed: on `weapon:fired`, an instantaneous displacement split

| Joint | Contribution | Recovery |
|---|---|---|
| Wrist | Largest, fastest | Fast spring |
| Elbow | Moderate | Medium |
| Shoulder | Small, slower | Slow |
| Camera | Small rotational punch only | unchanged `PlayerCamera.applyRecoilKick()` |

All proportions are per-weapon data.

### 8.4/8.5 Muzzle flash & tracers — unchanged (pooled, socket-driven).

### 8.6 Shell Casing Ejection — mini-physics: gravity 9.8, restitution 0.35, friction 0.6, randomized eject velocity/spin, pooled tiny cylinders from `Socket_Ejection` (+X eject dir), ground contact via downward raycast against level geometry, despawn after settling.

### 8.7 Reload Detail — at `magazine_detach` (35%): `Bone_Magazine` hidden + a pooled falling-magazine physics object spawns; at `magazine_attach` (55%): fresh magazine shown at `Socket_Magazine` + ammo updates; at `chamber_round` (85%, empty only): `Bone_ChargingHandle` procedural pull-and-release.

### 8.8 Pitch-Driven Look Layer — an additional target offset fed into the shoulder/wrist springs; composites automatically.

## 9. Movement Integration (joint targets)

| State | Shoulder | Elbow/Wrist | Off-Hand |
|---|---|---|---|
| IDLE/WALK | Neutral hip-carry | IK to grip, sway/breathing | IK to foregrip |
| SPRINT | Weapon inward/down (~0.2s blend) | IK engaged | Stays gripped |
| **Tactical Sprint** | Weapon fully to hip/side | Primary fine-orientation released | **Releases foregrip → free stride-synced swing**; snaps back on end |
| CROUCH | Slightly lowered | Tightened sway | On foregrip |
| SLIDE | Tucked-in, both arms pulled to torso | IK relaxed | Tucked |
| JUMP/AIR | Neutral + float offset | IK engaged | On foregrip |
| ADS | Optic aligned to camera | Sway minimized, recoil reduced | Tightest lock |

## 10. Off-Hand Behavior (Warzone/MW-style)

Hipfire/ADS/walk/crouch: locked to `Socket_GripSecondary`. Regular sprint: stays gripped. **Tactical sprint: releases entirely, procedural free swing** — the tell that distinguishes tac-sprint. Reload: off-hand driven by the baked reload clip's joints, returns to IK when the clip ends.

## 11. Camera vs. Arm Shake

| Effect | Camera | Arms |
|---|---|---|
| Firing | Small punch | Large primary kick |
| Landing | Small dip | Small settle-kick |
| Sprint transition | None | Pose-blend |
| Damage | Large shake | None |
| Look pitch | N/A | Shoulder/wrist offset |

## 12. Required Files

```
/tools/builders/{HandRigBuilder,RifleBuilder,PistolBuilder,ShotgunBuilder}.js
/tools/{generateHandModel,generateWeaponModels}.js
/src/character/{JointIK,JointSpring,HandSkinRegistry}.ts
/src/weapons/CasingPhysics.ts
/src/animation/BakedClipLoader.ts
/assets/models/characters/arms_standard.glb, arms_gloved.glb
/assets/models/weapons/{rifle,pistol,shotgun}.glb
/assets/animations/*.json
```
(Builders live under /tools because the game never imports them — it only loads the exported .glb files; TS project has no allowJs.)

## 13. Acceptance Criteria

- [ ] Arm rig fully generated by `generateHandModel.js`, saved as real .glb; game only loads it.
- [ ] All three weapons generated with all six sockets correctly placed.
- [ ] `solveTwoBoneIK` aligns both hands to any weapon's sockets; `arms_gloved.glb` swaps with zero code changes.
- [ ] Recoil visibly displaces wrist most, elbow some, shoulder slightly, camera a small punch — spring-recovered independently.
- [ ] Casings eject with randomized trajectories, bounce off real ground geometry, despawn after settling.
- [ ] Reload hides/shows the magazine at the correct event percentages; charging handle racks procedurally on empty reloads.
- [ ] Tactical sprint releases the off-hand into a free swing; re-grips on exit.
- [ ] Sway, breathing, recoil, look-layer, and pose-blends sum through the shared per-joint springs with no fighting.
