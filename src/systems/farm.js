/**
 * Farm posting system. Rare-tier. Three passes over the grid per run:
 *   1. `till`    on zoned-but-untilled tiles
 *   2. `plant`   on tilled + zoned tiles with no Crop yet
 *   3. `harvest` on Crop entities that have reached full growth
 *
 * Each pass dedupes against open board jobs of its own kind so a single tile
 * never stacks duplicate postings. Crops live on tilled tiles, so the harvest
 * pass iterates the Crop entity set directly instead of sweeping the grid.
 */

import { cropIsReady } from '../world/crops.js';

/**
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../ecs/world.js').World} world
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeFarmPostingSystem(board, grid, world) {
  /** @type {Set<number>} */
  const pendingTill = new Set();
  /** @type {Set<number>} */
  const pendingPlant = new Set();
  /** @type {Set<number>} */
  const pendingHarvest = new Set();
  /** @type {Set<number>} */
  const occupiedByCrop = new Set();
  return {
    name: 'farmPoster',
    tier: 'rare',
    run() {
      pendingTill.clear();
      pendingPlant.clear();
      pendingHarvest.clear();
      occupiedByCrop.clear();
      for (const j of board.jobs) {
        if (j.completed) continue;
        if (j.kind === 'till') pendingTill.add(grid.idx(j.payload.i, j.payload.j));
        else if (j.kind === 'plant') pendingPlant.add(grid.idx(j.payload.i, j.payload.j));
        else if (j.kind === 'harvest') pendingHarvest.add(grid.idx(j.payload.i, j.payload.j));
      }
      // Single crop sweep: note tile occupancy AND post harvest jobs for ready
      // crops in one pass. Scanning the Crop query twice here was both slower
      // and a foot-gun if the two passes ever saw mismatched snapshots.
      for (const { id, components } of world.query(['Crop', 'TileAnchor'])) {
        const a = components.TileAnchor;
        const idx = grid.idx(a.i, a.j);
        occupiedByCrop.add(idx);
        const c = components.Crop;
        if (!cropIsReady(c.kind, c.growthTicks)) continue;
        if (pendingHarvest.has(idx)) continue;
        board.post('harvest', { cropId: id, i: a.i, j: a.j });
        pendingHarvest.add(idx);
      }
      for (let j = 0; j < grid.H; j++) {
        for (let i = 0; i < grid.W; i++) {
          if (grid.getFarmZone(i, j) === 0) continue;
          // Defence in depth: the designator already refuses to zone a
          // blocked tile, but a tree could grow (future) or the tile could
          // get walled around it, so skip anything unreachable.
          if (grid.isBlocked(i, j)) continue;
          const idx = grid.idx(i, j);
          if (!grid.isTilled(i, j)) {
            if (pendingTill.has(idx)) continue;
            board.post('till', { i, j });
            pendingTill.add(idx);
            continue;
          }
          if (occupiedByCrop.has(idx)) continue;
          if (pendingPlant.has(idx)) continue;
          board.post('plant', { i, j });
          pendingPlant.add(idx);
        }
      }
    },
  };
}
