# FIRST-PERSON CONTROLLER & VIEWMODEL SYSTEM — COMPLETE TECHNICAL SPECIFICATION

*(This is a standalone, deep-dive specification for the single most important subsystem in "OPERATOR": the first-person body — hands, arms, and weapons — and everything that drives how it moves, animates, and feels. It supersedes and significantly expands the relevant portions of Document 2 (movement/camera) and Document 3 (weapons/animation) with the full realism-focused detail needed for an AI agent to build this from nothing, using real hand and gun models. This document is written so that adding a **new** hand model or a **new** gun model later requires only conforming to the rig/socket contract defined here plus (at most) authoring one new "hold pose" — **never new code, never per-gun animation retargeting work by hand.**)*

---

## 0. Relationship to Prior Documents

- Document 2 defined movement physics (walk/sprint/crouch/slide/jump) and basic camera control at a "player capsule" level. **This document keeps that physics simulation intact but adds a second, distinct concept: Tactical Sprint**, and formally defines exactly how every movement state maps to weapon/hand posture, position, and animation.
- Document 3 defined weapon data, ballistics, recoil, and a first pass at the animation system. **This document replaces Document 3's animation section entirely** with a full layered-animation, IK-driven, retargeting-safe architecture, and replaces Document 3's viewmodel-rendering section with a fully specified dual-purpose rig designed for a future third-person mode.
- Everything else from Documents 1, 4, 5, 6 (engine, levels, UI, audio, polish) remains as previously specified and is assumed to exist. Where this document changes a file's responsibility, that file's earlier spec is considered **superseded**, not additive.

---

## 1. Foundational Definitions

**Viewmodel rig:** The combination of an arm/hand skeleton and an attached weapon skeleton, rendered in the foreground of the first-person camera, animated by a mix of pre-authored skeletal clips and real-time procedural adjustments.

**Retargeting:** The process of applying an animation authored for one skeleton to a *different* skeleton with the same bone hierarchy/naming but different proportions (bone lengths, arm length, hand size). Standard skeletal animation retargeting works by matching bones **by name**, not by exact shape — meaning if every hand model and every weapon conforms to the same named bone/socket contract, the same animation data and the same code can drive any of them.

**Socket (attachment point):** A named, empty transform (no visible geometry) authored inside a model's file, used as a precise anchor point for attaching or aligning something else — e.g., a weapon's `Socket_Muzzle` is where muzzle flash effects spawn; a weapon's `Socket_Grip` is where the hand's palm should align.

**Inverse Kinematics (IK):** A technique where, instead of directly animating every bone rotation by hand, you specify a **target position** for an end effector (like the hand) and let an algorithm compute the chain of bone rotations (e.g., shoulder → elbow → wrist) needed to reach it. This is essential for a generic hand-to-weapon-grip system, because it lets one hand rig correctly grip *any* weapon's grip socket without a human animator re-posing the hand for every single weapon.

**Additive animation layer:** An animation blending technique where a clip is applied as a *delta/offset* on top of whatever the base layer is already doing, rather than replacing it — e.g., an "aim down sights" pose can be layered additively on top of a walking animation so the character's legs/body keep walking correctly while the arms simultaneously shift into an aiming posture.

**Procedural animation:** Animation computed live, every frame, from a mathematical formula driven by real-time input (mouse movement, velocity, time) — as opposed to "baked" animation, which is a fixed sequence of keyframes played back identically regardless of input. Procedural animation is required wherever behavior must react continuously and precisely to player input (weapon sway, breathing, recoil recovery); baked animation is preferred wherever a specific, hand-crafted, complex motion needs to look exactly right regardless of input (reloading, switching weapons).

**Spring-damper model:** A common procedural-animation technique that simulates a physical spring pulling a value toward a target, with damping to prevent infinite oscillation — used extensively here for weapon sway, recoil recovery, and idle breathing, because it produces smooth, natural-feeling, continuously-reactive motion far better than fixed-duration lerps.

**Tactical Sprint ("Tac Sprint"):** A distinct, faster movement mode (present in modern Call of Duty titles) triggered separately from regular sprint — typically a double-tap of the sprint key while already sprinting, or a dedicated bind — that increases speed further beyond normal sprint, fully lowers/holsters the weapon out of a ready position, and requires a brief, deliberate transition animation to raise the weapon back to a firing-ready stance before the player can fire or ADS again. This is mechanically and visually distinct from regular sprint (which in this project still allows a quick "snap-up" back to firing).

**Root motion vs. in-place animation:** Root motion is animation where the actual root bone of a skeleton physically translates through space as part of the clip (used in third-person character movement, where footstep timing must match ground contact exactly). In-place animation loops in place with no net translation, and the *simulation* (Document 2's capsule) drives the actual world-space movement instead. **This project uses in-place viewmodel animation exclusively** — the simulation, never the animation clip, is the source of truth for world position, which is what makes procedural layering and retargeting clean.

---

## 2. Asset & Rig Contract — The Core of Retargeting-Safe Design

This section is the single most important part of this document. If followed correctly, **swapping in a new hand model or a new gun model requires zero code changes** — only conforming to this contract and, at most, authoring one new weapon-specific "hold pose" reference.

### 2.1 Canonical Arm/Hand Skeleton

Every hand/arm model (`.glb`) used in this game — no matter who models it or how it looks — **must** be rigged with exactly this bone hierarchy and exactly these names:

```
Root_Arms
└─ Shoulder_R
   └─ UpperArm_R
      └─ Forearm_R
         └─ Hand_R
            ├─ Thumb_R_01 → Thumb_R_02 → Thumb_R_03
            ├─ Index_R_01 → Index_R_02 → Index_R_03
            ├─ Middle_R_01 → Middle_R_02 → Middle_R_03
            ├─ Ring_R_01 → Ring_R_02 → Ring_R_03
            └─ Pinky_R_01 → Pinky_R_02 → Pinky_R_03
└─ Shoulder_L
   └─ UpperArm_L
      └─ Forearm_L
         └─ Hand_L
            └─ (same finger chain naming with _L suffix)
```

Requirements:
- Bone **names** must match exactly (case-sensitive) — this is what allows the same code and the same animation clips to drive any conforming rig regardless of the model's actual mesh/proportions.
- Bone **orientations** (local rotation axes at rest/bind pose) must follow a single documented convention across every model (e.g., bone's local +X always points down the length of the limb toward its child) — this is what makes retargeting produce correct results instead of twisted/broken limbs when swapping models.
- A rest/bind pose (T-pose or A-pose — pick one convention project-wide, document it, and never mix) must be identical in spirit across every hand model submitted.
- Finger bones are required (not optional) because trigger-finger animation and grip-conforming poses on the index finger specifically are expected for realism (finger actually curls onto the trigger).

Any new hand model that conforms to this exact hierarchy/naming/orientation/rest-pose convention is a **drop-in replacement** — no code in `WeaponViewmodel.js`, `AnimationBlender.js`, or the IK system needs to change.

### 2.2 Canonical Weapon Rig & Socket Contract

Every weapon model (`.glb`) must contain, at minimum, these named empties/bones (some are pure sockets with no animation; some are actual animated bones for moving parts):

| Name | Type | Purpose |
|---|---|---|
| `Root_Weapon` | Bone | The weapon's own root, parented at runtime to the hand's attachment point (Section 2.4) |
| `Socket_Grip` | Empty | Where the primary (right) hand's palm should align — the core reference point the entire hand-alignment system is built around |
| `Socket_GripSecondary` | Empty | Where the off-hand (left hand, or foregrip-supporting hand) should align — critical for the generic off-hand IK described in 2.5 |
| `Socket_Muzzle` | Empty | Muzzle flash / tracer spawn point, oriented so its local +Z points down the barrel |
| `Socket_Magazine` | Empty | Where a magazine mesh attaches/detaches during reload animation |
| `Socket_Ejection` | Empty | Where shell-eject particle effects spawn (future polish hook) |
| `Socket_Optic` | Empty | Where the player's eye/camera should align when ADS is active (see Section 7) |
| `Bone_Bolt` (optional) | Bone | Animated bolt/slide part, moved during fire/reload clips if the model supports it |
| `Bone_Magazine` (optional) | Bone | If the magazine itself is a rigged/animated sub-part rather than a swap-hidden mesh |
| `Bone_ChargingHandle` (optional) | Bone | Animated during "reload_empty" to visually chamber a round |

Requirements:
- `Socket_Grip`, `Socket_GripSecondary`, `Socket_Muzzle`, `Socket_Magazine`, and `Socket_Optic` are **mandatory** on every weapon — the entire system (hand IK, muzzle flash, reload magazine swap, ADS camera alignment) is driven by looking these up by name. A weapon missing any of these sockets is an invalid asset and must be rejected by a validation step in the asset pipeline (`generateWeaponModels.js` from Document 3 should assert their presence before exporting).
- `Bone_Bolt`/`Bone_Magazine`/`Bone_ChargingHandle` are optional — if absent, the animation system simply skips the corresponding moving-part animation for that weapon (a plain "less mechanically detailed" weapon is acceptable; a missing *socket* is not).

### 2.3 The `WeaponProfile` Data Contract

Every weapon, in addition to its Document 3 `WeaponBase`-derived gameplay data (damage, fire rate, etc.), carries a **presentation profile** — a small, purely-visual data file consumed only by the viewmodel/animation system:

```js
// WeaponProfile for AssaultRifle
{
  weaponId: 'assault_rifle',
  modelPath: '/assets/models/weapons/assault_rifle.glb',

  // Local-space offset fine-tuning applied AFTER automatic grip-socket alignment,
  // for final artistic hand-placement correction (small values, e.g. centimeters/degrees)
  gripFineTuneOffset: { position: [0, 0, 0], rotationEuler: [0, 0, 0] },
  gripSecondaryFineTuneOffset: { position: [0, 0, 0], rotationEuler: [0, 0, 0] },

  // Where the weapon sits relative to the camera at hip-fire rest (before any sway/bob)
  hipRestPosition: [0.28, -0.22, -0.55],
  hipRestRotationEuler: [0, -8, 0],

  // Camera-to-Socket_Optic alignment used for ADS (Section 7)
  adsCameraOffset: [0, 0, 0],  // fine-tune only; primary alignment is automatic via Socket_Optic

  // Which baked hold-pose clip to use as the base "idle grip" (Section 6.4)
  holdPoseClipName: 'hold_rifle_twoHanded',

  // Whether this weapon uses two-handed grip (Socket_GripSecondary active) or one-handed (pistol-style, secondary hand may rest on wrist/frame instead)
  gripStyle: 'twoHanded', // or 'oneHanded'

  swayProfile: 'rifle_default',      // key into a small table of sway spring constants (Section 6.5)
  breathingProfile: 'rifle_default', // key into a small table of breathing amplitude/frequency
}
```

This is the file a developer edits when adding a new gun — **never** a code file. `gripStyle: 'oneHanded'` for a Pistol tells the IK system (2.5) to relax the off-hand IK target to a "supporting the wrist" pose instead of a foregrip pose, again driven entirely by data, not by writing new pistol-specific code.

### 2.4 How a New Hand Model Plugs In (Zero Code)

1. Rig the new hand/arm model exactly per Section 2.1.
2. Export to `.glb`, place under `/assets/models/characters/`.
3. Point `Constants.js`'s (or a small `CharacterModels.js` config's) `activeArmsModelPath` at the new file.
4. Because every existing baked animation clip (hold poses, reload, switch, inspect) was authored against the *named bone hierarchy*, not against a specific model's mesh, Three.js's skeletal animation system retargets automatically as long as bone names match — **the same clips, unmodified, drive the new hands.** The only visual difference will be the new model's actual proportions/appearance.
5. The IK system (2.5) recalculates grip alignment live every frame from the *current* rig's actual bone lengths, so even a hand model with meaningfully different arm/finger proportions correctly reaches each weapon's `Socket_Grip` without any manual re-tuning.

### 2.5 How a New Gun Model Plugs In (Zero Code, One Data File)

1. Rig the new weapon exactly per Section 2.2 (mandatory sockets present, named correctly).
2. Export to `.glb`, place under `/assets/models/weapons/`.
3. Author one `WeaponProfile` entry (Section 2.3) and one `WeaponBase` gameplay-data entry (Document 3, Section 6.2) for it.
4. At runtime, `WeaponViewmodel.js` (Section 3) does the following automatically, for **any** weapon conforming to the contract:
   - Loads the weapon `.glb`, reads `Socket_Grip`'s world transform.
   - Runs the **two-bone IK solver** (Shoulder→Elbow→Wrist for the primary hand; same for the secondary/off-hand toward `Socket_GripSecondary`) to bend the current hand rig's arm so `Hand_R`'s palm-anchor point reaches and orients to match `Socket_Grip` (and `Hand_L` to `Socket_GripSecondary`), each frame, live.
   - Applies `gripFineTuneOffset`/`gripSecondaryFineTuneOffset` as a final small correction on top of the IK solve, for cases where automatic alignment is 95% right but an artist wants the thumb wrap or finger curl to look slightly better on a specific gun.
   - Applies the weapon's `holdPoseClipName` as the base finger-curl pose (a **baked hand-pose-only clip**, authored once per grip *style*, not once per *weapon* — e.g., one `hold_rifle_twoHanded` clip is reused by the Assault Rifle, SMG, and any future rifle-style weapon, since IK handles the positional differences and the hand-pose clip only needs to handle finger curl/wrap shape, which is similar across similarly-shaped grips).
5. **Net result:** adding a tenth rifle later requires: model + rig + sockets + one `WeaponProfile` entry + one `WeaponBase` entry, reusing 100% of existing code, the existing IK system, and even the existing `hold_rifle_twoHanded` hand-pose clip if its grip shape is similar enough. A completely novel grip shape (e.g., a large launcher) would warrant authoring one new hold-pose clip, still zero code changes.

---

## 3. Rendering Architecture — How Hands + Guns Actually Get Drawn

### 3.1 Viewmodel Rig Hierarchy (Runtime Scene Graph)

```
MainCamera (THREE.PerspectiveCamera, driven by PlayerCamera.js)
└─ ViewmodelRigRoot (THREE.Object3D, child of camera — inherits camera rotation automatically)
     ├─ (positioned via hipRestPosition/ADS offset, sway, bob — Section 6)
     └─ ArmsSkinnedMesh (the loaded hand/arm .glb, with its skeleton)
            └─ Weapon attachment: weapon's Root_Weapon reparented under the arm's
               Hand_R bone at runtime (NOT under ViewmodelRigRoot directly) so the
               weapon inherits the hand's animated transform naturally, with the IK
               system (2.5) then correcting the arm chain so Hand_R itself ends up
               exactly at Socket_Grip's required position — i.e., IK solves the arm
               to satisfy "hand must be wherever the weapon's grip socket is."
```

This "weapon defines where the hand must be, arm IK bends to satisfy it" direction (rather than "hand plays a fixed animation, weapon is glued wherever the hand ends up") is the specific design choice that makes the system generic across arbitrary weapon shapes.

### 3.2 Avoiding World-Geometry Clipping

Chosen technique (must be implemented exactly, for consistency with the third-person-blend goal in 3.3): render the viewmodel rig on a **separate Three.js layer** (`THREE.Layers`, e.g. layer index `1`), and perform rendering in two passes each frame:
1. Render the main scene (world geometry, layer `0`) normally with the main camera.
2. Call `renderer.clearDepth()`.
3. Enable only layer `1` on the main camera temporarily, render again (this draws the viewmodel rig fresh, ignoring world depth, so it's always in front), then restore the camera's layer mask to `0` for the next frame's world pass.

This avoids needing a second camera object entirely (simpler than a dual-camera approach), keeps FOV/perspective perfectly consistent between world and viewmodel (important for realism — a mismatched viewmodel FOV is a classic amateur-shooter visual bug), and requires no near-plane hacks that could cause the viewmodel to clip into itself at extreme angles.

### 3.3 Designing for Future Third-Person Blending

The reason the arm rig (2.1) is a fully generic, standalone skeleton (not something hacked together only for a floating first-person view) is specifically so that later a **third-person body** can be added that:
- Shares the exact same `Root_Arms`-downward bone naming for its arms (attached to a fuller third-person body skeleton with legs/spine/head above it).
- Is driven by the **same `PlayerState`/`AnimationStateMachine` output** (Document 2/3) — the state machine doesn't know or care whether it's animating a first-person floating-arms rig or a full third-person body; it just resolves "current state → clip name(s) + layer weights" and hands that off to whichever skinned mesh(es) are currently active.
- A future "third person mode" (spectator cam, killcam, or eventual multiplayer remote-player rendering) simply **activates a second, fuller-body skinned mesh** using the same animation clips (the arm-specific ones apply identically; new leg/spine/head clips are added for the parts the first-person rig never needed), positioned at the player capsule's actual world transform instead of parented to the camera — no changes to `AnimationStateMachine` are required, only a new consumer of its already-existing output.
- **Action item embedded now:** `AnimationStateMachine.js` (Document 3) must resolve to **clip names + layer weights as data**, not directly call `viewmodel.playClip(...)` internally — instead it should emit a resolved animation descriptor that any number of registered "animation targets" (currently just the viewmodel; later, also a third-person body) can independently consume. This is a required refinement to Document 3's original design, specified here because it only becomes obviously necessary once third-person blending is a stated goal.

---

## 4. Movement Physics — Full Specification, Weapon-Integrated

This section keeps Document 2's underlying capsule simulation (position/velocity/fixed-timestep) intact and fully specifies (a) the previously-underspecified **Tactical Sprint**, and (b) exactly how every movement state visually and mechanically affects the weapon.

### 4.1 Movement States Recap (from Document 2, referenced here)
`IDLE, WALK, SPRINT, CROUCH_IDLE, CROUCH_WALK, SLIDE, JUMP, AIR, LANDING` — unchanged. This document adds one new orthogonal flag: `isTacticalSprinting: boolean`, tracked alongside (not replacing) the `SPRINT` state.

### 4.2 Regular Sprint — Weapon Behavior
- Speed: `walkSpeed × sprintSpeedMultiplier` (Document 2, unchanged).
- Weapon visual: the viewmodel rig lerps (over `SPRINT_WEAPON_LOWER_DURATION`, e.g. 0.2s) from hip-rest pose to a **lowered, angled-inward "ready jog" pose** (a distinct baked or procedural offset — a position/rotation delta applied on top of `hipRestPosition`), signaling "not currently aiming to fire" without fully holstering.
- Firing/ADS during regular sprint: **allowed with a brief interrupt** — pressing fire or ADS while regular-sprinting immediately cancels sprint (back to `WALK` state) and triggers a quick "snap up to ready" transition (`SPRINT_TO_READY_DURATION`, e.g. 0.12s, fast and punchy) before the shot/ADS actually executes; this snap delay is a deliberate, small, tunable cost (matches modern shooter feel of "you can't fire instantly out of a dead sprint, but it's fast").
- Head bob/sway amplitude increased per Document 2.

### 4.3 Tactical Sprint — Full New Mechanic

**Trigger:** double-tap the `sprint` action within a short window (`TAC_SPRINT_DOUBLE_TAP_WINDOW`, e.g. 0.3s) while grounded and already moving forward, **or** a dedicated separate keybind if the settings menu (Document 5) exposes one — implement double-tap detection as the default, with the bind itself still going through `InputManager`'s normal action system so it remains rebindable.
- Detection logic lives in a small internal timer inside `PlayerMovement.js`/`PlayerController.js`: record timestamp of each `sprint`-press edge; if a second press-edge occurs within the window while the first sprint is still active, promote to Tactical Sprint instead of just continuing regular sprint.
- **Speed:** `walkSpeed × tacSprintSpeedMultiplier`, a distinct, higher constant than regular sprint's multiplier (e.g., regular sprint 1.5×, tac sprint 1.8×) — tactical sprint is strictly faster.
- **Weapon visual:** the weapon fully lowers to a distinct, more extreme **holster-adjacent pose** (arm swings down and inward further than regular sprint's pose — a fully separate baked pose or procedural offset, `TAC_SPRINT_WEAPON_POSE`), signaling total non-readiness.
- **Firing/ADS during tac sprint: fully disallowed**, with **no instant-cancel-on-fire-press shortcut** like regular sprint has — pressing fire or ADS while tac-sprinting does nothing except immediately **end tac sprint** (drop back to regular `SPRINT` or `WALK` depending on continued input), after which the normal sprint-to-ready snap-up (4.2) applies from there. This two-step cost (tac-sprint press does nothing but cancel tac-sprint; a second press is needed to actually fire) is the deliberate, correct-feeling distinction between regular and tactical sprint, matching the mechanic's real-world design intent: tac sprint trades combat-readiness for maximum speed.
- **Exit conditions:** releasing `sprint`, hitting an obstacle/wall (collision-stopped), stamina depletion (if `StaminaSystem`, Document 2, is configured to drain faster during tac sprint via a distinct drain-rate constant — recommended), or any input that reduces forward-input angle below the sprint-eligibility threshold.
- **Stamina interplay:** tac sprint drains `StaminaSystem`'s meter at a steeper rate constant than regular sprint (`TAC_SPRINT_STAMINA_DRAIN_RATE > SPRINT_STAMINA_DRAIN_RATE`), reinforcing it as a short, committed burst rather than a sustainable default movement mode.

### 4.4 Slide — Full Physics (Recap + Weapon Integration)

Physics unchanged from Document 2 (boost-then-ease-out-decay, capsule/camera height lerp, tilt, steer influence, jump-cancel, cooldown). **New weapon-integration requirements added here:**
- On slide entry, the weapon rig lerps into a **slide-specific pose**: arm/weapon angled slightly downward and outward for balance-read visual correctness, distinct from crouch's pose, matching the camera's slide tilt (Document 2's `SLIDE_CAMERA_TILT_DEG`) with a complementary counter-lean on the weapon so it doesn't look like it's floating disconnected from the tilted view.
- Firing during a slide is **allowed** (unlike sprint) but with a temporary spread penalty applied via `WeaponBase.getCurrentSpreadAngle()`'s movement-state modifier (Document 3) — sliding counts as a "moving fast" state for spread purposes, on par with or worse than sprint-adjacent spread values.
- ADS during a slide is **disallowed** — attempting to ADS mid-slide is a no-op until the slide ends (matching the physical implausibility of precisely aiming while sliding).

### 4.5 Crouch — Weapon Integration
- Weapon rig position lerps downward slightly less than the camera does proportionally (a subtle, deliberate offset so the gun doesn't feel like it shrinks 1:1 with the camera — small artistic correction, tunable) to preserve a natural-looking crouched aiming posture.
- No firing/ADS restrictions beyond Document 3's existing spread bonus for being stationary/crouched (crouching *improves* spread, unlike sprint states).

### 4.6 Jump / Air — Weapon Integration
- A brief, small procedural "float" offset (weapon drifts slightly, spring-damped) applied while airborne, and a corresponding small downward "settle" kick on landing (paired with Document 2's camera landing dip) — both purely cosmetic additive offsets, layered exactly like sway (Section 6.5's spring-damper model reused here with different constants).

### 4.7 Movement-State-to-Weapon-Pose Summary Table

| Movement State | Weapon Pose Target | Fire Allowed | ADS Allowed | Spread Modifier |
|---|---|---|---|---|
| `IDLE` / `WALK` | `hipRestPosition` (from `WeaponProfile`) | Yes | Yes | Base |
| `SPRINT` | Lowered "ready jog" pose | Yes (with snap-up delay) | Yes (with snap-up delay) | N/A while sprinting |
| Tactical Sprint | `TAC_SPRINT_WEAPON_POSE` (fully lowered) | No (cancels tac sprint instead) | No (cancels tac sprint instead) | N/A |
| `CROUCH_IDLE` / `CROUCH_WALK` | Slightly lowered hip-rest | Yes | Yes | Improved (tighter) |
| `SLIDE` | Slide-specific angled pose | Yes | No | Worsened |
| `JUMP` / `AIR` | Hip-rest + float offset | Yes | Yes | Worsened |
| `LANDING` | Hip-rest + settle kick | Yes (brief accuracy penalty) | Yes | Temporarily worsened |
| ADS (any eligible base state) | Raised to `Socket_Optic`-aligned pose | Yes | — | Greatly improved |

---

## 5. Input & Interaction Model

All actions below go through `InputManager.isActionDown()`/edge-detection exactly as established in Documents 1–3; this section defines the **exact interaction semantics** (hold vs. toggle vs. double-tap vs. edge-triggered), since ambiguity here directly causes mushy, unresponsive-feeling controls.

| Action | Interaction type | Notes |
|---|---|---|
| Fire | Level-triggered (auto) / edge-triggered (semi) per `FireModeSystem` | Document 3, unchanged |
| ADS | Hold **by default**, with a "Toggle ADS" option in Settings (Document 5) writing a boolean to `SettingsStore` that `WeaponManager` reads to choose hold-vs-toggle behavior at runtime — both must be fully supported, not just hold | |
| Reload | Edge-triggered single press | Re-pressing during an active reload is ignored (already reloading) |
| Sprint | Hold = regular sprint; double-tap-within-window (4.3) = promote to Tactical Sprint | Releasing at any point drops back to `WALK` |
| Crouch | Hold **by default**, "Toggle Crouch" option in Settings, identical dual-support pattern to ADS | Slide trigger (4.4) is always the edge (press-transition) of this action while sprinting, regardless of hold/toggle mode |
| Weapon Switch (1/2, scroll) | Edge-triggered | Queued/ignored appropriately if already mid-switch (Document 3) |
| Melee (future-reserved bind, `V`) | Edge-triggered | Not implemented in this document's scope but the input action and animation state slot (`MeleeState.js`, Document 3) should already exist per Document 3's spec — this document just confirms the input-handling pattern it should follow |

**Buffering rule (important for feel):** a fire input pressed during the last ~100ms of a reload or switch animation should be **buffered** (remembered) and automatically executed the instant the blocking action completes, rather than requiring the player to re-press at the exact right frame — implement via a small timestamped "pending action" flag checked at the end of `ReloadSystem`/switch completion, a standard responsiveness technique in polished shooters.

---

## 6. Animation System — Full Layered Architecture

### 6.1 Layer Stack (Evaluated in This Exact Order, Every Frame)

1. **Base Locomotion Layer** — a single baked clip selected by current `PlayerState` movement state (`idle`, `walk`, `walk_back`, `strafe_left`, `strafe_right`, `sprint`, `tac_sprint` *(new)*, `jump_start`, `jump_loop`, `jump_land`, `slide`, `crouch_idle`, `crouch_walk`), crossfaded between on transition (Document 3's `AnimationBlender.crossfadeTo`).
2. **Hold-Pose Layer (additive, always-on)** — the weapon's `holdPoseClipName` (Section 2.3), applied additively to shape finger curl/wrap onto the current weapon regardless of what the base locomotion layer is doing with the arms overall.
3. **ADS Layer (additive, weight-driven 0→1 over `adsInDuration`/`adsOutDuration`)** — a generic "raise to aim" pose blended in by weight as ADS engages/disengages, **not** a hard clip swap — this is what allows walking-while-aiming to look correct (legs/base layer keep animating, arms shift into the raised posture proportionally to ADS weight).
4. **Procedural IK Layer** — the grip-alignment solve from Section 2.5, applied **after** the above layers have posed the base arm, as a corrective bend ensuring the hand(s) precisely reach the current weapon's actual grip socket(s) regardless of what pose the layers above produced. This must run last among the "pose" layers because it depends on where the shoulder/elbow ended up after everything else.
5. **Procedural Sway Layer** — mouse-look-lag + idle breathing (Section 6.5), applied as a final rigid transform offset to the entire viewmodel rig root (not the skeleton's bones individually) — cheap, and correctly stacks after the pose is otherwise fully resolved.
6. **Procedural Recoil/Kick Layer** — per-shot kick + spring-recovery (Document 3's `RecoilSystem`, now formally slotted in here as the final layer), also applied as a rigid root offset, stacking after sway.
7. **Movement-State Pose Offset Layer** — the lowered-sprint-pose / tac-sprint-pose / slide-pose / crouch-offset / jump-float from Section 4.7, applied as a lerped rigid root offset blended by current movement state — evaluated alongside (summed with) layers 5–6, since all three (sway, recoil, movement-pose) are simple additive Vector3/Euler offsets on the same rig-root transform and can be cleanly summed in one final composition step.

**One-shot Action Layer (overrides base layer temporarily):** `fire`, `ads_fire`, `reload_tactical`, `reload_empty`, `switch_out`, `switch_in`, `inspect` are **not** additive — they temporarily crossfade-replace the base locomotion layer's arm-relevant bones for their duration (legs, if a third-person body is later added, continue unaffected — a per-bone-mask blend, standard in animation systems, should be used so a reload clip authored only for the arms doesn't need to also carry redundant leg data). On completion, control returns to whatever the base locomotion layer resolves to at that moment (which may have changed while the one-shot was playing — e.g., started reloading while idle, finished reload while now walking, correctly resumes into `walk`).

### 6.2 Procedural vs. Baked — Decision Table

| Content | Method | Reason |
|---|---|---|
| Idle/walk/sprint/crouch/slide/jump locomotion | Baked clip | Complex, full-arm, best authored by hand once per grip-style |
| Hold-pose (finger curl per grip style) | Baked, additive | Shape only needs authoring per *grip style*, reused across many weapons via Section 2.5 |
| Fire, ADS-fire, reload (tactical/empty), switch (out/in), inspect | Baked, one-shot | Precise, deliberate, mechanically-specific motion (finger racking a slide, hand slapping a mag) that procedural code cannot reasonably approximate believably |
| Grip alignment to any weapon's socket | Procedural (IK) | Must generalize to arbitrary weapon shapes without new authored content per weapon |
| Idle breathing sway | Procedural (spring/sine) | Must run continuously, subtly, indefinitely, without visible looping seams |
| Mouse-look weapon lag/sway | Procedural (spring-damper on input) | Must react instantly and proportionally to live mouse input, impossible to pre-bake |
| Per-shot recoil kick + recovery | Procedural (data-driven pattern + spring) | Must vary per weapon via data (Document 3's `RecoilPatterns.js`) without new clips per weapon |
| Movement-state weapon pose offsets (sprint-lower, slide-angle, tac-sprint-lower) | Procedural (lerp/spring toward per-state target offset) | Same offset logic reused cheaply across every weapon via `WeaponProfile` values, no baked content needed per weapon |

### 6.3 IK System Detail (Two-Bone IK Solver)

Implement a standard **two-bone IK solver** (analytic, not iterative — cheaper and perfectly stable for a 2-joint chain like shoulder→elbow→wrist), applied once per frame per arm:

- **Inputs:** shoulder joint world position (fixed, from the current pose after layers 1–3), target world position + orientation (the weapon's `Socket_Grip` or `Socket_GripSecondary` world transform, since the weapon itself is parented under the hand per Section 3.1 — this requires an iterative-resolution-order trick: compute the weapon's *intended* world position first from where the hand *would* be at rest, run IK to correct the arm to that target, and treat this as converged after one pass since weapon/hand offsets are small and stable frame-to-frame — do not attempt a physically iterative solve, a single analytic pass is sufficient and standard for this use case), upper-arm length, forearm length (both read live from the current skeleton's actual bone lengths — this is exactly what makes the system automatically correct for a hand model with different proportions, per Section 2.4).
- **Output:** corrected local rotations for `UpperArm` and `Forearm` bones such that `Hand`'s origin reaches the target position, with a pole-vector/hint (a fixed forward-ish reference direction) used to resolve the otherwise-ambiguous elbow bend direction naturally (elbow bends backward/outward like a real arm, not inward through the body).
- Apply `gripFineTuneOffset` (Section 2.3) as a small additional local rotation/position nudge on `Hand` after the IK solve converges, for final artistic correction per weapon.
- The off-hand (`Hand_L`) runs the identical solver targeting `Socket_GripSecondary`, with `gripStyle: 'oneHanded'` weapons (Section 2.3) substituting a fixed "supporting the wrist/frame" secondary target instead of a foregrip point, so pistols don't produce an anatomically absurd off-hand reach.

### 6.4 Required Baked Clip Inventory (Superseding/Clarifying Document 3's List)

Organized by what it's authored **against** (skeleton vs. grip-style vs. per-weapon), clarifying Document 3's original flat list:

- **Authored once against the arm skeleton, reused by every weapon:** `idle`, `walk`, `walk_back`, `strafe_left`, `strafe_right`, `sprint`, `tac_sprint` *(new)*, `jump_start`, `jump_loop`, `jump_land`, `slide`, `crouch_idle`, `crouch_walk`.
- **Authored once per grip-style (`twoHanded`, `oneHanded`, future `heavy`/`launcher`), reused by every weapon sharing that style:** the hold-pose additive clip (Section 2.3), the ADS-raise additive pose.
- **Authored once per weapon (cannot reasonably be shared, since mechanical details differ):** `fire`, `ads_fire`, `reload_tactical`, `reload_empty`, `switch_out`, `switch_in`, `inspect`.

This three-tier breakdown is the actual technical answer to "how do we add guns without redoing all the animation work" — only the bottom tier is genuinely per-weapon, and even that tier is a fixed, small, well-understood set of 7 clips per new weapon.

### 6.5 Procedural Formulas (Spring-Damper Model, Reused Throughout)

A single reusable utility, `SpringDamper` (add to `/src/animation` or `/src/utils`), implementing critically-damped spring motion:

```
velocity += ((target - current) * stiffness - velocity * damping) * dt
current += velocity * dt
```

Used, with different tuned `stiffness`/`damping` constants per use case (all in `Constants.js`, grouped under `ANIMATION.SPRING_PROFILES`), for:
- **Weapon sway (mouse-look lag):** `target` = a small offset proportional to recent mouse-delta magnitude/direction; low stiffness, moderate damping → gun "lags" behind quick look-flicks and settles.
- **Idle breathing:** `target` = a slowly-oscillating sine-wave value (not player-input-driven at all — pure `sin(elapsedTime * frequency) * amplitude`), fed through the same spring for a natural, non-robotic settle rather than a raw sine directly applied (raw sine looks mechanical; spring-filtered sine looks organic).
- **Recoil recovery:** `target` = 0 (neutral); `current` is displaced instantly (not via the spring) by each shot's kick amount, then the spring pulls it back to 0 — this hybrid "instant displacement, spring recovery" pattern is exactly what produces the correct punchy-kick-then-smooth-settle feel real recoil has.
- **Movement-state pose offsets:** `target` = the current state's designated offset vector (Section 4.7's table); moderate stiffness so transitions (e.g., entering sprint) feel deliberate but not sluggish.
- **Jump float/landing settle (4.6):** `target` = a small designated air-float offset while airborne, `0` while grounded, with an instant displacement kick on the landing frame identical in spirit to recoil's hybrid pattern.

All of these independent `SpringDamper` outputs are **summed together** (position and rotation separately) into one final root-offset transform applied to `ViewmodelRigRoot` (Section 3.1) after the skeletal pose layers (1–4) have already been evaluated — this additive-summation design is what allows, e.g., recoil kick and sprint-lowered-pose and idle breathing to all visibly, correctly coexist simultaneously without any of them needing to know about each other.

### 6.6 Animation Event Timing (Reload/Switch/Fire Mechanical Beats)

Since true embedded glTF animation-clip events are not assumed to be reliably available (per Document 3's original caveat), this document formalizes the **percentage-of-duration scheduling** approach as the standard, permanent technique (not a temporary stand-in) for this project:

Each per-weapon clip that has mechanically significant beats defines a small data table of `{ atProgress: 0.0–1.0, event: 'eventName' }` entries alongside its `WeaponProfile`/`WeaponBase` data, e.g.:

```js
reloadEmptyEvents: [
  { atProgress: 0.35, event: 'magazine_detach' },   // hide old mag mesh
  { atProgress: 0.55, event: 'magazine_attach' },    // show new mag mesh, ammo count updates here
  { atProgress: 0.85, event: 'chamber_round' },       // Bone_ChargingHandle animates if present
]
```

A small internal ticker inside `ReloadSystem`/`WeaponManager` (Document 3, now formalized here) checks elapsed-time-as-percentage-of-total-duration each frame against this table and fires each event exactly once when crossed — driving magazine mesh visibility swaps, ammo-count updates, and optional bone-driven charging-handle animation at believable, artist-tunable moments, without depending on the asset pipeline supporting literal embedded clip events.

---

## 7. Camera / View System

### 7.1 FOV Management (Recap, Now Weapon-Socket-Aware)
Unchanged core mechanism from Document 2 (FOV-modifier-stack). This document adds that **ADS FOV target is not purely a flat per-weapon constant** in isolation — it is used *together with* the camera's positional alignment to `Socket_Optic` (see 7.2), since a correctly-modeled scope/sight requires both the eye position and the FOV to change in a coordinated way for the sight picture to look correct (too narrow an FOV with the eye positioned too far back looks wrong, and vice versa) — `WeaponProfile.adsCameraOffset` exists specifically as the fine-tune knob for this coordination, applied on top of automatic `Socket_Optic` alignment.

### 7.2 ADS Camera Alignment via `Socket_Optic`
On ADS engage, rather than moving the *weapon* up to a fixed screen-space position (the common naive approach), this project moves conceptually the other way: the **weapon's `Socket_Optic` world position is treated as the point the camera should align its view through**, and the ADS transition interpolates the `ViewmodelRigRoot`'s offset such that, at full ADS weight, `Socket_Optic` sits precisely on the camera's optical axis at a distance matching realistic eye-relief. This is what makes iron sights/optics line up pixel-correctly across arbitrarily different weapon geometries with zero per-weapon manual screen-position tuning beyond the small `adsCameraOffset` correction knob.

### 7.3 Recoil/Camera Kick Integration (Recap)
`PlayerCamera.applyRecoilKick()` (Document 3) remains the true camera-rotation punch; Section 6.5's recoil layer handles the *viewmodel's own* visual kick — both are driven from the same `RecoilPatterns.js` step per shot, applied to two different targets (real camera rotation vs. viewmodel root offset), which is why they visually agree/reinforce each other instead of looking like two disconnected effects.

### 7.4 Future Third-Person Blend Path (Design-Only, Not Implemented Here)
Reiterating and formalizing Section 3.3's design intent as a concrete future integration path: a later "third-person renderer" would (a) instantiate a full third-person body skeleton sharing this document's arm-bone naming, (b) subscribe to the same `AnimationStateMachine` resolved-descriptor output (Section 3.3's required refinement), (c) position that body at the player capsule's actual simulated world transform (Document 2) rather than parented to the camera, and (d) simply **not** apply the first-person-only procedural layers (sway/recoil-viewmodel-kick/ADS-optic-alignment are first-person-camera-only concepts) while still applying the shared base locomotion + hold-pose + one-shot-action layers identically. No code from this document needs to change to enable this later — it is purely additive.

---

## 8. Weapon Mechanics Recap, Now Fully Tied to Animation/Physics

- **Reload:** driven by `ReloadSystem` (Document 3) + Section 6.6's event table; tactical vs. empty determined by ammo state as before; **new integration point:** reload is now also correctly interrupted/blocked by Tactical Sprint engagement (starting tac sprint mid-reload cancels the reload with no ammo granted, identical cancellation rule to weapon-switch from Document 3).
- **Switching:** unchanged from Document 3, now explicitly also blocked from starting mid-tac-sprint-transition (must finish returning to a ready pose first) to avoid animation-layer conflicts between the one-shot switch clip and the tac-sprint pose offset.
- **Inspect:** an idle-fidget one-shot clip (Document 3 listed it; this document confirms it plays only from a fully idle, non-combat state — grounded, not moving, no recent fire — triggered by a dedicated bind, purely cosmetic, cancels instantly on any movement/fire/ADS input).

---

## 9. Extensibility: Attachments & Killstreak/Equipment Viewmodels

**Attachments (future document, seam defined now):** Since ADS alignment is socket-driven (Section 7.2) rather than hardcoded per weapon, an attached optic model would simply be parented under the weapon's existing `Socket_Optic` empty at a defined sub-offset, and swapping optics later is a matter of swapping which optic mesh sits there plus adjusting that one socket's local transform slightly — no changes to `PlayerCamera`, the ADS system, or the IK system are required. Similarly, a foregrip attachment would only need to define an alternate `Socket_GripSecondary` position on the weapon (attachments essentially override/relocate existing sockets, a data-only change) to have the off-hand IK automatically reach the new, more forward position — again, zero code changes.

**Killstreaks/equipment viewmodels (future document, seam defined now):** Because the entire hand/hold-pose/IK/sway/recoil layer stack is generic and keyed off `WeaponProfile`+`WeaponBase`-shaped data rather than being weapon-specific code, a grenade, a controller/tablet (for calling in a killstreak), or thrown equipment can be implemented as just another entry conforming to the same contract (a "weapon" with `gripStyle: 'oneHanded'`, its own small clip set for `fire`/equivalent "throw"/"activate" actions, and its own sockets) — `WeaponManager` treats it identically to a firearm from an architectural standpoint, and the animation/renders pipeline requires no new code path to support it.

---

## 10. Required File/Module Updates (Superseding Document 3's Equivalent Files)

```
/src/weapons
├── WeaponViewmodel.js        (REWRITE per Section 3: layer-based rig root, weapon reparenting under Hand_R)
├── WeaponIK.js                (NEW: two-bone IK solver, Section 6.3)
├── WeaponProfile.js            (NEW: data schema + per-weapon profile registry, Section 2.3)
├── WeaponPoseOffsets.js        (NEW: movement-state → pose offset table, Section 4.7)
└── /definitions/*.js           (UPDATED: each now also references its WeaponProfile)

/src/animation
├── AnimationStateMachine.js    (UPDATED per Section 3.3: emits resolved descriptors, not direct playClip calls)
├── AnimationLayerCompositor.js (NEW: composes layers 1–7 from Section 6.1 into a final pose each frame)
└── SpringDamper.js              (NEW, in /src/utils or here: Section 6.5's reusable spring utility)

/src/player
└── PlayerMovement.js            (UPDATED: adds Tactical Sprint detection/state per Section 4.3)
```

---

## 11. Acceptance Criteria

- [ ] Swapping `activeArmsModelPath` to a second, differently-proportioned hand model (conforming to Section 2.1) requires zero code changes and produces correct, non-broken grip alignment on all existing weapons via live IK.
- [ ] Adding a fourth weapon (conforming to Section 2.2's socket contract, with an authored `WeaponProfile`) requires zero code changes and correctly grips, ADS-aligns, and animates using existing shared clips plus its own 7 per-weapon one-shot clips.
- [ ] Regular Sprint and Tactical Sprint are visually and mechanically distinct: different speeds, different weapon poses, and different fire/ADS-interrupt behavior (regular sprint allows a quick snap-to-fire; tac sprint requires an explicit cancel-then-fire two-step).
- [ ] Slide produces correct weapon angling, allows degraded-accuracy firing, and disallows ADS.
- [ ] ADS correctly aligns `Socket_Optic` to the camera's optical axis across at least two visually distinct weapons (e.g., a rifle and a pistol) with no per-weapon screen-position hacking beyond the small `adsCameraOffset` fine-tune value.
- [ ] All seven animation layers (Section 6.1) demonstrably coexist correctly in at least one combined scenario (e.g., sprinting, then firing mid-recoil-recovery while breathing sway is active, while ADS weight is transitioning) with no visual fighting/popping/snapping between layers.
- [ ] Reload/switch/inspect one-shots correctly interrupt and correctly resume into whatever base locomotion state is current afterward, including the buffered-fire-input case (Section 5).
- [ ] The `AnimationStateMachine` output is confirmed to be consumable by a hypothetical second listener (a simple test/mock consumer proving the resolved-descriptor refactor from Section 3.3 works) without modification.
- [ ] All new tunable values (tac sprint constants, spring stiffness/damping profiles, pose offsets) live in `Constants.js`/`WeaponProfile` data, none hardcoded inline.

---

*End of First-Person Controller & Viewmodel System specification. This document should be treated as authoritative over Document 2's camera/weapon-adjacent sections and Document 3's viewmodel/animation sections wherever they conflict.*
