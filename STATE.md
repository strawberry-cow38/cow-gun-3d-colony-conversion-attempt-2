# STATE

Snapshot of `cow-gun-3d-colony-conversion-attempt-2` as of **2026-04-20**.

This is a point-in-time status doc. For the roadmap see [PLAN.md](./PLAN.md); for foundational decisions see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## TL;DR

A 3D cow colony sim running on a hand-rolled archetype ECS + three.js. Single-player, local-only, RimWorld-flavored. The core loop is full: cows wander, chop, mine, till, plant, harvest, cook meals (w/ quality), smelt ore, paint paintings, build walls (w/ partial-fill tiers), stairs, roofs, and floors across multiple z-levels, haul items into filtered stockpiles, eat, sleep in owned beds, and chit-chat. Live at **<https://game.cowtools.uk>** via a Cloudflare Tunnel → `vite preview` on the dev box (both systemd services, survive reboots).

**Perf headline (2026-04-13 bench, still representative):** 1000 cows at avg **6.2 ms/tick** on a 128×128 grid — ~5.4× real-time headroom at 30 Hz. Brain hot-path is now the dirty-flag gated `systems/cow.js`; the old O(N²) neighbor sweep in `cowFollowPath` is still the dominant cost above 1500 cows.

**Since the last STATE snapshot (2026-04-13):** ~380 commits. Full phase 4 + phase 6 landed. Phase 5 now has basic OIT landed (vendored `stevinz/three-wboit` wired as a render-pass wrapper, URL toggles `?noOit` / `?oitTest`). Dreamcore skybox + TOD palette shipped — the previously-claimed EffectComposer postprocessing stack (LUT / tonemap / caustics) was **never actually committed**; corrected here.

---

## Phase status (vs PLAN.md)

| Phase | Status | Notes |
|---|---|---|
| 0 — Bootstrap | ✅ | vite + biome + tsc --checkJS + vitest, CI in `.github/workflows/`. |
| 1 — Core ECS + 30 Hz loop | ✅ | Archetype ECS, tiered scheduler (every / rare / long / dirty), fixed-step loop + render interpolation, profiler. |
| 2 — World, terrain, camera | ✅ | Atlas-baked tile tops, per-tile mutation API, z-levels + ramps, chunked terrain, RTS + cowCam cameras, gzip save at schema **v36** (37-step migration chain). |
| 3 — First cow | ✅ | Pathfinding + Brain + Wander + nametag sprites + click-select. |
| 4 — Job ecosystem | ✅ | Chop / cut / haul / mine / till / plant / harvest / cook / smelt / paint / build / deconstruct. Stockpile zones + farm zones + bills + work tab. Stations: stove, furnace, easel, bed, torch, wall (4-quarter partial), door, floor, roof (w/ material options), stair. |
| 5 — Rendering polish | 🛠 | OIT vendored (`three-wboit`) + wired via `?oitTest` / `?noOit`. Dreamcore skybox mesh + TOD palette shipped. EffectComposer stack (tonemap / LUT / caustics) — previously claimed shipped, actually never committed. Cutaway-wall + particles still open. |
| 6 — Colony feel | ✅ | Day/night, sleep, drafting, speed (1/2/3/6×) + pause (Space). Mood-lite via skills + traits + backstories + identity + social/chitchat. |
| 7 — Tier 1 dedicated server | ⏳ | Not started. |
| 8 — Tier 3 encounters | ⏳ | Not started. |
| 9 — Async inter-colony + world events | ⏳ | Not started. |
| 10 — Polish + content + ship | 🛠 | Content landing every day. Audio gen stood up on the 4080S but not wired in-engine. |

---

## What's built, concretely

### ECS core (`src/ecs/`)
- Archetype tables keyed by exact component set. Slot+gen entity IDs.
- Tiered scheduler: `every`, `rare` (every 8), `long` (every 64), `dirty` (fires only when its tag is set).
- Per-system wall-ms EWMA exposed for the profiler overlay.
- `world.query` result caching in render hot paths.

### World (`src/world/`)
- `TileGrid` + `TileWorld` — per-layer typed arrays for elevation / biome / wall / door / torch / roof / floor / ramp / stockpile / farmZone / tilled / flower, plus the `ignoreRoof` override.
- `coords.js` — `tileToWorld` / `worldToTile`, `TILE_SIZE = 43` units (1.5 m physical).
- Gzip save/load (`persist.js`) at **v36**. Migrations chain `v0 → v36` and never delete old steps.
- **Items** (`items.js`) — wood, stone, coal, copper_ore, corn, carrot, potato, meal. Per-kind stack cap, nutrition, render color, tier-sized GLB drop visuals, shared `addItemToTile`.
- **Buildables** — `bed.js`, `stair.js`, `stove.js`, `painting.js` + `easel`, `furnace`, `wallArt`, `flowers.js`.
- **Crops** (`crops.js`) — per-type growth stages + harvest yield; planted-at-tick for ETA display.
- **Recipes** (`recipes.js`) — bill system definitions w/ output destination routing.
- **Meal quality** (`quality.js`) — 0–4 tiers driven by cooking skill roll, descriptions per tier surfaced in the item panel.
- **Skills** (`skills.js`) — XP-backed, 0–20 levels, awarded from work systems.
- **Identity / traits / backstories** (`identity.js`, `traits.js`, `backstories.js`) — seeded on spawn; every backstory tagged w/ skill hints.
- **Social / chitchat** (`chitchat.js`) — topic pool for the social system.
- **Time of day** (`timeOfDay.js`) — tick-driven TOD curve feeding sun / sky / hemi colors.
- **Weather** stubs (`weather.js`) — not yet driving anything.

### Simulation (`src/sim/` + `src/systems/` + `src/jobs/`)
- A* pathfind w/ result cache, per-layer grids, cliff-climb tier, dirty invalidation on tree / boulder / wall / door / floor / ramp change.
- **JobBoard** (`jobs/board.js`) — chop / cut / haul / mine / till / plant / harvest / build / deconstruct + priority tiers (`prioritize.js`, `tiers.js`). Bumps `version` on post / release / complete so idle cows wake.
- **Cow brain** (`systems/cow.js`) — dirty-flag gate on decide (`jobDirty | vitalsDirty | lastBoardVersion !== board.version`), hunger / tiredness / thirst triggered job selection, nearest-unclaimed-job scan within the cow's work-tab filter, wander fallback.
- **PathFollow** — steers Velocity toward next tile; soft cow-cow avoidance. Wade-slowdown in shallow water.
- **Hunger** — drains per in-game day; low hunger sets `vitalsDirty`.
- **Tiredness** — drains while awake; restoring in owned bed. Guarded against double-drain during sleep.
- **HaulPoster** — one haul job per loose item unit; consolidation pass merges smaller stockpile stacks with a strict ordering rule; cooldown on unreachable drop sites; in-flight per-site keying for stacked wall blueprints.
- **Stations**: `stove` (cook → meal w/ quality), `furnace` + `furnaceExpel` (smelt), `easel` (paint → painting entity), `farm` / `farmZones` (till + plant + harvest w/ zone filters), `stockpileZones` (accept filters + eviction), `trees` (chop → wood), `boulders` (mine → stone/coal/copper_ore), `bushes` (decorative), `growth` (crop stages), `social` (chitchat), `rooms` (auto-detect via roof + hasRoofSupport), `autoRoof` (auto-place roofs on enclosed rooms), `roofCollapse` (structural sanity), `itemRescue` (un-stuck loose items), `lighting` (torch pool, no sun shadow), `movement`.

### Render (`src/render/`)
- InstancedMesh for cows, items (tiered GLBs — wood / stone / coal / copper_ore / corn / carrot / potato), trees (pine + maple GLBs), boulders (3 shape variants × material tint w/ embedded ore chunks), bushes (crossed-quad billboards).
- Atlas-baked tile tops w/ per-tile UV offset, chunked for frustum culling.
- Drop shadows: unified blob decal system for cows + items + trees + boulders + bushes.
- Dreamcore skybox mesh + stars + sun/moon discs positioned each frame to follow the camera.
- OIT render wrapper (`wboitRenderer.js`) around the vendored `WboitPass` — opaque + sorted-transparent + accumulation + revealage + composite. Toggle via `?noOit`; smoke test via `?oitTest` (spawns 10 overlapping `MeshWboitMaterial` cubes).
- Sun directional shadow was added and then **removed globally** (perf + art direction).
- Pooled torch lights only; furnace PointLight cut; decorative mesh castShadow disabled.
- RTS camera + first-person cowCam + smoothed focus mode.
- 3D selection ghosts on items (tier-sized) / beds / stairs / trees / boulders / zones.
- Click-to-select w/ two-stage pick (direct cow raycast → fallback nearest-cow-to-tile); itemSelector w/ per-stack click hitboxes.
- Cow nametags: Title/First/Nickname/Last scheme, sharp glyph rewrite, 2× size over heads.
- CowCam first-person overlay, draft badge (sword/shield), item labels via `ITEM_INFO.label`.

### UI (`src/ui/` + `src/boot/`)
- `objectTypes.js` — append-only registry of clickable types (tree, boulder, wall, door, torch, roof, floor, buildsite) for panel routing.
- `src/boot/` now hosts wiring modules split out of `main.js`: `drafting`, `hotkeys`, `hud`, `input`, `layerSwitcher`, `params`, `renderFrame`, `setupDesignators`, `setupInstancers`, `setupWorldCallbacks`, `spawn`, `utils`. `main.js` is still ~1300 lines.
- RimWorld-style bottom tab bar + layout shuffle. Portrait cards (avatar on top, name + activity below) square layout.
- Zone UIs: stockpile filters, farm zone crop + till + harvest toggles, rename, expand, X-delete, Delete-keybind.
- Cow info panel: rename, skills section, work tab w/ 1–8 priority modes, drafting.
- Bills: output destination (floor / haul / specific stockpile).
- Stair info panel + deconstruct wiring.
- Bed panel w/ owner picker + in-world owner nametag sprites.
- Meal quality descriptions surfaced in item stack panel.

### Tooling
- `pnpm dev` (vite), `pnpm build` (vite), `pnpm test` (vitest run), `pnpm lint` (biome check), `pnpm typecheck` (tsc --noEmit).
- **28 vitest test files, 305+ tests** across `test/ecs/`, `test/jobs/`, `test/render/`, `test/boot/`, `test/sim/`, `test/systems/`, `test/world/`.
- CI workflow at `.github/workflows/ci.yml`.
- Repo live at <https://github.com/strawberry-cow38/cow-gun-3d-colony-conversion-attempt-2>.

### Dev-side audio generation (4080S Windows, not yet in-engine)
- Python 3.11 venv at `C:\claude-workspace\audio_env\`.
- **AudioGen** (facebook/audiogen-medium) working — `gen_sfx.py` / `gen_sfx.ps1` CLI wrappers, 3 × 4 s clips in ~4 s on GPU after cached load.
- **Stable Audio Open 1.0** install in progress (weights downloaded via `hf_xet`; smoke test running at time of writing).
- SSH via `claude-admin@192.168.1.145`.

---

## Controls (current)

| Input | Action |
|---|---|
| LMB | Select cow / item / zone / buildable (or clear) |
| Shift+LMB | Toggle cow in selection |
| RMB drag | Move camera |
| Scroll | Zoom |
| RMB on tile (with selection) | Move-command |
| `Space` | Pause / resume |
| `1` / `2` / `3` / `4` | Sim speed 1× / 2× / 3× / 6× |
| `Q` / `E` | Switch z-layer (down / up) |
| `C` | Toggle chop-designate mode |
| `V` | Toggle stockpile-designate mode |
| `F` | Focus/follow selected cow |
| `R` | Enter first-person / take over cow |
| `T` | Toggle draft on selected cows |
| `N` | Spawn a cow |
| `K` / `L` | Save / Load to localStorage |
| `P` | Toggle debug overlays |
| `Delete` | Delete selected zone |

---

## Infra

| Thing | How it runs |
|---|---|
| Domain | `cowtools.uk` on Cloudflare DNS. |
| Tunnel | `cloudflared` named tunnel `cow-sim`, 4 connections to `lhr14/15/16`. `game.cowtools.uk` routes to `http://localhost:4173`. |
| Preview server | `vite preview` on `:4173`, as systemd unit `cow-sim-preview.service`. |
| Tunnel service | `cloudflared.service`, `cloudflared service install` with config at `/etc/cloudflared/config.yml`. |
| Reboot survival | Both services `enabled`; `Restart=on-failure` for preview. |
| Deploy step | After `git push`, run `vite build` — `vite preview` serves `dist/`, so the master will see nothing new until the build finishes. |

---

## Active work

### In flight
- Audio gen on the 4080S: AudioGen shipped; Stable Audio Open smoke test resuming (downloaded weights via `hf_xet`, previous kill interrupted the HF fetch).
- Partial wall: per-entity selection ghost + decon + blueprint cancel (task #429).
- Z-level building UI: stair designator polish, wall-top walkability, z+1 blueprints (task #398).
- All buildables z-aware (structural) — task #420.
- Phase 3: polish + panel UI (food) — task #378.
- Install / uninstall round-trip for furnace / easel / torch + wallart info panel — **paused 2026-04-15**.

### Next shelf
- OIT cutaway building view + OIT particle system (Phase 5 continuation; vendor + wire shipped 2026-04-20).
- EffectComposer postprocessing (tonemap / LUT / water caustics) — re-opened after PLAN audit.
- Wire AudioGen / Stable Audio SFX output into the game.
- Phase 7 (dedicated server) scoping.

---

## Known debt / audit carry-overs

- **`main.js` still ~1300 lines.** Split continues incrementally — `src/boot/` already holds 11 modules extracted from it.
- **Path cache invalidation** is still all-or-nothing on terrain change — fine at 128² but want incremental invalidation when grids get larger.
- **Entity gen rollover** at 65535 reuses is a theoretical concern; not urgent.
- **Cow-cow avoidance** in `cowFollowPath` is still O(N²). A spatial grid replacement is the main perf carrot at >1500 cows. Planned in PLAN.md Phase 5a-alike slice, not yet scheduled.
- **Triton missing** on Windows audio env — fine, xformers falls back to non-triton kernels.
- **Discord allowlist** drops transiently mid-session; master re-runs `/discord:access`. Not a code concern.

---

## Repo stats (rough)

- **221** JS files under `src/`
- **28** test files under `test/` with **305+** tests
- `main.js` at **1316** lines
- **3** top-level docs: ARCHITECTURE, PLAN, STATE (this file)
- Save schema **v36**, 37 migration files
