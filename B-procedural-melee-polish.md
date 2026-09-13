# DOCUMENT B: Melee, Idle & Movement-Integrated Animation Polish for the Procedural Rig

*(Re-grounded entirely in the rigid joint rig from Document A — no fingers, no skinning; everything driven by the same shoulder/elbow/wrist joints and spring system.)*

## 1. Melee as a "Weaponless" Rig State

Fists use `gripStyle: 'fistsOnly'` — `JointIK.solveTwoBoneIK` is **not invoked**; both arms are driven entirely by procedural pose targets (guard stance) and baked punch clips, using the same joints as firearms.

## 2. Attack Mechanics

Rate limiting (`meleeAttackRateSeconds`), short hit-sweep (capsule cast, not point-raycast) reusing `BallisticsSystem.registerHittable()`, forward lunge (`meleeLungeDistance`, collision-clamped), and 2–3 combo variants cycling on chained hits within `meleeComboWindow`. Each combo variant is a **baked joint-keyframe clip** driving `Shoulder_R`/`ElbowPivot_R`/`WristPivot_R` — 3–5 keyframes per joint.

## 3. Guard Stance (replaces ADS for fists)

Pressing ADS with fists blends a **guard pose target** on both shoulders/elbows via the same additive-target mechanism as a firearm's ADS-raise — never touching `PlayerCamera`'s FOV stack.

## 4. Running With Fists — Procedural

Regular sprint already uses the **free procedural arm-swing** (sine-based, stride-synced, opposite-phase left/right) on **both** arms — the natural generalization of "off-hand swings freely when not gripping."

## 5. Slide, Crouch, Jump With Fists

Identical joint-target table structure as Document A §9 — "tucked fists" for slide, "guard-adjacent float" for air.

## 6. Idle Fidgets

Shoulder/wrist-scale only: weight-shift, "weapon check" glance (firearms), shoulder-roll (fists). 2–4 variants per grip style, randomized non-repeating selection, 8–20 s trigger window, instantly interrupted by any real input.

## 7. Look Layer

Identical to firearms — grip-style-agnostic.

## 8. Consolidated Interrupt-Priority Table

Death > Melee > Switch > Reload > Fire > Tac-Sprint transition > Sprint transition > ADS/Guard > Idle fidget > Base+additive layers — governs which clip or procedural target owns each joint's spring `target`.

## 9. Required File Additions

```
/src/weapons/definitions/Fists.ts
/src/weapons/{MeleeHitDetection,MeleeComboTracker}.ts
/src/animation/{IdleFidgetController,AnimationPriorityTable}.ts
/assets/animations/melee_punch_01.json, melee_punch_02.json, melee_punch_03.json
```

## 10. Acceptance Criteria

- [ ] Fists bypass `JointIK` entirely; procedural targets + baked punch clips only.
- [ ] Melee rate-limits, hit-sweeps, lunges, and combos with baked joint-keyframe clips.
- [ ] Guard stance reuses the ADS additive-blend mechanism without touching camera FOV.
- [ ] Running with fists uses free stride-synced arm-swing on both arms.
- [ ] Idle fidgets are shoulder/wrist-scale, randomized, non-repeating, instantly interruptible.
- [ ] The priority table resolves conflicts with no popping or stuck joints.
