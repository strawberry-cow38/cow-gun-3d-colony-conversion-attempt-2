/**
 * Wall designation mode.
 *
 * Press `V` to enter; LMB drag a rectangle of tiles to designate wood walls.
 * Each designated tile spawns a BuildSite entity (wall/wood/required=1). The
 * haul system then routes wood to the tile and, once delivered, posts a build
 * job so a cow physically erects the wall. Shift+drag cancels existing
 * designations (despawns the BuildSite + its pending haul/build jobs). Press
 * `V` or `Escape` to exit.
 *
 * Tiles that are blocked (tree, rock), already a finished wall, or stockpile
 * tiles are skipped on ADD — we don't want to overlap with pre-existing work.
 * Cancel pass ignores the blocked check so half-placed sites can always be
 * cleared.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld, worldToTile } from '../world/coords.js';

const _ndc = new THREE.Vector2();
const PREVIEW_CLEARANCE = 0.08 * UNITS_PER_METER;
const PREVIEW_COLOR_ADD = 0xe9d477;
const PREVIEW_COLOR_REMOVE = 0xff6a4a;

export class WallDesignator {
  /**
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

    this.preview = buildPreview(scene);

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
    if (e.code === 'KeyV') {
      this.active = !this.active;
      if (!this.active) this.#cancelDrag();
      this.audio?.play(this.active ? 'toggle_on' : 'toggle_off');
      this.onStateChanged();
    } else if (e.code === 'Escape' && this.active) {
      this.active = false;
      this.#cancelDrag();
      this.audio?.play('toggle_off');
      this.onStateChanged();
    }
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
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    if (!this.active || !this.mousedown) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    this.curTile = tile;
    this.#renderPreview();
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

  /**
   * Spawn a BuildSite on (i, j) unless something already occupies it. Returns
   * true if a site was actually added.
   *
   * @param {number} i @param {number} j
   */
  #designateTile(i, j) {
    if (this.tileGrid.isBlocked(i, j)) return false;
    if (this.tileGrid.isStockpile(i, j)) return false;
    if (this.#findSiteAt(i, j) !== null) return false;
    const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
    this.world.spawn({
      BuildSite: {
        kind: 'wall',
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

  /**
   * Cancel a pending BuildSite: release/complete its build job if any, clear
   * any outstanding haul jobs targeting the tile, and despawn the entity.
   * Delivered materials stay — they end up as a loose Item stack on the tile.
   *
   * @param {number} i @param {number} j
   */
  #cancelTile(i, j) {
    const id = this.#findSiteAt(i, j);
    if (id === null) return false;
    const site = this.world.get(id, 'BuildSite');
    if (site) {
      if (site.buildJobId > 0) this.board.complete(site.buildJobId);
      // Drop any delivered units back as a loose stack so they aren't lost.
      if (site.delivered > 0) {
        // Dynamic import would be cleaner but we're in a hot path — require a
        // caller-side helper later. For now: one unit per wall, so a straight
        // spawn is fine.
        // eslint-disable-next-line no-inner-declarations
        const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
        this.world.spawn({
          Item: { kind: site.requiredKind, count: site.delivered, capacity: 50 },
          ItemViz: {},
          TileAnchor: { i, j },
          Position: { x: w.x, y: this.tileGrid.getElevation(i, j), z: w.z },
        });
      }
    }
    // Cancel outstanding haul jobs pointing at this tile.
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
