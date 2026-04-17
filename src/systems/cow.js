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
import { startStateFor } from '../jobs/prioritize.js';
import {
  HUNGER_CRITICAL_THRESHOLD,
  HUNGER_PREEMPT_TIER,
  TIREDNESS_CRITICAL_THRESHOLD,
  TIREDNESS_PREEMPT_TIER,
  TIREDNESS_SLEEP_THRESHOLD,
  tierFor,
} from '../jobs/tiers.js';
import { TILL_TICKS } from '../jobs/till.js';
import { WANDER_IDLE_TICKS, pickWanderGoal } from '../jobs/wander.js';
import { bedFootprintTiles } from '../world/bed.js';
import { BOULDER_LOOT } from '../world/boulders.js';
import { TILE_SIZE, tileToWorld, worldToTileClamp } from '../world/coords.js';
import { cropIsReady, cropKindFor } from '../world/crops.js';
import { FACING_OFFSETS, FACING_SPAN_OFFSETS } from '../world/facing.js';
import {
  FOOD_NUTRITION,
  HUNGER_EAT_THRESHOLD,
  addItemToTile,
  addItemsToTile,
  inventoryAdd,
  itemHasTag,
  stackAdd,
  stackCount,
  stackRemove,
} from '../world/items.js';
import { generatePainting } from '../world/painting.js';
import {
  RAW_FOOD_RANK,
  cookingSkillFor,
  nutritionMultiplier,
  poisoningChance,
  qualityRank,
  rollQuality,
} from '../world/quality.js';
import { PAINTING_SIZE_BY_RECIPE, RECIPES } from '../world/recipes.js';
import { XP_PER_WORK, awardXp } from '../world/skills.js';
import { stairRampTiles, stairTopLandingTile } from '../world/stair.js';
import { stoveFootprintTiles } from '../world/stove.js';
import { BIOME, LAYER_HEIGHT, TERRAIN_STEP, WALL_FILL_FULL } from '../world/tileGrid.js';
import { woodYieldFor } from '../world/trees.js';
import { canCowDoJobKind, priorityForJobKind } from '../world/workPriorities.js';
import { DARKNESS_SLOWDOWN_THRESHOLD } from './lighting.js';

export const COW_SPEED_UNITS_PER_SEC = 85.7; // ≈2 tiles/sec at 1.5m tile
const ARRIVE_DIST_SQ = 4 * 4; // within 4 units of a step center counts as arrived
const HUNGER_DRAIN_PER_TICK = 1 / 43200; // empties over one in-game day
// Tiredness empties over 16 in-game hours (2/3 of a day = 28800 ticks at 30Hz).
// Sleep restores it over 8 hours (14400 ticks) in a bed — so an 8-hour night
// fully refills a day's drain. Floor-sleep restores half as fast so cows with
// no bed still recover, just slowly enough that building one matters.
const TIREDNESS_DRAIN_PER_TICK = 1 / 28800;
const TIREDNESS_RESTORE_PER_TICK = 1 / 14400;
const TIREDNESS_FLOOR_RESTORE_MULT = 0.5;
// Bed sleep restores fully. Floor sleep tops out at half so cows still
// recover when bedless but a built bed gives a clear, visible upgrade.
const SLEEP_SATIATED_THRESHOLD = 1;
const FLOOR_SATIATED_THRESHOLD = 0.5;
// While food-poisoned, hunger drains this fast — roughly 3x normal, so the
// cow ends up hungry again sooner than if the bad meal had been tasty.
const HUNGER_DRAIN_POISONED_MULT = 3;
// Poisoning lasts about 2.5 minutes of real time at 30Hz (4500 ticks).
const FOOD_POISONING_DURATION_TICKS = 4500;
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
 * @property {import('../world/tileWorld.js').TileWorld=} tileWorld
 *   Optional multi-layer world; when present, follow-path can resolve per-
 *   layer walkability + elevation so cows traversing z>0 tiles sit at the
 *   right y.
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
 *   tileWorld?: import('../world/tileWorld.js').TileWorld,
 * }} BrainDeps
 */

/**
 * @param {BrainDeps} deps
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeCowBrainSystem(deps) {
  const { grid, paths, walkable, board, tileWorld } = deps;
  return {
    name: 'cowBrain',
    tier: 'every',
    run(world, ctx) {
      // Drop completed jobs before the stale-claim scan so we don't iterate
      // a pile of tombstones every tick. No caller relies on byId keeping a
      // completed job lookup-able — post-complete code reads job.completed
      // (true) either way; after reap it gets null, same semantics.
      board.reap();

      // Release claims held by cows that no longer consider the job theirs
      // (e.g. the player reassigned the cow to a move via RMB mid-chop).
      // Goes through board.release() so version bumps and other idle cows
      // get a chance to pick up the freshly-freed job.
      for (const j of board.jobs) {
        if (j.claimedBy === null) continue;
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
        'Tiredness',
        'Brain',
      ])) {
        const cow = components.Cow;
        const job = components.Job;
        const path = components.Path;
        const pos = components.Position;
        const inv = components.Inventory;
        const hunger = components.Hunger;
        const tiredness = components.Tiredness;
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
            job.kind === 'harvest' ||
            job.kind === 'paint' ||
            job.kind === 'cook' ||
            job.kind === 'sleep'
          ) {
            if (job.kind === 'sleep') releaseBedOccupant(world, job, id);
            if (job.payload?.jobId != null) board.release(job.payload.jobId);
            job.kind = 'none';
            job.state = 'idle';
            job.payload = {};
            path.steps = [];
            path.index = 0;
          }
          if (inv.items.length > 0) {
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
          inv.items.length > 0 &&
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
        //
        // Player-prioritized jobs are exempt: the player explicitly told this
        // cow to finish this work first, so hunger waits.
        if (
          !job.prioritized &&
          hunger.value < HUNGER_CRITICAL_THRESHOLD &&
          tierFor(job.kind) >= HUNGER_PREEMPT_TIER &&
          anyFood
        ) {
          if (job.payload?.jobId != null) board.release(job.payload.jobId);
          if (inv.items.length > 0) {
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

        // Same story for tiredness: a cow falling asleep on its feet drops
        // non-urgent work so the next decide block re-plans as a sleep job.
        // Unlike hunger we don't gate on "any beds exist" — floor-sleep is a
        // valid fallback, so the cow should collapse wherever it stands if
        // there's no bed. Player-prioritized jobs skip the preempt so
        // manually-directed work finishes regardless of exhaustion.
        if (
          !job.prioritized &&
          tiredness.value < TIREDNESS_CRITICAL_THRESHOLD &&
          tierFor(job.kind) >= TIREDNESS_PREEMPT_TIER
        ) {
          if (job.payload?.jobId != null) board.release(job.payload.jobId);
          if (inv.items.length > 0) {
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
            // Prior job ended → clear the prioritized flag so the upcoming
            // board/self-care branches start from a clean slate.
            job.prioritized = false;

            // Shift-clicked priority queue: pull the next reserved jobId and
            // start walking. Skip dead queue entries (job completed or its
            // claim got stolen by a non-queued prioritize) until one sticks
            // or the queue empties.
            if (!Array.isArray(job.priorityQueue)) job.priorityQueue = [];
            while (job.kind === 'none' && job.priorityQueue.length > 0) {
              const nextId = job.priorityQueue.shift();
              if (nextId == null) break;
              const next = board.get(nextId);
              if (!next || next.completed || next.claimedBy !== id) continue;
              job.kind = next.kind;
              job.state = startStateFor(next.kind);
              job.payload = { ...next.payload, jobId: next.id };
              job.prioritized = true;
              path.steps = [];
              path.index = 0;
            }

            // Critical-only self-care runs BEFORE the board check so a
            // starving or collapsing cow doesn't grab another designation.
            // Soft hunger/tiredness falls through to the board first so
            // player-directed work outranks a peckish eat or a drowsy nap.
            if (
              (job.kind === 'wander' || job.kind === 'none') &&
              hunger.value < HUNGER_CRITICAL_THRESHOLD
            ) {
              const near = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
              const food = findBestFood(world, near);
              if (food) {
                job.kind = 'eat';
                job.state = 'pathing-to-food';
                job.payload = { itemId: food.id, i: food.i, j: food.j };
                path.steps = [];
                path.index = 0;
              }
            }

            if (
              (job.kind === 'wander' || job.kind === 'none') &&
              tiredness.value < TIREDNESS_CRITICAL_THRESHOLD
            ) {
              const near = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
              const bed = findBestBed(world, id, near);
              if (bed) {
                reserveBed(world, bed.id, id);
                job.kind = 'sleep';
                job.state = 'pathing-to-bed';
                job.payload = { bedId: bed.id, i: bed.i, j: bed.j };
                path.steps = [];
                path.index = 0;
              } else {
                // No bed but we're collapsing — drop where we stand, but
                // refuse to lie down in water. Stay awake on a water tile so
                // the cow keeps wandering toward dry ground instead of
                // drowning itself.
                const biomeHere = grid.biome[grid.idx(near.i, near.j)];
                const onWater = biomeHere === BIOME.SHALLOW_WATER || biomeHere === BIOME.DEEP_WATER;
                if (!onWater) {
                  job.kind = 'sleep';
                  job.state = 'sleeping';
                  job.payload = { onFloor: true };
                  path.steps = [];
                  path.index = 0;
                }
              }
            }

            // Preempt a wander when work appears — without this a cow that
            // already rolled into wander never re-checks the board and would
            // ignore freshly designated trees / dropped items.
            if (job.kind === 'wander' || job.kind === 'none') {
              const near = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
              const wp = world.get(id, 'WorkPriorities');
              const candidate = board.findUnclaimed(
                near,
                (j) => {
                  // Respect the cow's per-category work priorities. Unknown
                  // kinds soft-pass; missing component is treated as "all on"
                  // to keep legacy / test flows working.
                  if (!canCowDoJobKind(wp, j.kind)) return false;
                  // Paint/cook jobs can be cook-locked: only the cow who first
                  // started the bill may resume it after an interruption.
                  if (j.kind !== 'paint' && j.kind !== 'cook') return true;
                  const lock = j.payload.lockedCowId | 0;
                  return lock === 0 || lock === id;
                },
                (j) => priorityForJobKind(wp, j.kind),
              );
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
                job.payload = { ...candidate.payload, jobId: candidate.id };
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
              } else if (candidate && candidate.kind === 'paint' && board.claim(candidate.id, id)) {
                job.kind = 'paint';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  easelId: candidate.payload.easelId,
                  i: candidate.payload.i,
                  j: candidate.payload.j,
                };
                path.steps = [];
                path.index = 0;
              } else if (candidate && candidate.kind === 'cook' && board.claim(candidate.id, id)) {
                job.kind = 'cook';
                job.state = 'pathing';
                job.payload = {
                  jobId: candidate.id,
                  stoveId: candidate.payload.stoveId,
                  i: candidate.payload.i,
                  j: candidate.payload.j,
                };
                path.steps = [];
                path.index = 0;
              } else if (
                candidate &&
                candidate.kind === 'install' &&
                board.claim(candidate.id, id)
              ) {
                job.kind = 'install';
                job.state = 'pathing-to-item';
                job.payload = { ...candidate.payload, jobId: candidate.id };
                path.steps = [];
                path.index = 0;
              } else if (
                candidate &&
                candidate.kind === 'uninstall' &&
                board.claim(candidate.id, id)
              ) {
                job.kind = 'uninstall';
                job.state = 'pathing';
                job.payload = { ...candidate.payload, jobId: candidate.id };
                path.steps = [];
                path.index = 0;
              }
            }

            // Soft self-care fallback: only after the board offered nothing.
            // Player-directed work outranks a peckish eat or a drowsy nap; if
            // there's no work, fall through here and tend to needs.
            if (job.kind === 'none' && hunger.value < HUNGER_EAT_THRESHOLD) {
              const near = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
              const food = findBestFood(world, near);
              if (food) {
                job.kind = 'eat';
                job.state = 'pathing-to-food';
                job.payload = { itemId: food.id, i: food.i, j: food.j };
                path.steps = [];
                path.index = 0;
              }
            }
            if (job.kind === 'none' && tiredness.value < TIREDNESS_SLEEP_THRESHOLD) {
              const near = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
              const bed = findBestBed(world, id, near);
              if (bed) {
                reserveBed(world, bed.id, id);
                job.kind = 'sleep';
                job.state = 'pathing-to-bed';
                job.payload = { bedId: bed.id, i: bed.i, j: bed.j };
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
          runChopJob(world, id, job, path, pos, grid, paths, walkable, board, ctx, deps);
        } else if (job.kind === 'mine') {
          runMineJob(world, id, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'cut') {
          runCutJob(world, id, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'build') {
          runBuildJob(world, id, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'deconstruct') {
          runDeconstructJob(world, id, job, path, pos, grid, paths, walkable, board, deps);
        } else if (job.kind === 'till') {
          runTillJob(world, id, job, path, pos, grid, paths, board, deps);
        } else if (job.kind === 'plant') {
          runPlantJob(world, id, job, path, pos, grid, paths, board, deps);
        } else if (job.kind === 'harvest') {
          runHarvestJob(world, id, job, path, pos, grid, paths, board, deps);
        } else if (job.kind === 'paint') {
          runPaintJob(world, id, job, path, pos, grid, paths, walkable, board, ctx, deps);
        } else if (job.kind === 'cook') {
          runCookJob(world, id, job, path, pos, grid, paths, walkable, board, ctx, deps);
        } else if (job.kind === 'install') {
          runInstallJob(world, job, path, pos, inv, grid, paths, board, deps);
        } else if (job.kind === 'uninstall') {
          runUninstallJob(world, job, path, pos, grid, paths, board, deps);
        } else if (job.kind === 'haul' || job.kind === 'deliver' || job.kind === 'supply') {
          runHaulJob(world, id, job, path, pos, inv, grid, paths, board, deps);
        } else if (job.kind === 'eat') {
          runEatJob(world, job, path, pos, hunger, grid, paths, deps, id);
        } else if (job.kind === 'sleep') {
          runSleepJob(world, job, path, pos, tiredness, grid, paths, id);
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
            const cowZ = brain.layerZ | 0;
            const goal = pickWanderGoal(grid, walkable);
            if (!goal) {
              job.state = 'idle';
              job.payload = { untilTick: ctx.tick + WANDER_IDLE_TICKS };
            } else {
              // Wander goals are randomized — caching them just churns the LRU.
              // Ground-level goal with cow's current layerZ as the path start
              // so a z=1 cow routes down a stair to pick up wandering on z=0
              // instead of hanging on the upper floor with no reachable target.
              const route = paths.find(
                { i: si, j: sj, z: cowZ },
                { ...goal, z: 0 },
                { cache: false },
              );
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
function runChopJob(world, cowId, job, path, pos, grid, paths, walkable, board, ctx, deps) {
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
      awardXp(world, cowId, 'plants', XP_PER_WORK);
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
function runMineJob(world, cowId, job, path, pos, grid, paths, walkable, board, deps) {
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
      awardXp(world, cowId, 'mining', XP_PER_WORK);
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
function runCutJob(world, cowId, job, path, pos, grid, paths, walkable, board, deps) {
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
      awardXp(world, cowId, 'plants', XP_PER_WORK);
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
        addItemToTile(world, grid, crop.kind, anchor.i, anchor.j);
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
  // completed externally OR the player just forbade the site mid-build → bail
  // cleanly. On forbid we also complete the board job and zero buildJobId so
  // the haul poster won't immediately repost it; un-forbidding resumes the
  // normal flow where pass 0b reposts a fresh build job.
  const site = world.get(siteId, 'BuildSite');
  const boardJob = board.get(jobId);
  const forbidden = !!site?.forbidden;
  if (!site || !boardJob || boardJob.completed || forbidden) {
    if (boardJob && !boardJob.completed) {
      if (forbidden) {
        board.complete(jobId);
        if (site) site.buildJobId = 0;
      } else {
        board.release(jobId);
      }
    }
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
    const siteAnchor = world.get(siteId, 'TileAnchor');
    const siteZ = siteAnchor ? siteAnchor.z | 0 : 0;
    const cowZ = world.get(builderId, 'Brain')?.layerZ | 0;
    const adj = findBuildStandTile(
      grid,
      walkable,
      job.payload.i,
      job.payload.j,
      blueprintTiles,
      deps.tileWorld,
      siteZ,
    );
    if (!adj) {
      board.release(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    const route = paths.find({ ...start, z: cowZ }, adj);
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
      const stoveTiles =
        site.kind === 'stove' && anchor ? stoveFootprintTiles(anchor, site.facing | 0) : null;
      const someoneInFootprint = stoveTiles
        ? stoveTiles.some((t) => cowOnTileExcluding(world, grid, t.i, t.j, builderId))
        : anchor && cowOnTileExcluding(world, grid, anchor.i, anchor.j, builderId);
      if (
        site.kind !== 'roof' &&
        site.kind !== 'floor' &&
        site.kind !== 'bed' &&
        someoneInFootprint
      ) {
        // One tick of pad keeps progress visually pegged at 99% and the audio
        // tap firing at the same cadence; we re-check next tick.
        job.payload.ticksRemaining = 1;
        site.progress = 1 - 1 / totalTicks;
        return;
      }
      deps.onBuildComplete(pos, site.kind);
      finishBuild(world, grid, siteId, jobId, board, walkable, deps.tileWorld);
      awardXp(world, builderId, 'construction', XP_PER_WORK);
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
 * @param {import('../world/tileWorld.js').TileWorld} [tileWorld]
 */
function finishBuild(world, grid, siteId, jobId, board, walkable, tileWorld) {
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
    const workSpot = pickStationWorkSpot(grid, walkable, anchor, facing);
    grid.blockTile(anchor.i, anchor.j);
    world.spawn({
      Furnace: { stuff, workI: workSpot.i, workJ: workSpot.j, facing },
      FurnaceViz: {},
      Bills: { list: [], nextBillId: 1 },
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'easel') {
    const facing = site.facing | 0;
    const workSpot = pickStationWorkSpot(grid, walkable, anchor, facing);
    grid.blockTile(anchor.i, anchor.j);
    world.spawn({
      Easel: { stuff, workI: workSpot.i, workJ: workSpot.j, facing },
      EaselViz: {},
      Bills: { list: [], nextBillId: 1 },
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'stove') {
    const facing = site.facing | 0;
    // Work-spot is picked from the anchor's facing; the full 3-tile footprint
    // then gets blocked. Pick BEFORE blocking so span tiles aren't rejected
    // from the neighbor scan.
    const workSpot = pickStationWorkSpot(grid, walkable, anchor, facing);
    for (const t of stoveFootprintTiles(anchor, facing)) {
      if (grid.inBounds(t.i, t.j)) grid.blockTile(t.i, t.j);
    }
    world.spawn({
      Stove: { stuff, workI: workSpot.i, workJ: workSpot.j, facing },
      StoveViz: {},
      Bills: { list: [], nextBillId: 1 },
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'bed') {
    const facing = site.facing | 0;
    // Bed stays walkable (cows lie on it); no grid.blockTile.
    world.spawn({
      Bed: { stuff, facing },
      BedViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j },
      Position: position,
    });
  } else if (site.kind === 'stair') {
    const facing = site.facing | 0;
    const bottomZ = anchor.z | 0;
    const bottom = tileWorld?.layers[bottomZ];
    const top = tileWorld?.layers[bottomZ + 1];
    if (bottom && top) {
      for (const t of stairRampTiles(anchor, facing)) {
        bottom.setRamp(t.i, t.j, 1);
      }
      const landing = stairTopLandingTile(anchor, facing);
      top.setFloor(landing.i, landing.j, 1);
    }
    world.spawn({
      Stair: { stuff, facing, bottomZ },
      StairViz: {},
      TileAnchor: { i: anchor.i, j: anchor.j, z: bottomZ },
      Position: position,
    });
  } else {
    // Wall lives on its anchor's z-layer so upper-floor walls write to the
    // right occupancy bitmap. Fallback to `grid` if tileWorld or the layer is
    // missing (keeps legacy z=0-only callers intact). Wall-family blueprints
    // (full / half / quarter) share this branch: the tier adds to an existing
    // Wall.fill if one's already there, otherwise a fresh entity is spawned.
    const wallZ = anchor.z | 0;
    const wallLayer = tileWorld?.layers[wallZ] ?? grid;
    const tier = WALL_TIER_BY_KIND[site.kind] ?? WALL_FILL_FULL;
    const existingWallId = findWallAt(world, anchor.i, anchor.j, wallZ);
    if (existingWallId !== null) {
      const wall = world.get(existingWallId, 'Wall');
      if (wall) {
        wall.fill = Math.min(WALL_FILL_FULL, (wall.fill | 0) + tier);
        wallLayer.setWallFill(anchor.i, anchor.j, wall.fill);
      }
    } else {
      wallLayer.setWallFill(anchor.i, anchor.j, tier);
      world.spawn({
        Wall: { stuff, fill: tier },
        WallViz: {},
        TileAnchor: { i: anchor.i, j: anchor.j, z: wallZ },
        Position: position,
      });
    }
  }
  world.despawn(siteId);
  board.complete(jobId);
}

/**
 * Pick the work-spot tile for a facing-aware station (furnace, easel). Prefer
 * the tile in front of `facing`; fall back to any walkable cardinal neighbor;
 * last resort, the station's own tile. Call BEFORE `grid.blockTile` so the
 * neighbor scan doesn't reject the station's own tile.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {(g: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {{ i: number, j: number }} anchor
 * @param {number} facing
 */
function pickStationWorkSpot(grid, walkable, anchor, facing) {
  const off = FACING_OFFSETS[facing] ?? FACING_OFFSETS[0];
  const fi = anchor.i + off.di;
  const fj = anchor.j + off.dj;
  const facingSpot = grid.inBounds(fi, fj) && walkable(grid, fi, fj) ? { i: fi, j: fj } : null;
  return (
    facingSpot ??
    findAdjacentWalkable(grid, walkable, anchor.i, anchor.j) ?? {
      i: anchor.i,
      j: anchor.j,
    }
  );
}

/** Fill contributed per wall-family BuildSite kind, in quarter-layer units. */
const WALL_TIER_BY_KIND = /** @type {Record<string, number>} */ ({
  wall: WALL_FILL_FULL,
  halfWall: 2,
  quarterWall: 1,
});

/**
 * Find an existing Wall entity at (i,j,z), or null. Used by the build-finish
 * path to decide between spawning a new wall and bumping an existing wall's
 * fill when a partial-wall blueprint completes atop it.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} i @param {number} j @param {number} z
 */
function findWallAt(world, i, j, z) {
  for (const { id, components } of world.query(['Wall', 'TileAnchor'])) {
    const a = components.TileAnchor;
    if (a.i === i && a.j === j && (a.z | 0) === z) return id;
  }
  return null;
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
  easel: 'Easel',
  stove: 'Stove',
  bed: 'Bed',
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
function runDeconstructJob(world, cowId, job, path, pos, grid, paths, walkable, board, deps) {
  const { entityId, kind, jobId } =
    /** @type {{ entityId: number, kind: string, jobId: number }} */ (job.payload);
  const compName =
    /** @type {'Wall'|'Door'|'Torch'|'Roof'|'Floor'|'Furnace'|'Easel'|'Stove'|'Bed'} */ (
      DECON_COMP_BY_KIND[
        /** @type {'wall'|'door'|'torch'|'roof'|'floor'|'furnace'|'easel'|'stove'|'bed'} */ (kind)
      ] ?? 'Wall'
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
      awardXp(world, cowId, 'construction', XP_PER_WORK);
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
  else if (kind === 'furnace' || kind === 'easel') grid.unblockTile(anchor.i, anchor.j);
  else if (kind === 'stove') {
    const stoveEntity = world.get(entityId, 'Stove');
    const facing = stoveEntity ? stoveEntity.facing | 0 : 0;
    for (const t of stoveFootprintTiles(anchor, facing)) {
      if (grid.inBounds(t.i, t.j)) grid.unblockTile(t.i, t.j);
    }
  }
  // Wall/door/torch cost 1 wood → 50% refund = 1. Roofs are free so they
  // refund nothing. Furnaces cost 15 stone → refund 7. Easels cost 8 wood →
  // refund 4, plus any in-progress craft's ingredients (already consumed at
  // craft start, so the player isn't silently robbed). When buildings diverge
  // further, the original `required`/`requiredKind` should live on the
  // finished-structure entity (mirroring how BuildSite tracks them).
  if (kind === 'furnace') {
    for (let k = 0; k < 7; k++) addItemToTile(world, grid, 'stone', anchor.i, anchor.j);
    const furnace = world.get(entityId, 'Furnace');
    if (furnace) {
      for (const s of furnace.stored)
        addItemsToTile(world, grid, s.kind, s.count, anchor.i, anchor.j);
      for (const s of furnace.outputs)
        addItemsToTile(world, grid, s.kind, s.count, anchor.i, anchor.j);
    }
  } else if (kind === 'easel') {
    for (let k = 0; k < 4; k++) addItemToTile(world, grid, 'wood', anchor.i, anchor.j);
    const easel = world.get(entityId, 'Easel');
    const bills = world.get(entityId, 'Bills');
    if (easel && bills && easel.activeBillId > 0) {
      const active = bills.list.find((b) => b.id === easel.activeBillId);
      const recipe = active ? RECIPES[active.recipeId] : null;
      if (recipe) {
        for (const ing of recipe.ingredients)
          addItemsToTile(world, grid, ing.kind, ing.count, anchor.i, anchor.j);
      }
    }
  } else if (kind === 'stove') {
    for (let k = 0; k < 12; k++) addItemToTile(world, grid, 'stone', anchor.i, anchor.j);
    const stove = world.get(entityId, 'Stove');
    const bills = world.get(entityId, 'Bills');
    if (stove) {
      for (const s of stove.stored)
        addItemsToTile(world, grid, s.kind, s.count, anchor.i, anchor.j);
      if (bills && stove.activeBillId > 0) {
        const active = bills.list.find((b) => b.id === stove.activeBillId);
        const recipe = active ? RECIPES[active.recipeId] : null;
        if (recipe) {
          for (const ing of recipe.ingredients)
            addItemsToTile(world, grid, ing.kind, ing.count, anchor.i, anchor.j);
        }
      }
    }
  } else if (kind === 'bed') {
    // 8 wood → 50% refund = 4.
    for (let k = 0; k < 4; k++) addItemToTile(world, grid, 'wood', anchor.i, anchor.j);
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
function runTillJob(world, cowId, job, path, pos, grid, paths, board, deps) {
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
      awardXp(world, cowId, 'plants', XP_PER_WORK);
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
function runPlantJob(world, cowId, job, path, pos, grid, paths, board, deps) {
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
      awardXp(world, cowId, 'plants', XP_PER_WORK);
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
function runHarvestJob(world, cowId, job, path, pos, grid, paths, board, deps) {
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
      addItemToTile(world, grid, crop.kind, i, j);
      deps.onHarvestComplete(pos);
      deps.onItemChange();
      board.complete(jobId);
      awardXp(world, cowId, 'plants', XP_PER_WORK);
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
 * @param {{ items: { kind: string, count: number }[] }} inv
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runHaulJob(world, haulerId, job, path, pos, inv, grid, paths, board, deps) {
  const {
    jobId,
    itemId,
    toI,
    toJ,
    toBuildSite,
    toRelocation,
    toSupply,
    furnaceId,
    easelId,
    stoveId,
    fromFurnaceId,
    fromI,
    fromJ,
    siteId,
  } =
    /** @type {{ jobId: number, itemId?: number, toI: number, toJ: number, toBuildSite?: boolean, toRelocation?: boolean, toSupply?: boolean, furnaceId?: number, easelId?: number, stoveId?: number, fromFurnaceId?: number, fromI?: number, fromJ?: number, siteId?: number, kind?: string }} */ (
      job.payload
    );
  const kind = /** @type {string | undefined} */ (job.payload.kind);

  // Target tile stopped being a valid drop (stockpile undesignated, or
  // BuildSite cancelled/already built, or station gone) → complete + bail.
  const targetGone = toBuildSite
    ? findBuildSiteAt(world, toI, toJ) === null
    : toSupply
      ? !stationWorkSpotMatches(world, furnaceId, easelId, stoveId, toI, toJ)
      : !toRelocation && !grid.isStockpile(toI, toJ);
  if (targetGone) {
    if (inv.items.length > 0) {
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

  // Pre-pickup bail-out for supply jobs when the target station is now
  // actively crafting. Master's rule: don't keep filling a running
  // workstation. Post-pickup cows finish normally — dropping cargo at the
  // stockpile would just trigger a haul back, and the cargo belongs in
  // station.stored anyway so the next craft starts warm. When the station
  // idles, the poster reposts fresh supply jobs for whatever's still short.
  if (
    toSupply &&
    inv.items.length === 0 &&
    (job.state === 'pathing-to-item' ||
      job.state === 'walking-to-item' ||
      job.state === 'picking-up')
  ) {
    const station =
      typeof furnaceId === 'number'
        ? world.get(furnaceId, 'Furnace')
        : typeof easelId === 'number'
          ? world.get(easelId, 'Easel')
          : typeof stoveId === 'number'
            ? world.get(stoveId, 'Stove')
            : null;
    if (station && station.activeBillId > 0) {
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      path.steps = [];
      path.index = 0;
      return;
    }
  }

  // Source gone: for haul-from-furnace, bail if the furnace disappeared or
  // its output of this kind drained to zero before pickup. For tile Item
  // sources the forbidden check below covers the normal case.
  if (
    typeof fromFurnaceId === 'number' &&
    (job.state === 'pathing-to-item' ||
      job.state === 'walking-to-item' ||
      job.state === 'picking-up')
  ) {
    const furnace = world.get(fromFurnaceId, 'Furnace');
    if (!furnace || !kind || stackCount(furnace.outputs, kind) <= 0) {
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      path.steps = [];
      path.index = 0;
      return;
    }
  }

  // Item got forbidden after the cow claimed the haul. Release pre-pickup —
  // post-pickup the carried unit is already off the tile, so let the cow
  // finish dropping it. Blueprint-clear relocations intentionally move
  // forbidden stacks and are exempt. Haul-from-furnace has no Item entity.
  if (
    !toRelocation &&
    typeof fromFurnaceId !== 'number' &&
    (job.state === 'pathing-to-item' ||
      job.state === 'walking-to-item' ||
      job.state === 'picking-up')
  ) {
    const srcItem = typeof itemId === 'number' ? world.get(itemId, 'Item') : null;
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
    // Pickup target: furnace work spot OR Item tile.
    /** @type {{ i: number, j: number, z: number } | null} */
    let target = null;
    if (typeof fromFurnaceId === 'number') {
      const fa = world.get(fromFurnaceId, 'TileAnchor');
      target = { i: fromI ?? 0, j: fromJ ?? 0, z: fa?.z | 0 };
    } else if (typeof itemId === 'number') {
      const anchor = world.get(itemId, 'TileAnchor');
      const item = world.get(itemId, 'Item');
      if (anchor && item) target = { i: anchor.i, j: anchor.j, z: anchor.z | 0 };
    }
    if (!target) {
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const cowZ = world.get(haulerId, 'Brain')?.layerZ | 0;
    const route = paths.find({ ...start, z: cowZ }, target);
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
      if (typeof fromFurnaceId === 'number') {
        const furnace = world.get(fromFurnaceId, 'Furnace');
        const available = furnace && kind ? stackCount(furnace.outputs, kind) : 0;
        if (!furnace || !kind || available <= 0) {
          board.complete(jobId);
          job.kind = 'none';
          job.state = 'idle';
          job.payload = {};
          return;
        }
        const added = inventoryAdd(inv, kind, available);
        if (added > 0) stackRemove(furnace.outputs, kind, added);
        releaseHaulClaim(job, board, jobId);
        deps.onItemChange();
        job.state = 'pathing-to-drop';
        return;
      }
      const item = typeof itemId === 'number' ? world.get(itemId, 'Item') : null;
      if (!item || item.count <= 0) {
        board.complete(jobId);
        job.kind = 'none';
        job.state = 'idle';
        job.payload = {};
        return;
      }
      // Cap pickup so cows don't overshoot. payload.count is the bundled
      // reservation — the cow only grabs her share so a single cow doesn't
      // drain a 50-stack that two other cows were also promised slots for.
      // Build sites additionally clamp to remaining need. Anything that
      // doesn't fit in the 60kg carry cap (inventoryAdd) stays on the source
      // stack and the poster re-posts the remainder next tick.
      const payloadCount = /** @type {number | undefined} */ (job.payload.count);
      let requested = Math.min(item.count, payloadCount ?? item.count);
      if (toBuildSite && typeof siteId === 'number') {
        const site = world.get(siteId, 'BuildSite');
        if (site) requested = Math.min(requested, Math.max(0, site.required - site.delivered));
      }
      const added = inventoryAdd(inv, item.kind, requested);
      item.count -= added;
      if (item.count <= 0 && typeof itemId === 'number') world.despawn(itemId);
      releaseHaulClaim(job, board, jobId);
      deps.onItemChange();
      job.state = 'pathing-to-drop';
    }
    return;
  }

  if (job.state === 'pathing-to-drop') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    // BuildSites on an upper layer carry the layer z on their TileAnchor —
    // goal z must match or haulers will path to the ground tile below the
    // blueprint and sit there forever.
    const dropZ =
      toBuildSite && typeof siteId === 'number' ? world.get(siteId, 'TileAnchor')?.z | 0 : 0;
    const cowZ = world.get(haulerId, 'Brain')?.layerZ | 0;
    const route = paths.find({ ...start, z: cowZ }, { i: toI, j: toJ, z: dropZ });
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
      if (inv.items.length > 0) {
        // Iterate every stack the cow is carrying. The job expects one
        // `kind` (supply: recipe ingredient; build: site.requiredKind);
        // non-matching stacks spill onto the drop tile so they re-enter
        // the haul pool instead of polluting the furnace or site.
        if (toBuildSite) {
          const activeSiteId =
            typeof siteId === 'number' ? siteId : findBuildSiteAt(world, toI, toJ);
          const site = activeSiteId !== null ? world.get(activeSiteId, 'BuildSite') : null;
          // A site forbidden mid-delivery refuses the credit — spill the whole
          // carry onto the drop tile so the haul pool can reclaim it once the
          // player un-forbids or cancels.
          const accepting = site && !site.forbidden;
          for (const stack of inv.items) {
            if (accepting && stack.kind === site.requiredKind) {
              const need = Math.max(0, site.required - site.delivered);
              const deliver = Math.min(stack.count, need);
              site.delivered += deliver;
              const leftover = stack.count - deliver;
              if (leftover > 0) addItemsToTile(world, grid, stack.kind, leftover, toI, toJ);
            } else {
              addItemsToTile(world, grid, stack.kind, stack.count, toI, toJ);
            }
          }
        } else if (
          toSupply &&
          (typeof furnaceId === 'number' ||
            typeof easelId === 'number' ||
            typeof stoveId === 'number')
        ) {
          const station =
            typeof furnaceId === 'number'
              ? world.get(furnaceId, 'Furnace')
              : typeof easelId === 'number'
                ? world.get(easelId, 'Easel')
                : world.get(/** @type {number} */ (stoveId), 'Stove');
          for (const stack of inv.items) {
            if (station && stack.kind === kind) {
              // Matching ingredient → deposit into station.stored so the
              // haul poster can't yank it back to the stockpile.
              stackAdd(station.stored, stack.kind, stack.count);
            } else {
              addItemsToTile(world, grid, stack.kind, stack.count, toI, toJ);
            }
          }
        } else {
          for (const stack of inv.items) {
            addItemsToTile(world, grid, stack.kind, stack.count, toI, toJ);
          }
        }
        inv.items.length = 0;
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
 * Paint job state machine. A MANNED craft: the cow walks to the easel's work
 * spot and stands there while `workTicksRemaining` counts down. On first
 * arrival she takes the artist lock (`easel.artistCowId` + `job.payload.
 * lockedCowId` = her id) so interruptions preserve attribution — only she
 * can resume the bill. On completion she spawns the Painting entity on the
 * easel's own tile; the player hauls it to a wall later via a future
 * wall-mount flow.
 *
 * Ingredients were already consumed when the easel system started the bill,
 * so bailing here (easel gone, bill suspended, path unreachable) doesn't
 * refund anything — the player ate that cost the moment the bill started.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {(g: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ tick: number }} ctx
 * @param {BrainDeps} deps
 */
function runPaintJob(world, cowId, job, path, pos, grid, paths, walkable, board, ctx, deps) {
  const { easelId, jobId } = /** @type {{ easelId: number, jobId: number }} */ (job.payload);
  const easel = world.get(easelId, 'Easel');
  const bills = world.get(easelId, 'Bills');
  const boardJob = board.get(jobId);

  // Easel gone, bill cleared, or board job completed → bail. Keep any partial
  // progress cleared on the easel side (activeBillId/artistCowId) to avoid a
  // zombie craft locking future bills.
  if (!easel || !bills || !boardJob || boardJob.completed || easel.activeBillId === 0) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  // Artist lock: if another cow already owns this craft, give up the claim.
  const lock = boardJob.payload.lockedCowId | 0 || easel.artistCowId | 0;
  if (lock > 0 && lock !== cowId) {
    board.release(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const target = { i: easel.workI, j: easel.workJ };
    const route = paths.find(start, target);
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
      // Arrived. Take the artist lock on both the easel AND the board job so
      // a drafted/interrupted cow retains exclusive rights to resume.
      if (easel.artistCowId === 0) easel.artistCowId = cowId;
      boardJob.payload.lockedCowId = cowId;
      if (easel.startTick === 0) easel.startTick = ctx.tick;
      job.state = 'painting';
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'painting') {
    easel.workTicksRemaining = Math.max(0, easel.workTicksRemaining - 1);
    easel.progress = 1 - easel.workTicksRemaining / Math.max(1, getActiveRecipeTicks(easel, bills));
    if (easel.workTicksRemaining > 0 && easel.workTicksRemaining % 30 === 0) {
      deps.onCowHammer(pos);
    }
    if (easel.workTicksRemaining <= 0) {
      finishPaint(world, grid, cowId, easelId, easel, bills, ctx.tick, deps);
      board.complete(jobId);
      awardXp(world, cowId, 'crafting', XP_PER_WORK);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Total workTicks of the active bill on the easel. Used only for the
 * progress display; falls back to 1 if the bill vanished (keeps the ratio
 * bounded and the UI sane).
 *
 * @param {{ activeBillId: number }} easel
 * @param {{ list: import('../world/recipes.js').Bill[] }} bills
 */
function getActiveRecipeTicks(easel, bills) {
  const bill = bills.list.find((b) => b.id === easel.activeBillId);
  if (!bill) return 1;
  const recipe = RECIPES[bill.recipeId];
  return recipe?.workTicks ?? 1;
}

/**
 * Spawn a Painting entity on the easel's own tile (an Item stack of kind
 * 'painting', count 1). Bumps bill.done, clears activeBillId and
 * artistCowId so the next bill can start on the next tick.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} cowId
 * @param {number} easelId
 * @param {{ activeBillId: number, artistCowId: number, workTicksRemaining: number, startTick: number, progress: number }} easel
 * @param {{ list: import('../world/recipes.js').Bill[] }} bills
 * @param {number} tick
 * @param {BrainDeps} deps
 */
function finishPaint(world, grid, cowId, easelId, easel, bills, tick, deps) {
  const bill = bills.list.find((b) => b.id === easel.activeBillId);
  const anchor = world.get(easelId, 'TileAnchor');
  easel.activeBillId = 0;
  easel.artistCowId = 0;
  easel.workTicksRemaining = 0;
  easel.progress = 0;
  easel.startTick = 0;
  if (!bill || !anchor) return;
  const recipe = RECIPES[bill.recipeId];
  if (!recipe) return;
  bill.done += 1;
  const size = PAINTING_SIZE_BY_RECIPE[bill.recipeId] ?? 1;
  const seed = (tick * 1000 + cowId) | 0;
  const spec = generatePainting(seed, size);
  const artistName =
    /** @type {{ name?: string } | null} */ (world.get(cowId, 'Brain'))?.name ?? 'cow';
  const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
  world.spawn({
    Item: { kind: 'painting', count: 1, capacity: 1, forbidden: false },
    Painting: {
      size,
      title: spec.title,
      palette: spec.palette,
      shapes: spec.shapes,
      quality: 'normal',
      artistCowId: cowId,
      artistName,
      easelI: anchor.i,
      easelJ: anchor.j,
      startTick: easel.startTick | 0,
      finishTick: tick,
    },
    PaintingViz: {},
    TileAnchor: { i: anchor.i, j: anchor.j },
    Position: { x: w.x, y: grid.getElevation(anchor.i, anchor.j), z: w.z },
  });
  deps.onItemChange();
}

/**
 * Manned cook state machine — structurally mirrors runPaintJob. Quality was
 * rolled at craft start (makeStoveSystem) so the meal's stack-identity tuple
 * is fixed before this job ever runs.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {(g: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ tick: number }} ctx
 * @param {BrainDeps} deps
 */
function runCookJob(world, cowId, job, path, pos, grid, paths, walkable, board, ctx, deps) {
  const { stoveId, jobId } = /** @type {{ stoveId: number, jobId: number }} */ (job.payload);
  const stove = world.get(stoveId, 'Stove');
  const bills = world.get(stoveId, 'Bills');
  const boardJob = board.get(jobId);

  if (!stove || !bills || !boardJob || boardJob.completed || stove.activeBillId === 0) {
    if (boardJob && !boardJob.completed) board.release(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  const lock = boardJob.payload.lockedCowId | 0 || stove.cookCowId | 0;
  if (lock > 0 && lock !== cowId) {
    board.release(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const target = { i: stove.workI, j: stove.workJ };
    const route = paths.find(start, target);
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
      if (stove.cookCowId === 0) stove.cookCowId = cowId;
      boardJob.payload.lockedCowId = cowId;
      if (stove.startTick === 0) stove.startTick = ctx.tick;
      job.state = 'cooking';
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'cooking') {
    stove.workTicksRemaining = Math.max(0, stove.workTicksRemaining - 1);
    stove.progress = 1 - stove.workTicksRemaining / Math.max(1, getActiveRecipeTicks(stove, bills));
    if (stove.workTicksRemaining > 0 && stove.workTicksRemaining % 30 === 0) {
      deps.onCowHammer(pos);
    }
    if (stove.workTicksRemaining <= 0) {
      finishCook(world, grid, stoveId, stove, bills, deps);
      board.complete(jobId);
      awardXp(world, cowId, 'cooking', XP_PER_WORK);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * Spawn the meal stack on the stove's anchor tile, then clear the active
 * craft slot so the next bill can start. Quality + ingredient kinds were
 * latched at craft start; they ride onto the Item so stack-identity sorts
 * gourmet/yucky batches apart.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} stoveId
 * @param {{ activeBillId: number, cookCowId: number, workTicksRemaining: number, progress: number, startTick: number, mealQuality: string, mealIngredients: string[] }} stove
 * @param {{ list: import('../world/recipes.js').Bill[] }} bills
 * @param {BrainDeps} deps
 */
function finishCook(world, grid, stoveId, stove, bills, deps) {
  const bill = bills.list.find((b) => b.id === stove.activeBillId);
  const anchor = world.get(stoveId, 'TileAnchor');
  // stove.js pre-rolled quality without knowing the cook; re-roll now so the
  // actual cook's skill actually affects the meal.
  const quality =
    stove.cookCowId > 0 ? rollQuality(cookingSkillFor(world, stove.cookCowId)) : stove.mealQuality;
  const ingredients = stove.mealIngredients.slice();
  stove.activeBillId = 0;
  stove.cookCowId = 0;
  stove.workTicksRemaining = 0;
  stove.progress = 0;
  stove.startTick = 0;
  stove.mealQuality = '';
  stove.mealIngredients = [];
  if (!bill || !anchor) return;
  const recipe = RECIPES[bill.recipeId];
  if (!recipe) return;
  bill.done += 1;
  addItemsToTile(world, grid, recipe.outputKind, recipe.outputCount, anchor.i, anchor.j, {
    quality,
    ingredients,
  });
  deps.onItemChange();
}

/** Fixed work-tick cost for installing or uninstalling wall art. */
const INSTALL_TICKS = 45;

/**
 * Install job state machine. Fetch the painting item from its tile, carry it
 * to the workspot adjacent to the target wall, then swap it for a WallArt
 * entity mounted on that wall face.
 *
 * The painting's metadata is stashed into `job.payload.art` at pickup time so
 * the Item entity can be despawned without losing title/palette/attribution.
 * On install we spawn a fresh WallArt from that snapshot.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {{ items: { kind: string, count: number }[] }} inv
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {BrainDeps} deps
 */
function runInstallJob(world, job, path, pos, inv, grid, paths, board, deps) {
  const { jobId, itemId, anchorI, anchorJ, workI, workJ, face, size } =
    /** @type {{ jobId: number, itemId: number, anchorI: number, anchorJ: number, workI: number, workJ: number, face: number, size: number }} */ (
      job.payload
    );

  // Any wall in the span missing → abort. Restore the painting if we're
  // already carrying its metadata so the player doesn't lose the artwork.
  if (!allWallsIntact(grid, anchorI, anchorJ, face, size)) {
    const carried = /** @type {any} */ (job.payload.art);
    if (carried) {
      spawnPaintingFromSnapshot(world, grid, pos, carried);
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
    const item = world.get(itemId, 'Item');
    const painting = world.get(itemId, 'Painting');
    const anchor = world.get(itemId, 'TileAnchor');
    if (!item || !painting || !anchor || item.forbidden === true) {
      board.release(jobId);
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
      const painting = world.get(itemId, 'Painting');
      if (!item || !painting || item.count <= 0) {
        board.complete(jobId);
        job.kind = 'none';
        job.state = 'idle';
        job.payload = {};
        return;
      }
      // Snapshot painting metadata onto the job before despawning the Item
      // so the WallArt spawn on completion can clone it all back.
      job.payload.art = snapshotPainting(painting);
      item.count -= 1;
      if (item.count <= 0) world.despawn(itemId);
      deps.onItemChange();
      job.state = 'pathing-to-wall';
    }
    return;
  }

  if (job.state === 'pathing-to-wall') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const route = paths.find(start, { i: workI, j: workJ });
    if (!route || route.length === 0) {
      const carried = /** @type {any} */ (job.payload.art);
      if (carried) {
        spawnPaintingFromSnapshot(world, grid, pos, carried);
        deps.onItemChange();
      }
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    path.steps = route;
    path.index = 0;
    job.state = 'walking-to-wall';
    return;
  }

  if (job.state === 'walking-to-wall') {
    if (path.index >= path.steps.length) {
      job.state = 'installing';
      job.payload.ticksRemaining = INSTALL_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'installing') {
    const remaining = (job.payload.ticksRemaining ?? INSTALL_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    if (remaining > 0 && remaining % 15 === 0) {
      deps.onCowHammer(pos);
    }
    if (remaining <= 0) {
      const art = /** @type {any} */ (job.payload.art);
      if (art) {
        const w = tileToWorld(anchorI, anchorJ, grid.W, grid.H);
        world.spawn({
          WallArt: {
            face,
            size,
            title: art.title,
            palette: art.palette,
            shapes: art.shapes,
            quality: art.quality,
            artistCowId: art.artistCowId,
            artistName: art.artistName,
            easelI: art.easelI,
            easelJ: art.easelJ,
            startTick: art.startTick,
            finishTick: art.finishTick,
            uninstallJobId: 0,
            progress: 0,
          },
          WallArtViz: {},
          TileAnchor: { i: anchorI, j: anchorJ },
          Position: { x: w.x, y: grid.getElevation(anchorI, anchorJ), z: w.z },
        });
        deps.onItemChange();
      }
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
    // Inventory is unused for the paint-carry — cow is empty-handed.
    void inv;
  }
}

/**
 * Uninstall job state machine. Walk to the workspot of a WallArt, pry it off
 * the wall, and spawn a painting Item at the workspot tile. The WallArt's
 * metadata is preserved onto the new painting so the piece keeps its
 * attribution + size across install/uninstall cycles.
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
function runUninstallJob(world, job, path, pos, grid, paths, board, deps) {
  const { jobId, wallArtId, workI, workJ } =
    /** @type {{ jobId: number, wallArtId: number, workI: number, workJ: number }} */ (job.payload);
  const art = world.get(wallArtId, 'WallArt');
  const anchor = world.get(wallArtId, 'TileAnchor');
  if (!art || !anchor) {
    board.complete(jobId);
    job.kind = 'none';
    job.state = 'idle';
    job.payload = {};
    path.steps = [];
    path.index = 0;
    return;
  }

  if (job.state === 'pathing') {
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const route = paths.find(start, { i: workI, j: workJ });
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
      job.state = 'prying';
      job.payload.ticksRemaining = INSTALL_TICKS;
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'prying') {
    const remaining = (job.payload.ticksRemaining ?? INSTALL_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    art.progress = 1 - remaining / INSTALL_TICKS;
    if (remaining > 0 && remaining % 15 === 0) {
      deps.onCowHammer(pos);
    }
    if (remaining <= 0) {
      const snapshot = snapshotPainting({
        size: art.size,
        title: art.title,
        palette: art.palette,
        shapes: art.shapes,
        quality: art.quality,
        artistCowId: art.artistCowId,
        artistName: art.artistName,
        easelI: art.easelI,
        easelJ: art.easelJ,
        startTick: art.startTick,
        finishTick: art.finishTick,
      });
      world.despawn(wallArtId);
      const w = tileToWorld(workI, workJ, grid.W, grid.H);
      const tempPos = { x: w.x, y: grid.getElevation(workI, workJ), z: w.z };
      spawnPaintingFromSnapshot(world, grid, tempPos, snapshot);
      deps.onItemChange();
      board.complete(jobId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/**
 * True if every wall tile in the `size`-long span starting at (anchorI, anchorJ)
 * extending in the FACING's perpendicular direction is still a built wall.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} anchorI @param {number} anchorJ
 * @param {number} face @param {number} size
 */
function allWallsIntact(grid, anchorI, anchorJ, face, size) {
  const step = FACING_SPAN_OFFSETS[face] ?? FACING_SPAN_OFFSETS[0];
  for (let k = 0; k < size; k++) {
    const wi = anchorI + step.di * k;
    const wj = anchorJ + step.dj * k;
    if (!grid.inBounds(wi, wj)) return false;
    if (!grid.isFullWall(wi, wj)) return false;
  }
  return true;
}

/**
 * Freeze a Painting component's metadata into a plain object so it survives
 * the source entity's despawn. Palette/shapes arrays are shallow-copied so
 * later mutation of the original can't leak into the snapshot.
 *
 * @param {{ size: number, title: string, palette: string[], shapes: any[], quality: string, artistCowId: number, artistName: string, easelI: number, easelJ: number, startTick: number, finishTick: number }} p
 */
function snapshotPainting(p) {
  return {
    size: p.size,
    title: p.title,
    palette: p.palette.slice(),
    shapes: p.shapes.slice(),
    quality: p.quality,
    artistCowId: p.artistCowId,
    artistName: p.artistName,
    easelI: p.easelI,
    easelJ: p.easelJ,
    startTick: p.startTick,
    finishTick: p.finishTick,
  };
}

/**
 * Spawn a painting Item at the nearest tile to `pos`, clothed in the snapshot's
 * attribution + palette. Used when an install job aborts mid-flight (cow was
 * carrying a painting and the wall went away) so the art isn't lost.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {{ x: number, y: number, z: number }} pos
 * @param {ReturnType<typeof snapshotPainting>} snapshot
 */
function spawnPaintingFromSnapshot(world, grid, pos, snapshot) {
  const tile = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
  const w = tileToWorld(tile.i, tile.j, grid.W, grid.H);
  world.spawn({
    Item: { kind: 'painting', count: 1, capacity: 1, forbidden: false },
    Painting: { ...snapshot },
    PaintingViz: {},
    TileAnchor: { i: tile.i, j: tile.j },
    Position: { x: w.x, y: grid.getElevation(tile.i, tile.j), z: w.z },
  });
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
 * True when the target station entity still exists and its work spot is still
 * (i, j). Checks Furnace then Easel then Stove — supply jobs target whichever
 * station posted them. If the station was deconstructed mid-haul, the supply
 * job no longer has a valid drop target.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number | undefined} furnaceId
 * @param {number | undefined} easelId
 * @param {number | undefined} stoveId
 * @param {number} i @param {number} j
 */
function stationWorkSpotMatches(world, furnaceId, easelId, stoveId, i, j) {
  if (typeof furnaceId === 'number') {
    const f = world.get(furnaceId, 'Furnace');
    if (f !== undefined && f.workI === i && f.workJ === j) return true;
  }
  if (typeof easelId === 'number') {
    const e = world.get(easelId, 'Easel');
    if (e !== undefined && e.workI === i && e.workJ === j) return true;
  }
  if (typeof stoveId === 'number') {
    const s = world.get(stoveId, 'Stove');
    if (s !== undefined && s.workI === i && s.workJ === j) return true;
  }
  return false;
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
 * Works on both raw food (`rawFood`-tagged kinds) and cooked meals (`kind === 'meal'`).
 * Meals apply a quality-scaled nutrition multiplier and may inflict food
 * poisoning on lower-tier dishes — see world/quality.js for the table.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {{ value: number }} hunger
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {BrainDeps} deps
 * @param {number} cowId
 */
function runEatJob(world, job, path, pos, hunger, grid, paths, deps, cowId) {
  const { itemId } = /** @type {{ itemId: number }} */ (job.payload);

  if (job.state === 'pathing-to-food') {
    const item = world.get(itemId, 'Item');
    const anchor = world.get(itemId, 'TileAnchor');
    if (!item || !anchor || item.count <= 0 || !isEdibleKind(item.kind)) {
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
    if (!item || !isEdibleKind(item.kind) || item.count <= 0) {
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    const remaining = (job.payload.ticksRemaining ?? EAT_TICKS) - 1;
    job.payload.ticksRemaining = remaining;
    if (remaining <= 0) {
      const mult = item.kind === 'meal' && item.quality ? nutritionMultiplier(item.quality) : 1;
      hunger.value = Math.min(1, hunger.value + FOOD_NUTRITION * mult);
      if (item.kind === 'meal' && item.quality) {
        const chance = poisoningChance(item.quality);
        if (chance > 0 && Math.random() < chance) {
          const fp = world.get(cowId, 'FoodPoisoning');
          if (fp) fp.ticksRemaining = FOOD_POISONING_DURATION_TICKS;
        }
      }
      item.count -= 1;
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
 * State machine for the self-assigned sleep job: walk to bed → claim it →
 * sleep until satiated. Bails if the bed vanishes mid-trip or gets snatched
 * by another cow. Floor-sleep is a degenerate case with no `bedId` — the cow
 * just sits where it is and restores at half rate.
 *
 * First-time sleep auto-claims ownership: an unowned bed the cow reaches
 * becomes theirs permanently. Matches Rimworld's auto-assign-on-first-use so
 * players don't have to manually pair cows to beds.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ kind: string, state: string, payload: Record<string, any> }} job
 * @param {{ steps: { i: number, j: number }[], index: number }} path
 * @param {{ x: number, y: number, z: number }} pos
 * @param {{ value: number }} tiredness
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../sim/pathfinding.js').PathCache} paths
 * @param {number} cowId
 */
function runSleepJob(world, job, path, pos, tiredness, grid, paths, cowId) {
  const bedId = /** @type {number | undefined} */ (job.payload?.bedId);

  if (job.state === 'pathing-to-bed') {
    const bed = bedId != null ? world.get(bedId, 'Bed') : null;
    const anchor = bedId != null ? world.get(bedId, 'TileAnchor') : null;
    // Bed decon'd or claimed by another cow while we walked? Bail — next
    // decide block will either find a new bed or fall through to wander.
    if (
      !bed ||
      !anchor ||
      bed.deconstructJobId > 0 ||
      (bed.ownerId !== 0 && bed.ownerId !== cowId) ||
      (bed.occupantId !== 0 && bed.occupantId !== cowId)
    ) {
      releaseBedOccupant(world, job, cowId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    // Try every tile in the bed's footprint. A sapling or cow standing on the
    // anchor shouldn't strand the owner when the adjacent mattress tile is
    // still reachable — fall through to the next candidate.
    const start = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
    const footprint = bedFootprintTiles(anchor, bed.facing | 0);
    let chosen = null;
    let route = null;
    for (const t of footprint) {
      if (!grid.inBounds(t.i, t.j)) continue;
      const r = paths.find(start, { i: t.i, j: t.j });
      if (r && r.length > 0) {
        route = r;
        chosen = t;
        break;
      }
    }
    if (!route || !chosen) {
      releaseBedOccupant(world, job, cowId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
      return;
    }
    path.steps = route;
    path.index = 0;
    job.state = 'walking-to-bed';
    job.payload = { bedId, i: chosen.i, j: chosen.j };
    return;
  }

  if (job.state === 'walking-to-bed') {
    if (path.index >= path.steps.length) {
      // Claim the bed now that we're on it. First cow to reach an unowned
      // bed owns it forever; occupantId was reserved at brain-assign time so
      // peers already avoid this mattress for the duration of the sleep.
      const bed = bedId != null ? world.get(bedId, 'Bed') : null;
      if (!bed || bed.deconstructJobId > 0) {
        releaseBedOccupant(world, job, cowId);
        job.kind = 'none';
        job.state = 'idle';
        job.payload = {};
        return;
      }
      if (bed.ownerId === 0) bed.ownerId = cowId;
      bed.occupantId = cowId;
      job.state = 'sleeping';
      path.steps = [];
      path.index = 0;
    }
    return;
  }

  if (job.state === 'sleeping') {
    const onFloor = job.payload?.onFloor === true;
    // Floor-sleepers don't hold a bed — they just restore in place.
    if (!onFloor) {
      const bed = bedId != null ? world.get(bedId, 'Bed') : null;
      // Bed disappeared under us (deconstruct finished)? Wake up.
      if (!bed || bed.deconstructJobId > 0) {
        job.kind = 'none';
        job.state = 'idle';
        job.payload = {};
        return;
      }
    }
    const mult = onFloor ? TIREDNESS_FLOOR_RESTORE_MULT : 1;
    const cap = onFloor ? FLOOR_SATIATED_THRESHOLD : SLEEP_SATIATED_THRESHOLD;
    tiredness.value = Math.min(cap, tiredness.value + TIREDNESS_RESTORE_PER_TICK * mult);
    if (tiredness.value >= cap) {
      if (!onFloor) releaseBedOccupant(world, job, cowId);
      job.kind = 'none';
      job.state = 'idle';
      job.payload = {};
    }
  }
}

/** @param {string} kind */
function isEdibleKind(kind) {
  return itemHasTag(kind, 'rawFood') || kind === 'meal';
}

/** Raw food has no `quality`; sort it between 'unpleasant' and 'decent'. */
const EDIBLE_RANK_RAW = RAW_FOOD_RANK;

/**
 * Pick the edible stack a cow most wants: highest-quality tier first, then
 * nearest Chebyshev distance within that tier. Raw food sits at a fixed rank
 * so ANY tasty+ meal beats a raw crop, but a starving cow still eats raw food
 * when that's all there is.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ i: number, j: number }} near
 */
function findBestFood(world, near) {
  /** @type {{ id: number, i: number, j: number, rank: number, dist: number } | null} */
  let best = null;
  for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
    const it = components.Item;
    if (!isEdibleKind(it.kind) || it.count <= 0 || it.forbidden) continue;
    const a = components.TileAnchor;
    const rank = it.kind === 'meal' && it.quality ? qualityRank(it.quality) : EDIBLE_RANK_RAW;
    const dist = Math.max(Math.abs(a.i - near.i), Math.abs(a.j - near.j));
    if (!best || rank > best.rank || (rank === best.rank && dist < best.dist)) {
      best = { id, i: a.i, j: a.j, rank, dist };
    }
  }
  return best;
}

/**
 * Pick a bed for a tired cow: owned-by-me beds win (cows remember their own
 * mattress), then unowned + unoccupied beds by nearest Chebyshev distance.
 * A bed still under construction has no Bed component yet, so blueprints are
 * automatically excluded.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 * @param {{ i: number, j: number }} near
 */
function findBestBed(world, cowId, near) {
  /** @type {{ id: number, i: number, j: number, owned: boolean, dist: number } | null} */
  let best = null;
  for (const { id, components } of world.query(['Bed', 'TileAnchor'])) {
    const b = components.Bed;
    // Skip beds mid-deconstruct — don't send a cow to sleep on something that's
    // about to be torn down and its tiles freed for walkability.
    if (b.deconstructJobId > 0) continue;
    const ownedByMe = b.ownerId === cowId;
    // Someone else's bed, or someone is currently asleep in it.
    if (!ownedByMe && b.ownerId !== 0) continue;
    if (b.occupantId !== 0 && b.occupantId !== cowId) continue;
    const a = components.TileAnchor;
    const dist = Math.max(Math.abs(a.i - near.i), Math.abs(a.j - near.j));
    if (!best || (ownedByMe && !best.owned) || (ownedByMe === best.owned && dist < best.dist)) {
      best = { id, i: a.i, j: a.j, owned: ownedByMe, dist };
    }
  }
  return best;
}

/**
 * Clear the occupantId on a bed the cow is currently sleeping in. Called when
 * a sleep job ends for any reason — completed, preempted, drafted, etc.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ payload: Record<string, any> }} job
 * @param {number} cowId
 */
function releaseBedOccupant(world, job, cowId) {
  const bedId = job.payload?.bedId;
  if (!bedId) return;
  const bed = world.get(bedId, 'Bed');
  if (bed && bed.occupantId === cowId) bed.occupantId = 0;
}

/**
 * Reserve a bed at brain-assign time so peers that re-decide on the same tick
 * don't pick the same mattress. findBestBed skips beds with a non-zero
 * occupantId — set it before the cow has even started walking.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} bedId
 * @param {number} cowId
 */
function reserveBed(world, bedId, cowId) {
  const bed = world.get(bedId, 'Bed');
  if (bed) bed.occupantId = cowId;
}

/** @param {import('../ecs/world.js').World} world */
function hasAnyFood(world) {
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const it = components.Item;
    if (isEdibleKind(it.kind) && it.count > 0 && !it.forbidden) return true;
  }
  return false;
}

/**
 * Spawn ground Items at the cow's current tile for everything in Inventory
 * and clear it. Caller is responsible for calling deps.onItemChange().
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {{ items: { kind: string, count: number }[] }} inv
 * @param {{ x: number, y: number, z: number }} pos
 */
function dropCarriedItem(world, grid, inv, pos) {
  if (inv.items.length === 0) return;
  const { i, j } = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
  for (const stack of inv.items) {
    addItemsToTile(world, grid, stack.kind, stack.count, i, j);
  }
  inv.items.length = 0;
}

/**
 * Zero the source-stack claim post-pickup on both the cow's local payload and
 * the board's record. The cow's Job.payload is built as a fresh object at
 * claim time, so posters and the prioritize menu (which read from board.jobs)
 * need the board's count nulled separately or they'll keep seeing the cow's
 * full original claim and either re-target her job or skip a free remainder.
 *
 * @param {{ payload: Record<string, any> }} job
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {number} jobId
 */
function releaseHaulClaim(job, board, jobId) {
  job.payload.count = 0;
  const boardJob = board.get(jobId);
  if (boardJob) boardJob.payload.count = 0;
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
  const { grid, tileWorld } = deps;
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
        const curLayer = tileWorld?.layers[curStep.z | 0] ?? grid;
        const nextLayer = nextStep ? (tileWorld?.layers[nextStep.z | 0] ?? grid) : null;
        const curBlocked = !deps.walkable(curLayer, curStep.i, curStep.j);
        const nextBlocked =
          nextStep && nextLayer && !deps.walkable(nextLayer, nextStep.i, nextStep.j);
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
        const stepZ = step.z | 0;
        const target = tileToWorld(step.i, step.j, grid.W, grid.H);
        const targetY = grid.getElevation(step.i, step.j) + stepZ * LAYER_HEIGHT;
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < ARRIVE_DIST_SQ) {
          path.index++;
          pos.y = targetY;
          const brain = world.get(id, 'Brain');
          if (brain) brain.layerZ = stepZ;
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
        // don't float when crossing terrain. Adjacent tiles one TERRAIN_STEP
        // (0.75m) higher/lower play a short hop — sine arc, 65% speed — so a
        // ramp still wins on speed. Two-step (1.5m) neighbours are a climb:
        // cows crawl at 10% speed and the arc stretches out so a ramp is
        // obviously faster. Pathfinder rejects anything taller (see CLIMB_MAX
        // in pathfinding.js), so we don't need to guard it here.
        const cur = worldToTileClamp(pos.x, pos.z, grid.W, grid.H);
        if (grid.inBounds(cur.i, cur.j)) {
          const cowZ = world.get(id, 'Brain')?.layerZ | 0;
          const curElev = grid.getElevation(cur.i, cur.j) + cowZ * LAYER_HEIGHT;
          const dElev = targetY - curElev;
          const absD = Math.abs(dElev);
          const climbing = absD >= TERRAIN_STEP * 1.5;
          const hopping = !climbing && absD > TERRAIN_STEP * 0.5;
          if (hopping || climbing) {
            const curCenter = tileToWorld(cur.i, cur.j, grid.W, grid.H);
            const totalLen = Math.hypot(target.x - curCenter.x, target.z - curCenter.z);
            const progress = totalLen > 0.0001 ? Math.max(0, Math.min(1, 1 - dist / totalLen)) : 1;
            const arcScale = climbing ? 0.55 : 0.35;
            const bump = Math.sin(progress * Math.PI) * TERRAIN_STEP * arcScale;
            pos.y = curElev + dElev * progress + bump;
            speed *= climbing ? 0.1 : 0.65;
          } else {
            pos.y = curElev;
          }
          // Finished floor tiles are full speed; bare terrain drags to 85%.
          // Applied before the darkness check so both stack multiplicatively.
          if (!grid.isFloor(cur.i, cur.j)) speed *= 0.85;
          // Half speed on dim tiles (<40% light) — cows stumble in the dark.
          if (grid.getLight(cur.i, cur.j) < DARK_LIGHT_BYTE) speed *= 0.5;
          // Wading through shallow water: 15% speed.
          if (grid.biome[grid.idx(cur.i, cur.j)] === BIOME.SHALLOW_WATER) speed *= 0.15;
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
      const baseDrain = HUNGER_DRAIN_PER_TICK * 8;
      for (const { components } of world.query(['Hunger', 'FoodPoisoning', 'Brain'])) {
        const h = components.Hunger;
        const fp = components.FoodPoisoning;
        const poisoned = fp.ticksRemaining > 0;
        const drain = poisoned ? baseDrain * HUNGER_DRAIN_POISONED_MULT : baseDrain;
        h.value = Math.max(0, h.value - drain);
        if (poisoned) fp.ticksRemaining = Math.max(0, fp.ticksRemaining - 8);
        // Wake the brain when the cow is (or just became) hungry enough to
        // want food. The gate in cowBrain stays closed otherwise.
        if (h.value < HUNGER_EAT_THRESHOLD) {
          components.Brain.vitalsDirty = true;
        }
      }
    },
  };
}

/** @returns {import('../ecs/schedule.js').SystemDef} */
export function makeTirednessSystem() {
  return {
    name: 'tirednessDrain',
    tier: 'rare',
    run(world) {
      const drain = TIREDNESS_DRAIN_PER_TICK * 8;
      for (const { components } of world.query(['Tiredness', 'Brain'])) {
        const t = components.Tiredness;
        t.value = Math.max(0, t.value - drain);
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
      for (const { id, components } of world.query(['Cow', 'Position', 'PrevPosition'])) {
        const p = components.Position;
        const pp = components.PrevPosition;
        // Cows on z>0 legitimately stand on wall-tops; base-grid isWall is a
        // floor surface for them, not an obstacle. Skip collision so they can
        // walk across upper layers.
        const layerZ = world.get(id, 'Brain')?.layerZ | 0;
        if (layerZ > 0) continue;
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
