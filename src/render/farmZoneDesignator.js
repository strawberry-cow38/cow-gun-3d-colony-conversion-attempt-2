/**
 * Farm-zone designation mode.
 *
 * Activated from the build tab; LMB drag a rectangle to mark tiles as a
 * farming zone. Shift+drag clears the zone. Escape exits. Zoned tiles display
 * a green overlay and trigger cows to till / plant / tend the tile.
 *
 * Mirrors StockpileDesignator's structure: drag rect, capture-phase mouse
 * listeners to keep selection / pan out of the way, a toggle bitmap on
 * TileGrid.farmZone.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld, worldToTile } from '../world/coords.js';
import { CROP_ID_FOR_KIND, CROP_KINDS } from '../world/crops.js';
import { createDragSizeLabel } from './dragSizeLabel.js';

const _ndc = new THREE.Vector2();
const PREVIEW_CLEARANCE = 0.08 * UNITS_PER_METER;
const PREVIEW_COLOR_ADD = 0x44dd88;
const PREVIEW_COLOR_REMOVE = 0xff6a4a;

export class FarmZoneDesignator {
  /**
   * @param {{
   *   canvas: HTMLElement,
   *   camera: THREE.PerspectiveCamera,
   *   tileMesh: () => THREE.Mesh,
   *   tileGrid: import('../world/tileGrid.js').TileGrid,
   *   overlay: { markDirty: () => void },
   *   scene: THREE.Scene,
   *   onChanged: () => void,
   *   audio?: { play: (kind: string) => void },
   * }} opts
   */
  constructor({ canvas, camera, tileMesh, tileGrid, overlay, scene, onChanged, audio }) {
    this.dom = canvas;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.tileGrid = tileGrid;
    this.overlay = overlay;
    this.onStateChanged = onChanged;
    this.audio = audio;
    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.mousedown = false;
    this.removing = false;
    /** @type {{ i: number, j: number } | null} */
    this.startTile = null;
    /** @type {{ i: number, j: number } | null} */
    this.curTile = null;

    /** @type {string} */
    this.currentCrop = CROP_KINDS[0];
    this.preview = buildPreview(scene);
    this.sizeLabel = createDragSizeLabel({
      addVerb: 'farm',
      cancelVerb: 'clear farm',
      addHex: PREVIEW_COLOR_ADD,
      removeHex: PREVIEW_COLOR_REMOVE,
    });

    canvas.addEventListener('mousedown', (e) => this.#onDown(e), true);
    addEventListener('mousemove', (e) => this.#onMove(e));
    addEventListener('mouseup', (e) => this.#onUp(e), true);
    canvas.addEventListener(
      'click',
      (e) => {
        if (!this.active) return;
        if (e.button !== 0) return;
        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );
    addEventListener('keydown', (e) => this.#onKey(e));
  }

  /** @param {KeyboardEvent} e */
  #onKey(e) {
    if (e.code === 'Escape' && this.active) this.deactivate();
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.audio?.play('toggle_on');
    this.onStateChanged();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.#cancelDrag();
    this.audio?.play('toggle_off');
    this.onStateChanged();
  }

  /** @param {string} kind */
  setCrop(kind) {
    if (!CROP_ID_FOR_KIND[kind]) return;
    this.currentCrop = kind;
    this.onStateChanged();
  }

  #cancelDrag() {
    this.mousedown = false;
    this.startTile = null;
    this.curTile = null;
    this.#hidePreview();
    this.sizeLabel.hide();
  }

  /** @param {MouseEvent} e */
  #onDown(e) {
    if (!this.active || e.button !== 0) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.mousedown = true;
    this.removing = e.shiftKey;
    this.startTile = tile;
    this.curTile = tile;
    this.#renderPreview();
    this.sizeLabel.render(e, this.startTile, this.curTile, this.removing);
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    if (!this.active || !this.mousedown) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    this.curTile = tile;
    this.#renderPreview();
    this.sizeLabel.render(e, this.startTile, this.curTile, this.removing);
  }

  /** @param {MouseEvent} e */
  #onUp(e) {
    if (!this.mousedown || e.button !== 0) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.mousedown = false;
    const start = this.startTile;
    const end = this.curTile;
    this.startTile = null;
    this.curTile = null;
    this.#hidePreview();
    this.sizeLabel.hide();
    if (!start || !end) return;
    this.#apply(start, end, this.removing);
  }

  /**
   * @param {{ i: number, j: number }} a
   * @param {{ i: number, j: number }} b
   * @param {boolean} removing
   */
  #apply(a, b, removing) {
    const i0 = Math.min(a.i, b.i);
    const i1 = Math.max(a.i, b.i);
    const j0 = Math.min(a.j, b.j);
    const j1 = Math.max(a.j, b.j);
    let any = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!this.tileGrid.inBounds(i, j)) continue;
        // Skip blocked tiles when adding — farm zones can't overlap trees,
        // walls, or built structures. Stockpile tiles share ground with zones
        // fine so no extra check for that.
        if (!removing && this.tileGrid.isBlocked(i, j)) continue;
        const cur = this.tileGrid.getFarmZone(i, j);
        const target = removing ? 0 : CROP_ID_FOR_KIND[this.currentCrop];
        if (cur === target) continue;
        this.tileGrid.setFarmZone(i, j, target);
        any = true;
      }
    }
    if (any) {
      this.audio?.play('command');
      this.overlay.markDirty();
      this.onStateChanged();
    }
  }

  #renderPreview() {
    if (!this.startTile || !this.curTile) {
      this.#hidePreview();
      return;
    }
    const grid = this.tileGrid;
    const i0 = Math.min(this.startTile.i, this.curTile.i);
    const i1 = Math.max(this.startTile.i, this.curTile.i);
    const j0 = Math.min(this.startTile.j, this.curTile.j);
    const j1 = Math.max(this.startTile.j, this.curTile.j);
    const nw = tileToWorld(i0, j0, grid.W, grid.H);
    const se = tileToWorld(i1, j1, grid.W, grid.H);
    const x0 = nw.x - TILE_SIZE * 0.5;
    const x1 = se.x + TILE_SIZE * 0.5;
    const z0 = nw.z - TILE_SIZE * 0.5;
    const z1 = se.z + TILE_SIZE * 0.5;
    const y = grid.getElevation(i0, j0) + PREVIEW_CLEARANCE;
    const p = this.preview.positions;
    p[0] = x0;
    p[1] = y;
    p[2] = z0;
    p[3] = x1;
    p[4] = y;
    p[5] = z0;
    p[6] = x1;
    p[7] = y;
    p[8] = z1;
    p[9] = x0;
    p[10] = y;
    p[11] = z1;
    p[12] = x0;
    p[13] = y;
    p[14] = z0;
    this.preview.geo.attributes.position.needsUpdate = true;
    const mat = /** @type {THREE.LineBasicMaterial} */ (this.preview.line.material);
    mat.color.setHex(this.removing ? PREVIEW_COLOR_REMOVE : PREVIEW_COLOR_ADD);
    this.preview.line.visible = true;
  }

  #hidePreview() {
    this.preview.line.visible = false;
  }

  /**
   * @param {MouseEvent} e
   * @returns {{ i: number, j: number } | null}
   */
  #pickTile(e) {
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.getTileMesh(), false);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    const t = worldToTile(p.x, p.z, this.tileGrid.W, this.tileGrid.H);
    if (t.i < 0) return null;
    return t;
  }
}

/** @param {THREE.Scene} scene */
function buildPreview(scene) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(5 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: PREVIEW_COLOR_ADD }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { geo, positions, line };
}
