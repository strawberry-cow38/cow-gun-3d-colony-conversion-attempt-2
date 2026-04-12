# ARCHITECTURE

Foundational decisions for `cow-gun-3d-colony-conversion-attempt-2`. Locked 2026-04-12.

These are the load-bearing choices the rest of the project is built on. Changing one of these later means significant rework — they were debated up front so we don't pivot mid-build.

---

## 1. Language: JavaScript

Plain ES modules, no TypeScript source.

Type-safety net via JSDoc annotations + `tsc --checkJS` in CI (see §7).

**Why:** TS adds a build step, friction with three.js typings, and types-as-source-of-truth fights ECS archetypes (entity shapes are dynamic). JSDoc gives editor + CI type checking where it matters without TS friction.

---

## 2. Renderer: three.js

Stylized low-poly 3D, single canvas, custom render pipeline.

**Order-Independent Transparency (OIT):** non-negotiable foundation feature. Plan:
- Adopt **weighted-blended OIT** (Morgan McGuire 2013) via a fork of [stevinz/three-wboit](https://github.com/stevinz/three-wboit).
- Render pipeline designed around a custom pass system from day one — OIT is not a retrofit.
- Used for cutaway building views (semi-transparent walls), glass/water structures, layered particle FX, fog volumes.
- Fallback to depth-peeling ([gkjohnson demo](https://discourse.threejs.org/t/demo-order-independent-transparency-with-depth-peeling/88044)) if WBOIT artifacts bite us.

**Why three.js over babylon.js:** smaller bundle (~600KB vs ~2-3MB), bigger indie/game ecosystem, less opinionated (plays nice with custom ECS), more "stays out of your way." Babylon's built-in OIT was tempting, but porting WBOIT is ~half a day of work — not worth the trade.

---

## 3. ECS: Handwritten

Custom archetype-style Entity Component System, ~200 lines of core code.

**Layout:**
- **Entity** — opaque integer ID.
- **Component** — pure data (no methods). Stored in archetype tables (entities grouped by exact component set) for cache-friendly iteration.
- **System** — function over entities matching a component query.

**Tier system (per existing colony-sim memory):**
- Systems opt into a tick cadence: `every` (every tick), `rare` (every N ticks), `long` (every M ticks), `dirty` (only when flagged).
- Mirrors RimWorld's `[TickRare]` / `[TickLong]` discipline.
- Spatial grid for proximity queries; staggered eval to spread CPU load across ticks.

**Why handwritten over bitECS / miniplex:** colony sim has weird needs (job tiers, dirty-flag eval, custom serialization for save/load) that library opinions would fight. 200 lines of zero-dep ECS is cheaper than fighting a library's worldview.

---

## 4. Server topology: 3-tier

```
┌─────────────────────────────────────────────────────┐
│  TIER 1: DEDICATED WORLD SERVER (persistent, WS)    │
│  - world map, colony ownership, identity/auth       │
│  - matchmaking for encounters                       │
│  - source of truth for save state (option b)        │
└────────┬─────────────────────────────────┬──────────┘
         │                                 │
         ↓                                 ↓
┌──────────────────────┐         ┌──────────────────────┐
│ TIER 2: LOOPBACK     │         │ TIER 3: ENCOUNTER    │
│ COLONY INSTANCE      │         │ INSTANCE (shared)    │
│ (in your tab)        │         │ (server-managed)     │
│                      │         │                      │
│ - single-player      │         │ - server-authoritative│
│ - your private base  │         │ - 2-N players        │
│ - pause/fast-fwd ok  │         │ - PvP/PvE ruins      │
│ - trusts client      │         │ - lag-comp + SI vault│
│ - same ECS code      │         │ - same ECS code      │
└──────────────────────┘         └──────────────────────┘
```

**Rules:**
- **No real-time colony visits.** Inter-colony interaction is async (caravans, messages, world events) — never live.
- **Save state lives on dedicated server.** Single source of truth. Loopback pulls fresh on entry, periodic sync on changes.
- **Same ECS code runs in all three tiers.** What differs is who owns the tick loop and where snapshots flow.
- **Encounter instances are server-authoritative.** Anti-cheat, lag compensation, snapshot interpolation all live here. (This is where the FPS-architecture bones from the predecessor get reused.)
- **Encounters are ephemeral.** Spun up by dedicated server on demand, hosted as rooms inside one Node process (don't fork-per-encounter), die when done.

**Transport:**
- Tier 1: WebSocket
- Tier 2: postMessage / direct in-tab call (no network)
- Tier 3: WebSocket for MVP. Built behind a swappable `Transport` interface so WebRTC DataChannel is a 1-day swap if encounters need lower latency / unreliable mode later.

---

## 5. Save format: JSON + gzip

- Serialize world state to JSON, gzip on the wire and at rest.
- Every save has a `version` field.
- On load: if `save.version < CURRENT`, run migration functions in sequence (`v3 → v4 → v5 → CURRENT`).
- **Migration functions are append-only.** Never delete one. Year-old saves must always load.
- Swap to MessagePack only if/when bandwidth or parse time actually bites — same shape, different serializer, ~1-day port.

**Why JSON over binary:** debuggability is gold ("just open the file when something corrupts"), gzip handles 90% of the size pain for free, premature binary buys pain we don't need yet.

---

## 6. Tick + scale primitives

**World scale:**
- 1 unit ≈ 3.5 cm
- 1 tile = 1.5 m = 43 units
- Default colony grid: 200 × 200 tiles = 300m × 300m

**Time:**
- Sim tick rate: **30 Hz** (33 ms / tick)
- 1 game day = 24 real-world minutes = **43,200 ticks**
- Render runs separately at display refresh rate, interpolating between sim ticks.

**Speed multipliers (planned):** 1x = 30 tps, 2x = 60 tps, 3x = 120 tps. May add ultra (240 tps) later.

**World map scale:** TBD — separate coordinate system from colony grid (regional, probably hex), locked when world-map design starts.

---

## 7. Tooling

| Concern | Pick |
|---------|------|
| Bundler + dev server | **vite** (esbuild dev, rollup prod, HMR) |
| Test runner | **vitest** (vite-native, jest-compatible API) |
| Lint + format | **biome** (single rust binary, replaces eslint + prettier) |
| Type checking | **JSDoc + `tsc --checkJS`** in CI |
| Package manager | **pnpm** |

---

## What is NOT decided yet

Deferred until needed — don't pre-design these:
- World-map regional coordinate system + size
- Specific component schemas
- UI framework / approach (likely raw DOM + canvas overlays)
- Audio engine
- Modding API surface
- Telemetry / analytics
- Dedicated server hosting (cloud provider, region strategy)
