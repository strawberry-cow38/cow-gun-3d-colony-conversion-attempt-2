/**
 * Deconstruct designation mode.
 *
 * Activated from the build tab; LMB-drag a rectangle to mark every finished
 * structure inside the rect for demolition (posts a 'deconstruct' job and sets
 * the entity's deconstructJobId). Shift+drag cancels existing marks inside
 * the rect.
 *
 * The default `kinds` set covers Wall/Door/Torch — roofs and floors are
 * deliberately excluded so a demolish sweep through a room doesn't also rip
 * the ceiling off or tear up the carpet. Both get their own dedicated
 * designators: "un-roof" (roof-only `kinds` + `tagIgnoreRoof: true`) and
 * "un-floor" (floor-only `kinds`).
 *
 * Mirrors ChopDesignator's drag + preview rectangle pattern — the differences
 * are (a) what we query for (Wall/Door/Torch/[Roof] instead of Tree) and (b)
 * the board kind we post ('deconstruct').
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld, worldToTile } from '../world/coords.js';
import { stairFootprintTiles } from '../world/stair.js';
import { stoveFootprintTiles } from '../world/stove.js';
import { createDragSizeLabel } from './dragSizeLabel.js';

const _ndc = new THREE.Vector2();
const PREVIEW_CLEARANCE = 0.08 * UNITS_PER_METER;
export const DECONSTRUCT_PREVIEW_COLOR = 0xff4a4a;
const PREVIEW_COLOR_REMOVE = 0xff6a4a;

/**
 * Component name → lowercase job-payload kind. Matches DECON_COMP_BY_KIND in
 * cow.js. Roofs + floors are intentionally absent — ripping them up alongside
 * walls/doors is rarely what the player wants. Both have dedicated "un-roof"
 * and "un-floor" designators that the build tab wires up with their own
 * `kinds` override.
 */
export const DECON_KINDS = /** @type {const} */ ([
  { comp: 'Wall', kind: 'wall' },
  { comp: 'Door', kind: 'door' },
  { comp: 'Torch', kind: 'torch' },
  { comp: 'Furnace', kind: 'furnace' },
  { comp: 'Easel', kind: 'easel' },
  { comp: 'Stove', kind: 'stove' },
  { comp: 'Bed', kind: 'bed' },
  { comp: 'Stair', kind: 'stair' },
]);

export class DeconstructDesignator {
  /**
   * Roof-only and floor-only modes override `kinds` + `previewColor` so the
   * player can demolish roofs/floors without also hitting the structure
   * around them. `tagIgnoreRoof` additionally flips the tile's ignoreRoof bit
   * on demolish so the auto-roofer doesn't rebuild what the player just tore
   * down; the reverse path (shift-drag to cancel) clears it again.
   * `addVerb`/`cancelVerb` label the size guide — default
   * "demolish"/"cancel demolish".
   *
   * @param {{
   *   canvas: HTMLElement,
   *   camera: THREE.PerspectiveCamera,
   *   tileMesh: () => THREE.Group,
   *   tileGrid: import('../world/tileGrid.js').TileGrid,
   *   world: import('../ecs/world.js').World,
   *   jobBoard: import('../jobs/board.js').JobBoard,
   *   instancers: { markDirty: () => void }[],
   *   scene: THREE.Scene,
   *   onChanged: () => void,
   *   audio?: { play: (kind: string) => void },
   *   kinds?: readonly { comp: string, kind: string }[],
   *   previewColor?: number,
   *   tagIgnoreRoof?: boolean,
   *   addVerb?: string,
   *   cancelVerb?: string,
   * }} opts
   */
  constructor({
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    instancers,
    scene,
    onChanged,
    audio,
    kinds,
    previewColor,
    tagIgnoreRoof,
    addVerb,
    cancelVerb,
  }) {
    this.dom = canvas;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.tileGrid = tileGrid;
    this.world = world;
    this.board = jobBoard;
    this.instancers = instancers;
    this.onStateChanged = onChanged;
    this.audio = audio;
    this.kinds = kinds ?? DECON_KINDS;
    this.previewColor = previewColor ?? DECONSTRUCT_PREVIEW_COLOR;
    this.tagIgnoreRoof = tagIgnoreRoof === true;
    this.addVerb = addVerb ?? 'demolish';
    this.cancelVerb = cancelVerb ?? 'cancel demolish';
    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.mousedown = false;
    this.removing = false;
    /** @type {{ i: number, j: number } | null} */
    this.startTile = null;
    /** @type {{ i: number, j: number } | null} */
    this.curTile = null;

    this.preview = buildPreview(scene);
    this.sizeLabel = createDragSizeLabel({
      addVerb: this.addVerb,
      cancelVerb: this.cancelVerb,
      addHex: this.previewColor,
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
    for (const { comp, kind } of this.kinds) {
      for (const { id, components } of this.world.query([comp, 'TileAnchor'])) {
        const anchor = components.TileAnchor;
        let matched = false;
        if (comp === 'Stove') {
          for (const t of stoveFootprintTiles(anchor, components.Stove.facing | 0)) {
            if (t.i >= i0 && t.i <= i1 && t.j >= j0 && t.j <= j1) {
              matched = true;
              break;
            }
          }
        } else if (comp === 'Stair') {
          for (const t of stairFootprintTiles(anchor, components.Stair.facing | 0)) {
            if (t.i >= i0 && t.i <= i1 && t.j >= j0 && t.j <= j1) {
              matched = true;
              break;
            }
          }
        } else if (anchor.i >= i0 && anchor.i <= i1 && anchor.j >= j0 && anchor.j <= j1) {
          matched = true;
        }
        if (!matched) continue;
        const tag = components[comp];
        if (removing) {
          if (tag.deconstructJobId > 0) {
            this.board.complete(tag.deconstructJobId);
            tag.deconstructJobId = 0;
            tag.progress = 0;
            any = true;
          }
        } else {
          if (tag.deconstructJobId === 0) {
            const job = this.board.post('deconstruct', {
              entityId: id,
              kind,
              i: anchor.i,
              j: anchor.j,
            });
            tag.deconstructJobId = job.id;
            tag.progress = 0;
            any = true;
          }
        }
      }
    }
    if (this.tagIgnoreRoof) {
      const target = removing ? 0 : 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (!this.tileGrid.inBounds(i, j)) continue;
          if (this.tileGrid.isIgnoreRoof(i, j) === !!target) continue;
          this.tileGrid.setIgnoreRoof(i, j, target);
          any = true;
        }
      }
    }
    if (any) {
      this.audio?.play('command');
      for (const inst of this.instancers) inst.markDirty();
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
    mat.color.setHex(this.removing ? PREVIEW_COLOR_REMOVE : this.previewColor);
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
    const hits = this.raycaster.intersectObject(this.getTileMesh(), true);
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
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: DECONSTRUCT_PREVIEW_COLOR }),
  );
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { geo, positions, line };
}
