/**
 * Shared blueprint-designator (walls, doors, torches).
 *
 * Activated from the build tab. Two placement modes, chosen per config:
 *  - drag (walls): LMB-drag a rectangle to spawn BuildSites across the range.
 *  - single-place (doors, torches): LMB = place one tile; no drag, no rect.
 *
 * Shift cancels instead of placing, scoped to this config's kind so modes
 * don't clobber each other's blueprints. `Escape` exits.
 *
 * Tiles that are blocked (tree, rock), already a door, or stockpile tiles are
 * skipped on ADD. Torches additionally skip tiles that already have a torch.
 * Cancel pass ignores the blocked check so half-placed sites can always be
 * cleared.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld, worldToTile } from '../world/coords.js';

const _ndc = new THREE.Vector2();
const PREVIEW_CLEARANCE = 0.08 * UNITS_PER_METER;
const PREVIEW_COLOR_REMOVE = 0xff6a4a;
const PREVIEW_COLOR_REMOVE_CSS = '#ff6a4a';

/**
 * @typedef {Object} BuildDesignatorConfig
 * @property {'wall' | 'door' | 'torch'} kind - BuildSite.kind to spawn
 * @property {number} previewColorAdd - hex color for ADD preview line + label border
 * @property {string} addVerb - label verb on add ("build", "door")
 * @property {string} cancelVerb - label verb on cancel ("cancel", "cancel door")
 * @property {boolean} [singlePlace] - if true, mousedown places exactly one
 *   tile (doors + torches). No drag, no size label; a one-tile hover preview
 *   tracks the cursor instead.
 */

/** @type {BuildDesignatorConfig} */
export const WALL_DESIGNATOR_CONFIG = {
  kind: 'wall',
  previewColorAdd: 0xe9d477,
  addVerb: 'build',
  cancelVerb: 'cancel',
};

/** @type {BuildDesignatorConfig} */
export const DOOR_DESIGNATOR_CONFIG = {
  kind: 'door',
  previewColorAdd: 0xffb070,
  addVerb: 'door',
  cancelVerb: 'cancel door',
  singlePlace: true,
};

/** @type {BuildDesignatorConfig} */
export const TORCH_DESIGNATOR_CONFIG = {
  kind: 'torch',
  previewColorAdd: 0xffb84a,
  addVerb: 'torch',
  cancelVerb: 'cancel torch',
  singlePlace: true,
};

export class BuildDesignator {
  /**
   * @param {BuildDesignatorConfig} config
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Mesh} getTileMesh
   * @param {import('../world/tileGrid.js').TileGrid} tileGrid
   * @param {import('../ecs/world.js').World} world
   * @param {import('../jobs/board.js').JobBoard} board
   * @param {{ markDirty: () => void }} buildSiteInstancer
   * @param {THREE.Scene} scene
   * @param {() => void} onStateChanged
   * @param {{ play: (kind: string) => void }} [audio]
   */
  constructor(
    config,
    dom,
    camera,
    getTileMesh,
    tileGrid,
    world,
    board,
    buildSiteInstancer,
    scene,
    onStateChanged,
    audio,
  ) {
    this.config = config;
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.tileGrid = tileGrid;
    this.world = world;
    this.board = board;
    this.buildSites = buildSiteInstancer;
    this.onStateChanged = onStateChanged;
    this.audio = audio;
    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.mousedown = false;
    this.removing = false;
    /** @type {{ i: number, j: number } | null} */
    this.startTile = null;
    /** @type {{ i: number, j: number } | null} */
    this.curTile = null;

    this.preview = buildPreview(scene, config.previewColorAdd);
    this.sizeLabel = buildSizeLabel(colorToCss(config.previewColorAdd));

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
    this.#hideSizeLabel();
  }

  /** @param {MouseEvent} e */
  #onDown(e) {
    if (!this.active || e.button !== 0) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (this.config.singlePlace) {
      // Single-place: no drag, no size label. Apply one tile and let the
      // hover preview keep tracking the cursor for the next click.
      this.#apply(tile, tile, e.shiftKey);
      this.startTile = tile;
      this.curTile = tile;
      this.removing = e.shiftKey;
      this.#renderPreview();
      return;
    }
    this.mousedown = true;
    this.removing = e.shiftKey;
    this.startTile = tile;
    this.curTile = tile;
    this.#renderPreview();
    this.#renderSizeLabel(e);
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    if (!this.active) return;
    if (this.config.singlePlace) {
      // Hover preview: re-render against the tile under the cursor every
      // move, even without a mousedown, so the player sees where the next
      // click will land.
      const tile = this.#pickTile(e);
      if (!tile) {
        this.#hidePreview();
        return;
      }
      this.startTile = tile;
      this.curTile = tile;
      this.removing = e.shiftKey;
      this.#renderPreview();
      return;
    }
    if (!this.mousedown) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    this.curTile = tile;
    this.#renderPreview();
    this.#renderSizeLabel(e);
  }

  /** @param {MouseEvent} e */
  #onUp(e) {
    // Single-place already applied on mousedown; nothing to do on release.
    if (this.config.singlePlace) return;
    if (!this.mousedown || e.button !== 0) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.mousedown = false;
    const start = this.startTile;
    const end = this.curTile;
    this.startTile = null;
    this.curTile = null;
    this.#hidePreview();
    this.#hideSizeLabel();
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
        if (removing) {
          if (this.#cancelTile(i, j)) any = true;
        } else {
          if (this.#designateTile(i, j)) any = true;
        }
      }
    }
    if (any) {
      this.audio?.play('command');
      this.buildSites.markDirty();
      this.onStateChanged();
    }
  }

  /** @param {number} i @param {number} j */
  #designateTile(i, j) {
    if (this.tileGrid.isBlocked(i, j)) return false;
    if (this.tileGrid.isDoor(i, j)) return false;
    if (this.tileGrid.isTorch(i, j)) return false;
    // Torches are decorative and non-blocking; letting them sit on stockpile
    // tiles means players can light up a storage area without having to
    // redraw the stockpile around them.
    if (this.config.kind !== 'torch' && this.tileGrid.isStockpile(i, j)) return false;
    if (this.#findSiteAt(i, j) !== null) return false;
    const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
    this.world.spawn({
      BuildSite: {
        kind: this.config.kind,
        requiredKind: 'wood',
        required: 1,
        delivered: 0,
        buildJobId: 0,
        progress: 0,
      },
      BuildSiteViz: {},
      TileAnchor: { i, j },
      Position: { x: w.x, y: this.tileGrid.getElevation(i, j), z: w.z },
    });
    return true;
  }

  /** @param {number} i @param {number} j */
  #cancelTile(i, j) {
    const id = this.#findSiteAt(i, j);
    if (id === null) return false;
    const site = this.world.get(id, 'BuildSite');
    // Only cancel blueprints of our own kind so wall/door modes don't step on
    // each other's pending work on shared tiles.
    if (!site || site.kind !== this.config.kind) return false;
    if (site.buildJobId > 0) this.board.complete(site.buildJobId);
    // Drop any delivered units back as a loose stack so they aren't lost.
    if (site.delivered > 0) {
      const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
      this.world.spawn({
        Item: { kind: site.requiredKind, count: site.delivered, capacity: 50 },
        ItemViz: {},
        TileAnchor: { i, j },
        Position: { x: w.x, y: this.tileGrid.getElevation(i, j), z: w.z },
      });
    }
    for (const job of this.board.jobs) {
      if (job.completed || job.kind !== 'haul') continue;
      if (job.payload.toBuildSite !== true) continue;
      if (job.payload.toI === i && job.payload.toJ === j) this.board.complete(job.id);
    }
    this.world.despawn(id);
    return true;
  }

  /** @param {number} i @param {number} j */
  #findSiteAt(i, j) {
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      if (components.TileAnchor.i === i && components.TileAnchor.j === j) return id;
    }
    return null;
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
    mat.color.setHex(this.removing ? PREVIEW_COLOR_REMOVE : this.config.previewColorAdd);
    this.preview.line.visible = true;
  }

  #hidePreview() {
    this.preview.line.visible = false;
  }

  /** @param {MouseEvent} e */
  #renderSizeLabel(e) {
    if (!this.startTile || !this.curTile) {
      this.#hideSizeLabel();
      return;
    }
    const w = Math.abs(this.curTile.i - this.startTile.i) + 1;
    const h = Math.abs(this.curTile.j - this.startTile.j) + 1;
    const meters = TILE_SIZE / UNITS_PER_METER;
    const wm = (w * meters).toFixed(1);
    const hm = (h * meters).toFixed(1);
    const verb = this.removing ? this.config.cancelVerb : this.config.addVerb;
    this.sizeLabel.textContent = `${verb}: ${w} × ${h} tiles (${wm}m × ${hm}m, ${w * h})`;
    this.sizeLabel.style.left = `${e.clientX + 16}px`;
    this.sizeLabel.style.top = `${e.clientY + 16}px`;
    this.sizeLabel.style.borderColor = this.removing
      ? PREVIEW_COLOR_REMOVE_CSS
      : colorToCss(this.config.previewColorAdd);
    this.sizeLabel.style.display = 'block';
  }

  #hideSizeLabel() {
    this.sizeLabel.style.display = 'none';
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

/** @param {number} hex */
function colorToCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * @param {THREE.Scene} scene
 * @param {number} color
 */
function buildPreview(scene, color) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(5 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { geo, positions, line };
}

/** @param {string} borderCss */
function buildSizeLabel(borderCss) {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.display = 'none';
  el.style.padding = '4px 8px';
  el.style.background = 'rgba(14, 18, 24, 0.85)';
  el.style.color = '#ffffff';
  el.style.font = '12px/1.2 system-ui, -apple-system, Segoe UI, sans-serif';
  el.style.fontWeight = '600';
  el.style.border = `1px solid ${borderCss}`;
  el.style.borderRadius = '3px';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '50';
  el.style.whiteSpace = 'nowrap';
  document.body.appendChild(el);
  return el;
}
