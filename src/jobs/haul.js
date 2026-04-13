/**
 * Haul job plumbing.
 *
 * Posts a `haul` job for each loose Item that isn't already sitting on a
 * stockpile tile and isn't already targeted by an open haul job. Each job
 * reserves a specific stockpile tile as its drop target, so two cows can't
 * race to deposit on the same slot.
 *
 * Payload:
 *   { itemId, fromI, fromJ, toI, toJ }
 *
 * PICKUP_TICKS / DROP_TICKS give the cow a brief pause when interacting so
 * the motion reads as a real action instead of a teleport.
 */

export const PICKUP_TICKS = 12;
export const DROP_TICKS = 9;

/**
 * Build a {tileIdx → true} set of stockpile tiles already occupied by an Item
 * or reserved as a haul drop target. Used when picking a free slot.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('./board.js').JobBoard} board
 */
export function buildStockpileReservations(world, grid, board) {
  const reserved = new Uint8Array(grid.W * grid.H);
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    if (grid.isStockpile(a.i, a.j)) reserved[grid.idx(a.i, a.j)] = 1;
  }
  for (const j of board.jobs) {
    if (j.completed || j.kind !== 'haul') continue;
    const { toI, toJ } = /** @type {{ toI: number, toJ: number }} */ (j.payload);
    if (grid.inBounds(toI, toJ)) reserved[grid.idx(toI, toJ)] = 1;
  }
  return reserved;
}

/**
 * Build a Set of item entity IDs already targeted by an open haul job so we
 * don't double-post.
 *
 * @param {import('./board.js').JobBoard} board
 */
export function buildHaulItemSet(board) {
  /** @type {Set<number>} */
  const out = new Set();
  for (const j of board.jobs) {
    if (j.completed || j.kind !== 'haul') continue;
    out.add(j.payload.itemId);
  }
  return out;
}

/**
 * Find the nearest empty+unreserved stockpile tile by Chebyshev distance from
 * (i, j). Returns null if none left.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Uint8Array} reserved
 * @param {number} i @param {number} j
 */
export function findNearestFreeStockpileTile(grid, reserved, i, j) {
  let best = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let jj = 0; jj < grid.H; jj++) {
    for (let ii = 0; ii < grid.W; ii++) {
      if (!grid.isStockpile(ii, jj)) continue;
      const idx = grid.idx(ii, jj);
      if (reserved[idx]) continue;
      const d = Math.max(Math.abs(ii - i), Math.abs(jj - j));
      if (d < bestD) {
        bestD = d;
        best = { i: ii, j: jj };
      }
    }
  }
  return best;
}

/**
 * Rare-tier system: scan items missing a stockpile home, post haul jobs.
 * Cheap — only runs on rare tier (every 8 ticks) and inner loops bail fast.
 *
 * @param {import('./board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeHaulPostingSystem(board, grid) {
  return {
    name: 'haulPoster',
    tier: 'rare',
    run(world) {
      const reserved = buildStockpileReservations(world, grid, board);
      const targeted = buildHaulItemSet(board);
      for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
        if (targeted.has(id)) continue;
        const a = components.TileAnchor;
        // Already on a stockpile — no haul needed.
        if (grid.isStockpile(a.i, a.j)) continue;
        const target = findNearestFreeStockpileTile(grid, reserved, a.i, a.j);
        if (!target) return; // no free slots anywhere, stop scanning this tick
        reserved[grid.idx(target.i, target.j)] = 1;
        board.post('haul', {
          itemId: id,
          fromI: a.i,
          fromJ: a.j,
          toI: target.i,
          toJ: target.j,
        });
      }
    },
  };
}
