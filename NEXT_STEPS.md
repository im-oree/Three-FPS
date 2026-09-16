# Work plan — agreed order

The user's ordering is explicit; later items must not jump the queue.

1. **Killstreak migration to the server** (Item 7, next system), 12 end-to-end
   tests, then a UI polish pass.
2. **AI: rigorous testing and tuning across different situations.**
3. **Game modes system** — only after 1 and 2.

Map/presentation work folded in alongside:

- [ ] `prototype` must never be picked by QUICK PLAY / random / any game mode.
      It loads ONLY when explicitly clicked in the map list.
- [ ] Replace `warehouse` with a 1:1 **Killhouse** (COD4 / CODM), renamed.
      Build the warehouse SHELL with the shell builder, then walls/boxes/props
      with the existing builders. Roof system with real colliders; all map
      boundaries sealed.
- [ ] **Per-map camera angles** for previews — planned per map, showing each
      map at its best, not one aerial angle for all. Fix the washed-out colour.
- [ ] **Skybox system** integrated into every map that lacks it.
- [ ] Killhouse roof: realistic **broken/missing roof panels** that open real
      firing lanes for aerial streaks (matches the real map, whose roof has
      giant window bays for exactly this reason).
- [ ] Missile: **higher start altitude / longer approach** so the player has
      time to plan a strike.
- [ ] End-to-end test proving a missile can actually kill someone.

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
