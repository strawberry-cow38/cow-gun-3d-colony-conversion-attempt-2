/**
 * Two passes that keep loose Items in a legal state:
 *
 *  Pass 1 — move items off blocked tiles to a cardinal-adjacent walkable tile
 *           so the haul poster can route a cow to them. Most commonly fires
 *           when a building is placed on top of an existing stack.
 *
 *  Pass 2 — one stack per tile, count ≤ maxStack. Detects tiles holding
 *           multiple stacks or a single over-cap stack (e.g. addItemsToTile
 *           dropping a 30+15 stone pile) and spreads the excess into
 *           neighbor tiles. Same-kind same-forbidden spills merge into an
 *           existing neighbor stack with room; leftovers spawn on empty
 *           neighbors. If no neighbor has room this tick we make partial
 *           progress and retry on the next rare tick.
 *
 *  Why: the supply/haul posters assume a tile has at most one stack per kind.
 *  Multi-stack tiles cause cows to ping-pong — the haul poster picks a
 *  different loose stack for the same supply job on each rare tick.
 */

import { findAdjacentWalkable } from '../jobs/chop.js';
import { tileToWorld } from '../world/coords.js';
import { maxStack } from '../world/items.js';

/** 8-neighbor offsets used when looking for a spill target. */
const NBRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {() => void} [onRelocated]  fires (once) on any tick that moved an
 *   item so callers can flag the item instancer dirty.
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeItemRescueSystem(grid, onRelocated) {
  const walkable = (
    /** @type {import('../world/tileGrid.js').TileGrid} */ g,
    /** @type {number} */ i,
    /** @type {number} */ j,
  ) => !g.isBlocked(i, j);
  return {
    name: 'itemRescue',
    tier: 'rare',
    run(world) {
      let any = false;

      // Combined sweep: do the Pass 1 blocked→walkable relocation in-place,
      // then bucket every still-reachable item by tile for the Pass 2 spread.
      /** @type {Map<number, { id: number, item: any, anchor: any }[]>} */
      const byTile = new Map();
      for (const { id, components } of world.query(['Item', 'TileAnchor', 'Position'])) {
        const a = components.TileAnchor;
        if (grid.isBlocked(a.i, a.j)) {
          const adj = findAdjacentWalkable(grid, walkable, a.i, a.j);
          if (!adj) continue;
          a.i = adj.i;
          a.j = adj.j;
          const w = tileToWorld(adj.i, adj.j, grid.W, grid.H);
          const p = components.Position;
          p.x = w.x;
          p.y = grid.getElevation(adj.i, adj.j);
          p.z = w.z;
          any = true;
        }
        const idx = grid.idx(a.i, a.j);
        let list = byTile.get(idx);
        if (!list) {
          list = [];
          byTile.set(idx, list);
        }
        list.push({ id, item: components.Item, anchor: a });
      }

      // Snapshot before spilling: the whole-entity branch below inserts new
      // keys into byTile, and Map iterators visit late-added entries.
      const tileLists = [...byTile.values()];
      for (const list of tileLists) {
        const multi = list.length > 1;
        const over = list.some((e) => e.item.count > maxStack(e.item.kind));
        if (!multi && !over) continue;

        list.sort((a, b) => b.item.count - a.item.count || a.id - b.id);
        const primary = list[0];
        const primaryCap = maxStack(primary.item.kind);

        /** @type {{ sourceId: number, sourceItem: any, kind: string, forbidden: boolean, cap: number, toMove: number }[]} */
        const spills = [];
        if (primary.item.count > primaryCap) {
          spills.push({
            sourceId: primary.id,
            sourceItem: primary.item,
            kind: primary.item.kind,
            forbidden: primary.item.forbidden,
            cap: primaryCap,
            toMove: primary.item.count - primaryCap,
          });
        }
        for (let k = 1; k < list.length; k++) {
          const e = list[k];
          spills.push({
            sourceId: e.id,
            sourceItem: e.item,
            kind: e.item.kind,
            forbidden: e.item.forbidden,
            cap: maxStack(e.item.kind),
            toMove: e.item.count,
          });
        }

        const ci = primary.anchor.i;
        const cj = primary.anchor.j;
        for (const spill of spills) {
          while (spill.toMove > 0) {
            const target = findSpillTarget(
              grid,
              byTile,
              ci,
              cj,
              spill.kind,
              spill.forbidden,
              spill.cap,
            );
            if (!target) break;
            const chunk = Math.min(spill.toMove, target.room);
            if (target.existing) {
              target.existing.item.count += chunk;
              spill.sourceItem.count -= chunk;
            } else if (chunk === spill.sourceItem.count) {
              // Whole-entity move preserves per-entity components (Painting
              // etc.) that a fresh spawn would drop. Count is unchanged.
              const sourceAnchor = world.get(spill.sourceId, 'TileAnchor');
              const sourcePos = world.get(spill.sourceId, 'Position');
              if (sourceAnchor && sourcePos) {
                const w = tileToWorld(target.ni, target.nj, grid.W, grid.H);
                sourceAnchor.i = target.ni;
                sourceAnchor.j = target.nj;
                sourcePos.x = w.x;
                sourcePos.y = grid.getElevation(target.ni, target.nj);
                sourcePos.z = w.z;
                const nidx = grid.idx(target.ni, target.nj);
                let nlist = byTile.get(nidx);
                if (!nlist) {
                  nlist = [];
                  byTile.set(nidx, nlist);
                }
                nlist.push({ id: spill.sourceId, item: spill.sourceItem, anchor: sourceAnchor });
              }
            } else {
              const w = tileToWorld(target.ni, target.nj, grid.W, grid.H);
              const newId = world.spawn({
                Item: {
                  kind: spill.kind,
                  count: chunk,
                  capacity: spill.cap,
                  forbidden: spill.forbidden,
                },
                ItemViz: {},
                TileAnchor: { i: target.ni, j: target.nj },
                Position: { x: w.x, y: grid.getElevation(target.ni, target.nj), z: w.z },
              });
              const nidx = grid.idx(target.ni, target.nj);
              let nlist = byTile.get(nidx);
              if (!nlist) {
                nlist = [];
                byTile.set(nidx, nlist);
              }
              nlist.push({
                id: newId,
                item: world.get(newId, 'Item'),
                anchor: world.get(newId, 'TileAnchor'),
              });
              spill.sourceItem.count -= chunk;
            }
            spill.toMove -= chunk;
            any = true;
          }
          if (spill.sourceItem.count <= 0 && spill.sourceId !== primary.id) {
            world.despawn(spill.sourceId);
          }
        }
      }

      if (any && onRelocated) onRelocated();
    },
  };
}

/**
 * Pick the best walkable neighbor of (i,j) to absorb a spill of `kind`.
 * Prefers a neighbor already holding exactly one matching stack with room
 * (merge); falls back to the first empty neighbor (spawn). Skips neighbors
 * that already hold multiple stacks or a foreign-kind stack, because those
 * would just create another bad tile.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Map<number, { id: number, item: any, anchor: any }[]>} byTile
 * @param {number} i @param {number} j
 * @param {string} kind
 * @param {boolean} forbidden
 * @param {number} cap
 */
function findSpillTarget(grid, byTile, i, j, kind, forbidden, cap) {
  /** @type {{ ni: number, nj: number, existing: null, room: number } | null} */
  let emptyTarget = null;
  for (const [di, dj] of NBRS) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj)) continue;
    if (grid.isBlocked(ni, nj)) continue;
    const nidx = grid.idx(ni, nj);
    const nlist = byTile.get(nidx);
    if (!nlist || nlist.length === 0) {
      if (!emptyTarget) emptyTarget = { ni, nj, existing: null, room: cap };
      continue;
    }
    if (nlist.length > 1) continue;
    const e = nlist[0];
    if (e.item.kind === kind && e.item.forbidden === forbidden && e.item.count < cap) {
      return { ni, nj, existing: e, room: cap - e.item.count };
    }
  }
  return emptyTarget;
}
