/**
 * Bottom-right "what's under the cursor" readout. Listens for mousemove on
 * the canvas and runs three raycasts against the cow instancer, the object
 * hitbox mesh, and the tile mesh; whichever reports the closest hit decides
 * the label. Fallbacks handle items, furnaces/easels, nearby-cow proximity,
 * and bare terrain.
 *
 * Throttled to one resolve per rAF so a 120 Hz mouse still only does one
 * pass per frame.
 */

import * as THREE from 'three';
import { objectTypeFor } from '../ui/objectTypes.js';
import { TILE_SIZE } from '../world/coords.js';
import { ITEM_INFO } from '../world/items.js';
import { BIOME } from '../world/tileGrid.js';
import { pickTileFromEvent } from './tilePickUtils.js';

const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();

const BIOME_LABELS = /** @type {Record<number, string>} */ ({
  [BIOME.GRASS]: 'Grass',
  [BIOME.DIRT]: 'Dirt',
  [BIOME.STONE]: 'Stone',
  [BIOME.SAND]: 'Sand',
  [BIOME.SHALLOW_WATER]: 'Shallow water',
  [BIOME.DEEP_WATER]: 'Deep water',
});

const PICK_RADIUS = TILE_SIZE * 1.5;

export class HoverTooltip {
  /**
   * @param {{
   *   dom: HTMLElement,
   *   el: HTMLElement,
   *   camera: import('three').PerspectiveCamera,
   *   tileMesh: () => import('three').Mesh,
   *   grid: { W: number, H: number },
   *   tileGrid: import('../world/tileGrid.js').TileGrid,
   *   world: import('../ecs/world.js').World,
   *   cowInstancer: { mesh: import('three').InstancedMesh, entityFromInstanceId: (i: number) => number | null },
   *   objectHitboxes: { mesh: import('three').InstancedMesh, entityFromInstanceId: (i: number) => number | null },
   * }} opts
   */
  constructor({ dom, el, camera, tileMesh, grid, tileGrid, world, cowInstancer, objectHitboxes }) {
    this.dom = dom;
    this.el = el;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.grid = grid;
    this.tileGrid = tileGrid;
    this.world = world;
    this.cowInstancer = cowInstancer;
    this.objectHitboxes = objectHitboxes;
    this.pending = /** @type {MouseEvent | null} */ (null);
    this.scheduled = false;
    this.lastText = '';
    dom.addEventListener('mousemove', (e) => this.#onMove(e));
    dom.addEventListener('mouseleave', () => this.#hide());
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    this.pending = e;
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      const ev = this.pending;
      this.pending = null;
      if (ev) this.#resolve(ev);
    });
  }

  #hide() {
    if (this.lastText === '') return;
    this.lastText = '';
    this.el.textContent = '';
    this.el.style.display = 'none';
  }

  /** @param {string} text */
  #show(text) {
    if (text === this.lastText) return;
    this.lastText = text;
    this.el.textContent = text;
    this.el.style.display = 'block';
  }

  /** @param {MouseEvent} e */
  #resolve(e) {
    const label = this.#labelAt(e);
    if (label) this.#show(label);
    else this.#hide();
  }

  /** @param {MouseEvent} e */
  #labelAt(e) {
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_ndc, this.camera);

    // Three parallel picks: whichever reports the closest hit wins, so a wall
    // in front of a cow behind a roof all sort correctly without manual
    // priority rules.
    const cowHit = _raycaster.intersectObject(this.cowInstancer.mesh, false)[0];
    const objHit = _raycaster.intersectObject(this.objectHitboxes.mesh, false)[0];
    const tileHit = _raycaster.intersectObject(this.getTileMesh(), false)[0];

    const cowDist = cowHit?.instanceId !== undefined ? cowHit.distance : Number.POSITIVE_INFINITY;
    const objDist = objHit?.instanceId !== undefined ? objHit.distance : Number.POSITIVE_INFINITY;

    if (cowDist < objDist) {
      const ent = this.cowInstancer.entityFromInstanceId(/** @type {number} */ (cowHit.instanceId));
      if (ent !== null) return this.#cowLabel(ent);
    }
    if (objDist < Number.POSITIVE_INFINITY) {
      const ent = this.objectHitboxes.entityFromInstanceId(
        /** @type {number} */ (objHit.instanceId),
      );
      if (ent !== null) return this.#objectLabel(ent);
    }

    if (!tileHit) return null;
    const tile = pickTileFromEvent(e, this.dom, this.camera, this.getTileMesh(), this.grid);
    if (!tile) return null;

    // Stations occupy a whole tile but aren't in the object hitbox registry
    // (they have their own StationSelector UX), so they need a separate
    // tile-based lookup.
    if (this.#entityAt(tile.i, tile.j, 'Furnace') !== null) return 'Furnace';
    if (this.#entityAt(tile.i, tile.j, 'Easel') !== null) return 'Easel';

    // Cow proximity fallback: at RTS zoom a moving cow can be a few pixels
    // wide, so grab any cow within a tile of the tile-hit point.
    const p = tileHit.point;
    let best = /** @type {number | null} */ (null);
    let bestD2 = PICK_RADIUS * PICK_RADIUS;
    for (const { id, components } of this.world.query(['Cow', 'Position'])) {
      const pos = components.Position;
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = id;
      }
    }
    if (best !== null) return this.#cowLabel(best);

    const itemId = this.#entityAt(tile.i, tile.j, 'Item');
    if (itemId !== null) return this.#itemLabel(itemId);

    return this.#terrainLabel(tile.i, tile.j);
  }

  /** @param {number} i @param {number} j @param {string} comp */
  #entityAt(i, j, comp) {
    for (const { id, components } of this.world.query([comp, 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i === i && a.j === j) return id;
    }
    return null;
  }

  /** @param {number} id */
  #cowLabel(id) {
    const brain = this.world.get(id, 'Brain');
    return brain?.name ? `Cow: ${brain.name}` : 'Cow';
  }

  /** @param {number} id */
  #objectLabel(id) {
    const entry = objectTypeFor(this.world, id);
    if (!entry) return null;
    const label = entry.label(this.world, id);
    const sub = entry.subtitle?.(this.world, id);
    return sub ? `${label} · ${sub}` : label;
  }

  /** @param {number} id */
  #itemLabel(id) {
    const item = this.world.get(id, 'Item');
    if (!item) return 'Item';
    const info = ITEM_INFO[item.kind];
    const name = info?.label ?? item.kind;
    return item.count > 1 ? `${name} ×${item.count}` : name;
  }

  /** @param {number} i @param {number} j */
  #terrainLabel(i, j) {
    const biome = this.tileGrid.getBiome(i, j);
    const name = BIOME_LABELS[biome] ?? 'Terrain';
    return `${name} (${i}, ${j})`;
  }
}
