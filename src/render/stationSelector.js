/**
 * Click-to-select a station entity (furnace or easel). Tile-based picking —
 * raycasts the tile mesh to resolve (i, j), then checks whether an entity of
 * the given component kind sits on that tile. Mirrors ItemSelector's approach
 * and survives item stacks rendering on top of the station: the underlying
 * tile is still the station's, so the station wins.
 *
 * Register in capture-phase BEFORE ItemSelector. On a station tile we
 * stopImmediatePropagation so items sharing that tile don't steal focus;
 * on any other tile we fall through and the item picker handles it.
 *
 * Plain LMB replaces the selection; Shift+LMB toggles.
 */

import * as THREE from 'three';
import { worldToTile } from '../world/coords.js';
import { stoveFootprintTiles } from '../world/stove.js';

const _ndc = new THREE.Vector2();

export class StationSelector {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Mesh} getTileMesh
   * @param {{ W: number, H: number }} grid
   * @param {import('../ecs/world.js').World} world
   * @param {'Furnace' | 'Easel' | 'Stove'} compName
   * @param {(id: number | null, additive: boolean) => void} onSelect
   * @param {{ isDesignatorActive?: () => boolean }} [opts]
   */
  constructor(dom, camera, getTileMesh, grid, world, compName, onSelect, opts = {}) {
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.grid = grid;
    this.world = world;
    this.compName = compName;
    this.onSelect = onSelect;
    this.isDesignatorActive = opts.isDesignatorActive ?? (() => false);
    this.raycaster = new THREE.Raycaster();
    dom.addEventListener('click', (e) => this.#handleClick(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #handleClick(e) {
    if (e.button !== 0) return;
    if (this.isDesignatorActive()) return;
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.getTileMesh(), false);
    if (hits.length === 0) return;
    const p = hits[0].point;
    const t = worldToTile(p.x, p.z, this.grid.W, this.grid.H);
    if (t.i < 0) return;
    const id = this.#stationAt(t.i, t.j);
    if (id === null) return;
    this.onSelect(id, e.shiftKey);
    e.stopImmediatePropagation();
  }

  /** @param {number} i @param {number} j */
  #stationAt(i, j) {
    const isStove = this.compName === 'Stove';
    for (const { id, components } of this.world.query([this.compName, 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (isStove) {
        const facing = components.Stove.facing | 0;
        for (const t of stoveFootprintTiles(a, facing)) {
          if (t.i === i && t.j === j) return id;
        }
      } else if (a.i === i && a.j === j) {
        return id;
      }
    }
    return null;
  }
}
