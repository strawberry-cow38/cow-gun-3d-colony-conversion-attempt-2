/**
 * Click-to-select for stockpile zones. Runs on LMB capture-phase after the
 * object hitbox selector, so a wall/door/bed on a stockpile tile keeps its
 * own selection priority. If the click lands on a stockpile tile, the owning
 * zone becomes the selected one; clicking an empty tile clears the zone
 * selection without touching other buckets.
 */

import { pickTileFromEvent } from './tilePickUtils.js';

export class StockpileSelector {
  /**
   * @param {{
   *   canvas: HTMLElement,
   *   camera: import('three').PerspectiveCamera,
   *   tileMesh: () => import('three').Object3D,
   *   grid: { W: number, H: number },
   *   stockpileZones: ReturnType<typeof import('../systems/stockpileZones.js').createStockpileZones>,
   *   onSelect: (id: number | null) => void,
   *   isDesignatorActive?: () => boolean,
   * }} opts
   */
  constructor({ canvas, camera, tileMesh, grid, stockpileZones, onSelect, isDesignatorActive }) {
    this.dom = canvas;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.grid = grid;
    this.stockpileZones = stockpileZones;
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
    const id = this.stockpileZones.zoneIdAt(tile.i, tile.j);
    this.onSelect(id > 0 ? id : null);
  }
}
