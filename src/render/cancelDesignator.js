/**
 * Cancel designation mode.
 *
 * LMB-drag a rectangle to cancel, inside the rect:
 *   - any BuildSite blueprint (wall/door/torch/roof/floor) — despawned;
 *     delivered resources drop back as a loose item stack.
 *   - any pending deconstruct mark on Wall/Door/Torch/Roof/Floor — job
 *     cancelled.
 *
 * Consolidates cancel across blueprints + demolition queue + auto-roof so
 * players have one undo tool instead of needing to remember which designator
 * placed a given mark.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld, worldToTile } from '../world/coords.js';
import { releaseBuildSite } from './buildDesignator.js';
import { createDragSizeLabel } from './dragSizeLabel.js';

const _ndc = new THREE.Vector2();
const PREVIEW_CLEARANCE = 0.08 * UNITS_PER_METER;
export const CANCEL_PREVIEW_COLOR = 0xffe24a;

const DECON_COMPS = /** @type {const} */ (['Wall', 'Door', 'Torch', 'Roof', 'Floor', 'Furnace']);

export class CancelDesignator {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Mesh} getTileMesh
   * @param {import('../world/tileGrid.js').TileGrid} tileGrid
   * @param {import('../ecs/world.js').World} world
   * @param {import('../jobs/board.js').JobBoard} board
   * @param {{ markDirty: () => void }} buildSiteInstancer
   * @param {{ markDirty: () => void }[]} deconInstancers  dirty flags for wall/roof viz whose deconstruct marks we may clear
   * @param {THREE.Scene} scene
   * @param {() => void} onStateChanged
   * @param {{ play: (kind: string) => void }} [audio]
   */
  constructor(
    dom,
    camera,
    getTileMesh,
    tileGrid,
    world,
    board,
    buildSiteInstancer,
    deconInstancers,
    scene,
    onStateChanged,
    audio,
  ) {
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.tileGrid = tileGrid;
    this.world = world;
    this.board = board;
    this.buildSiteInstancer = buildSiteInstancer;
    this.deconInstancers = deconInstancers;
    this.onStateChanged = onStateChanged;
    this.audio = audio;
    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.mousedown = false;
    /** @type {{ i: number, j: number } | null} */
    this.startTile = null;
    /** @type {{ i: number, j: number } | null} */
    this.curTile = null;

    this.preview = buildPreview(scene);
    this.sizeLabel = createDragSizeLabel({
      addVerb: 'cancel',
      addHex: CANCEL_PREVIEW_COLOR,
    });

    dom.addEventListener('mousedown', (e) => this.#onDown(e), true);
    addEventListener('mousemove', (e) => this.#onMove(e));
    addEventListener('mouseup', (e) => this.#onUp(e), true);
    dom.addEventListener(
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
    this.startTile = tile;
    this.curTile = tile;
    this.#renderPreview();
    this.sizeLabel.render(e, this.startTile, this.curTile, false);
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    if (!this.active || !this.mousedown) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    this.curTile = tile;
    this.#renderPreview();
    this.sizeLabel.render(e, this.startTile, this.curTile, false);
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
    this.#apply(start, end);
  }

  /**
   * @param {{ i: number, j: number }} a
   * @param {{ i: number, j: number }} b
   */
  #apply(a, b) {
    const i0 = Math.min(a.i, b.i);
    const i1 = Math.max(a.i, b.i);
    const j0 = Math.min(a.j, b.j);
    const j1 = Math.max(a.j, b.j);

    let cancelledSite = false;
    let clearedDecon = false;

    // Two-pass: despawning mid-query corrupts the iterator.
    const toDespawn = [];
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const anchor = components.TileAnchor;
      if (anchor.i < i0 || anchor.i > i1) continue;
      if (anchor.j < j0 || anchor.j > j1) continue;
      releaseBuildSite(
        this.world,
        this.board,
        this.tileGrid,
        components.BuildSite,
        anchor.i,
        anchor.j,
      );
      toDespawn.push(id);
      cancelledSite = true;
    }
    for (const id of toDespawn) this.world.despawn(id);

    for (const comp of DECON_COMPS) {
      for (const { components } of this.world.query([comp, 'TileAnchor'])) {
        const anchor = components.TileAnchor;
        if (anchor.i < i0 || anchor.i > i1) continue;
        if (anchor.j < j0 || anchor.j > j1) continue;
        const tag = components[comp];
        if (tag.deconstructJobId > 0) {
          this.board.complete(tag.deconstructJobId);
          tag.deconstructJobId = 0;
          tag.progress = 0;
          clearedDecon = true;
        }
      }
    }

    if (cancelledSite || clearedDecon) {
      this.audio?.play('command');
      if (cancelledSite) this.buildSiteInstancer.markDirty();
      if (clearedDecon) for (const inst of this.deconInstancers) inst.markDirty();
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
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: CANCEL_PREVIEW_COLOR }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { geo, positions, line };
}
