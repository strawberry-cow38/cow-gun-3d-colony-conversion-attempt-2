/**
 * Benchmark: can the sim hold 30 Hz (33.3ms budget) with N cows?
 *
 * Spawns N cows on a large grid with real Brain/Job/Path/Hunger + movement +
 * path-follow + hunger system + haul poster. Runs 900 ticks (30 sim-seconds)
 * and reports tick p50/p95/p99 plus per-system avg wall-ms.
 *
 * Usage: node bench/cows.js [count=1000] [ticks=900]
 */

import { registerComponents } from '../src/components/index.js';
import { Scheduler } from '../src/ecs/schedule.js';
import { World } from '../src/ecs/world.js';
import { JobBoard } from '../src/jobs/board.js';
import { makeHaulPostingSystem } from '../src/jobs/haul.js';
import { PathCache, defaultWalkable } from '../src/sim/pathfinding.js';
import { makeCowBrainSystem, makeCowFollowPathSystem, makeHungerSystem } from '../src/systems/cow.js';
import { applyVelocity, snapshotPositions } from '../src/systems/movement.js';
import { spawnInitialTrees } from '../src/systems/trees.js';
import { tileToWorld } from '../src/world/coords.js';
import { TileGrid } from '../src/world/tileGrid.js';

const count = Number(process.argv[2] ?? 1000);
const ticks = Number(process.argv[3] ?? 900);
const W = 128;
const H = 128;

const world = new World();
registerComponents(world);

const grid = new TileGrid(W, H);
const paths = new PathCache(grid, defaultWalkable);
const board = new JobBoard();

// Seed a handful of trees (so haul poster + chop system have real work).
spawnInitialTrees(world, grid, 200);

// Spawn N cows across the grid.
for (let n = 0; n < count; n++) {
  let i;
  let j;
  let tries = 0;
  do {
    i = Math.floor(Math.random() * W);
    j = Math.floor(Math.random() * H);
    tries++;
  } while (grid.isBlocked(i, j) && tries < 32);
  const w = tileToWorld(i, j, W, H);
  world.spawn({
    Cow: { drafted: false },
    Position: { x: w.x, y: 0, z: w.z },
    PrevPosition: { x: w.x, y: 0, z: w.z },
    Velocity: { x: 0, y: 0, z: 0 },
    Hunger: { value: 1 },
    Brain: { name: `cow${n}`, jobDirty: true, vitalsDirty: true, lastBoardVersion: -1 },
    Job: { kind: 'none', state: 'idle', payload: {} },
    Path: { steps: [], index: 0 },
    Inventory: { itemKind: null },
    CowViz: {},
  });
}

const scheduler = new Scheduler();
scheduler.add(snapshotPositions);
scheduler.add(
  makeCowBrainSystem({ board, grid, paths, walkable: defaultWalkable, drivingCowId: () => null }),
);
scheduler.add(
  makeCowFollowPathSystem({ grid, paths, walkable: defaultWalkable, drivingCowId: () => null }),
);
scheduler.add(applyVelocity);
scheduler.add(makeHungerSystem());
scheduler.add(makeHaulPostingSystem(board, grid));

// Warmup 30 ticks so caches fill before we measure.
for (let t = 0; t < 30; t++) scheduler.tick(world, t, 1 / 30);

const samples = new Float64Array(ticks);
const t0All = performance.now();
for (let t = 0; t < ticks; t++) {
  const t1 = performance.now();
  scheduler.tick(world, 30 + t, 1 / 30);
  samples[t] = performance.now() - t1;
}
const totalMs = performance.now() - t0All;

const sorted = Array.from(samples).sort((a, b) => a - b);
const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const avg = samples.reduce((s, v) => s + v, 0) / samples.length;

console.log(`\ncows=${count} ticks=${ticks} grid=${W}x${H}`);
console.log(`tick budget @ 30 Hz = 33.33 ms`);
console.log(`tick avg   = ${avg.toFixed(2)} ms`);
console.log(`tick p50   = ${p(0.5).toFixed(2)} ms`);
console.log(`tick p95   = ${p(0.95).toFixed(2)} ms`);
console.log(`tick p99   = ${p(0.99).toFixed(2)} ms`);
console.log(`tick max   = ${sorted[sorted.length - 1].toFixed(2)} ms`);
console.log(`wall total = ${totalMs.toFixed(0)} ms (${ticks} ticks)`);
console.log(`headroom   = ${(33.33 / avg).toFixed(2)}x real-time`);

console.log(`\nper-system avg ms (EWMA):`);
const rows = Array.from(scheduler.avgMs.entries()).sort((a, b) => b[1] - a[1]);
for (const [name, ms] of rows) console.log(`  ${name.padEnd(18)} ${ms.toFixed(3)} ms`);
