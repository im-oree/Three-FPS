# Work plan — agreed order

The user's ordering is explicit; later items must not jump the queue.

1. ~~**Killstreak migration to the server**~~ — DONE (`308742b`),
   `verify:killstreaks` 20/20.
2. **AI: rigorous testing and tuning across different situations.**
3. **Game modes system** — only after 1 and 2.

Map/presentation work folded in alongside:

- [x] `prototype` never picked by QUICK PLAY / random. Implemented as an
      `excludeFromRotation` flag plus an exported `ROTATION_LEVELS`; random
      callers use that, never `LEVELS`. Verified in the browser.
- [x] Replace `warehouse` with a 1:1 **Killhouse**. Built from
      `tools/lib/KillhouseLayout.js` (floor plan as data) via
      `tools/generateKillhouseShell.js`, on the existing shell builders.
      150 colliders, sealed on all sides, `verify:killhouse` 26/26.
- [x] **Per-map camera angles** for previews — a `PLANS` table in
      `tools/generateMapPreviews.mjs`, including an INTERIOR camera for
      Killhouse. Washed-out colour fixed (warmer key + rim light, fog pushed
      from 0.35 to 0.55 of `far`, brightness lift for dark-skied maps).
      Also fixed: previews shot with culling driven by the GAME camera, which
      had been silently deleting geometry from every preview.
- [ ] **Skybox system** integrated into every map that lacks it.
- [x] Killhouse roof: 12 bays (10 clerestory + 2 collapsed) over 470
      visual panels. Colliders merged into per-strip runs — 564 -> 150,
      because the server linear-scans `boxes[]` on every raycast and a
      piloted missile raycasts every tick. Proven both ways: a strike into
      solid roof is stopped, a strike through a bay is not.
- [x] Missile start altitude 210 -> 330 m, standoff 46 -> 62,
      flight budget 9 -> 14 s.
- [x] End-to-end kill test: a strike called through the centre bay kills a
      player standing under it (149 damage, lethal) while a player under
      solid roof on the far side is untouched. In `verify:killhouse`.

### Still open

- [ ] **Skybox system** integrated into every map that lacks it.
- [ ] Killhouse is currently lit by the tropical HDRI borrowed from Firing
      Range; it should get its own overcast UK sky.

## Bugs found while building Killhouse (all fixed in `b0e7a9f`)

These were pre-existing and affected every map, not just the new one:

1. `CollisionWorld.raycast` returned **NaN distances** for axis-aligned rays.
   The slab method divides by the direction component, so a ray with a zero
   component starting exactly on that face's plane computes `0/0`. Every
   comparison against NaN is false, so the guard clauses accepted the box and
   reported a hit on geometry nowhere near the ray.
2. `Perception` used forward `(-sin, -cos)` while the movement basis is
   `(-sin, +cos)` — **the FOV cone pointed behind the bot.** Bots could only
   notice enemies they had their back to. The AI suite passed because its own
   fixture placed the target behind the bot, matching the bug.
3. Map previews rendered with **culling still driven by the game camera**, so
   anything outside the player's view was switched off mid-shoot.

## Research already done (Killhouse)

Activision CODM Map Snapshot + COD4 references:
- Killhouse is the F.N.G. tutorial warehouse in a UK SAS base, converted to a
  live-fire course. Small, roughly symmetrical, very little cover.
- Centre: a **wooden watchtower**, ladder-only access, 360° view, the map's
  high ground and its biggest risk.
- Cover: brick and wooden walls, shipping containers, sandbags, ruined cars.
- Both spawns have a **small staircase to an open platform**; you can see the
  enemy spawn from your own.
- **The roof is the important part:** "partially exposed to the outside thanks
  to its unique roof… multiple giant windows allow natural light and air to
  flow freely." Aerial streaks must be flown THROUGH those openings or they
  are blocked. This is canon, not an invention — it is exactly the roof-gap
  behaviour the user asked for.
