/**
 * Generic world-object click selector. Handles any entity type registered in
 * `src/ui/objectTypes.js` — trees, boulders, walls, doors, torches, roofs,
 * floors, plus anything added to the registry later.
 *
 * Tile-based pick: raycast the tile mesh, read (i, j), look for registered
 * entities on that tile. When several stack on one tile (e.g. torch sitting
 * on a floor tile, wall covering a roof), the priority list below picks the
 * most likely intended target — "things you probably meant to click" — rather
 * than the arbitrary query order.
 *
 * Runs in capture-phase AFTER the specialized selectors (cow, item, station,
 * wall-art) so those keep priority on their own tiles. Double-click a target
 * to select every entity of the same type currently inside the camera
 * frustum, mirroring `ItemSelector`'s behaviour.
 */

import { objectTypeFor } from '../ui/objectTypes.js';
import { frustumVisibleIds, pickTileFromEvent } from './tilePickUtils.js';

/**
 * Tile pick order when multiple objects share a tile. Torches/walls/doors are
 * the visible vertical structure and win over ground-plane stuff (roof/floor).
 * Trees and boulders sit on terrain and come after the built structures.
 */
const TILE_LOOKUP_ORDER = ['Wall', 'Door', 'Torch', 'Tree', 'Boulder', 'Roof', 'Floor'];

export class ObjectSelector {
  /**
   * @param {{
   *   canvas: HTMLElement,
   *   camera: import('three').PerspectiveCamera,
   *   tileMesh: () => import('three').Mesh,
   *   grid: { W: number, H: number },
   *   world: import('../ecs/world.js').World,
   *   onSelect: (id: number | null, additive: boolean) => void,
   *   onSelectMany: (ids: number[]) => void,
   * }} opts
   */
  constructor({ canvas, camera, tileMesh, grid, world, onSelect, onSelectMany }) {
    this.dom = canvas;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.grid = grid;
    this.world = world;
    this.onSelect = onSelect;
    this.onSelectMany = onSelectMany;
    canvas.addEventListener('click', (e) => this.#onClick(e), { capture: true });
    canvas.addEventListener('dblclick', (e) => this.#onDouble(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #onClick(e) {
    if (e.button !== 0) return;
    const tile = pickTileFromEvent(e, this.dom, this.camera, this.getTileMesh(), this.grid);
    if (!tile) {
      // Leave "click on empty space clears everything" to the cow/item
      // selectors — they run first and handle the null case. If we got here
      // with no tile hit, they already cleared state.
      return;
    }
    const id = this.#objectAt(tile.i, tile.j);
    if (id === null) {
      if (!e.shiftKey) this.onSelect(null, false);
      return;
    }
    this.onSelect(id, e.shiftKey);
    e.stopImmediatePropagation();
  }

  /** @param {MouseEvent} e */
  #onDouble(e) {
    if (e.button !== 0) return;
    const tile = pickTileFromEvent(e, this.dom, this.camera, this.getTileMesh(), this.grid);
    if (!tile) return;
    const id = this.#objectAt(tile.i, tile.j);
    if (id === null) return;
    const entry = objectTypeFor(this.world, id);
    if (!entry) return;
    // When a type exposes kindOf (trees by species, boulders by rock type),
    // scope "select similar" to the same sub-kind — double-clicking an oak
    // shouldn't grab every pine in view.
    const targetKind = entry.kindOf?.(this.world, id) ?? null;
    const predicate = targetKind ? (c) => c[entry.component]?.kind === targetKind : undefined;
    const ids = frustumVisibleIds(
      this.camera,
      this.world,
      [entry.component, 'Position'],
      predicate,
    );
    if (ids.length === 0) return;
    this.onSelectMany(ids);
    e.stopImmediatePropagation();
  }

  /** @param {number} i @param {number} j */
  #objectAt(i, j) {
    for (const comp of TILE_LOOKUP_ORDER) {
      for (const { id, components } of this.world.query([comp, 'TileAnchor'])) {
        const a = components.TileAnchor;
        if (a.i === i && a.j === j) return id;
      }
    }
    return null;
  }
}
