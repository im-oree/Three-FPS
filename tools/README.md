# /tools — One-Time Asset & Pipeline Tooling

> **Asset Generation Policy:**
> All 3D models, textures, animations, and audio files used by this game are real, static files committed under `/assets`. They are produced **once**, ahead of time, by scripts in this `/tools` folder (run manually via `node tools/<script>.js`) or authored directly in external tools (Blender, image editors, DAWs, etc.) and placed into `/assets` by hand. Scripts in `/tools` are permitted to use procedural/algorithmic generation internally, but their output must always be a saved file on disk — never in-memory geometry constructed live inside the running game. **The one exception is Document 1's single temporary test cube**, used only to verify the rendering pipeline before real content exists, and it is deleted once real gameplay/environments are built. If you are an AI agent or developer working on any future document in this series and find yourself writing `new THREE.BoxGeometry(...)` (or similar) inside `/src` gameplay code, stop — that content belongs in a `/tools` script that exports a real asset file instead.

## Contents

| Path | Purpose |
|---|---|
| `README.md` | This policy (governs every future document). |
| `copyAssets.mjs` | Post-build mirror of `/assets` → `dist/assets` so dev and production resolve identical URLs. Runs automatically via `npm run build`. |
| `verify/` | Headless-browser verification harness (Chromium 153 + WebGL 2 via SwiftShader). See `verify/README.md`. Not an asset generator — infrastructure. |

## Scripts planned by later documents (do not create earlier)

- `generateWeaponModels.js` (Document 3)
- `generateLevelGeometry.js` (Document 4)
- `bakeTextures.js` (Document 4/6)
- `exportAnimationClips.js` (Document 3)

## Traversal animation clips

`generateTraversalClips.js` authors the mantle and vault hand animations into
`/assets/animations/` as real committed JSON clips:

```
node tools/generateTraversalClips.js
```

- `mantle_climb.json` — 1.0 s logical, `ownsIK: "both"`, six tracks
  (shoulder/elbow/wrist per side) across five phases: reach, plant, pull,
  press, recover. Both hands are visibly on the ledge; the weapon is stowed by
  the CharacterStateSystem for the duration, so the climb is animated
  empty-handed whether or not a gun is equipped.
- `vault_over.json` — 0.62 s, `ownsIK: "R"`, one decisive leading-hand plant.

Per Document A no finger joints are authored — grip realism comes from
shoulder/elbow/wrist rotation only.
