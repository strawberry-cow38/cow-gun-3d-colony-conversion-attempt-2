/**
 * Generic world-object click selector. Handles any entity type registered in
 * `src/ui/objectTypes.js` — trees, boulders, walls, doors, torches, roofs,
 * floors, plus anything added to the registry later.
 *
 * Picks against the invisible `objectHitboxes` InstancedMesh: each registered
 * entity owns a box sized by `boxForEntity`, same dimensions as the selection
 * ghost. Whichever box the ray hits closest to the camera wins — so clicking
 * a tree's canopy, a wall's upper half, or a roof tile all route to the right
 * entity even when they extend past their anchor tile.
 *
 * Runs in capture-phase AFTER the specialized selectors (cow, item, station,
 * wall-art) so those keep priority on overlapping geometry. Double-click a
 * target to select every entity of the same type currently inside the camera
 * frustum, mirroring `ItemSelector`'s behaviour.
 */

import { objectTypeFor } from '../ui/objectTypes.js';
import { frustumVisibleIds, pickEntityFromEvent, pickTileFromEvent } from './tilePickUtils.js';

export class ObjectSelector {
  /**
   * @param {{
   *   canvas: HTMLElement,
   *   camera: import('three').PerspectiveCamera,
   *   tileMesh: () => import('three').Mesh,
   *   grid: { W: number, H: number },
   *   world: import('../ecs/world.js').World,
   *   hitboxes: { mesh: import('three').InstancedMesh, entityFromInstanceId: (i: number) => number | null },
   *   onSelect: (id: number | null, additive: boolean) => void,
   *   onSelectMany: (ids: number[]) => void,
   *   isDesignatorActive?: () => boolean,
   * }} opts
   */
  constructor({
    canvas,
    camera,
    tileMesh,
    grid,
    world,
    hitboxes,
    onSelect,
    onSelectMany,
    isDesignatorActive,
  }) {
    this.dom = canvas;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.grid = grid;
    this.world = world;
    this.hitboxes = hitboxes;
    this.onSelect = onSelect;
    this.onSelectMany = onSelectMany;
    this.isDesignatorActive = isDesignatorActive ?? (() => false);
    canvas.addEventListener('click', (e) => this.#onClick(e), { capture: true });
    canvas.addEventListener('dblclick', (e) => this.#onDouble(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #onClick(e) {
    if (e.button !== 0) return;
    if (this.isDesignatorActive()) return;
    const id = pickEntityFromEvent(e, this.dom, this.camera, this.hitboxes);
    if (id === null) {
      // Still check whether the click landed on terrain at all — on a tile
      // miss, let the cow/item selectors decide (they run first); on a tile
      // hit with no object, honour the non-additive "clear" gesture.
      const tile = pickTileFromEvent(e, this.dom, this.camera, this.getTileMesh(), this.grid);
      if (tile && !e.shiftKey) this.onSelect(null, false);
      return;
    }
    this.onSelect(id, e.shiftKey);
    e.stopImmediatePropagation();
  }

  /** @param {MouseEvent} e */
  #onDouble(e) {
    if (e.button !== 0) return;
    if (this.isDesignatorActive()) return;
    const id = pickEntityFromEvent(e, this.dom, this.camera, this.hitboxes);
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
}
