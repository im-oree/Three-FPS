# Character State Authority — binding contract

**This document is normative. Any work on the character — in this session or
any future one, by any author — must follow it.** The enforcement is real:
`tools/verify/state-authority.mjs` runs as part of `npm run verify` and fails
the build on violation.

Source of truth: [`src/character/CharacterStateSystem.ts`](src/character/CharacterStateSystem.ts).

---

## 1. Why this exists

Before this system, "what is the character doing?" was answered by a scatter of
private booleans: `weapon.isReloading`, `manager.switching`, `manager.adsActive`,
`movement.isTacticalSprinting`, `vault.active`. Each subsystem owned a fragment
of the truth and none of them agreed. The observable results were:

- tactical sprint that could never be entered, because two systems disagreed
  about whether sprint was already running;
- a reload that changed the ammo count but played no animation;
- a mantle that triggered by itself whenever you walked at a wall, because the
  traversal system asked nobody's permission.

Those are not three bugs. They are one bug — *no single owner of character
state* — reported three times. This system is that owner.

## 2. The model: orthogonal channels, not one enum

The character is genuinely doing several things at once. Right now it might be
**sprinting**, **reloading**, **holding a rifle**, and **grounded**. A flat
state machine would need `SPRINT_RELOADING_RIFLE`, `CROUCH_WALK_ADS_PISTOL`,
and a combinatorial explosion of siblings.

So state is split into **five orthogonal channels**, each a small mutually
exclusive machine, plus a few scalar **facts**:

| Channel | Question it answers | States |
|---|---|---|
| `locomotion` | how the body moves | `IDLE` `WALK` `SPRINT` `TAC_SPRINT` `CROUCH_IDLE` `CROUCH_WALK` `SLIDE` `JUMP` `AIR` `LANDING` |
| `traversal` | is the character climbing | `NONE` `VAULT` `MANTLE` |
| `weaponAction` | what the hands are doing | `NONE` `FIRING` `RELOADING` `SWITCHING` `INSPECTING` `MELEE` `CYCLING` |
| `aim` | sighting mode | `HIP` `ADS` |
| `carry` | where the weapon physically is | `READY` `LOWERED` `STOWED` |

Facts: `grounded` (boolean), `weaponId` (string).

Any combination the interaction rules permit is legal and simultaneous. That is
the point — the current situation is always fully legible from one object.

## 3. The four rules

### Rule 1 — one way to change state

```ts
characterState.request({
  channel: 'weaponAction',
  to: WeaponAction.RELOADING,
  source: 'ReloadSystem.begin',   // who is asking; shows up in the audit log
});                                // -> true (accepted) | false (rejected)
```

There are **no public setters**. A request is validated against the transition
table and the cross-channel interaction rules, then either accepted in full or
rejected with a recorded reason. It never half-applies.

Callers must **honour a rejection**. If `request` returns `false`, the action
does not happen:

```ts
// ReloadSystem.begin — correct
if (!characterState.request({ channel: 'weaponAction', to: WeaponAction.RELOADING, source: 'ReloadSystem.begin' })) {
  return false;              // the authority said no; we do nothing
}
```

`force: true` exists only for *completion* and *consequence* transitions (a
reload finishing, an interaction stowing the weapon). Forced requests are still
written to the audit log, so nothing is invisible.

### Rule 2 — one way to read state

```ts
characterState.locomotion            // channel getters
characterState.get('weaponAction')
characterState.canFire()             // derived helpers — prefer these
characterState.isBusy()
```

Do not cache a read across frames, and do not mirror it into a field. A derived
`get` on your own class is fine (see `WeaponBase.busyWithAction`), a stored
boolean is not.

### Rule 3 — adding a state

A new state must be added in **two** places: the channel's enum *and* the
`TRANSITIONS` table. A state that exists in the enum but has no transition rules
is unreachable — every `request` targeting it is rejected.

This is deliberate. It means you cannot bolt a feature onto the character and
forget to tell the state system: your feature simply will not run until you
declare it. `state-authority.mjs` also fails the build if an enum member is
missing from `TRANSITIONS`.

### Rule 4 — adding a channel

Only for a genuinely orthogonal axis of behaviour (something that can be true
*at the same time* as everything else, e.g. a future `stance` or `health`
channel). Add it to the channel set, give it a default, document what it means
here, and give it at least one consumer — an unread channel is a lie, and the
verifier checks for that too.

## 4. Cross-channel interactions

Rules that span channels are declared **once**, in `checkInteractions` (vetoes)
and `applyInteractionEffects` (consequences), never scattered through gameplay
code.

| Trigger | Effect |
|---|---|
| traversal enters `VAULT`/`MANTLE` | vetoes all weapon actions, ADS and locomotion requests; forces `aim → HIP`, `weaponAction → NONE`, `carry → STOWED` |
| traversal returns to `NONE` | forces `carry → READY` |
| `RELOADING` / `SWITCHING` begins | forces `aim → HIP` |
| `SPRINT` | forces `aim → HIP`; ADS requests vetoed while sprinting |
| `TAC_SPRINT` | additionally forces `carry → LOWERED`; restored to `READY` on exit |
| `SLIDE` | vetoes traversal |
| `carry !== READY` | vetoes ADS |

The mantle case is the clearest illustration of why this belongs here: "both
hands are on the ledge" has consequences for the weapon, the aim, and the
animation layer simultaneously. One declaration, three systems obey.

## 5. Who owns which channel

Exactly one site may originate a non-forced request per channel:

| Channel | Owner |
|---|---|
| `locomotion` | `PlayerController.fixedStep` (proposals come from the pure `resolveNextState`) |
| `locomotion` → `TAC_SPRINT` | `PlayerMovement.requestTacticalSprint` |
| `traversal` | `PlayerController` jump-traversal block |
| `weaponAction` → `RELOADING` | `ReloadSystem.begin` |
| `weaponAction` → `SWITCHING` | `WeaponManager.switchTo` |
| `weaponAction` → `CYCLING` | `CyclingActionSystem.begin` (pump/bolt) |
| `aim` | `WeaponManager.startADS` / `stopADS` |
| `carry` | interaction effects only — no gameplay system sets it directly |

Consumers (anyone who reads) are unrestricted.

## 6. Traversal is jump-triggered

Mantling and vaulting **never** happen automatically. Every frame
`PlayerController` probes the geometry with `VaultSystem.probeOnly()` — a pure
solve with no side effects — and stores the result in `traversalPrompt`
(`'vault' | 'mantle' | null`), which the HUD can display. The climb begins only
when, in the same frame, all of these hold:

1. jump was pressed this frame,
2. forward input is held,
3. a prompt was armed *before* the step,
4. `characterState.canTraverse()` is true,
5. the authority accepts the `traversal` request.

A jump press consumed by a traversal does not also produce a normal jump.
There is no minimum speed for a mantle: walking up to a ledge, stopping, and
pressing jump is the normal way to use it.

## 7. Animation follows state, never leads it

`AnimationStateMachine` reads `characterState.traversal` directly and selects
`mantle_climb` or `vault_over`. Those clips sit at priority tier `Traversal`
(10), above every weapon action, so nothing can steal the arms mid-climb.

`mantle_climb` (`assets/animations/mantle_climb.json`, authored by
`tools/generateTraversalClips.js`) declares `ownsIK: "both"` — it drives both
arm chains through reach → plant → pull → press → recover, so two hands are
visibly on the ledge. Because the interaction rules force `carry → STOWED`, the
weapon is hidden for the duration in **both** perspectives and the character
climbs empty-handed whether or not a gun is equipped. Per Document A no finger
joints are animated; the grip reads from shoulder/elbow/wrist alone.

## 8. Debugging

```js
__OPERATOR__.characterState.snapshot()      // every channel + facts right now
__OPERATOR__.characterState.getLog()        // last 200 accepted transitions, with source
__OPERATOR__.characterState.getRejections() // last 200 refusals, with reason
```

If a character action "does nothing", check `getRejections()` first. The answer
is almost always there, naming both the rule and the requesting site.

## 9. Checklist for adding a character feature

1. Which channel does it belong to? If none, does it truly need a new one?
2. Add the state to the enum **and** `TRANSITIONS`.
3. Declare any cross-channel consequences in the interaction functions.
4. Route the one originating call site through `characterState.request(...)`
   with a descriptive `source`, and honour a `false` return.
5. Read it back with a getter or derived helper — never a cached mirror field.
6. Run `npm run verify` (includes `tools/verify/state-authority.mjs`).
