/**
 * Uninstall-painting designator. Toggleable build-tab tool. Click the floor
 * tile where a viewer would stand (one step out from the wall along the
 * painting's face normal) — the designator finds the WallArt whose span
 * fronts that viewer tile and queues an uninstall job. The cow pries the
 * painting off the wall and drops a storable Item+Painting at that tile.
 *
 * Mutually exclusive with the other build-tab designators via the shared
 * `notifyChanged` walker in setupDesignators.js.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld, worldToTile } from '../world/coords.js';
import { FACING_OFFSETS, FACING_SPAN_OFFSETS } from '../world/facing.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const _ndc = new THREE.Vector2();
const PREVIEW_CLEARANCE = 0.08 * UNITS_PER_METER;
const PREVIEW_COLOR_VALID = 0xff8fd0;
const PREVIEW_COLOR_INVALID = 0xff6a4a;
const WORK_SPOT_COLOR = 0x7cffb0;

export class UninstallDesignator {
  /**
   * @param {{
   *   canvas: HTMLElement,
   *   camera: THREE.PerspectiveCamera,
   *   tileMesh: () => THREE.Group,
   *   tileGrid: import('../world/tileGrid.js').TileGrid,
   *   world: import('../ecs/world.js').World,
   *   jobBoard: import('../jobs/board.js').JobBoard,
   *   scene: THREE.Scene,
   *   onChanged: () => void,
   *   audio?: { play: (kind: string) => void },
   * }} opts
   */
  constructor({ canvas, camera, tileMesh, tileGrid, world, jobBoard, scene, onChanged, audio }) {
    this.dom = canvas;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.tileGrid = tileGrid;
    this.world = world;
    this.board = jobBoard;
    this.onStateChanged = onChanged;
    this.audio = audio;
    this.active = false;
    /** @type {{ i: number, j: number } | null} */
    this.hoverTile = null;
    this.raycaster = new THREE.Raycaster();

    this.spanPreview = buildSpanPreview(scene);
    this.workSpotPreview = buildTilePreview(scene);

    canvas.addEventListener('mousedown', (e) => this.#onDown(e), true);
    addEventListener('mousemove', (e) => this.#onMove(e));
    canvas.addEventListener(
      'click',
      (e) => {
        if (!this.active || e.button !== 0) return;
        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );
    addEventListener('keydown', (e) => this.#onKey(e));
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.hoverTile = null;
    this.audio?.play('toggle_on');
    this.onStateChanged();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.hoverTile = null;
    this.#hidePreview();
    this.audio?.play('toggle_off');
    this.onStateChanged();
  }

  /** @param {KeyboardEvent} e */
  #onKey(e) {
    if (!this.active) return;
    if (e.code === 'Escape') this.deactivate();
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    if (!this.active) return;
    this.hoverTile = this.#pickTile(e);
    this.#renderPreview();
  }

  /** @param {MouseEvent} e */
  #onDown(e) {
    if (!this.active || e.button !== 0) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const hit = this.#findWallArtViewedFrom(tile);
    if (!hit) return;
    const { wallArtId, art } = hit;
    if (art.uninstallJobId > 0) return;
    const job = this.board.post('uninstall', {
      wallArtId,
      workI: tile.i,
      workJ: tile.j,
    });
    art.uninstallJobId = job.id;
    this.audio?.play('command');
  }

  /**
   * Find a WallArt whose span has the hovered tile as one of its viewer
   * spots — i.e. some span tile `w` satisfies `w + face_normal == tile`.
   *
   * @param {{ i: number, j: number }} tile
   */
  #findWallArtViewedFrom(tile) {
    for (const { id, components } of this.world.query(['WallArt', 'TileAnchor'])) {
      const art = components.WallArt;
      const anchor = components.TileAnchor;
      const size = Math.max(1, art.size | 0);
      const face = art.face | 0;
      const step = FACING_SPAN_OFFSETS[face] ?? FACING_SPAN_OFFSETS[0];
      const offset = FACING_OFFSETS[face] ?? FACING_OFFSETS[0];
      for (let k = 0; k < size; k++) {
        const vi = anchor.i + step.di * k + offset.di;
        const vj = anchor.j + step.dj * k + offset.dj;
        if (vi === tile.i && vj === tile.j) {
          return { wallArtId: id, art, anchor, face, size };
        }
      }
    }
    return null;
  }

  #renderPreview() {
    if (!this.hoverTile) {
      this.#hidePreview();
      return;
    }
    const hit = this.#findWallArtViewedFrom(this.hoverTile);
    if (!hit) {
      this.#hidePreview();
      return;
    }
    const color = hit.art.uninstallJobId > 0 ? PREVIEW_COLOR_INVALID : PREVIEW_COLOR_VALID;
    const step = FACING_SPAN_OFFSETS[hit.face] ?? FACING_SPAN_OFFSETS[0];
    const first = { i: hit.anchor.i, j: hit.anchor.j };
    const last = {
      i: hit.anchor.i + step.di * (hit.size - 1),
      j: hit.anchor.j + step.dj * (hit.size - 1),
    };
    renderSpanPreview(this.spanPreview, this.tileGrid, first, last, color);
    renderTilePreview(
      this.workSpotPreview,
      this.tileGrid,
      this.hoverTile.i,
      this.hoverTile.j,
      WORK_SPOT_COLOR,
    );
  }

  #hidePreview() {
    this.spanPreview.line.visible = false;
    this.workSpotPreview.line.visible = false;
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
    const hits = this.raycaster.intersectObject(this.getTileMesh(), true);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    const t = worldToTile(p.x, p.z, this.tileGrid.W, this.tileGrid.H);
    if (t.i < 0) return null;
    return t;
  }
}

/** @param {THREE.Scene} scene */
function buildSpanPreview(scene) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(5 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: PREVIEW_COLOR_VALID }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { geo, positions, line };
}

/** @param {THREE.Scene} scene */
function buildTilePreview(scene) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(5 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: WORK_SPOT_COLOR }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { geo, positions, line };
}

/**
 * @param {{ geo: THREE.BufferGeometry, positions: Float32Array, line: THREE.Line }} preview
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {{ i: number, j: number }} a
 * @param {{ i: number, j: number }} b
 * @param {number} color
 */
function renderSpanPreview(preview, grid, a, b, color) {
  const i0 = Math.min(a.i, b.i);
  const i1 = Math.max(a.i, b.i);
  const j0 = Math.min(a.j, b.j);
  const j1 = Math.max(a.j, b.j);
  const nw = tileToWorld(i0, j0, grid.W, grid.H);
  const se = tileToWorld(i1, j1, grid.W, grid.H);
  const x0 = nw.x - TILE_SIZE * 0.5;
  const x1 = se.x + TILE_SIZE * 0.5;
  const z0 = nw.z - TILE_SIZE * 0.5;
  const z1 = se.z + TILE_SIZE * 0.5;
  // Outline sits above wall-top so it isn't occluded by the wall mesh at
  // normal RTS camera angles — matches install preview.
  let y = grid.inBounds(i0, j0) ? grid.getElevation(i0, j0) : 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (!grid.inBounds(i, j)) continue;
      const e = grid.getElevation(i, j);
      if (e > y) y = e;
    }
  }
  y += WALL_HEIGHT + PREVIEW_CLEARANCE;
  const p = preview.positions;
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
  preview.geo.attributes.position.needsUpdate = true;
  /** @type {THREE.LineBasicMaterial} */
  (preview.line.material).color.setHex(color);
  preview.line.visible = true;
}

/**
 * @param {{ geo: THREE.BufferGeometry, positions: Float32Array, line: THREE.Line }} preview
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j @param {number} color
 */
function renderTilePreview(preview, grid, i, j, color) {
  const w = tileToWorld(i, j, grid.W, grid.H);
  const x0 = w.x - TILE_SIZE * 0.5;
  const x1 = w.x + TILE_SIZE * 0.5;
  const z0 = w.z - TILE_SIZE * 0.5;
  const z1 = w.z + TILE_SIZE * 0.5;
  const y = grid.getElevation(i, j) + PREVIEW_CLEARANCE;
  const p = preview.positions;
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
  preview.geo.attributes.position.needsUpdate = true;
  /** @type {THREE.LineBasicMaterial} */
  (preview.line.material).color.setHex(color);
  preview.line.visible = true;
}
