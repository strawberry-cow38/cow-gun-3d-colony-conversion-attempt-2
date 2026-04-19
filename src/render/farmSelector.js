/**
 * Click-to-select for farm zones. Mirrors StockpileSelector: LMB on a farm
 * tile selects the owning zone, LMB on empty terrain clears the farm-zone
 * selection. Yields while any designator is armed so drags don't flicker
 * the selection.
 */

import { pickTileFromEvent } from './tilePickUtils.js';

export class FarmSelector {
  /**
   * @param {{
   *   canvas: HTMLElement,
   *   camera: import('three').PerspectiveCamera,
   *   tileMesh: () => import('three').Object3D,
   *   grid: { W: number, H: number },
   *   farmZones: import('../systems/farmZones.js').FarmZones,
   *   onSelect: (id: number | null) => void,
   *   isDesignatorActive?: () => boolean,
   * }} opts
   */
  constructor({ canvas, camera, tileMesh, grid, farmZones, onSelect, isDesignatorActive }) {
    this.dom = canvas;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.grid = grid;
    this.farmZones = farmZones;
    this.onSelect = onSelect;
    this.isDesignatorActive = isDesignatorActive ?? (() => false);
    canvas.addEventListener('click', (e) => this.#onClick(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #onClick(e) {
    if (e.button !== 0) return;
    if (e.shiftKey) return;
    if (this.isDesignatorActive()) return;
    const tile = pickTileFromEvent(e, this.dom, this.camera, this.getTileMesh(), this.grid);
    if (!tile) return;
    const id = this.farmZones.zoneIdAt(tile.i, tile.j);
    this.onSelect(id > 0 ? id : null);
  }
}
