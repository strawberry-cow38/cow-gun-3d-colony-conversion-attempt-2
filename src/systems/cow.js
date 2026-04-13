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

import { BUILD_TICKS, findBuildStandTile } from '../jobs/build.js';
import { CHOP_TICKS, findAdjacentWalkable } from '../jobs/chop.js';
import { DROP_TICKS, PICKUP_TICKS } from '../jobs/haul.js';
import { HUNGER_CRITICAL_THRESHOLD, HUNGER_PREEMPT_TIER, tierFor } from '../jobs/tiers.js';
import { WANDER_IDLE_TICKS, pickRandomWalkable } from '../jobs/wander.js';
import { tileToWorld, worldToTileClamp } from '../world/coords.js';
import { FOOD_NUTRITION, HUNGER_EAT_THRESHOLD, addItemToTile } from '../world/items.js';

const COW_SPEED_UNITS_PER_SEC = 85.7; // ≈2 tiles/sec at 1.5m tile
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
 *   onCowEat: (pos: {x:number,y:number,z:number}) => void,
 *   onCowHammer: (pos: {x:number,y:number,z:number}) => void,
 *   onBuildComplete: (pos: {x:number,y:number,z:number}) => void,
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
            job.kind === 'haul' ||
            job.kind === 'eat' ||
            job.kind === 'build'
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
        if (inv.itemKind !== null && job.kind !== 'haul') {
          dropCarriedItem(world, grid, inv, pos);
          deps.onItemChange();
        }

        // Critical hunger preempts any non-urgent work. A cow hauling logs
        // when it's starving drops what it's carrying and bails to eat; the
        // next tick's decide block will self-assign an eat job. Jobs below
        // HUNGER_PREEMPT_TIER (eat itself) are already urgent enough to let
        // run to completion.
        if (hunger.value < HUNGER_CRITICAL_THRESHOLD && tierFor(job.kind) >= HUNGER_PREEMPT_TIER) {
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
              } else if (candidate && candidate.kind === 'haul' && board.claim(candidate.id, id)) {
                job.kind = 'haul';
                job.state = 'pathing-to-item';
                job.payload = {
                  jobId: candidate.id,
                  itemId: candidate.payload.itemId,
                  fromI: candidate.payload.fromI,
                  fromJ: candidate.payload.fromJ,
                  toI: candidate.payload.toI,
                  toJ: candidate.payload.toJ,
                  toBuildSite: candidate.payload.toBuildSite === true,
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

        const kindBefore = job.kind;

        if (job.kind === 'chop') {
          runChopJob(world, job, path, pos, grid, paths, walkable, board, ctx, deps);
        } else if (job.kind === 'build') {
          runBuildJob(world, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'haul') {
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

        // State machine completed → mark the brain dirty so next tick picks
        // fresh work instead of waiting for an external bump.
        if (kindBefore !== 'none' && job.kind === 'none') {
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
  const boardJob = board.jobs.find((j) => j.id === jobId);
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
 * State machine for the build job. Mirrors runChopJob: walk adjacent to the
 * build site, hammer for BUILD_TICKS, then convert the BuildSite into a Wall.
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
function runBuildJob(world, job, path, pos, grid, paths, walkable, board, deps) {
  const { siteId, jobId } = /** @type {{ siteId: number, jobId: number }} */ (job.payload);

  // Site despawned (player cancelled the blueprint) OR the board job was
  // completed externally → bail cleanly.
  const site = world.get(siteId, 'BuildSite');
  const boardJob = board.jobs.find((j) => j.id === jobId);
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
    const adj = findBuildStandTile(grid, walkable, job.payload.i, job.payload.j);
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
      job.state = 'building';
      job.payload.ticksRemaining = BUILD_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'building') {
    const remaining = (job.payload.ticksRemaining ?? BUILD_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    site.progress = 1 - remaining / BUILD_TICKS;
    // Hammer audio lands every ~18 ticks so a 4-second build gives ~6 strikes
    // — rhythmic without drowning out other cows' work.
    if (remaining > 0 && remaining % 18 === 0) deps.onCowHammer(pos);
    if (remaining <= 0) {
      deps.onBuildComplete(pos);
      finishBuild(world, grid, siteId, jobId, board);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Convert a BuildSite entity into a Wall, flip the tile's wall bit so pathing
 * routes around it, and mark the job complete.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} siteId
 * @param {number} jobId
 * @param {import('../jobs/board.js').JobBoard} board
 */
function finishBuild(world, grid, siteId, jobId, board) {
  const anchor = world.get(siteId, 'TileAnchor');
  const site = world.get(siteId, 'BuildSite');
  if (!anchor || !site) {
    board.complete(jobId);
    return;
  }
  grid.setWall(anchor.i, anchor.j, 1);
  const pos = world.get(siteId, 'Position');
  world.spawn({
    Wall: {},
    WallViz: {},
    TileAnchor: { i: anchor.i, j: anchor.j },
    Position: pos ? { ...pos } : { x: 0, y: 0, z: 0 },
  });
  world.despawn(siteId);
  board.complete(jobId);
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
  const { jobId, itemId, toI, toJ, toBuildSite } =
    /** @type {{ jobId: number, itemId: number, toI: number, toJ: number, toBuildSite?: boolean }} */ (
      job.payload
    );

  // Target tile stopped being a valid drop (stockpile undesignated, or
  // BuildSite cancelled/already built) → complete + bail. Delivery to a
  // BuildSite uses the site's existence at that tile, not the stockpile bit.
  const targetGone = toBuildSite
    ? findBuildSiteAt(world, toI, toJ) === null
    : !grid.isStockpile(toI, toJ);
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
    const a = components.TileAnchor;
    const d = Math.max(Math.abs(a.i - near.i), Math.abs(a.j - near.j));
    if (d < bestD) {
      bestD = d;
      best = { id, i: a.i, j: a.j };
    }
  }
  return best;
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
  if (anchor) {
    grid.unblockTile(anchor.i, anchor.j);
    // Trees drop 20 wood each — addItemToTile merges into an open stack if
    // there is one, else spawns a second item when the first stack hits cap.
    for (let k = 0; k < 20; k++) addItemToTile(world, grid, 'wood', anchor.i, anchor.j);
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

        const speed = crowded ? COW_SPEED_UNITS_PER_SEC * SLOW_FACTOR : COW_SPEED_UNITS_PER_SEC;
        vel.x = nx * speed;
        vel.z = nz * speed;
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
