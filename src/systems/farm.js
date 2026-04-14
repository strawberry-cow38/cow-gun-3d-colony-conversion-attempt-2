/**
 * Farm posting system. Rare-tier: scans the grid for zoned-but-untilled tiles
 * and posts `till` jobs for any that don't already have one open. Dedupes via
 * a set of tile indices built from the board's open till jobs at the top of
 * each tick.
 */

/**
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeFarmPostingSystem(board, grid) {
  /** @type {Set<number>} */
  const pendingTill = new Set();
  return {
    name: 'farmPoster',
    tier: 'rare',
    run() {
      pendingTill.clear();
      for (const j of board.jobs) {
        if (j.completed || j.kind !== 'till') continue;
        pendingTill.add(grid.idx(j.payload.i, j.payload.j));
      }
      for (let j = 0; j < grid.H; j++) {
        for (let i = 0; i < grid.W; i++) {
          if (grid.getFarmZone(i, j) === 0) continue;
          if (grid.isTilled(i, j)) continue;
          // Defence in depth: the designator already refuses to zone a
          // blocked tile, but a tree could grow (future) or the tile could
          // get walled around it, so skip anything unreachable.
          if (grid.isBlocked(i, j)) continue;
          const idx = grid.idx(i, j);
          if (pendingTill.has(idx)) continue;
          board.post('till', { i, j });
          pendingTill.add(idx);
        }
      }
    },
  };
}
