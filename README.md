# MASTER SPECIFICATION: "OPERATOR" — A Call of Duty–Style 3D First-Person Shooter

## 0. Purpose of This Document

This is a complete build specification meant to be handed to a developer or AI coding agent as the single source of truth for building the **core single-player FPS engine and gameplay loop**. It intentionally defines base concepts from scratch so nothing is assumed or left ambiguous. This document covers **movement, controls, weapons, animation, environments, UI/menus, audio, and visual fidelity**. It deliberately does **NOT** cover AI enemy logic (a separate follow-up document) or networked multiplayer (a future document), but the architecture below must be built so those systems can be dropped in later without refactoring.

---

## 1. What We Are Building (Definitions)

**First-Person Shooter (FPS):** A video game genre where the player experiences the game world through the eyes of their character (the camera is placed at the character's head/eye level), and the primary gameplay revolves around aiming and firing weapons at targets/enemies. The player never sees their own character's full body except for arms/hands and a held weapon model rendered in the foreground ("viewmodel").

**3D FPS Game:** An FPS rendered in a fully three-dimensional environment with real-time 3D graphics (as opposed to 2D/sprite-based "boomer shooters"). The player moves through a 3D space with full 6-degrees-of-freedom camera rotation (pitch/yaw) and X/Y/Z movement, and objects/enemies/bullets exist as 3D entities with real collision volumes.

**"Call of Duty–style"** means specifically:
- Weighty but fast, responsive movement (sprint, slide, crouch, mantle-ready architecture).
- A highly animated, high-fidelity **viewmodel** (the arms + weapon you see on screen) with dozens of context-specific animations (not a static gun sprite).
- Snappy per-weapon feel: distinct recoil patterns, reload timing, ADS (Aim Down Sights) transitions, and sound design per weapon.
- A polished **frontend flow**: Main Menu → Settings/Loadout → Match → Pause → End-of-match Summary, all built as real UI screens, not placeholders.
- Realistic-leaning visuals: PBR materials, dynamic shadows, bloom/post-processing, screen shake, and camera feedback (kick, sway, bob) tied to player actions.

This document's job is to fully specify **all of the above** to production quality, using a scalable, modular, file-based Node.js project (never a single monolithic HTML file, never CDN-script-tag Three.js).

---

## 2. Technology Stack & Hard Constraints

These are non-negotiable:

| Concern | Requirement |
|---|---|
| Runtime/Tooling | Node.js project. `npm` (or `pnpm`) managed. `package.json` with locked dependency versions. |
| 3D Engine | `three` installed as an **npm dependency** (`import * as THREE from 'three'`). **Never** loaded via `<script src="cdn...">`. |
| Bundler/Dev Server | **Vite**. Provides ES module dev server + production build (`vite build`). |
| Language | Modern JavaScript (ES2022+), ES Modules only (`import`/`export`). TypeScript is allowed/encouraged but not mandatory — if plain JS, use JSDoc typing comments for editor intellisense. |
| Project Shape | A real multi-file project tree (see Section 3). **No monolithic single-file game.** Every subsystem (movement, weapons, animation state machine, UI screen, audio manager, etc.) lives in its **own file/module**, imported where needed. |
| Assets | Every 3D model, texture, animation clip, and audio file is a **real static file on disk** inside `/assets`, produced ahead of time (see Section 4), and loaded via standard Three.js loaders (`GLTFLoader`, `TextureLoader`, `AudioLoader`). **Nothing is procedurally built inside the render loop or on every game session.** |
| Physics/Collision | Lightweight custom raycast + bounding-volume collision (capsule vs. static mesh colliders) — no need for a full physics engine like Cannon/Rapier for this phase, but code must be structured so one could be swapped in later. |
| Rendering Target | 60 FPS on mid-range hardware. WebGLRenderer with shadow maps, tone mapping, and post-processing composer. |

---

## 3. Project Structure

Every system gets its own file. This is the required folder layout:

```
/operator-fps
├── package.json
├── vite.config.js
├── index.html                     (minimal shell: <canvas> + root UI div, loads /src/main.js)
├── /public
│   └── favicon.ico
│
├── /assets                        (ALL pre-generated, static, real files — see Section 4)
│   ├── /models
│   │   ├── /weapons/               (assault_rifle.glb, pistol.glb, smg.glb, shotgun.glb, sniper.glb, knife.glb)
│   │   ├── /characters/            (player_arms.glb — rigged arms+hands mesh with skeleton)
│   │   └── /environment/           (warehouse.glb, facility.glb, crates.glb, barrels.glb, etc.)
│   ├── /animations/                (embedded in glb or separate .glb anim-only files per weapon/character)
│   ├── /textures/                  (basecolor/normal/roughness/metalness/AO maps, .ktx2 compressed)
│   ├── /audio/
│   │   ├── /weapons/                (fire, reload_tactical, reload_empty, ads_in, ads_out, switch_out, switch_in, empty_click per weapon)
│   │   ├── /footsteps/              (per-surface: concrete, metal, gravel, wood)
│   │   ├── /ui/                     (menu_click, menu_hover, confirm, back)
│   │   └── /ambient/                (level ambiance loops)
│   └── /ui                         (crosshair icons, weapon icons, menu background art, fonts)
│
├── /tools                          (ONE-TIME Node scripts that GENERATE and SAVE the assets above to disk — run manually, not at game runtime)
│   ├── generateWeaponModels.js
│   ├── generateLevelGeometry.js
│   ├── bakeTextures.js
│   └── exportAnimationClips.js
│
└── /src
    ├── main.js                     (single entry point: boots Engine, mounts UI, starts loop)
    │
    ├── /core
    │   ├── Engine.js               (owns renderer, clock, main loop, ties subsystems together)
    │   ├── Renderer.js             (WebGLRenderer creation, resize handling, tone mapping config)
    │   ├── SceneManager.js         (active THREE.Scene, add/remove/swap level scenes)
    │   ├── Clock.js                (delta time, fixed-timestep helper for physics)
    │   ├── InputManager.js         (raw keyboard/mouse state, key-binding map, pointer lock lifecycle)
    │   ├── AssetLoader.js          (centralized GLTFLoader/TextureLoader/AudioLoader with caching + loading-screen progress events)
    │   ├── EventBus.js             (pub/sub used to decouple systems — e.g. "weapon:fired", "player:died")
    │   └── SettingsStore.js        (reads/writes user settings to localStorage)
    │
    ├── /player
    │   ├── PlayerController.js     (top-level orchestrator: owns camera, movement, collider, state)
    │   ├── PlayerCamera.js         (FOV management, camera shake, recoil kick, ADS zoom transitions)
    │   ├── PlayerMovement.js       (velocity/acceleration integration, ground detection, slope handling)
    │   ├── PlayerState.js          (finite-state: Idle, Walk, Sprint, Crouch, Slide, Jump/Air, ADS, Reload, Dead)
    │   ├── PlayerCollider.js       (capsule collider vs. level collision mesh)
    │   ├── HeadBob.js              (procedural bob offset applied to camera per movement state)
    │   ├── StaminaSystem.js        (optional sprint stamina; ties into HUD)
    │   └── FootstepSystem.js       (triggers footstep audio based on speed + surface material tag)
    │
    ├── /weapons
    │   ├── WeaponManager.js        (holds equipped weapons, handles switching, exposes fire()/reload()/aim())
    │   ├── WeaponBase.js           (base class: fire logic, ammo, fire-rate timer, spread calc)
    │   ├── /definitions
    │   │   ├── AssaultRifle.js
    │   │   ├── Pistol.js
    │   │   ├── SMG.js
    │   │   ├── Shotgun.js
    │   │   ├── SniperRifle.js
    │   │   └── CombatKnife.js
    │   ├── WeaponViewmodel.js      (loads/attaches the weapon+arms glb to the camera rig)
    │   ├── WeaponSway.js           (mouse-look-driven procedural sway/lag of the viewmodel)
    │   ├── RecoilSystem.js         (per-weapon recoil pattern data + camera/viewmodel kick application)
    │   ├── ReloadSystem.js         (tactical vs. empty reload timing & ammo math)
    │   ├── FireModeSystem.js       (semi/burst/auto handling)
    │   ├── BallisticsSystem.js     (raycast from camera center, range falloff damage calc, penetration hook for later)
    │   ├── MuzzleFlashEffect.js    (sprite/particle flash spawned at muzzle socket)
    │   ├── ImpactEffect.js         (decal + particle burst spawned at hit point, surface-aware)
    │   └── TracerEffect.js         (fast-moving line/mesh for visible tracer rounds)
    │
    ├── /animation
    │   ├── AnimationStateMachine.js
    │   ├── AnimationBlender.js     (crossfade/blend between clips using THREE.AnimationMixer)
    │   └── /states
    │       ├── IdleState.js
    │       ├── WalkState.js
    │       ├── SprintState.js
    │       ├── JumpState.js        (jump-start / air-loop / land, 3 sub-clips)
    │       ├── SlideState.js
    │       ├── CrouchState.js
    │       ├── ADSState.js         (additive aim-in/out layer blended atop movement)
    │       ├── FireState.js
    │       ├── ReloadState.js
    │       ├── SwitchWeaponState.js
    │       └── MeleeState.js
    │
    ├── /environment
    │   ├── LevelLoader.js          (loads a level .glb + its metadata JSON: spawn points, collision mesh ref, lighting config)
    │   ├── /levels
    │   │   ├── WarehouseLevel.js
    │   │   └── FacilityLevel.js
    │   ├── CollisionWorld.js       (static collision mesh registry used by PlayerCollider & BallisticsSystem)
    │   ├── LightingRig.js          (ambient + directional "sun" + fill lights, shadow config)
    │   ├── SkyboxManager.js
    │   └── PostProcessing.js       (EffectComposer: bloom, vignette, FXAA, subtle chromatic aberration)
    │
    ├── /ui
    │   ├── UIManager.js            (top-level screen router: which screen is active)
    │   ├── /menus
    │   │   ├── MainMenu.js         (Play / Loadout / Settings / Quit)
    │   │   ├── SettingsMenu.js     (video, audio, controls sub-tabs)
    │   │   ├── ControlsMenu.js     (rebindable key list, sensitivity slider)
    │   │   ├── LoadoutMenu.js      (weapon selection + cosmetic skin selection)
    │   │   ├── PauseMenu.js        (Resume / Settings / Quit to Main Menu)
    │   │   └── GameOverScreen.js   (stats summary + Play Again / Main Menu buttons)
    │   └── /hud
    │       ├── HUDManager.js
    │       ├── HealthDisplay.js
    │       ├── AmmoCounter.js
    │       ├── Crosshair.js        (dynamic spread-based crosshair)
    │       ├── HitMarker.js
    │       ├── DamageDirectionIndicator.js
    │       └── LowHealthVignette.js
    │
    ├── /audio
    │   ├── AudioManager.js         (wraps THREE.AudioListener + positional/non-positional sound playback, pooling)
    │   ├── SoundLibrary.js         (maps sound keys → file paths, preloaded via AssetLoader)
    │   └── categories
    │       ├── WeaponSounds.js
    │       ├── FootstepSounds.js
    │       ├── AmbientSounds.js
    │       └── UISounds.js
    │
    ├── /state
    │   ├── GameStateManager.js     (MainMenu / Loading / Playing / Paused / GameOver states, drives UIManager)
    │   ├── MatchStatsTracker.js    (shots fired, hits, accuracy, kills placeholder, time played)
    │   └── SaveGameManager.js      (persist settings/loadout to localStorage)
    │
    ├── /customization
    │   ├── LoadoutManager.js       (equipped primary/secondary/melee)
    │   ├── SkinManager.js          (weapon material/texture swap)
    │   └── AttachmentManager.js    (stub for future scopes/grips — interface only for now)
    │
    ├── /extensibility  (empty-logic placeholder modules so future docs plug in cleanly)
    │   ├── AIControllerInterface.js   (defines the contract EnemyAI will implement — no logic yet)
    │   └── NetworkManagerInterface.js (defines the contract multiplayer sync will implement — no logic yet)
    │
    └── /utils
        ├── MathUtils.js
        ├── Constants.js            (all tunable numbers: speeds, FOVs, timings — centralized, not magic numbers scattered around)
        └── Debug.js                (on-screen stats: FPS, position, draw calls — toggle with a debug key)
```

**Rule:** No file should exceed ~300 lines or hold more than one clear responsibility. If a system grows complex (e.g., `RecoilSystem`), split further (e.g., `RecoilPatterns.js` holding just data tables).

---

## 4. Asset Creation Policy — "Generated & Saved," Not "Procedural at Runtime"

This is critical and must not be misunderstood:

- **Runtime procedural generation (FORBIDDEN as primary approach):** Building geometry with `THREE.BoxGeometry`/`ExtrudeGeometry` etc. live inside the game every time it loads, with no persisted asset file. This does not scale, cannot be art-directed, and cannot be edited by an artist later.

- **Build-time generation (REQUIRED approach):** Scripts in `/tools` are run **once, manually, via Node** (e.g. `node tools/generateWeaponModels.js`). These scripts may absolutely use code/geometry logic (or wrap a headless Blender Python pipeline, or hand-authored `.glb` exports from Blender/Maya) — but their **output is a real file** written to `/assets/models/...` (`.glb`/`.gltf`), `/assets/textures/...` (`.ktx2`/`.png`), etc. The **game itself never constructs meshes procedurally at play-time** — it only ever calls `AssetLoader.loadModel('weapons/assault_rifle.glb')` and gets back a fully authored, animated mesh.

- Every weapon, every character arm-rig, every level's geometry, every prop, and every animation clip must exist as a **committed static asset file** in the repository, generated ahead of time by the `/tools` scripts (or authored directly in a DCC tool and exported), not synthesized live.

- Levels are **hand-built layouts** (`WarehouseLevel.js`, `FacilityLevel.js`) that reference a static `.glb` scene plus a JSON metadata file (spawn points, collision mesh reference, light rig config) — not randomly assembled each run.

---

## 5. Core Gameplay Systems — Full Detail

### 5.1 Movement & Controls (COD-Style)

**Default Keybindings (must be rebindable via `ControlsMenu.js`):**

| Action | Key/Input |
|---|---|
| Move Forward/Back/Strafe | `W` `A` `S` `D` |
| Look | Mouse (via `PointerLockControls`-equivalent custom controller in `PlayerCamera.js`) |
| Jump | `Space` |
| Sprint | Hold `Left Shift` |
| Crouch | `Ctrl` (hold or toggle, configurable) |
| Slide | Trigger automatically when `Sprint` + `Crouch` are pressed together while grounded and moving |
| Aim Down Sights (ADS) | Hold (or toggle) `Right Mouse Button` |
| Fire | `Left Mouse Button` |
| Reload | `R` |
| Melee | `V` |
| Switch Weapon 1 / 2 | `1` / `2` |
| Cycle Weapon | Mouse Wheel |
| Interact (future doors/pickups) | `E` |
| Pause | `Esc` |
| Debug Overlay | `F3` |

**Movement Parameters (centralized in `Constants.js`, all tunable):**
- Walk speed, Sprint speed multiplier, Crouch speed multiplier, ADS speed multiplier
- Jump height / gravity value / air control factor
- Sprint→Fire transition delay (small delay before you can fire after sprinting, like COD)
- Slide: trigger speed threshold, slide duration, slide speed curve (fast initial burst decaying to stop), capsule height shrink during slide, camera height lower + slight forward tilt, cannot slide again until a short cooldown or until standing/re-sprinting
- Crouch: capsule height shrink, smooth lerp transition, camera height lerp
- Landing: brief camera dip + landing animation + reduced accuracy for a few frames if falling from height

**State Machine (`PlayerState.js`):** `Idle → Walk → Sprint → Crouch → CrouchWalk → Slide → Jump/Air → Landing`, orthogonally combined with weapon states `Idle/Firing/Reloading/ADS/Switching`. Movement state and weapon/animation state are tracked separately but both feed into `AnimationStateMachine`.

### 5.2 Camera System (`PlayerCamera.js`)
- Base FOV (e.g. 90°), ADS FOV per weapon (varies by weapon type — sniper ADS FOV much lower).
- Smooth FOV lerp on ADS in/out (not instant snap) with a per-weapon ADS-in/out duration.
- Procedural camera shake events fired via `EventBus` for: weapon fire (small), explosion (large, future), landing (small dip), taking damage (short jolt).
- Head bob (`HeadBob.js`): sinusoidal vertical+horizontal offset, amplitude/frequency scales with movement state (walk < sprint, none while ADS or airborne).
- Recoil kick: camera pitch/yaw punch per shot per `RecoilSystem` pattern data, auto-recovers over time.

### 5.3 Weapon System
- Weapons defined as data+behavior classes extending `WeaponBase` (damage, fire rate, magazine size, reserve ammo, reload durations, recoil pattern reference, spread cone values, ADS FOV/speed, sound keys, model path, animation clip names).
- **Fire Modes:** semi-auto, full-auto, burst — implemented in `FireModeSystem.js`, selectable per weapon definition.
- **ADS behavior:** raises viewmodel, reduces spread cone drastically, reduces move speed, transitions FOV, may switch to a distinct "ADS-fire" animation.
- **Reload:** two variants — *tactical* (mag not empty, faster) and *empty* (slower, includes chambering a round) — each with its own animation clip and sound, both interruptible-safe (queued cancel if switching weapons).
- **Weapon Switching:** plays "holster/switch-out" then "raise/switch-in" viewmodel animation with a defined time cost during which firing is blocked.
- **Muzzle Flash / Tracers / Impacts:** spawned via dedicated effect classes, attached to a "muzzle" socket bone/empty in the weapon's glTF, pooled (reused) objects rather than newly instantiated every shot for performance.

### 5.4 Animation System
- All character/weapon animation uses **skeletal animation from imported `.glb` files** (rigged arms mesh + weapon meshes attached to hand bone), driven by `THREE.AnimationMixer` wrapped in `AnimationBlender.js`.
- Required clip list per weapon (must exist as real exported animation clips in the asset files):
  `idle`, `walk`, `walk_back`, `strafe_left`, `strafe_right`, `sprint`, `jump_start`, `jump_loop`, `jump_land`, `slide`, `crouch_idle`, `crouch_walk`, `fire`, `ads_fire`, `reload_tactical`, `reload_empty`, `switch_out`, `switch_in`, `melee_attack`, `inspect` (idle fidget).
- `AnimationStateMachine.js` resolves current `PlayerState` + weapon action into the correct clip(s), crossfading over ~0.1–0.2s for smoothness, and layering ADS as an **additive** blend on top of base locomotion so you can aim while walking/sprinting-to-stop.
- Animation events (e.g., the exact frame a reload clip inserts the new magazine) drive sound triggers and ammo-count updates via `EventBus`, keeping visuals and logic in sync.

### 5.5 Hit Detection & Damage (`BallisticsSystem.js`)
- Hitscan: a `THREE.Raycaster` fired from the camera's exact center each shot (accounting for current spread cone via a small random pitch/yaw jitter).
- Raycast tested against enemy/prop hit-volumes (simple bounding boxes/spheres for now; per-bone hitboxes are a documented extension point for the AI doc) plus the level's static collision mesh for wall impacts.
- Damage falloff by distance (near-range vs far-range damage curve per weapon).
- On hit: fire `EventBus` event → triggers `HitMarker` UI, `ImpactEffect` at hit point, and (in single-player training target context) score/stat updates via `MatchStatsTracker`.

### 5.6 Environment System
- Levels are static, hand-authored `.glb` scenes (built via DCC tool or the one-time `/tools` generator scripts) loaded through `LevelLoader.js`.
- Each level ships with a metadata JSON: player spawn transform, ambient light color/intensity, directional "sun" angle/color/intensity, fog settings, and a reference to a (possibly simplified) collision mesh separate from the visual mesh for performance.
- Include at least: **Warehouse** (indoor, crates/pallets/metal shelving, tight/mid-range combat) and **Facility** (mixed indoor/outdoor, longer sightlines) as the two shipped levels for this phase, plus an isolated **Training Range** mode (static shooting-range level with paper/steel targets) to validate weapon feel without needing AI yet.

### 5.7 UI / Menu Flow
`GameStateManager.js` drives which screen `UIManager.js` shows:

1. **Main Menu** (`MainMenu.js`): Title art, **Play**, **Loadout**, **Settings**, **Quit**. Play → level select (Warehouse / Facility / Training Range) → Loading Screen (shows `AssetLoader` progress bar) → Match.
2. **Loadout Menu**: pick primary + secondary + melee, preview weapon skin on a rotating 3D viewmodel preview panel, confirm/back.
3. **Settings Menu**: tabs for **Video** (resolution/quality preset, FOV slider, brightness, V-Sync), **Audio** (master/music/sfx/UI volume sliders), **Controls** (rebind list rendered from `InputManager`'s binding map, mouse sensitivity slider, invert-Y toggle).
4. **In-Match:** click-to-play locks the pointer (Pointer Lock API), unlocking auto-opens the **Pause Menu** (`Resume`, `Settings`, `Quit to Main Menu`).
5. **Game Over / Match Summary** (`GameOverScreen.js`): shots fired, hits, accuracy %, time survived/completed, buttons to **Retry** or **Main Menu**.

All menus are real DOM/HTML+CSS overlays (styled, not `alert()`/browser default), layered above the WebGL canvas, built as their own components/files, driven by `UIManager` show/hide calls and `EventBus` messages (e.g., button click → `EventBus.emit('game:start', levelId)`).

### 5.8 HUD (in-match overlay, DOM-based, updated via EventBus)
- **Health bar/number** (`HealthDisplay.js`) with low-health red vignette pulse (`LowHealthVignette.js`).
- **Ammo counter** (`AmmoCounter.js`): current mag / reserve, weapon icon.
- **Dynamic crosshair** (`Crosshair.js`): expands with movement/firing spread, contracts when ADS/still.
- **Hit marker** (`HitMarker.js`): brief X flash on confirmed hit, distinct color/sound for a kill (future AI hook).
- **Damage direction indicator** (`DamageDirectionIndicator.js`): directional arrow flashing toward damage source.
- **Stats readout** during Training Range mode (accuracy, shots fired).

### 5.9 Audio System (`AudioManager.js` + `SoundLibrary.js`)
- Built on `THREE.AudioListener` attached to the camera, using `THREE.PositionalAudio` for world sounds (footsteps, impacts, ambient) and plain `THREE.Audio` for UI/viewmodel-attached sounds (fire, reload — these follow the camera, so should feel "in your ears").
- A small **sound pool** per category to allow overlapping rapid sounds (e.g., automatic weapon fire) without audio cutoff.
- Footsteps (`FootstepSystem.js` + `FootstepSounds.js`): tagged surface materials on level collision mesh (concrete/metal/gravel/wood) select the correct footstep sound set, timed to sprint/walk cadence and to the animation's foot-plant events where possible.
- Every weapon has its own sound set: fire, tail/reverb tail (optional), reload_tactical, reload_empty, ADS-in, ADS-out, switch-out, switch-in, dry-fire/empty-click.

### 5.10 Settings, Persistence & Customization
- `SettingsStore.js` persists video/audio/control settings and last-used loadout to `localStorage`, reloaded on boot.
- `LoadoutManager.js`/`SkinManager.js` let the player pick a primary/secondary/melee and a cosmetic material/texture variant ("skin") for the equipped weapon's viewmodel — implemented now, with `AttachmentManager.js` scaffolded as an empty interface for future scopes/grips/etc.

---

## 6. Explicit Extension Points for Future Docs

This document must produce an engine where the **next document (AI enemies)** and a **later document (multiplayer)** can be implemented as additive modules:

- `/src/extensibility/AIControllerInterface.js`: defines the method contract (`spawn()`, `update(dt)`, `onDamaged(amount, source)`, `die()`) that a future `EnemyAI` class will implement. No behavior yet — just the seam.
- `/src/extensibility/NetworkManagerInterface.js`: defines the contract (`connect()`, `sendState()`, `onRemoteUpdate()`) a future multiplayer layer will implement.
- `EventBus.js` must be used pervasively (weapon fire, hit registered, player died, level loaded, etc.) specifically so AI/network systems can subscribe without touching core files.
- `BallisticsSystem.js` must already support hitting arbitrary registered hittable objects (not just walls) so enemy hitboxes can be registered later with zero changes to the firing code itself.
- The **Training Range** level (static paper/steel targets that register hits and reset) exists precisely so weapon feel, hit detection, and scoring can be fully validated by this document alone, with no AI required.

---

## 7. Visual Fidelity Requirements

- **Materials:** PBR (`MeshStandardMaterial`/`MeshPhysicalMaterial`) with basecolor, normal, roughness, metalness, and AO texture maps for weapons, characters, and environment props.
- **Lighting:** one directional "sun" light with shadow-casting enabled (`renderer.shadowMap.enabled = true`, `THREE.PCFSoftShadowMap`), plus ambient/hemisphere fill light, plus any necessary local point/spot lights per level for indoor areas.
- **Post-processing** (`PostProcessing.js` via `EffectComposer`): subtle Bloom (muzzle flashes, emissive lights pop), FXAA/SMAA anti-aliasing, slight vignette, optional subtle chromatic aberration on damage taken, tone mapping (`THREE.ACESFilmicToneMapping`) for a filmic, realistic look.
- **Weapon viewmodel fidelity:** high-detail models with proper metal/plastic/rubber material separation, animated moving parts (bolt, magazine, safety) synced to fire/reload clips where the source model supports it.
- **Screen feedback:** camera shake, hit marker flash, low-health vignette, sprint FOV kick — all must be implemented, not just described.

---

## 8. Performance & Scalability Requirements

- Object pooling for bullets/tracers/impact decals/particles — never `new` a throwaway object every shot.
- Texture compression via `.ktx2`/Basis Universal where feasible; otherwise reasonably sized `.png`/`.webp`.
- LOD-conscious asset creation (keep weapon/character poly counts and texture sizes reasonable for real-time 60fps).
- Frustum culling relied on by default (Three.js), plus manual disabling/hiding of off-screen heavy effects.
- A visible debug overlay (`F3`, via `Debug.js`) showing FPS, draw calls, and player position/velocity for ongoing profiling during development.

---

## 9. Acceptance Criteria (Definition of Done for This Document's Scope)

- [ ] Project boots via `npm install && npm run dev`, no CDN script tags anywhere, Three.js imported as an npm module.
- [ ] Every listed subsystem exists as its own file/module per the tree in Section 3.
- [ ] All assets (models/textures/animations/audio) exist as real files under `/assets`, produced via the `/tools` scripts or authored directly — nothing generated procedurally at runtime.
- [ ] Player can walk, sprint, crouch, slide, and jump with smooth, correctly-blended animations for each transition.
- [ ] At least 3 distinct weapons are fully implemented (model, all required animation clips, unique sounds, unique recoil pattern, ADS behavior).
- [ ] Full menu flow works end-to-end: Main Menu → Loadout → Settings → Play → Loading → Match (pointer-locked) → Pause → Game Over → back to Main Menu.
- [ ] HUD (health, ammo, dynamic crosshair, hit markers, damage direction) is fully functional and updates live during play.
- [ ] Training Range level allows verifying hit detection/damage/accuracy stats without any AI present.
- [ ] `EventBus`, `AIControllerInterface`, and `NetworkManagerInterface` exist and are demonstrably ready for future extension.
- [ ] Runs at a stable 60fps target on mid-range hardware in Chrome.
