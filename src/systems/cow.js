/**
 * Cow brain + path-follow + hunger systems (Phase 3).
 *
 * Brain (every tick): if Job.kind === 'none', synthesize a Wander goal. Run the
 * job's state machine. Wander: planning → moving → idle → planning.
 *
 * PathFollow (every tick): for any cow with a Path, point Velocity toward the
 * world position of the next path step. When close enough, advance the index.
 * When the path is exhausted, zero velocity (the brain's job-state will notice).
 *
 * Hunger (rare tier): drain Hunger.value at a rate of 1 / (one-day-in-ticks).
 * Cosmetic in Phase 3 — Phase 4 wires it into the Eat job.
 */

import { WANDER_IDLE_TICKS, pickRandomWalkable } from '../jobs/wander.js';
import { TILE_SIZE, tileToWorld } from '../world/coords.js';

const COW_SPEED_UNITS_PER_SEC = 85.7; // ≈2 tiles/sec at 1.5m tile
const ARRIVE_DIST_SQ = 4 * 4; // within 4 units of a step center counts as arrived
const HUNGER_DRAIN_PER_TICK = 1 / 43200; // empties over one in-game day

/**
 * @typedef CowDeps
 * @property {import('../world/tileGrid.js').TileGrid} grid
 * @property {import('../sim/pathfinding.js').PathCache} paths
 * @property {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 */

/**
 * @param {CowDeps} deps
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeCowBrainSystem(deps) {
  const { grid, paths, walkable } = deps;
  return {
    name: 'cowBrain',
    tier: 'every',
    run(world, ctx) {
      for (const { components } of world.query(['Cow', 'Position', 'Job', 'Path'])) {
        const job = components.Job;
        const path = components.Path;
        const pos = components.Position;

        if (job.kind === 'none') {
          job.kind = 'wander';
          job.state = 'planning';
          job.payload = {};
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
            const { i: si, j: sj } = nearestTile(pos.x, pos.z, grid.W, grid.H);
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
 * @param {CowDeps} deps
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
        const cur = nearestTile(pos.x, pos.z, grid.W, grid.H);
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

/**
 * Same as worldToTile but clamps to grid edges instead of returning (-1,-1) so
 * a cow that briefly drifts off-grid during steering still resolves to a tile.
 * @param {number} x @param {number} z @param {number} W @param {number} H
 */
function nearestTile(x, z, W, H) {
  const i = Math.floor(x / TILE_SIZE + W / 2);
  const j = Math.floor(z / TILE_SIZE + H / 2);
  return { i: Math.max(0, Math.min(W - 1, i)), j: Math.max(0, Math.min(H - 1, j)) };
}

export const COW_CONSTANTS = {
  COW_SPEED_UNITS_PER_SEC,
  HUNGER_DRAIN_PER_TICK,
};
