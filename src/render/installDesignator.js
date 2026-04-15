/**
 * Install-painting designator. Activated from the item stack panel's Install
 * button when a single painting stack is selected. Click the floor tile where
 * a viewer would stand — the designator infers the wall one step inward (along
 * the face normal) and queues an install job on that wall.
 *
 * For multi-tile paintings (`size > 1`) the wall anchor extends `size` tiles
 * along the face-perpendicular direction. R cycles the face so the same hover
 * tile can be interpreted as "viewer for a south-facing wall" vs "viewer for
 * an east-facing wall" — useful at inside corners. Each tile in the span must
 * be a built wall with a walkable viewer tile on the face side.
 *
 * Esc exits. This designator is mutually exclusive with the build-tab tools
 * via the shared `notifyChanged` walker in setupDesignators.js.
 */

import * as THREE from 'three';
import { defaultWalkable } from '../sim/pathfinding.js';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld, worldToTile } from '../world/coords.js';
import { FACING_OFFSETS, FACING_SPAN_OFFSETS } from '../world/facing.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const _ndc = new THREE.Vector2();
const PREVIEW_CLEARANCE = 0.08 * UNITS_PER_METER;
const PREVIEW_COLOR_VALID = 0xffd860;
const PREVIEW_COLOR_INVALID = 0xff6a4a;
const WORK_SPOT_COLOR = 0x7cffb0;

export class InstallDesignator {
  /**
   * @param {{
   *   canvas: HTMLElement,
   *   camera: THREE.PerspectiveCamera,
   *   tileMesh: () => THREE.Mesh,
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
    /** Painting item entity being installed. -1 when inactive. */
    this.itemId = -1;
    /** 1..4 tiles of wall the painting spans. */
    this.size = 1;
    /** 0..3 (S/E/N/W). R cycles. */
    this.currentFacing = 0;
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

  /**
   * @param {number} itemId
   * @param {number} size
   */
  activate(itemId, size) {
    this.itemId = itemId;
    this.size = Math.max(1, Math.min(4, size | 0));
    this.currentFacing = 0;
    this.hoverTile = null;
    if (!this.active) {
      this.active = true;
      this.audio?.play('toggle_on');
    }
    this.onStateChanged();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.itemId = -1;
    this.size = 1;
    this.hoverTile = null;
    this.#hidePreview();
    this.audio?.play('toggle_off');
    this.onStateChanged();
  }

  /** @param {KeyboardEvent} e */
  #onKey(e) {
    if (!this.active) return;
    if (e.code === 'Escape') {
      this.deactivate();
      return;
    }
    if (e.code === 'KeyR') {
      const step = e.shiftKey ? 3 : 1;
      this.currentFacing = (this.currentFacing + step) % 4;
      this.#renderPreview();
    }
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
    const plan = this.#validatePlacement(tile);
    if (!plan) return;
    const item = this.world.get(this.itemId, 'Item');
    const painting = this.world.get(this.itemId, 'Painting');
    const anchor = this.world.get(this.itemId, 'TileAnchor');
    if (!item || !painting || !anchor) {
      this.deactivate();
      return;
    }
    this.board.post('install', {
      itemId: this.itemId,
      size: this.size,
      face: plan.face,
      anchorI: plan.anchorI,
      anchorJ: plan.anchorJ,
      workI: plan.workI,
      workJ: plan.workJ,
    });
    this.audio?.play('command');
    this.deactivate();
  }

  /**
   * The hovered tile is the viewer spot (where a cow stands to see the
   * painting). The wall is one tile inward from there — we derive it by
   * subtracting the face normal, then extend the span along the wall.
   *
   * @param {{ i: number, j: number }} tile
   * @returns {{ face: number, anchorI: number, anchorJ: number, workI: number, workJ: number } | null}
   */
  #validatePlacement(tile) {
    const grid = this.tileGrid;
    const face = this.currentFacing;
    const step = FACING_SPAN_OFFSETS[face];
    const offset = FACING_OFFSETS[face];
    if (!grid.inBounds(tile.i, tile.j)) return null;
    if (!defaultWalkable(grid, tile.i, tile.j)) return null;
    const anchorI = tile.i - offset.di;
    const anchorJ = tile.j - offset.dj;
    for (let k = 0; k < this.size; k++) {
      const wi = anchorI + step.di * k;
      const wj = anchorJ + step.dj * k;
      if (!grid.inBounds(wi, wj)) return null;
      if (!grid.isWall(wi, wj)) return null;
      const vi = wi + offset.di;
      const vj = wj + offset.dj;
      if (!grid.inBounds(vi, vj)) return null;
      if (!defaultWalkable(grid, vi, vj)) return null;
    }
    return {
      face,
      anchorI,
      anchorJ,
      workI: tile.i,
      workJ: tile.j,
    };
  }

  #renderPreview() {
    if (!this.hoverTile) {
      this.#hidePreview();
      return;
    }
    const plan = this.#validatePlacement(this.hoverTile);
    const color = plan ? PREVIEW_COLOR_VALID : PREVIEW_COLOR_INVALID;
    const step = FACING_SPAN_OFFSETS[this.currentFacing];
    const offset = FACING_OFFSETS[this.currentFacing];
    // Outline the wall span the painting will mount on, not the floor tile
    // the user clicked — the click target is the viewer spot (hover tile).
    const wallFirst = {
      i: this.hoverTile.i - offset.di,
      j: this.hoverTile.j - offset.dj,
    };
    const wallLast = {
      i: wallFirst.i + step.di * (this.size - 1),
      j: wallFirst.j + step.dj * (this.size - 1),
    };
    renderSpanPreview(this.spanPreview, this.tileGrid, wallFirst, wallLast, color);
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
    const hits = this.raycaster.intersectObject(this.getTileMesh(), false);
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
  // Preview sits above wall-top because the span covers wall tiles — a
  // ground-level line would be occluded by the wall mesh from every RTS
  // camera angle that isn't straight-down.
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
  p[0] = x0; p[1] = y; p[2] = z0;
  p[3] = x1; p[4] = y; p[5] = z0;
  p[6] = x1; p[7] = y; p[8] = z1;
  p[9] = x0; p[10] = y; p[11] = z1;
  p[12] = x0; p[13] = y; p[14] = z0;
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
  p[0] = x0; p[1] = y; p[2] = z0;
  p[3] = x1; p[4] = y; p[5] = z0;
  p[6] = x1; p[7] = y; p[8] = z1;
  p[9] = x0; p[10] = y; p[11] = z1;
  p[12] = x0; p[13] = y; p[14] = z0;
  preview.geo.attributes.position.needsUpdate = true;
  /** @type {THREE.LineBasicMaterial} */
  (preview.line.material).color.setHex(color);
  preview.line.visible = true;
}
