/**
 * Cow brain + path-follow + hunger systems.
 *
 * Brain (every tick): if Job.kind === 'none', try to claim a job off the board
 * (chop for now); otherwise synthesize a Wander goal. Runs the active job's
 * state machine.
 *
 * PathFollow (every tick): for any cow with a Path, point Velocity toward the
 * world position of the next path step. When close enough, advance the index.
 * When the path is exhausted, zero velocity (the brain's job-state will notice).
 *
 * Hunger (rare tier): drain Hunger.value at a rate of 1 / (one-day-in-ticks).
 * Cosmetic in Phase 3 — Phase 4 will wire it into the Eat job.
 */

import { CHOP_TICKS, findAdjacentWalkable } from '../jobs/chop.js';
import { WANDER_IDLE_TICKS, pickRandomWalkable } from '../jobs/wander.js';
import { tileToWorld, worldToTileClamp } from '../world/coords.js';

const COW_SPEED_UNITS_PER_SEC = 85.7; // ≈2 tiles/sec at 1.5m tile
const ARRIVE_DIST_SQ = 4 * 4; // within 4 units of a step center counts as arrived
const HUNGER_DRAIN_PER_TICK = 1 / 43200; // empties over one in-game day

/**
 * @typedef PathDeps
 * @property {import('../world/tileGrid.js').TileGrid} grid
 * @property {import('../sim/pathfinding.js').PathCache} paths
 * @property {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 *
 * @typedef {PathDeps & {
 *   board: import('../jobs/board.js').JobBoard,
 *   onChopComplete: () => void,
 * }} BrainDeps
 */

/**
 * @param {BrainDeps} deps
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeCowBrainSystem(deps) {
  const { grid, paths, walkable, board } = deps;
  return {
    name: 'cowBrain',
    tier: 'every',
    run(world, ctx) {
      // Release claims held by cows that no longer consider the job theirs
      // (e.g. the player reassigned the cow to a move via RMB mid-chop).
      for (const j of board.jobs) {
        if (j.claimedBy === null || j.completed) continue;
        const cowJob = world.get(j.claimedBy, 'Job');
        if (!cowJob || cowJob.kind !== j.kind || cowJob.payload.jobId !== j.id) {
          j.claimedBy = null;
        }
      }
      for (const { id, components } of world.query(['Cow', 'Position', 'Job', 'Path'])) {
        const job = components.Job;
        const path = components.Path;
        const pos = components.Position;

        // Preempt a wander when chop work appears — without this a cow that
        // already rolled into wander never re-checks the board and will happily
        // ignore freshly designated trees.
        if (job.kind === 'wander' || job.kind === 'none') {
          const near = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
          const candidate = board.findUnclaimed(near);
          if (candidate && candidate.kind === 'chop' && board.claim(candidate.id, id)) {
            job.kind = 'chop';
            job.state = 'pathing';
            job.payload = {
              jobId: candidate.id,
              treeId: candidate.payload.treeId,
              i: candidate.payload.i,
              j: candidate.payload.j,
            };
            path.steps = [];
            path.index = 0;
          }
        }

        if (job.kind === 'none') {
          // No work claimed above → fall back to wander.
          job.kind = 'wander';
          job.state = 'planning';
          job.payload = {};
        }

        if (job.kind === 'chop') {
          runChopJob(world, id, job, path, pos, grid, paths, walkable, board, ctx, deps);
          continue;
        }

        if (job.kind === 'move') {
          // Player-issued move. Pop any waypoint boundary we've passed so the
          // selection viz stops drawing markers for already-reached steps.
          const waypoints = /** @type {{i:number,j:number}[]} */ (job.payload.waypoints ?? []);
          const legEnds = /** @type {number[]} */ (job.payload.legEnds ?? []);
          while (legEnds.length > 0 && path.index > legEnds[0]) {
            waypoints.shift();
            legEnds.shift();
          }
          // When the full chained path is consumed, revert so wander resumes.
          if (path.index >= path.steps.length) {
            job.kind = 'none';
            job.state = 'idle';
            job.payload = {};
          }
          continue;
        }

        if (job.kind === 'wander') {
          if (job.state === 'planning') {
            const goal = pickRandomWalkable(grid, walkable);
            if (!goal) {
              job.state = 'idle';
              job.payload = { untilTick: ctx.tick + WANDER_IDLE_TICKS };
              continue;
            }
            const { i: si, j: sj } = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
            const route = paths.find({ i: si, j: sj }, goal);
            if (!route || route.length === 0) {
              job.state = 'idle';
              job.payload = { untilTick: ctx.tick + WANDER_IDLE_TICKS };
              continue;
            }
            path.steps = route;
            path.index = 0;
            job.state = 'moving';
            job.payload = { goal };
          } else if (job.state === 'moving') {
            if (path.index >= path.steps.length) {
              job.state = 'idle';
              job.payload = { untilTick: ctx.tick + WANDER_IDLE_TICKS };
              path.steps = [];
              path.index = 0;
            }
          } else if (job.state === 'idle') {
            const until = job.payload.untilTick ?? 0;
            if (ctx.tick >= until) job.state = 'planning';
          }
        }
      }
    },
  };
}

/**
 * State machine for the chop job. Broken out so the brain loop stays readable.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ tick: number }} ctx
 * @param {BrainDeps} deps
 */
function runChopJob(world, cowId, job, path, pos, grid, paths, walkable, board, ctx, deps) {
  const { treeId, jobId } = /** @type {{ treeId: number, jobId: number }} */ (job.payload);

  // Tree went away (despawned by us earlier, or by external action) → bail.
  if (!world.get(treeId, 'Tree')) {
    board.release(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const adj = findAdjacentWalkable(grid, walkable, job.payload.i, job.payload.j);
    if (!adj) {
      board.release(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    const route = paths.find(start, adj);
    if (!route || route.length === 0) {
      board.release(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    path.steps = route;
    path.index = 0;
    job.state = 'walking';
    return;
  }

  if (job.state === 'walking') {
    if (path.index >= path.steps.length) {
      job.state = 'chopping';
      job.payload.ticksRemaining = CHOP_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'chopping') {
    const remaining = (job.payload.ticksRemaining ?? CHOP_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    const tree = world.get(treeId, 'Tree');
    if (tree) tree.progress = 1 - remaining / CHOP_TICKS;
    if (remaining <= 0) {
      deps.onChopComplete();
      finishChop(world, grid, treeId, jobId, board);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Despawn the tree, drop a wood item on its tile, complete the job.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} treeId
 * @param {number} jobId
 * @param {import('../jobs/board.js').JobBoard} board
 */
function finishChop(world, grid, treeId, jobId, board) {
  const anchor = world.get(treeId, 'TileAnchor');
  if (anchor) {
    grid.unblockTile(anchor.i, anchor.j);
    const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
    world.spawn({
      Item: { kind: 'wood' },
      ItemViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: { x: w.x, y: grid.getElevation(anchor.i, anchor.j), z: w.z },
    });
  }
  world.despawn(treeId);
  board.complete(jobId);
}

/**
 * @param {PathDeps} deps
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeCowFollowPathSystem(deps) {
  const { grid } = deps;
  return {
    name: 'cowFollowPath',
    tier: 'every',
    run(world) {
      for (const { components } of world.query(['Cow', 'Position', 'Velocity', 'Path'])) {
        const pos = components.Position;
        const vel = components.Velocity;
        const path = components.Path;

        if (path.index >= path.steps.length) {
          vel.x = 0;
          vel.z = 0;
          continue;
        }

        const step = path.steps[path.index];
        const target = tileToWorld(step.i, step.j, grid.W, grid.H);
        const targetY = grid.getElevation(step.i, step.j);
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < ARRIVE_DIST_SQ) {
          path.index++;
          pos.y = targetY;
          continue;
        }

        const dist = Math.sqrt(distSq);
        vel.x = (dx / dist) * COW_SPEED_UNITS_PER_SEC;
        vel.z = (dz / dist) * COW_SPEED_UNITS_PER_SEC;
        vel.y = 0;
        // Snap y to the elevation of the tile we currently stand on so cows
        // don't float when crossing terrain.
        const cur = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
        if (grid.inBounds(cur.i, cur.j)) pos.y = grid.getElevation(cur.i, cur.j);
      }
    },
  };
}

/** @returns {import('../ecs/schedule.js').SystemDef} */
export function makeHungerSystem() {
  return {
    name: 'hungerDrain',
    tier: 'rare',
    run(world) {
      const drain = HUNGER_DRAIN_PER_TICK * 8;
      for (const { components } of world.query(['Hunger'])) {
        const h = components.Hunger;
        h.value = Math.max(0, h.value - drain);
      }
    },
  };
}
