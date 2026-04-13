# STATE

Snapshot of `cow-gun-3d-colony-conversion-attempt-2` as of **2026-04-13**.

This is a point-in-time status doc. For the roadmap see [PLAN.md](./PLAN.md); for foundational decisions see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## TL;DR

A 3D cow colony sim running on a hand-rolled archetype ECS + three.js. Single-player, local-only. The core loop works: cows wander, chop trees, haul wood/stone/food to stockpiles, eat when hungry, can be drafted, can be taken over in first-person. Live at **<https://game.cowtools.uk>** via a Cloudflare Tunnel → `vite preview` on the dev box (both systemd services, survive reboots).

**Performance headline:** 1000 cows runs at avg **6.2 ms/tick** on a 128×128 grid — ~5.4× real-time headroom at 30 Hz.

---

## Phase status (vs PLAN.md)

| Phase | Status | Notes |
|---|---|---|
| 0 — Bootstrap | ✅ | vite + biome + tsc --checkJS + vitest scaffolding all in place. |
| 1 — Core ECS + 30 Hz loop | ✅ | Archetype ECS, tiered scheduler (every/rare/long/dirty), fixed-step loop, profiler. |
| 2 — World, terrain, camera | ✅ | Tile grid, RTS camera, tile picker, gzip save/load with migration chain (v0 → v7). |
| 3 — First cow | ✅ | Pathfinding + Brain + Wander + click-to-select. |
| 4 — Job ecosystem | ✅ (a–h shipped) | Trees/chop (4a), stockpile/haul (4b), stacks + stone/food + eat (4c), item labels + consolidation (4d), first-person takeover (4e), cow names + CowCam (4f), drafting (4g), F-focus + Q/E cycle (4h). |
| 5 — AI perf + OIT | 🛠 in progress | 5a dirty-flag AI in flight; OIT not started. |
| 6 — Colony feel | ⏳ | Scale-up, mood, day/night, speed controls. |
| 7–10 — Server, encounters, async, polish | ⏳ | Not started. |

---

## What's built, concretely

### ECS core (`src/ecs/`)
- Archetype tables keyed by exact component set. Slot+gen entity IDs.
- Tiered scheduler with `every` (every tick), `rare` (every 8), `long` (every 64), `dirty` (fires only when its tag is set).
- Per-system wall-ms EWMA exposed for the profiler overlay.

### World (`src/world/`)
- `TileGrid` — W×H typed arrays for elevation / biome / occupancy / stockpile.
- `coords.js` — `tileToWorld` / `worldToTile`, `TILE_SIZE = 43` units (1.5 m physical).
- Gzip save/load (`persist.js`) at schema **v7**. Migrations chain v0 → v7 and never delete old steps. Save key derives from `CURRENT_VERSION`.
- Item kind registry (`items.js`) — wood/stone/food, per-kind stack cap, nutrition, render color, shared `addItemToTile`.

### Simulation (`src/sim/` + `src/systems/` + `src/jobs/`)
- A* pathfinding with result cache; invalidated on tree/stockpile change.
- **JobBoard** (`jobs/board.js`) — chop + haul jobs; bumps `version` on post/release/complete so idle cows wake.
- **Cow brain** (`systems/cow.js`) — dirty-flag gate on decide (`jobDirty | vitalsDirty | lastBoardVersion !== board.version`), hunger-triggered eat job, nearest-unclaimed-job scan, wander fallback.
- **PathFollow** — steers Velocity toward next tile; soft cow-cow avoidance (lateral nudge + 70% slow when crowded).
- **Hunger** — drains 1 unit per in-game day; below 0.45 threshold sets `vitalsDirty` to force brain re-decide.
- **HaulPoster** (rare tier) — posts one haul job per loose item unit, runs a consolidation pass that merges smaller stockpile stacks into larger ones with a strict ordering rule so the pair never thrashes.

### Render (`src/render/`)
- InstancedMesh for cows + items + trees + stress entities.
- RTS camera + first-person camera + camera-smoothed focus mode.
- Tile mesh, tile picker, selection viz (waypoint markers), stockpile overlay, chop designator, stockpile designator.
- Cow name tags (HTML billboards), draft badge (sword/shield), item labels, CowCam first-person overlay.
- Click-to-select with two-stage pick (direct cow raycast → fallback nearest-cow-to-tile).

### Tooling
- `pnpm dev` (vite), `pnpm build`, `pnpm test` (vitest), `pnpm lint` (biome), `pnpm typecheck` (tsc --checkJS).
- **69 vitest tests** covering ECS, scheduler, pathfinding, coords, tileGrid, persist, migrations, board, haul posting.
- GitHub Actions CI workflow drafted (`.github/workflows/ci.yml`, not yet pushed).
- Repo live at <https://github.com/strawberry-cow38/cow-gun-3d-colony-conversion-attempt-2>.

---

## Controls (current)

| Input | Action |
|---|---|
| LMB | Select cow (or clear) |
| Shift+LMB | Toggle cow in selection |
| RMB drag | Move camera |
| Scroll | Zoom |
| RMB on tile (with selection) | Move-command |
| `C` | Toggle chop-designate mode |
| `V` | Toggle stockpile-designate mode |
| `G` / `J` | Debug: drop stone / food on picked tile |
| `N` | Spawn a cow |
| `K` / `L` | Save / Load to localStorage |
| `P` | Toggle debug overlays |
| `F` | Focus/follow selected cow |
| `Q` / `E` | Cycle focused cow |
| `R` | Enter first-person / take over cow |
| `T` | Toggle draft on selected cows |

---

## Perf numbers (2026-04-13, `bench/cows.js`)

Full-brain cows on a 128×128 grid, 900 ticks measured after 30-tick warmup. 30 Hz budget is 33.33 ms/tick.

| Cows | Avg | p50 | p95 | p99 | Max | Headroom |
|---|---|---|---|---|---|---|
|  500 |  1.8 ms |  1.7 |  2.1 |  3.1 |  3.8 | 18.8× |
| **1000** | **6.2 ms** | **6.1** | **7.1** | **7.8** | **11.3** | **5.4×** |
| 2000 | 22.6 ms | 22.3 | 26.6 | 28.8 | 29.2 | 1.5× |
| 3000 | 48.3 ms | 48.2 | 55.9 | 59.3 | 85.5 | 0.7× — breaks |

**Dominant cost:** `cowFollowPath` eats ~86% of the tick. It's the O(N²) cow-cow avoidance sweep — each cow linearly scans all others for personal-space / steering. Scaling shows it: 500 → 1000 is 3.5×, 1000 → 2000 is 3.7× (clean N²).

Phase 5a.3 (spatial grid for neighbor queries) targets exactly this; expected to push the break-point past 5000 cows.

---

## Infra

| Thing | How it runs |
|---|---|
| Domain | `cowtools.uk` on Cloudflare DNS. |
| Tunnel | `cloudflared` named tunnel `cow-sim`, 4 connections to `lhr14/15/16`. `game.cowtools.uk` routes to `http://localhost:4173`. |
| Preview server | `vite preview` on `:4173`, as systemd unit `cow-sim-preview.service`. |
| Tunnel service | `cloudflared.service`, `cloudflared service install` with config at `/etc/cloudflared/config.yml`. |
| Reboot survival | Both services `enabled`; `Restart=on-failure` for preview. |

---

## Active work

### In flight: **Phase 5a — dirty-flag AI**
5-slice perf push so colony scale can grow past ~3000 cows.

| Slice | Status | What |
|---|---|---|
| 5a.1 | ✅ shipped | Dirty-flag gate on cow brain (`jobDirty` / `vitalsDirty` / `lastBoardVersion`). Idle cows skip the decide block when nothing changed. |
| 5a.2 | ⏳ next | Job priority tiers (0=emergency → 4=idle). Cow on tier N only scans tiers 0..N-1 for interrupts — wakes don't stampede. |
| 5a.3 | ⏳ | Spatial grid (tile-bucketed) to replace the O(N²) neighbor sweep in `cowFollowPath` and `findNearestFood`. |
| 5a.4 | ⏳ | Staggered evaluation — brains distribute across tick offsets so heavy frames spread out. |
| 5a.5 | ⏳ | Thought system — cows produce `Thought` records (small reasons they did what they did), surfaced in CowCam + debug UI. |

### Also pending
- Push CI workflow to GitHub (pending gh auth refresh).
- Phase 5b — buildings (blocked on 5a.2 landing first, since build jobs need tiered board queuing).

---

## Known debt / audit carry-overs

The last audit pass (today) cleared the biggest items:
- Stale `tileMesh` stash in pickers → fixed via getter closures.
- `board.complete` not bumping `version` → fixed.
- `cowFollowPath` overshoot at final step → velocity now zeroed on arrival.
- Eat vs. haul race on food stacks → `buildHaulTargetedCounts` now counts cow eat claims too.
- Dead exports (`spawnTree`, `despawnTree`, `WANDER_RADIUS_TILES`) dropped.
- `addItemToTile` de-duplicated between `main.js` and `cow.js` via `src/world/items.js`.

Still open / acknowledged:
- `main.js` is ~800 lines and carries the bulk of wiring. Splitting into `src/boot/` modules is on the near-term shelf.
- Path cache invalidation is all-or-nothing on terrain change — fine at 128² but will want incremental invalidation later.
- Entity gen rollover at 65535 reuses is a theoretical issue; not a concern until we're churning cows.

---

## Repo stats (rough)

- **48** JS files under `src/`
- **~6.6k** lines of source
- **~880** lines of tests (69 tests, 11 files)
- **3** top-level docs: ARCHITECTURE, PLAN, STATE (this file)
