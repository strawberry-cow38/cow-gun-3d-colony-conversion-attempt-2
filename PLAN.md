# PLAN

Implementation roadmap for `cow-gun-3d-colony-conversion-attempt-2`.

**This document is living.** When the plan changes — phases reordered, scope shifted, milestones added or cut — update this file in the same commit as the change. A stale plan is worse than no plan.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the foundational decisions this plan is built on.

---

## Phase status legend

- `[ ]` not started
- `[~]` in progress
- `[x]` done
- `[-]` dropped / superseded

---

## Phase 0 — Bootstrap *(in progress)*

Get the project skeleton stood up so we can build on it.

- [x] Create empty repo with README
- [x] Lock architecture decisions (ARCHITECTURE.md)
- [x] Write this plan (PLAN.md)
- [ ] `package.json` with pnpm + scripts (`dev`, `build`, `test`, `lint`, `typecheck`)
- [ ] `vite.config.js` — dev server + prod bundle
- [ ] `biome.json` — lint + format config
- [ ] `tsconfig.json` — `checkJS: true`, `noEmit: true`, strict-ish
- [ ] `vitest.config.js`
- [ ] `.gitignore` (node_modules, dist, .DS_Store, etc.)
- [ ] `src/main.js` — entry point that boots a three.js scene with a single colored cube
- [ ] `index.html` — minimal canvas host
- [ ] First passing test (sanity: `vitest` runs, asserts 1+1=2)
- [ ] GitHub Actions CI: install + lint + typecheck + test on PR

**Definition of done:** `pnpm install && pnpm dev` opens browser to a spinning cube; `pnpm test && pnpm lint && pnpm typecheck` all pass; CI green on main.

---

## Phase 1 — Core ECS + sim loop

The heart of the engine. Everything from here on rides on these.

- [ ] Entity registry (ID allocation, recycling, generation counters)
- [ ] Component registration (typed, named, default-valued)
- [ ] Archetype storage (group entities by exact component set, store as TypedArrays where possible)
- [ ] Query API (`world.query([Position, Velocity])` returns iterable)
- [ ] System registration with tier (`every` / `rare` / `long` / `dirty`)
- [ ] Dirty flag plumbing (mark + consume)
- [ ] Fixed-step sim loop at **30 Hz** with accumulator + render interpolation
- [ ] Render runs at display refresh, interpolates between previous + current sim states
- [ ] Profiler hook (per-system tick time, exposed in dev overlay)
- [ ] Stress test: 1000 entities with `Position` + `Velocity`, all moving randomly. Must hold 30 Hz on dev hardware.

**Definition of done:** ECS supports add/remove components, queries return correctly, fixed-step loop holds 30 Hz under stress test, render is smooth at 60+ FPS via interpolation, dev overlay shows per-system ms.

---

## Phase 2 — World, terrain, camera

Make the 3D world feel like a place.

- [ ] Tile grid component + spatial index (200×200 default)
- [ ] Flat ground rendering (instanced tile mesh)
- [ ] Heightmap support (per-tile elevation)
- [ ] Camera controller — orbit + pan, RTS-style isometric default angle
- [ ] Tile picking (mouse-to-tile raycast)
- [ ] Save / load: serialize world to JSON + gzip, version field, load round-trips
- [ ] Migration scaffold: `migrations/v0_to_v1.js` example, registered in load pipeline
- [ ] Lock world coordinate system (units, axes, handedness, up vector)

**Definition of done:** Player can pan + orbit camera over a 200×200 colored tile grid with heightmap, click a tile to log its coords, save world, reload, get identical state.

---

## Phase 3 — First cow *(done)*

One pawn doing one thing. The smallest interesting simulation.

- [x] Pathfinding: A* on tile grid, with cached paths + dirty invalidation on terrain change
- [x] `Cow` archetype: `Position`, `Velocity`, `Hunger`, `Brain`, `JobAssigned?`
- [x] Job board: queue of jobs, assignment system finds nearest free worker
- [x] First job: `Wander` (pick random tile, walk there, idle 2s, repeat)
- [x] Cow render: low-poly box (or capsule) with name label, walking animation = bobbing
- [x] Selection: click cow to show its current job + stats in a debug panel

Notes deferred to later phases:
- Name label in 3D (sprite/billboard) — Phase 6 with mood/traits HUD.
- Real jobs on the JobBoard — Phase 4 (chop/haul/build). Phase 3 uses board scaffolding but cow synthesizes Wander locally as fallback.
- Fine-grained pathfind cache invalidation — Phase 4 when terrain becomes mutable.

**Definition of done:** One cow spawned, wanders the map autonomously, click to see its job + stats. Save/load preserves the cow.

---

## Phase 4 — Job ecosystem *(in progress)*

Grow the simulation breadth. Multiple jobs, resources, basic colony loop.

Landed as slice A (trees + chop):
- [~] Resource components: `Wood`, `Food`, `Stone` (as item entities) — `Item {kind}` + wood; food/stone later.
- [x] Trees as world entities (rocks deferred to a later slice)
- [x] Chop job (designate-mode click → JobBoard chop → cow pathfinds adjacent → chop timer → tree despawns, wood drops).
- [x] Tile-occupancy aware walkability: trees block paths; pathCache invalidates on tree change.

Still open:
- [ ] Stockpile zones (player-designated tiles where items get hauled) — slice B.
- [ ] Haul job — slice B.
- [ ] Jobs: `Eat`, `Sleep`, `Mine` (rock → stone) — later slices.
- [ ] Building placement: `Build` job, construction-in-progress component, completion turns blueprint into building.
- [ ] First building: a wooden wall and a sleeping spot.
- [ ] Hunger ticks down, eating restores it, starvation deals damage. (hunger drain already wired; eating path TBD)
- [ ] Sleep need ticks down, sleeping in a sleep spot restores it.

**Definition of done:** Player can place a stockpile + sleep spot, designate trees to chop, cows autonomously chop wood, haul to stockpile, eat when hungry, sleep when tired, build walls.

---

## Phase 5 — OIT integration

The foundational rendering feature we promised in ARCHITECTURE.md §2.

- [ ] Fork [stevinz/three-wboit](https://github.com/stevinz/three-wboit) into `src/render/wboit/`
- [ ] Adapt to current three.js version
- [ ] Wire into our render pipeline as a discrete pass
- [ ] Test: render 10 overlapping semi-transparent cubes, verify no z-fighting / draw-order artifacts
- [ ] Cutaway building view: when camera is below roof level OR cow is selected inside, render walls semi-transparent
- [ ] Particle system using OIT (smoke, dust)

**Definition of done:** Overlapping transparent geometry renders correctly from any angle. Cutaway view "just works" when camera is close to a building.

---

## Phase 6 — Colony feel

Scale up. Many cows. Mood. Time. Make it feel alive.

- [ ] 10-50 cows with individual jobs (perf still holds 30Hz)
- [ ] `Brain` component: mood, traits, relationships
- [ ] Mood-driven behavior: bad mood = slow work, very bad = wander off / fight
- [ ] Day/night cycle with lighting changes
- [ ] Sleep schedule (cows seek sleep at night automatically)
- [ ] Speed controls (1x / 2x / 3x = 30 / 60 / 120 tps)
- [ ] Pause

**Definition of done:** A 30-cow colony runs at 30 Hz, day/night cycles, cows sleep at night and work during day, mood system visibly affects behavior. Speed controls work without breaking determinism.

---

## Phase 7 — Tier 1: dedicated world server

Persistent multiplayer foundation.

- [ ] Node WS server (`server/world/`)
- [ ] Auth + identity (account = colony, simple token-based for MVP)
- [ ] World map data structure (regional, separate coord system from colony grid)
- [ ] Colony ownership + persistence (server-side store: SQLite or just JSON-on-disk for MVP)
- [ ] Save state sync protocol (loopback pushes diffs, server stores authoritative)
- [ ] Protocol versioning (every message has a version)
- [ ] Player can register, see world map, claim a tile, "enter" their colony (tier 2 spawns)

**Definition of done:** Two browsers can connect to local dedicated server, register accounts, claim different tiles on world map, see each other's colonies on the map (read-only summary), enter their own colony and play.

---

## Phase 8 — Tier 3: encounter instances

Server-authoritative shared multiplayer for ruins / PvP.

- [ ] Encounter room hosting (one Node process, many concurrent rooms)
- [ ] Server-authoritative tick loop (same ECS code as colony, but server owns it)
- [ ] Snapshot interpolation + lag compensation (port from predecessor's `SI.vault`)
- [ ] Session token handoff (tier 1 mints token, tier 3 validates)
- [ ] Outcome callback (tier 3 reports to tier 1 when encounter ends)
- [ ] First encounter content: an "ancient ruin" map with ~5 enemy cows, simple combat
- [ ] PvP matchmaking: two players queue, get matched, dropped into shared instance
- [ ] Result rewards flow back to colony state

**Definition of done:** Two players queue for a ruin, get matched, fight each other (or the ruin's NPCs), winner gets loot back in their colony. Server-authoritative — client cheating doesn't work.

---

## Phase 9 — Async inter-colony + world events

Async multiplayer interactions that don't need real-time.

- [ ] Caravan system: send goods/cows from your colony to another, arrives after real-world delay
- [ ] Trading interface
- [ ] World events (raids, weather, plagues — broadcast by tier 1)
- [ ] Faction system (alignments between colonies)

**Definition of done:** Players can send caravans to each other, trade resources, world events fire on a schedule and affect all colonies appropriately.

---

## Phase 10 — Polish + content + ship

The "actually a game" phase. Scope TBD as we get closer.

- [ ] Sound + music
- [ ] More cow visual variety
- [ ] Tutorial / onboarding
- [ ] Settings / accessibility
- [ ] Beta deploy of dedicated server
- [ ] Telemetry (opt-in)
- [ ] Bug bash

---

## Cross-cutting concerns (not phase-bound)

These are habits / processes that stay true across all phases:

- **Determinism.** Sim must be deterministic given same inputs + RNG seed. Critical for save/load + multiplayer encounters.
- **No hidden state.** Everything that affects sim must be a component. Nothing on closures, nothing on prototypes.
- **Migrations are append-only.** Never delete a save migration function.
- **JSDoc on public surfaces.** Internal helpers can skip; anything exported should have types.
- **Profile before optimizing.** Don't pre-optimize — measure first.
- **The plan is a living doc.** When reality diverges, update PLAN.md in the same commit.

---

## Open questions / explicit "decide later"

- World map regional coordinate system (hex? square? size?)
- Modding API surface
- Cloud hosting strategy for dedicated server
- Audio engine choice
- Combat depth (turn-based? real-time-with-pause? full real-time?)
- Cow trait system depth
- Tech tree / progression model
