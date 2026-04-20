# PLAN

Implementation roadmap for `cow-gun-3d-colony-conversion-attempt-2`.

**This document is living.** When the plan changes — phases reordered, scope shifted, milestones added or cut — update this file in the same commit as the change. A stale plan is worse than no plan.

Last rescan: **2026-04-20** (post-corn / pre-sound-in-engine). See [STATE.md](./STATE.md) for a detailed status snapshot and [ARCHITECTURE.md](./ARCHITECTURE.md) for the foundational decisions.

---

## Phase status legend

- `[ ]` not started
- `[~]` in progress
- `[x]` done
- `[-]` dropped / superseded

---

## Top-level phase status

| Phase | Status | Headline |
|---|---|---|
| 0 — Bootstrap | ✅ | vite + biome + tsc --checkJS + vitest in place. |
| 1 — Core ECS + 30 Hz loop | ✅ | Archetype ECS, tiered scheduler, fixed-step + interpolation, profiler. |
| 2 — World, terrain, camera | ✅ | Atlas-baked tile tops, z-levels + ramps, chunked terrain, RTS camera + Q/E layer switcher, gzip save at schema **v36**. |
| 3 — First cow | ✅ | Pathfind + Brain + Wander + select. |
| 4 — Job ecosystem | ✅ | Chop/haul/mine/till/plant/harvest/cook/smelt/paint/build/deconstruct + bills + work tab + priorities. |
| 5 — Rendering polish | 🛠 | OIT wboit vendored + wired (smoke test via `?oitTest`). Dreamcore skybox + TOD done. EffectComposer stack (LUT / tonemap / caustics) still open — earlier PLAN overclaimed these as shipped. |
| 6 — Colony feel | ✅ | Day/night, sleep, drafting, speed (1/2/3/6×) + pause (Space), skills + traits + backstories, social/chitchat. |
| 7 — Tier 1 dedicated server | ⏳ | Not started. |
| 8 — Tier 3 encounters | ⏳ | Not started. |
| 9 — Async inter-colony + world events | ⏳ | Not started. |
| 10 — Polish + content + ship | 🛠 | Content actively landing. Telemetry / tutorial / beta deploy still pending. |

---

## Phase 0 — Bootstrap *(done)*

- [x] Repo + README
- [x] ARCHITECTURE.md + PLAN.md
- [x] `package.json` + pnpm scripts (`dev`, `build`, `test`, `lint`, `typecheck`)
- [x] `vite.config.js`
- [x] `biome.json`
- [x] `tsconfig.json` (`checkJS: true`, `noEmit: true`)
- [x] `vitest.config.js` + 28 test files, 305+ tests
- [x] `.gitignore`
- [x] `src/main.js` + `index.html`
- [x] GitHub Actions CI (`.github/workflows/ci.yml`)
- [x] Live deploy: `game.cowtools.uk` → cloudflared → `vite preview :4173` (both systemd units)

---

## Phase 1 — Core ECS + sim loop *(done)*

- [x] Entity registry w/ slot+gen IDs
- [x] Component registration
- [x] Archetype storage
- [x] Query API (`world.query(...)`)
- [x] Tiered system registration (`every` / `rare` / `long` / `dirty`)
- [x] Dirty flag plumbing
- [x] 30 Hz fixed-step accumulator w/ render interpolation
- [x] Per-system wall-ms profiler, exposed in dev overlay
- [x] Stress bench: 1000 cows holds 30 Hz (~6 ms/tick)

---

## Phase 2 — World, terrain, camera *(done)*

- [x] Tile grid component + spatial index (default 128² / 200²)
- [x] Instanced atlas-baked tile tops w/ per-tile UV offset
- [x] Heightmap + z-levels (0.75 m steps, climb tier, ramps)
- [x] Terrain mesh chunking for frustum culling
- [x] RTS camera (orbit + pan + scroll zoom) + first-person cowCam
- [x] Tile picking (two-stage: direct cow raycast → nearest-cow-to-tile)
- [x] Gzip save/load at schema **v36** (37 migration files chained, never deleted)
- [x] Q / E layer switcher + wall-top path targeting
- [x] Coordinate system locked: 1 tile = 1.5 m = 43 units, Y-up

---

## Phase 3 — First cow *(done)*

- [x] A* pathfind w/ result cache, per-layer grids, dirty invalidation
- [x] `Cow` archetype: `Position`, `Velocity`, `Hunger`, `Tiredness`, `Brain`, `Skills`, `Identity`, etc.
- [x] JobBoard w/ post/claim/release/complete + version counter
- [x] `Wander` job + cow render + nametag sprites
- [x] Click-to-select + cow info panel
- [x] Deferred items landed: name labels, real board-backed jobs, fine-grained path cache invalidation

---

## Phase 4 — Job ecosystem *(done)*

All core jobs + stations landed. Beyond the original plan:

**Jobs** (`src/jobs/`): `chop`, `cut` (butcher), `haul`, `mine`, `till`, `plant`, `harvest`, `build`, `deconstruct`, `wander`, `atTile`, plus priority routing (`prioritize.js`) and tiered claim (`tiers.js`).

**Resource items** (`src/world/items.js`): `wood` (tiered log GLBs), `stone` / `coal` / `copper_ore` (tiered rock GLBs), `corn` / `carrot` / `potato` (tiered GLBs, `rawFood` tag), `meal` (w/ quality 0–4 + descriptions), plus per-kind stack cap, nutrition, render color.

**Stockpile zones**: designator rects → `StockpileZone` entities w/ per-kind filters, allow-toggle, rename, expand, X-delete. Haul poster respects filters + does consolidation.

**Farm zones**: designator rects w/ per-crop selector, till toggle, harvest toggle, rename, delete untills land. Cows only harvest food inside grow zones.

**Stations / furniture**: stove (cook → meal w/ quality from cooking skill), furnace (smelt coal → ingots), easel (paint → painting entity), bed (owner picker, drains Tiredness), torch (light), wall (tiered fill, 4-quarter partial walls), door, floor, roof (w/ material options + hasRoofSupport check), stair (z-aware placement + panel + decon).

**Bills system**: work orders posted against stations w/ output destination (floor / haul / specific stockpile).

**Work tab**: per-cow category→kind routing (priorities 1–8 + disable), component-backed, hydrates defensively.

Remaining scope moved to Phase 10 content drops.

---

## Phase 5 — Rendering polish *(in progress)*

Original Phase 5 was OIT. Basic OIT now landed; cutaway-building + particles still open. A parallel dreamcore look pass (skybox mesh + TOD palette) shipped in parallel — **no EffectComposer postprocessing stack ever landed** (LUT / tonemap / caustics were tracked as "done" but never committed; corrected 2026-04-20).

**Shipped:**
- [x] Dreamcore skybox mesh + stars (scene-object, not postprocessing)
- [x] Dusk/night TOD palette tuning (`timeOfDay.js`)
- [x] Drop shadows: unified blob system for cows / items / trees / boulders / bushes
- [x] Sun directional shadow landed then **removed globally** (perf + art direction)
- [x] Torch shadow drop + pool shrink
- [x] Frustum culling on instancers + `computeBoundingSphere` on InstancedMesh updates
- [x] OIT: vendor [stevinz/three-wboit](https://github.com/stevinz/three-wboit) into `src/render/wboit/`
- [x] OIT: wire WboitPass into `renderFrame.js` (toggle via `?noOit`, smoke test via `?oitTest`)

**Still open:**
- [ ] EffectComposer postprocessing stack: tonemap + LUT + water caustics (previously claimed shipped; actually not started)
- [ ] Cutaway building view (camera below roof → walls go semi-transparent)
- [ ] OIT particle system (smoke / dust)

**Definition of done:** Overlapping transparent geometry renders correctly from any angle, cutaway view "just works" when the camera is close to a building.

---

## Phase 6 — Colony feel *(done)*

- [x] Many cows w/ individual jobs (1000 cows @ 6 ms/tick verified)
- [x] Day/night cycle w/ lighting changes (`world/timeOfDay.js`)
- [x] Sleep schedule (tiredness drains, cow seeks assigned bed)
- [x] Speed controls (1 / 2 / 3 / 6× via number keys)
- [x] Pause (Space) — render keeps running for UI
- [x] **Mood-lite:** skills + traits + backstories + identity system (`world/skills.js`, `traits.js`, `backstories.js`, `identity.js`) — behavior hooks wired through work priorities and station quality rolls
- [x] Social / chitchat (`systems/social.js` + `world/chitchat.js`)

Not pursued (consciously):
- [-] Full mood meter → slow-work-when-sad. Superseded by skills + quality tiers + quality-of-meal descriptions.

---

## Phase 7 — Tier 1: dedicated world server *(not started)*

- [ ] Node WS server (`server/world/`)
- [ ] Auth + identity (account = colony, token-based MVP)
- [ ] World map data structure (regional coord system)
- [ ] Colony ownership + persistence (SQLite or JSON-on-disk MVP)
- [ ] Save state sync protocol (loopback → authoritative server diffs)
- [ ] Protocol versioning on every message
- [ ] Player registers → sees world map → claims tile → enters colony

---

## Phase 8 — Tier 3: encounter instances *(not started)*

- [ ] Encounter room hosting (one Node process, many concurrent rooms)
- [ ] Server-authoritative tick loop (shared ECS code)
- [ ] Snapshot interpolation + lag compensation (port from predecessor's `SI.vault`)
- [ ] Session token handoff (tier 1 mints, tier 3 validates)
- [ ] Outcome callback (tier 3 → tier 1 on end)
- [ ] First encounter content: ancient ruin, ~5 enemy cows, simple combat
- [ ] PvP matchmaking
- [ ] Rewards flow back to colony state

---

## Phase 9 — Async inter-colony + world events *(not started)*

- [ ] Caravan system (send goods/cows, real-time delay arrival)
- [ ] Trading interface
- [ ] World events (raids / weather / plagues, broadcast by tier 1)
- [ ] Faction system (alignments between colonies)

---

## Phase 10 — Polish + content + ship *(in progress)*

Content landing as slices. Pipeline / infra still open.

**Landed content:**
- Biomes: grass, sand, water (wading slowdown + shallow/deep visual tiers)
- Terrain generation w/ cliffs + elevations + flower decoration
- Trees: pine + maple GLBs
- Boulders: stone + coal + copper variants w/ embedded ore chunks
- Bushes: billboard crossed-quad shrubs
- Starter colony UX: default 3 cows, 2× starting skill levels, Title/First/Nickname/Last name scheme, portrait cards (avatar on top, name + activity below), RimWorld-style bottom tab bar
- Audio: music toggle (default muted for now)

**Still open:**
- [~] Sound + music: AudioGen + Stable Audio Open stood up on the 4080S Windows box (`C:\claude-workspace\`) for dev-side SFX generation. **Not wired into the game yet.**
- [ ] More cow visual variety (mesh variants / palette)
- [ ] Tutorial / onboarding
- [ ] Settings / accessibility pane
- [ ] Beta deploy of dedicated server (blocks on Phase 7)
- [ ] Telemetry (opt-in)
- [ ] Bug bash
- [ ] Install / uninstall round-trip for furnace / easel / torch + wallart info panel *(paused 2026-04-15)*
- [ ] All buildables z-aware (structural) — structural gates remain on Phase 10 backlog

---

## Cross-cutting concerns (not phase-bound)

- **Determinism.** Sim must be deterministic given same inputs + RNG seed. Critical for save/load + multiplayer encounters.
- **No hidden state.** Everything that affects sim must be a component. Nothing on closures, nothing on prototypes.
- **Migrations are append-only.** Chain now at v0 → v36; never delete an old step.
- **JSDoc on public surfaces.** Internal helpers can skip.
- **Profile before optimizing.** Measure first.
- **The plan is a living doc.** When reality diverges, update PLAN.md in the same commit.

---

## Open questions / explicit "decide later"

- World map regional coordinate system (hex? square? size?)
- Modding API surface
- Cloud hosting strategy for dedicated server
- Audio engine choice (Web Audio direct? Howler? Three PositionalAudio?)
- Combat depth (turn-based? RTwP? real-time?)
- Tech tree / progression model
- Cows → humans transition (planned; identity systems already named generically)
