/**
 * Cow brain + path-follow + hunger systems.
 *
 * Brain (every tick): if hungry and idle, self-assign an Eat job. Otherwise try
 * to claim a chop/haul job off the board; else synthesize a Wander goal.
 *
 * PathFollow (every tick): for any cow with a Path, point Velocity toward the
 * world position of the next path step. When close enough, advance the index.
 * When the path is exhausted, zero velocity (the brain's job-state will notice).
 *
 * Hunger (rare tier): drain Hunger.value at a rate of 1 / (one-day-in-ticks).
 * When it drops below HUNGER_EAT_THRESHOLD the brain interrupts wander/idle
 * with an Eat job that walks to the nearest food stack and consumes one unit.
 */

import { buildTicksForKind, findBuildStandTile } from '../jobs/build.js';
import { CHOP_TICKS, findAdjacentWalkable } from '../jobs/chop.js';
import { CUT_TICKS } from '../jobs/cut.js';
import { DECONSTRUCT_TICKS, findDeconstructStandTile } from '../jobs/deconstruct.js';
import { HARVEST_TICKS } from '../jobs/harvest.js';
import { DROP_TICKS, PICKUP_TICKS } from '../jobs/haul.js';
import { MINE_TICKS } from '../jobs/mine.js';
import { PLANT_TICKS } from '../jobs/plant.js';
import { HUNGER_CRITICAL_THRESHOLD, HUNGER_PREEMPT_TIER, tierFor } from '../jobs/tiers.js';
import { TILL_TICKS } from '../jobs/till.js';
import { WANDER_IDLE_TICKS, pickRandomWalkable } from '../jobs/wander.js';
import { BOULDER_LOOT } from '../world/boulders.js';
import { TILE_SIZE, tileToWorld, worldToTileClamp } from '../world/coords.js';
import { cropIsReady, cropKindFor } from '../world/crops.js';
import { FACING_OFFSETS } from '../world/facing.js';
import { FOOD_NUTRITION, HUNGER_EAT_THRESHOLD, addItemToTile } from '../world/items.js';
import { woodYieldFor } from '../world/trees.js';
import { DARKNESS_SLOWDOWN_THRESHOLD } from './lighting.js';

export const COW_SPEED_UNITS_PER_SEC = 85.7; // ≈2 tiles/sec at 1.5m tile
const ARRIVE_DIST_SQ = 4 * 4; // within 4 units of a step center counts as arrived
const HUNGER_DRAIN_PER_TICK = 1 / 43200; // empties over one in-game day
const EAT_TICKS = 18;

// Staggered brain evaluation: when the board changes, we don't want every
// cow to re-scan it the same tick. Each cow is bucketed by id and only runs
// the (expensive) decide block on its own bucket's tick phase. Urgent
// signals — a job just ended, or hunger crossed a threshold — bypass the
// stagger, so starving or idle cows still react immediately. At 30Hz the
// worst-case latency from a board post to a cow noticing is ~133ms, which
// is invisible to the player.
const BRAIN_STAGGER_BUCKETS = 4;

// Soft cow-cow avoidance: cows nudge sideways when another cow is ~ahead of
// them, and slow to 70% speed if they can't steer around it. Tuned in tile-
// world units (1 tile = 43u).
const COW_SENSE_RADIUS_SQ = 32 * 32; // notice neighbors within ~0.75 tile
const COW_PERSONAL_SPACE_SQ = 20 * 20; // head-on crowding → slow down
const AVOID_STRENGTH = 0.45; // lateral nudge weight before re-normalizing
const SLOW_FACTOR = 0.7; // "excuse me, fellow cow" speed when blocked
// Light grid is uint8 (0-255); cache the byte form of the shared threshold.
const DARK_LIGHT_BYTE = Math.round(DARKNESS_SLOWDOWN_THRESHOLD * 255);

// Spatial bucketing for the avoidance scan. Cell is the sense radius so every
// cow that could possibly affect another lives in self + 8 surrounding cells.
// Integer key encoding (ix+OFFSET)*STRIDE + (iz+OFFSET) keeps Map lookups
// hashing cheap numbers instead of strings; STRIDE=1024 supports signed tile
// offsets far larger than any sane grid.
const NEIGHBOR_CELL_SIZE = 32; // == sqrt(COW_SENSE_RADIUS_SQ)
const NEIGHBOR_CELL_OFFSET = 512;
const NEIGHBOR_CELL_STRIDE = 1024;

/**
 * @typedef PathDeps
 * @property {import('../world/tileGrid.js').TileGrid} grid
 * @property {import('../sim/pathfinding.js').PathCache} paths
 * @property {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @property {(() => number | null)=} drivingCowId
 *   Optional hook: returns the id of a cow currently driven by the FP camera
 *   (drafted + viewed). cowFollowPath skips that cow so it doesn't fight
 *   player input by steering toward the nearest path step.
 * @property {((pos: {x:number,y:number,z:number}) => void)=} onCowStep
 *   Optional hook: fired when a cow crosses into the next path tile. Used for
 *   positional footfall audio. Called with the cow's world position.
 *
 * @typedef {PathDeps & {
 *   board: import('../jobs/board.js').JobBoard,
 *   onChopComplete: (pos: {x:number,y:number,z:number}) => void,
 *   onMineComplete: (pos: {x:number,y:number,z:number}) => void,
 *   onCowEat: (pos: {x:number,y:number,z:number}) => void,
 *   onCowHammer: (pos: {x:number,y:number,z:number}) => void,
 *   onBuildComplete: (pos: {x:number,y:number,z:number}, kind: string) => void,
 *   onTillComplete: (pos: {x:number,y:number,z:number}) => void,
 *   onPlantComplete: (pos: {x:number,y:number,z:number}) => void,
 *   onHarvestComplete: (pos: {x:number,y:number,z:number}) => void,
 *   onItemChange: () => void,
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
      // Goes through board.release() so version bumps and other idle cows
      // get a chance to pick up the freshly-freed job.
      for (const j of board.jobs) {
        if (j.claimedBy === null || j.completed) continue;
        const cowJob = world.get(j.claimedBy, 'Job');
        if (!cowJob || cowJob.kind !== j.kind || cowJob.payload.jobId !== j.id) {
          board.release(j.id);
        }
      }
      // Food existence is a world-level signal; scan once per tick instead of
      // once per hungry cow so a foodless colony doesn't pay O(items × cows).
      const anyFood = hasAnyFood(world);
      for (const { id, components } of world.query([
        'Cow',
        'Position',
        'Job',
        'Path',
        'Inventory',
        'Hunger',
        'Brain',
      ])) {
        const cow = components.Cow;
        const job = components.Job;
        const path = components.Path;
        const pos = components.Position;
        const inv = components.Inventory;
        const hunger = components.Hunger;
        const brain = components.Brain;

        // Drafted cows opt out of all autonomous behavior — they just wait
        // for explicit player orders (RMB 'move' job, or FP direct drive).
        // Release any work they'd claimed and drop whatever they carry so it
        // re-enters the haul pool.
        if (cow.drafted) {
          if (
            job.kind === 'chop' ||
            job.kind === 'cut' ||
            job.kind === 'mine' ||
            job.kind === 'haul' ||
            job.kind === 'deliver' ||
            job.kind === 'supply' ||
            job.kind === 'eat' ||
            job.kind === 'build' ||
            job.kind === 'deconstruct' ||
            job.kind === 'till' ||
            job.kind === 'plant' ||
            job.kind === 'harvest'
          ) {
            if (job.payload?.jobId != null) board.release(job.payload.jobId);
            job.kind = 'none';
            job.state = 'idle';
            job.payload = {};
            path.steps = [];
            path.index = 0;
          }
          if (inv.itemKind !== null) {
            dropCarriedItem(world, grid, inv, pos);
            deps.onItemChange();
          }
          // 'move' jobs stay — drafted cows still follow paths the player
          // gave them. Anything else gets clamped to idle.
          if (job.kind !== 'move' && job.kind !== 'none') {
            job.kind = 'none';
            job.state = 'idle';
            job.payload = {};
          }
          if (job.kind === 'move') {
            const waypoints = /** @type {{i:number,j:number}[]} */ (job.payload.waypoints ?? []);
            const legEnds = /** @type {number[]} */ (job.payload.legEnds ?? []);
            while (legEnds.length > 0 && path.index >= legEnds[0]) {
              waypoints.shift();
              legEnds.shift();
            }
            if (path.index >= path.steps.length) {
              job.kind = 'none';
              job.state = 'idle';
              job.payload = {};
            }
          }
          continue;
        }

        // Dropped out of haul unexpectedly while carrying? Drop the item on
        // the ground where we stand so it re-enters the haul pool.
        if (
          inv.itemKind !== null &&
          job.kind !== 'haul' &&
          job.kind !== 'deliver' &&
          job.kind !== 'supply'
        ) {
          dropCarriedItem(world, grid, inv, pos);
          deps.onItemChange();
        }

        // Critical hunger preempts any non-urgent work. A cow hauling logs
        // when it's starving drops what it's carrying and bails to eat; the
        // next tick's decide block will self-assign an eat job. Jobs below
        // HUNGER_PREEMPT_TIER (eat itself) are already urgent enough to let
        // run to completion. Skip the preempt entirely when the colony has no
        // food — otherwise the cow oscillates between "drop work" and "no food
        // to plan for, re-claim work" every tick and never makes progress.
        if (
          hunger.value < HUNGER_CRITICAL_THRESHOLD &&
          tierFor(job.kind) >= HUNGER_PREEMPT_TIER &&
          anyFood
        ) {
          if (job.payload?.jobId != null) board.release(job.payload.jobId);
          if (inv.itemKind !== null) {
            dropCarriedItem(world, grid, inv, pos);
            deps.onItemChange();
          }
          job.kind = 'none';
          job.state = 'idle';
          job.payload = {};
          path.steps = [];
          path.index = 0;
          brain.jobDirty = true;
          brain.vitalsDirty = true;
        }

        // Dirty gate + staggered eval: skip the expensive decide block unless
        // something changed this cow's plan — job finished, hunger dropped,
        // or the board shifted AND this cow's bucket matches the current tick
        // phase. Urgent signals (jobDirty/vitalsDirty) bypass the stagger so
        // a starving cow doesn't wait up to BRAIN_STAGGER_BUCKETS ticks to
        // re-plan.
        const boardChanged = brain.lastBoardVersion !== board.version;
        const myTurn = ctx.tick % BRAIN_STAGGER_BUCKETS === id % BRAIN_STAGGER_BUCKETS;
        const needsDecide = brain.jobDirty || brain.vitalsDirty || (boardChanged && myTurn);

        if (needsDecide) {
          if (job.kind === 'wander' || job.kind === 'none') {
            // Hungry + idle? Self-assign an eat job so the cow walks to the
            // nearest food stack instead of wandering while starving.
            if (hunger.value < HUNGER_EAT_THRESHOLD) {
              const near = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
              const food = findNearestFood(world, near);
              if (food) {
                job.kind = 'eat';
                job.state = 'pathing-to-food';
                job.payload = { itemId: food.id, i: food.i, j: food.j };
                path.steps = [];
                path.index = 0;
              }
            }

            // Preempt a wander when work appears — without this a cow that
            // already rolled into wander never re-checks the board and would
            // ignore freshly designated trees / dropped items.
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
              } else if (candidate && candidate.kind === 'mine' && board.claim(candidate.id, id)) {
                job.kind = 'mine';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  boulderId: candidate.payload.boulderId,
                  i: candidate.payload.i,
                  j: candidate.payload.j,
                };
                path.steps = [];
                path.index = 0;
              } else if (candidate && candidate.kind === 'cut' && board.claim(candidate.id, id)) {
                job.kind = 'cut';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  entityId: candidate.payload.entityId,
                  i: candidate.payload.i,
                  j: candidate.payload.j,
                };
                path.steps = [];
                path.index = 0;
              } else if (
                candidate &&
                (candidate.kind === 'haul' ||
                  candidate.kind === 'deliver' ||
                  candidate.kind === 'supply') &&
                board.claim(candidate.id, id)
              ) {
                job.kind = candidate.kind;
                job.state = 'pathing-to-item';
                job.payload = {
                  jobId: candidate.id,
                  itemId: candidate.payload.itemId,
                  fromI: candidate.payload.fromI,
                  fromJ: candidate.payload.fromJ,
                  toI: candidate.payload.toI,
                  toJ: candidate.payload.toJ,
                  toBuildSite: candidate.payload.toBuildSite === true,
                  toRelocation: candidate.payload.toRelocation === true,
                  toSupply: candidate.payload.toSupply === true,
                  furnaceId: candidate.payload.furnaceId,
                };
                path.steps = [];
                path.index = 0;
              } else if (candidate && candidate.kind === 'build' && board.claim(candidate.id, id)) {
                job.kind = 'build';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  siteId: candidate.payload.siteId,
                  i: candidate.payload.i,
                  j: candidate.payload.j,
                };
                path.steps = [];
                path.index = 0;
              } else if (
                candidate &&
                candidate.kind === 'deconstruct' &&
                board.claim(candidate.id, id)
              ) {
                job.kind = 'deconstruct';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  entityId: candidate.payload.entityId,
                  kind: candidate.payload.kind,
                  i: candidate.payload.i,
                  j: candidate.payload.j,
                };
                path.steps = [];
                path.index = 0;
              } else if (candidate && candidate.kind === 'till' && board.claim(candidate.id, id)) {
                job.kind = 'till';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  i: candidate.payload.i,
                  j: candidate.payload.j,
                };
                path.steps = [];
                path.index = 0;
              } else if (candidate && candidate.kind === 'plant' && board.claim(candidate.id, id)) {
                job.kind = 'plant';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  i: candidate.payload.i,
                  j: candidate.payload.j,
                };
                path.steps = [];
                path.index = 0;
              } else if (
                candidate &&
                candidate.kind === 'harvest' &&
                board.claim(candidate.id, id)
              ) {
                job.kind = 'harvest';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  cropId: candidate.payload.cropId,
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
          }

          brain.jobDirty = false;
          brain.vitalsDirty = false;
          brain.lastBoardVersion = board.version;
        }

        if (job.kind === 'chop') {
          runChopJob(world, job, path, pos, grid, paths, walkable, board, ctx, deps);
        } else if (job.kind === 'mine') {
          runMineJob(world, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'cut') {
          runCutJob(world, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'build') {
          runBuildJob(world, id, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'deconstruct') {
          runDeconstructJob(world, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'till') {
          runTillJob(job, path, pos, grid, paths, board, deps);
        } else if (job.kind === 'plant') {
          runPlantJob(world, job, path, pos, grid, paths, board, deps);
        } else if (job.kind === 'harvest') {
          runHarvestJob(world, job, path, pos, grid, paths, board, deps);
        } else if (job.kind === 'haul' || job.kind === 'deliver' || job.kind === 'supply') {
          runHaulJob(world, job, path, pos, inv, grid, paths, board, deps);
        } else if (job.kind === 'eat') {
          runEatJob(world, job, path, pos, hunger, grid, paths, deps);
        } else if (job.kind === 'move') {
          // Player-issued move. Pop any waypoint boundary we've passed so the
          // selection viz stops drawing markers for already-reached steps.
          const waypoints = /** @type {{i:number,j:number}[]} */ (job.payload.waypoints ?? []);
          const legEnds = /** @type {number[]} */ (job.payload.legEnds ?? []);
          while (legEnds.length > 0 && path.index >= legEnds[0]) {
            waypoints.shift();
            legEnds.shift();
          }
          // When the full chained path is consumed, revert so wander resumes.
          if (path.index >= path.steps.length) {
            job.kind = 'none';
            job.state = 'idle';
            job.payload = {};
          }
        } else if (job.kind === 'wander') {
          if (job.state === 'planning') {
            const { i: si, j: sj } = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
            const goal = pickRandomWalkable(grid, walkable, { i: si, j: sj });
            if (!goal) {
              job.state = 'idle';
              job.payload = { untilTick: ctx.tick + WANDER_IDLE_TICKS };
            } else {
              // Wander goals are randomized — caching them just churns the LRU.
              const route = paths.find({ i: si, j: sj }, goal, { cache: false });
              if (!route || route.length === 0) {
                job.state = 'idle';
                job.payload = { untilTick: ctx.tick + WANDER_IDLE_TICKS };
              } else {
                path.steps = route;
                path.index = 0;
                job.state = 'moving';
                job.payload = { goal };
              }
            }
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

        // Any cow ending its tick in 'none' re-decides next tick. Covers both
        // completions (kindBefore was e.g. 'chop') and the otherwise-silent
        // case where the cow entered the tick already idle but the staggered
        // decide gate closed — without this the cow could wait up to
        // BRAIN_STAGGER_BUCKETS ticks for `boardChanged && myTurn` to align.
        if (job.kind === 'none') {
          brain.jobDirty = true;
        }
      }
    },
  };
}

/**
 * State machine for the chop job. Broken out so the brain loop stays readable.
 *
 * @param {import('../ecs/world.js').World} world
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
function runChopJob(world, job, path, pos, grid, paths, walkable, board, ctx, deps) {
  const { treeId, jobId } = /** @type {{ treeId: number, jobId: number }} */ (job.payload);

  // Tree went away, OR the board job was cancelled (player unmarked the tree
  // mid-chop) / completed externally → bail so we don't fell an unmarked tree.
  const boardJob = board.get(jobId);
  if (!world.get(treeId, 'Tree') || !boardJob || boardJob.completed) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    const tree = world.get(treeId, 'Tree');
    if (tree) tree.progress = 0;
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
      deps.onChopComplete(pos);
      finishChop(world, grid, treeId, jobId, board);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Mine job state machine. Mirrors runChopJob but keyed on Boulder.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runMineJob(world, job, path, pos, grid, paths, walkable, board, deps) {
  const { boulderId, jobId } = /** @type {{ boulderId: number, jobId: number }} */ (job.payload);
  const boardJob = board.get(jobId);
  if (!world.get(boulderId, 'Boulder') || !boardJob || boardJob.completed) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    const boulder = world.get(boulderId, 'Boulder');
    if (boulder) boulder.progress = 0;
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
      job.state = 'mining';
      job.payload.ticksRemaining = MINE_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'mining') {
    const remaining = (job.payload.ticksRemaining ?? MINE_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    const boulder = world.get(boulderId, 'Boulder');
    if (boulder) boulder.progress = 1 - remaining / MINE_TICKS;
    if (remaining > 0 && remaining % 18 === 0) deps.onCowHammer(pos);
    if (remaining <= 0) {
      deps.onMineComplete(pos);
      finishMine(world, grid, boulderId, jobId, board);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} boulderId
 * @param {number} jobId
 * @param {import('../jobs/board.js').JobBoard} board
 */
function finishMine(world, grid, boulderId, jobId, board) {
  const anchor = world.get(boulderId, 'TileAnchor');
  const boulder = world.get(boulderId, 'Boulder');
  if (anchor) {
    grid.unblockTile(anchor.i, anchor.j);
    const loot = boulder ? BOULDER_LOOT[boulder.kind] : null;
    if (loot) {
      for (let k = 0; k < loot.yield; k++)
        addItemToTile(world, grid, loot.item, anchor.i, anchor.j);
    }
  }
  world.despawn(boulderId);
  board.complete(jobId);
}

/**
 * Cut job state machine. Like chop/mine but target is any Cuttable entity
 * (Tree, Crop, or future wild foliage). Yield on finish depends on the
 * target's kind component — see finishCut.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runCutJob(world, job, path, pos, grid, paths, walkable, board, deps) {
  const { entityId, jobId } = /** @type {{ entityId: number, jobId: number }} */ (job.payload);
  const boardJob = board.get(jobId);
  if (!world.get(entityId, 'Cuttable') || !boardJob || boardJob.completed) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    const cut = world.get(entityId, 'Cuttable');
    if (cut) cut.progress = 0;
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
      job.state = 'cutting';
      job.payload.ticksRemaining = CUT_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'cutting') {
    const remaining = (job.payload.ticksRemaining ?? CUT_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    const cut = world.get(entityId, 'Cuttable');
    if (cut) cut.progress = 1 - remaining / CUT_TICKS;
    if (remaining > 0 && remaining % 18 === 0) deps.onCowHammer(pos);
    if (remaining <= 0) {
      finishCut(world, grid, entityId, jobId, board, pos, deps);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Despawn the cuttable and drop its current-state yield.
 *
 *   Tree  → woodYieldFor(kind, growth). Sapling yields 0, mature yields full.
 *   Crop  → 1 food if ready, else 0. Harvest is also 1 food, so cutting a
 *           ripe crop is mechanically equivalent to harvesting it.
 *   other → nothing (future wild foliage can wire in per-kind yield here).
 *
 * Tree tiles are grid-blocked (see spawnTree); crop tiles are not (see farm
 * system). Only unblock if the target actually blocked its tile, so we don't
 * double-unblock in the crop case.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} entityId
 * @param {number} jobId
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ x: number, y: number, z: number }} pos
 * @param {BrainDeps} deps
 */
function finishCut(world, grid, entityId, jobId, board, pos, deps) {
  const anchor = world.get(entityId, 'TileAnchor');
  const tree = world.get(entityId, 'Tree');
  const crop = world.get(entityId, 'Crop');
  let yieldedAnything = false;
  if (anchor) {
    if (tree) {
      grid.unblockTile(anchor.i, anchor.j);
      const n = woodYieldFor(tree.kind, tree.growth);
      for (let k = 0; k < n; k++) addItemToTile(world, grid, 'wood', anchor.i, anchor.j);
      if (n > 0) yieldedAnything = true;
      deps.onChopComplete(pos);
    } else if (crop) {
      if (cropIsReady(crop.kind, crop.growthTicks)) {
        addItemToTile(world, grid, 'food', anchor.i, anchor.j);
        yieldedAnything = true;
      }
      deps.onHarvestComplete(pos);
    }
  }
  if (yieldedAnything) deps.onItemChange();
  world.despawn(entityId);
  board.complete(jobId);
}

/**
 * State machine for the build job. Mirrors runChopJob: walk adjacent to the
 * build site, hammer for buildTicksForKind(kind), then convert the BuildSite
 * into the finished structure.
 *
 * Once the timer expires, we hold at the last tick (progress ≈ 99%) until
 * any non-builder cows have left the destination tile — otherwise the wall
 * would seal them in. The builder hammers in place during the stall.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} builderId
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runBuildJob(world, builderId, job, path, pos, grid, paths, walkable, board, deps) {
  const { siteId, jobId } = /** @type {{ siteId: number, jobId: number }} */ (job.payload);

  // Site despawned (player cancelled the blueprint) OR the board job was
  // completed externally → bail cleanly.
  const site = world.get(siteId, 'BuildSite');
  const boardJob = board.get(jobId);
  if (!site || !boardJob || boardJob.completed) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    if (site) site.progress = 0;
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const blueprintTiles = collectBlueprintTiles(world, grid, siteId);
    const adj = findBuildStandTile(grid, walkable, job.payload.i, job.payload.j, blueprintTiles);
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

  const totalTicks = buildTicksForKind(site.kind);

  if (job.state === 'walking') {
    if (path.index >= path.steps.length) {
      job.state = 'building';
      job.payload.ticksRemaining = totalTicks;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'building') {
    const remaining = (job.payload.ticksRemaining ?? totalTicks) - 1;
    job.payload.ticksRemaining = remaining;
    site.progress = 1 - remaining / totalTicks;
    // Hammer audio lands every ~18 ticks so a 4-second build gives ~6 strikes
    // — rhythmic without drowning out other cows' work. Roofs build in 30
    // ticks total so one strike at mid-build reads fine.
    if (remaining > 0 && remaining % 18 === 0) deps.onCowHammer(pos);
    if (remaining <= 0) {
      // Hold at 99% if any cow is currently standing on the build tile —
      // closing the wall on top of them would seal them in. The builder
      // themselves stand at an adjacent tile, so they don't trigger this.
      // Roofs + floors don't block pathing so they skip this stall — cows
      // happily stand on finished flooring.
      const anchor = world.get(siteId, 'TileAnchor');
      if (
        site.kind !== 'roof' &&
        site.kind !== 'floor' &&
        anchor &&
        cowOnTileExcluding(world, grid, anchor.i, anchor.j, builderId)
      ) {
        // One tick of pad keeps progress visually pegged at 99% and the audio
        // tap firing at the same cadence; we re-check next tick.
        job.payload.ticksRemaining = 1;
        site.progress = 1 - 1 / totalTicks;
        return;
      }
      deps.onBuildComplete(pos, site.kind);
      finishBuild(world, grid, siteId, jobId, board, walkable);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * True if any cow other than `excludeId` currently occupies tile (i, j).
 * Used by the builder to stall completion until the destination is clear so
 * we never finish a wall on top of a cow. Coord math is inlined — calling
 * `worldToTileClamp` per cow would allocate an object each iteration.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 * @param {number} excludeId
 */
function cowOnTileExcluding(world, grid, i, j, excludeId) {
  const W = grid.W;
  const H = grid.H;
  const halfW = W / 2;
  const halfH = H / 2;
  for (const { id, components } of world.query(['Cow', 'Position'])) {
    if (id === excludeId) continue;
    const pos = components.Position;
    let ti = Math.floor(pos.x / TILE_SIZE + halfW);
    let tj = Math.floor(pos.z / TILE_SIZE + halfH);
    if (ti < 0) ti = 0;
    else if (ti >= W) ti = W - 1;
    if (tj < 0) tj = 0;
    else if (tj >= H) tj = H - 1;
    if (ti === i && tj === j) return true;
  }
  return false;
}

/**
 * Convert a BuildSite entity into its finished form (Wall / Door / Torch /
 * Furnace based on `site.kind`), update the matching tile bitmap so pathing +
 * future designations agree, and mark the job complete. Walls flip the `wall`
 * bit (blocking); doors flip the `door` bit only (walkable); torches flip the
 * `torch` bit only (walkable, decorative); furnaces use the generic occupancy
 * bitmap since they aren't tile-bitmap-backed structures.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} siteId
 * @param {number} jobId
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 */
function finishBuild(world, grid, siteId, jobId, board, walkable) {
  const anchor = world.get(siteId, 'TileAnchor');
  const site = world.get(siteId, 'BuildSite');
  if (!anchor || !site) {
    board.complete(jobId);
    return;
  }
  const pos = world.get(siteId, 'Position');
  const position = pos ? { ...pos } : { x: 0, y: 0, z: 0 };
  const stuff = site.stuff ?? 'wood';
  if (site.kind === 'door') {
    grid.setDoor(anchor.i, anchor.j, 1);
    world.spawn({
      Door: { stuff },
      DoorViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'torch') {
    grid.setTorch(anchor.i, anchor.j, 1);
    world.spawn({
      Torch: {},
      TorchViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'wallTorch') {
    grid.setTorch(anchor.i, anchor.j, 1);
    world.spawn({
      Torch: {
        deconstructJobId: 0,
        progress: 0,
        wallMounted: true,
        yaw: yawAwayFromWallAt(grid, anchor.i, anchor.j),
      },
      TorchViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'roof') {
    grid.setRoof(anchor.i, anchor.j, 1);
    world.spawn({
      Roof: { stuff },
      RoofViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'floor') {
    grid.setFloor(anchor.i, anchor.j, 1);
    world.spawn({
      Floor: { stuff },
      FloorViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'furnace') {
    // Pick work-spot BEFORE blocking the tile — findAdjacentWalkable checks
    // neighbors, and we want to accept adjacent tiles even if the furnace's
    // own tile is about to become blocked. Prefer the tile in front of the
    // chosen facing; fall back to any walkable cardinal neighbor, then to the
    // furnace tile itself.
    const facing = site.facing | 0;
    const off = FACING_OFFSETS[facing] ?? FACING_OFFSETS[0];
    const fi = anchor.i + off.di;
    const fj = anchor.j + off.dj;
    const facingSpot = grid.inBounds(fi, fj) && walkable(grid, fi, fj) ? { i: fi, j: fj } : null;
    const workSpot = facingSpot ??
      findAdjacentWalkable(grid, walkable, anchor.i, anchor.j) ?? {
        i: anchor.i,
        j: anchor.j,
      };
    grid.blockTile(anchor.i, anchor.j);
    world.spawn({
      Furnace: { stuff, workI: workSpot.i, workJ: workSpot.j, facing },
      FurnaceViz: {},
      Bills: { list: [], nextBillId: 1 },
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else {
    grid.setWall(anchor.i, anchor.j, 1);
    world.spawn({
      Wall: { stuff },
      WallViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  }
  world.despawn(siteId);
  board.complete(jobId);
}

/**
 * Yaw (radians, Y-axis) a wall torch at (i,j) should face so its flame points
 * away from the wall it's mounted to. Inlined here so the build-finish path
 * stays in the systems layer (no reverse import from render/).
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
function yawAwayFromWallAt(grid, i, j) {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [di, dj] of dirs) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj)) continue;
    if (!grid.isWall(ni, nj) && !grid.isDoor(ni, nj)) continue;
    return Math.atan2(-di, -dj);
  }
  return 0;
}

/** Component name for each deconstructable kind. Lower-case kind → component tag. */
const DECON_COMP_BY_KIND = /** @type {const} */ ({
  wall: 'Wall',
  door: 'Door',
  torch: 'Torch',
  roof: 'Roof',
  floor: 'Floor',
  furnace: 'Furnace',
});

/**
 * State machine for the deconstruct job. Mirrors runBuildJob's walk → hammer
 * loop, but on completion the entity + tile bit get cleared and half the
 * building's original material cost drops back as a loose stack.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runDeconstructJob(world, job, path, pos, grid, paths, walkable, board, deps) {
  const { entityId, kind, jobId } =
    /** @type {{ entityId: number, kind: string, jobId: number }} */ (job.payload);
  const compName = /** @type {'Wall'|'Door'|'Torch'|'Roof'|'Floor'|'Furnace'} */ (
    DECON_COMP_BY_KIND[/** @type {'wall'|'door'|'torch'|'roof'|'floor'|'furnace'} */ (kind)] ??
      'Wall'
  );
  const tag = world.get(entityId, compName);
  const boardJob = board.get(jobId);
  // Entity gone (already deconstructed / cancelled) OR board job marked done →
  // bail cleanly, same as build/chop does.
  if (!tag || !boardJob || boardJob.completed) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    if (tag) tag.progress = 0;
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const adj = findDeconstructStandTile(grid, walkable, kind, job.payload.i, job.payload.j);
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
      job.state = 'demolishing';
      job.payload.ticksRemaining = DECONSTRUCT_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'demolishing') {
    const remaining = (job.payload.ticksRemaining ?? DECONSTRUCT_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    tag.progress = 1 - remaining / DECONSTRUCT_TICKS;
    if (remaining > 0 && remaining % 18 === 0) deps.onCowHammer(pos);
    if (remaining <= 0) {
      deps.onBuildComplete(pos, kind);
      finishDeconstruct(world, grid, entityId, kind, jobId, board);
      deps.onItemChange();
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Clear the grid bit for this kind, despawn the structure entity, and drop
 * half the building's material cost (rounded, min 0) as a loose stack on the
 * tile. Every kind currently costs 1 wood (see BuildDesignator#designateTile),
 * so a 50% return yields 1 wood back via Math.round(0.5) = 1.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} entityId
 * @param {string} kind
 * @param {number} jobId
 * @param {import('../jobs/board.js').JobBoard} board
 */
function finishDeconstruct(world, grid, entityId, kind, jobId, board) {
  const anchor = world.get(entityId, 'TileAnchor');
  if (!anchor) {
    board.complete(jobId);
    return;
  }
  if (kind === 'wall') grid.setWall(anchor.i, anchor.j, 0);
  else if (kind === 'door') grid.setDoor(anchor.i, anchor.j, 0);
  else if (kind === 'torch') grid.setTorch(anchor.i, anchor.j, 0);
  else if (kind === 'roof') grid.setRoof(anchor.i, anchor.j, 0);
  else if (kind === 'floor') grid.setFloor(anchor.i, anchor.j, 0);
  else if (kind === 'furnace') grid.unblockTile(anchor.i, anchor.j);
  // Wall/door/torch cost 1 wood → 50% refund = 1. Roofs are free so they
  // refund nothing. Furnaces cost 15 stone → refund 7. When buildings diverge
  // further, the original `required`/`requiredKind` should live on the
  // finished-structure entity (mirroring how BuildSite tracks them).
  if (kind === 'furnace') {
    for (let k = 0; k < 7; k++) addItemToTile(world, grid, 'stone', anchor.i, anchor.j);
  } else {
    const returned = kind === 'roof' ? 0 : Math.round(1 * 0.5);
    for (let k = 0; k < returned; k++) addItemToTile(world, grid, 'wood', anchor.i, anchor.j);
  }
  world.despawn(entityId);
  board.complete(jobId);
}

/**
 * State machine for the till job: walk onto the farm tile, break ground for
 * TILL_TICKS, flip the grid's tilled bit. Bails if the tile stops being a
 * farm zone or another cow tilled it first.
 *
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runTillJob(job, path, pos, grid, paths, board, deps) {
  const { i, j, jobId } = /** @type {{ i: number, j: number, jobId: number }} */ (job.payload);

  const boardJob = board.get(jobId);
  // Zone cleared, tile already tilled, or board job cancelled/completed → bail.
  if (!boardJob || boardJob.completed || grid.getFarmZone(i, j) === 0 || grid.isTilled(i, j)) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const route = paths.find(start, { i, j });
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
      job.state = 'tilling';
      job.payload.ticksRemaining = TILL_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'tilling') {
    const remaining = (job.payload.ticksRemaining ?? TILL_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    if (remaining <= 0) {
      grid.setTilled(i, j, 1);
      deps.onTillComplete(pos);
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * State machine for the plant job: walk onto a tilled + zoned tile, poke a
 * seed in for PLANT_TICKS, spawn a Crop entity. Bails if the tile loses its
 * zone, loses its tilled bit, or a crop already exists there (another cow
 * beat us to it).
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runPlantJob(world, job, path, pos, grid, paths, board, deps) {
  const { i, j, jobId } = /** @type {{ i: number, j: number, jobId: number }} */ (job.payload);

  const boardJob = board.get(jobId);
  const zoneId = grid.getFarmZone(i, j);
  const kind = cropKindFor(zoneId);
  const tileBusy = tileHasCrop(world, i, j);
  if (
    !boardJob ||
    boardJob.completed ||
    zoneId === 0 ||
    kind === null ||
    !grid.isTilled(i, j) ||
    tileBusy
  ) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const route = paths.find(start, { i, j });
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
      job.state = 'planting';
      job.payload.ticksRemaining = PLANT_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'planting') {
    const remaining = (job.payload.ticksRemaining ?? PLANT_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    if (remaining <= 0) {
      const w = tileToWorld(i, j, grid.W, grid.H);
      world.spawn({
        Crop: { kind, growthTicks: 0 },
        CropViz: {},
        Cuttable: { markedJobId: 0, progress: 0 },
        TileAnchor: { i, j },
        Position: { x: w.x, y: grid.getElevation(i, j), z: w.z },
      });
      deps.onPlantComplete(pos);
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * State machine for the harvest job: walk onto a ready crop, pull it up for
 * HARVEST_TICKS, drop a food item on the tile, despawn the crop. Tilled bit
 * stays set so the next farm-poster tick re-posts a plant job → auto-replant.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runHarvestJob(world, job, path, pos, grid, paths, board, deps) {
  const { i, j, jobId, cropId } =
    /** @type {{ i: number, j: number, jobId: number, cropId: number }} */ (job.payload);

  const boardJob = board.get(jobId);
  const crop = world.get(cropId, 'Crop');
  const anchor = world.get(cropId, 'TileAnchor');
  if (!boardJob || boardJob.completed || !crop || !anchor || anchor.i !== i || anchor.j !== j) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const route = paths.find(start, { i, j });
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
      job.state = 'harvesting';
      job.payload.ticksRemaining = HARVEST_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'harvesting') {
    const remaining = (job.payload.ticksRemaining ?? HARVEST_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    if (remaining <= 0) {
      world.despawn(cropId);
      addItemToTile(world, grid, 'food', i, j);
      deps.onHarvestComplete(pos);
      deps.onItemChange();
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {number} i
 * @param {number} j
 */
function tileHasCrop(world, i, j) {
  for (const { components } of world.query(['Crop', 'TileAnchor'])) {
    const a = components.TileAnchor;
    if (a.i === i && a.j === j) return true;
  }
  return false;
}

/**
 * State machine for the haul job: walk to the item → pick up → walk to drop
 * tile → drop. Any step that can no longer be satisfied bails gracefully,
 * returning the cow to `none` so the brain can repick.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {{ itemKind: string | null }} inv
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runHaulJob(world, job, path, pos, inv, grid, paths, board, deps) {
  const { jobId, itemId, toI, toJ, toBuildSite, toRelocation, toSupply, furnaceId } =
    /** @type {{ jobId: number, itemId: number, toI: number, toJ: number, toBuildSite?: boolean, toRelocation?: boolean, toSupply?: boolean, furnaceId?: number }} */ (
      job.payload
    );

  // Target tile stopped being a valid drop (stockpile undesignated, or
  // BuildSite cancelled/already built, or furnace gone) → complete + bail.
  // Delivery to a BuildSite uses the site's existence at that tile, not the
  // stockpile bit. Supply uses the furnace's work spot still pointing here.
  // Blueprint-clear relocations have no persistent marker on the tile; if
  // the cow can't get there at drop time the state machine falls back to
  // dropping in place, which is fine.
  const targetGone = toBuildSite
    ? findBuildSiteAt(world, toI, toJ) === null
    : toSupply
      ? !furnaceWorkSpotMatches(world, furnaceId, toI, toJ)
      : !toRelocation && !grid.isStockpile(toI, toJ);
  if (targetGone) {
    if (inv.itemKind !== null) {
      dropCarriedItem(world, grid, inv, pos);
      deps.onItemChange();
    }
    board.complete(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  // Item got forbidden after the cow claimed the haul. Release pre-pickup —
  // post-pickup the carried unit is already off the tile, so let the cow
  // finish dropping it. Blueprint-clear relocations intentionally move
  // forbidden stacks and are exempt.
  if (
    !toRelocation &&
    (job.state === 'pathing-to-item' ||
      job.state === 'walking-to-item' ||
      job.state === 'picking-up')
  ) {
    const srcItem = world.get(itemId, 'Item');
    if (srcItem?.forbidden === true) {
      board.release(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      path.steps = [];
      path.index = 0;
      return;
    }
  }

  if (job.state === 'pathing-to-item') {
    // The source Item must still exist and be somewhere pickup-able.
    const anchor = world.get(itemId, 'TileAnchor');
    const item = world.get(itemId, 'Item');
    if (!anchor || !item) {
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const route = paths.find(start, { i: anchor.i, j: anchor.j });
    if (!route || route.length === 0) {
      board.release(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    path.steps = route;
    path.index = 0;
    job.state = 'walking-to-item';
    return;
  }

  if (job.state === 'walking-to-item') {
    if (path.index >= path.steps.length) {
      job.state = 'picking-up';
      job.payload.ticksRemaining = PICKUP_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'picking-up') {
    const remaining = (job.payload.ticksRemaining ?? PICKUP_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    if (remaining <= 0) {
      const item = world.get(itemId, 'Item');
      if (!item || item.count <= 0) {
        board.complete(jobId);
        job.kind = 'none';
        job.state = 'idle';
        job.payload = {};
        return;
      }
      inv.itemKind = item.kind;
      item.count -= 1;
      if (item.count <= 0) world.despawn(itemId);
      deps.onItemChange();
      job.state = 'pathing-to-drop';
    }
    return;
  }

  if (job.state === 'pathing-to-drop') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const route = paths.find(start, { i: toI, j: toJ });
    if (!route || route.length === 0) {
      // Can't get there; drop where we stand, let the poster re-route later.
      dropCarriedItem(world, grid, inv, pos);
      deps.onItemChange();
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    path.steps = route;
    path.index = 0;
    job.state = 'walking-to-drop';
    return;
  }

  if (job.state === 'walking-to-drop') {
    if (path.index >= path.steps.length) {
      job.state = 'dropping';
      job.payload.ticksRemaining = DROP_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'dropping') {
    const remaining = (job.payload.ticksRemaining ?? DROP_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    if (remaining <= 0) {
      // If another code path already cleared the inventory (e.g. emergency
      // drop), skip spawning a phantom item.
      if (inv.itemKind !== null) {
        if (toBuildSite) {
          // Delivery: consume the carried unit into the BuildSite instead of
          // spawning a loose item stack. If the site vanished under us while
          // we were dropping, fall back to dumping the wood on the tile so it
          // re-enters the haul pool.
          const siteId = findBuildSiteAt(world, toI, toJ);
          const site = siteId !== null ? world.get(siteId, 'BuildSite') : null;
          if (site && site.delivered < site.required) {
            site.delivered += 1;
            inv.itemKind = null;
          } else {
            addItemToTile(world, grid, inv.itemKind, toI, toJ);
            inv.itemKind = null;
          }
        } else if (toSupply) {
          // Drop forbidden so the haul poster doesn't immediately yank the
          // ingredient back to the stockpile before the furnace consumes it.
          addItemToTile(world, grid, inv.itemKind, toI, toJ, { forbidden: true });
          inv.itemKind = null;
        } else {
          addItemToTile(world, grid, inv.itemKind, toI, toJ);
          inv.itemKind = null;
        }
        deps.onItemChange();
      }
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Find the BuildSite entity anchored at (i, j), if any. Returns its entity
 * id or null. O(sites) scan — site count stays small in practice.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} i @param {number} j
 */
function findBuildSiteAt(world, i, j) {
  for (const { id, components } of world.query(['BuildSite', 'TileAnchor'])) {
    if (components.TileAnchor.i === i && components.TileAnchor.j === j) return id;
  }
  return null;
}

/**
 * True when the furnace entity still exists and its work spot is still (i, j).
 * If the furnace was deconstructed mid-haul (or the player rebuilt it elsewhere
 * and reused the id slot — won't happen with monotonically growing ids, but
 * cheap to check), the supply job no longer has a valid drop target.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number | undefined} furnaceId
 * @param {number} i @param {number} j
 */
function furnaceWorkSpotMatches(world, furnaceId, i, j) {
  if (typeof furnaceId !== 'number') return false;
  const f = world.get(furnaceId, 'Furnace');
  return f !== undefined && f.workI === i && f.workJ === j;
}

/**
 * Set of tile-indices (`j*W + i`) that currently host a pending BuildSite,
 * except for `excludeSiteId` (the site being built right now — its own tile
 * is the goal, not a stand-tile). Used to steer builders off neighboring
 * blueprints when picking where to stand.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} excludeSiteId
 */
function collectBlueprintTiles(world, grid, excludeSiteId) {
  const tiles = new Set();
  for (const { id, components } of world.query(['BuildSite', 'TileAnchor'])) {
    if (id === excludeSiteId) continue;
    const a = components.TileAnchor;
    tiles.add(a.j * grid.W + a.i);
  }
  return tiles;
}

/**
 * State machine for the self-assigned eat job: walk to food → consume one unit
 * → restore hunger. Bails if the food vanishes mid-trip.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {{ value: number }} hunger
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {BrainDeps} deps
 */
function runEatJob(world, job, path, pos, hunger, grid, paths, deps) {
  const { itemId } = /** @type {{ itemId: number }} */ (job.payload);

  if (job.state === 'pathing-to-food') {
    const item = world.get(itemId, 'Item');
    const anchor = world.get(itemId, 'TileAnchor');
    if (!item || !anchor || item.count <= 0 || item.kind !== 'food') {
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const route = paths.find(start, { i: anchor.i, j: anchor.j });
    if (!route || route.length === 0) {
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    path.steps = route;
    path.index = 0;
    job.state = 'walking-to-food';
    job.payload = { itemId, i: anchor.i, j: anchor.j };
    return;
  }

  if (job.state === 'walking-to-food') {
    if (path.index >= path.steps.length) {
      job.state = 'eating';
      job.payload.ticksRemaining = EAT_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'eating') {
    // Re-check at the start of each eating tick — if the food got hauled away
    // or eaten by someone else, bail immediately instead of burning the full
    // EAT_TICKS countdown with nothing to consume.
    const item = world.get(itemId, 'Item');
    if (!item || item.kind !== 'food' || item.count <= 0) {
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    const remaining = (job.payload.ticksRemaining ?? EAT_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    if (remaining <= 0) {
      item.count -= 1;
      hunger.value = Math.min(1, hunger.value + FOOD_NUTRITION);
      if (item.count <= 0) world.despawn(itemId);
      deps.onItemChange();
      deps.onCowEat(pos);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Nearest food item (Chebyshev) with at least one unit left. Cheap enough at
 * colony scale since there are rarely many food stacks.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ i: number, j: number }} near
 */
function findNearestFood(world, near) {
  let best = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
    if (components.Item.kind !== 'food' || components.Item.count <= 0) continue;
    if (components.Item.forbidden) continue;
    const a = components.TileAnchor;
    const d = Math.max(Math.abs(a.i - near.i), Math.abs(a.j - near.j));
    if (d < bestD) {
      bestD = d;
      best = { id, i: a.i, j: a.j };
    }
  }
  return best;
}

/** @param {import('../ecs/world.js').World} world */
function hasAnyFood(world) {
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const it = components.Item;
    if (it.kind === 'food' && it.count > 0 && !it.forbidden) return true;
  }
  return false;
}

/**
 * Spawn a ground Item at the cow's current tile based on its Inventory and
 * clear the inventory. Caller is responsible for calling deps.onItemChange().
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {{ itemKind: string | null }} inv
 * @param {{ x: number, y: number, z: number }} pos
 */
function dropCarriedItem(world, grid, inv, pos) {
  if (inv.itemKind === null) return;
  const { i, j } = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
  addItemToTile(world, grid, inv.itemKind, i, j);
  inv.itemKind = null;
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
  const tree = world.get(treeId, 'Tree');
  if (anchor) {
    grid.unblockTile(anchor.i, anchor.j);
    const yielded = tree ? woodYieldFor(tree.kind, tree.growth) : 0;
    for (let k = 0; k < yielded; k++) addItemToTile(world, grid, 'wood', anchor.i, anchor.j);
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
      // Snapshot cow positions into a spatial hash so the avoidance scan hits
      // O(N) on average instead of O(N²). Cell size is the sense radius, so
      // only self + 8 neighbor cells ever need to be walked per cow.
      const drivenId = deps.drivingCowId?.() ?? null;
      /** @type {{ id: number, pos: {x:number,y:number,z:number}, vel: {x:number,y:number,z:number}, path: any }[]} */
      const herd = [];
      /** @type {Map<number, typeof herd>} */
      const cells = new Map();
      for (const { id, components } of world.query(['Cow', 'Position', 'Velocity', 'Path'])) {
        const entry = {
          id,
          pos: components.Position,
          vel: components.Velocity,
          path: components.Path,
        };
        herd.push(entry);
        const ix = Math.floor(entry.pos.x / NEIGHBOR_CELL_SIZE) + NEIGHBOR_CELL_OFFSET;
        const iz = Math.floor(entry.pos.z / NEIGHBOR_CELL_SIZE) + NEIGHBOR_CELL_OFFSET;
        const key = ix * NEIGHBOR_CELL_STRIDE + iz;
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = [];
          cells.set(key, bucket);
        }
        bucket.push(entry);
      }

      for (const self of herd) {
        const { id, pos, vel, path } = self;

        // FP camera is driving this cow — it writes Velocity directly each
        // render frame, so skip path-follow so we don't fight it.
        if (id === drivenId) continue;

        if (path.index >= path.steps.length) {
          vel.x = 0;
          vel.z = 0;
          continue;
        }

        // Freshly-built walls invalidate cached paths: the cow's stored steps
        // still include a tile that's now solid. Peek the current + next step
        // and if either is unwalkable, bail the job back to idle so the brain
        // re-plans next tick. Cheaper than re-running A* inline and avoids
        // the "cow butts into new wall" visual.
        const curStep = path.steps[path.index];
        const nextStep = path.steps[path.index + 1];
        const curBlocked = !deps.walkable(grid, curStep.i, curStep.j);
        const nextBlocked = nextStep && !deps.walkable(grid, nextStep.i, nextStep.j);
        if (curBlocked || nextBlocked) {
          const job = world.get(id, 'Job');
          const brain = world.get(id, 'Brain');
          if (job) {
            job.kind = 'none';
            job.state = 'idle';
            job.payload = {};
          }
          if (brain) brain.jobDirty = true;
          path.steps = [];
          path.index = 0;
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
          deps.onCowStep?.(pos);
          // If that was the final step, zero velocity this tick instead of
          // carrying the previous tick's vel one more step past the goal.
          if (path.index >= path.steps.length) {
            vel.x = 0;
            vel.z = 0;
          }
          continue;
        }

        const dist = Math.sqrt(distSq);
        let nx = dx / dist;
        let nz = dz / dist;

        // Soft avoidance: nudge sideways when a neighbor sits roughly ahead of
        // us, slow down when one is crowding our personal space head-on.
        // Only walk neighbor cells in the spatial hash — 3x3 max.
        let nudgeX = 0;
        let nudgeZ = 0;
        let crowded = false;
        const myIx = Math.floor(pos.x / NEIGHBOR_CELL_SIZE) + NEIGHBOR_CELL_OFFSET;
        const myIz = Math.floor(pos.z / NEIGHBOR_CELL_SIZE) + NEIGHBOR_CELL_OFFSET;
        for (let cdx = -1; cdx <= 1; cdx++) {
          for (let cdz = -1; cdz <= 1; cdz++) {
            const bucket = cells.get((myIx + cdx) * NEIGHBOR_CELL_STRIDE + (myIz + cdz));
            if (!bucket) continue;
            for (const other of bucket) {
              if (other === self) continue;
              const ex = other.pos.x - pos.x;
              const ez = other.pos.z - pos.z;
              const d2 = ex * ex + ez * ez;
              if (d2 < 0.001 || d2 > COW_SENSE_RADIUS_SQ) continue;
              const d = Math.sqrt(d2);
              // Only react to neighbors roughly in the direction we're going.
              const fwdDot = (ex * nx + ez * nz) / d;
              if (fwdDot < 0.2) continue;
              const weight = 1 - d / Math.sqrt(COW_SENSE_RADIUS_SQ);
              // Nudge perpendicular to our desired heading, flipping side
              // based on which side the other cow sits so we drift around.
              const cross = nx * ez - nz * ex;
              const side = cross >= 0 ? 1 : -1;
              nudgeX += -nz * side * weight;
              nudgeZ += nx * side * weight;
              if (d2 < COW_PERSONAL_SPACE_SQ && fwdDot > 0.5) crowded = true;
            }
          }
        }

        nx += nudgeX * AVOID_STRENGTH;
        nz += nudgeZ * AVOID_STRENGTH;
        const mag = Math.hypot(nx, nz);
        if (mag > 0.0001) {
          nx /= mag;
          nz /= mag;
        }

        let speed = crowded ? COW_SPEED_UNITS_PER_SEC * SLOW_FACTOR : COW_SPEED_UNITS_PER_SEC;
        // Snap y to the elevation of the tile we currently stand on so cows
        // don't float when crossing terrain.
        const cur = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
        if (grid.inBounds(cur.i, cur.j)) {
          pos.y = grid.getElevation(cur.i, cur.j);
          // Finished floor tiles are full speed; bare terrain drags to 85%.
          // Applied before the darkness check so both stack multiplicatively.
          if (!grid.isFloor(cur.i, cur.j)) speed *= 0.85;
          // Half speed on dim tiles (<40% light) — cows stumble in the dark.
          if (grid.getLight(cur.i, cur.j) < DARK_LIGHT_BYTE) speed *= 0.5;
        }
        vel.x = nx * speed;
        vel.z = nz * speed;
        vel.y = 0;
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
      for (const { components } of world.query(['Hunger', 'Brain'])) {
        const h = components.Hunger;
        const before = h.value;
        h.value = Math.max(0, before - drain);
        // Wake the brain when the cow is (or just became) hungry enough to
        // want food. The gate in cowBrain stays closed otherwise.
        if (h.value < HUNGER_EAT_THRESHOLD) {
          components.Brain.vitalsDirty = true;
        }
      }
    },
  };
}

/**
 * Post-velocity collision against finished walls.
 *
 * AI cows already path around walls (the A* `defaultWalkable` gate prevents
 * routing through them), but the FP-drafted cow is driven directly by WASD —
 * nothing else stops them from walking into a wall tile. This runs after
 * applyVelocity and reverts any cow whose new tile became a wall, sliding
 * along axis-aligned walls so a glancing approach doesn't dead-stop.
 *
 * Defensive for AI cows too — if a future code path ever bypasses the
 * pathfinder, walls still hold.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeCowWallCollisionSystem(grid) {
  return {
    name: 'cowWallCollision',
    tier: 'every',
    run(world) {
      for (const { components } of world.query(['Cow', 'Position', 'PrevPosition'])) {
        const p = components.Position;
        const pp = components.PrevPosition;
        const cur = worldToTileClamp(p.x, p.z, grid.W, grid.H);
        if (!grid.isWall(cur.i, cur.j)) continue;
        // We've crossed into a wall tile. Try preserving each axis on its own
        // before falling back to a full revert — that gives the natural
        // "slide along the wall" feel when the cow walks at it diagonally.
        const xOnly = worldToTileClamp(p.x, pp.z, grid.W, grid.H);
        const zOnly = worldToTileClamp(pp.x, p.z, grid.W, grid.H);
        const xClear = !grid.isWall(xOnly.i, xOnly.j);
        const zClear = !grid.isWall(zOnly.i, zOnly.j);
        if (xClear && !zClear) {
          p.z = pp.z;
        } else if (zClear && !xClear) {
          p.x = pp.x;
        } else {
          p.x = pp.x;
          p.z = pp.z;
        }
      }
    },
  };
}
