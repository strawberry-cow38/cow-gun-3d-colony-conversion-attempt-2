/**
 * Bottom-right "what's under the cursor" readout. Listens for mousemove on
 * the canvas and picks the closest hit from the cow hitbox mesh, the
 * object hitbox mesh, and the tile mesh. Fallbacks handle items and bare
 * terrain labels.
 *
 * Throttled to ~10Hz. The tile mesh raycast walks ~40k triangles (one giant
 * BufferGeometry, no BVH) — doing that at rAF cadence on fast mice halved
 * the framerate just from mouse movement. It's also deferred until after
 * the cheap instanced-mesh picks so we skip it entirely when a cow or
 * object wins.
 */

import * as THREE from 'three';
import { objectTypeFor } from '../ui/objectTypes.js';
import { worldToTile } from '../world/coords.js';
import { ITEM_INFO } from '../world/items.js';
import { BIOME } from '../world/tileGrid.js';

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

// Tile mesh is one giant BufferGeometry (~40k tris, no BVH). Each raycast
// against it walks every tri, so cap label refresh to ~10Hz — human eye
// can't read a tooltip faster and mousemove fires at 120Hz on fast mice.
const RESOLVE_INTERVAL_MS = 100;

export class HoverTooltip {
  /**
   * @param {{
   *   dom: HTMLElement,
   *   el: HTMLElement,
   *   camera: import('three').PerspectiveCamera,
   *   tileMesh: () => import('three').Group,
   *   grid: { W: number, H: number },
   *   tileGrid: import('../world/tileGrid.js').TileGrid,
   *   world: import('../ecs/world.js').World,
   *   cowHitboxes: { mesh: import('three').InstancedMesh, entityFromInstanceId: (i: number) => number | null },
   *   objectHitboxes: { mesh: import('three').InstancedMesh, entityFromInstanceId: (i: number) => number | null },
   * }} opts
   */
  constructor({ dom, el, camera, tileMesh, grid, tileGrid, world, cowHitboxes, objectHitboxes }) {
    this.dom = dom;
    this.el = el;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.grid = grid;
    this.tileGrid = tileGrid;
    this.world = world;
    this.cowHitboxes = cowHitboxes;
    this.objectHitboxes = objectHitboxes;
    this.pending = /** @type {MouseEvent | null} */ (null);
    this.scheduled = false;
    this.lastResolveMs = 0;
    this.lastText = '';
    dom.addEventListener('mousemove', (e) => this.#onMove(e));
    dom.addEventListener('mouseleave', () => this.#hide());
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    this.pending = e;
    if (this.scheduled) return;
    const now = performance.now();
    const since = now - this.lastResolveMs;
    const delay = since >= RESOLVE_INTERVAL_MS ? 0 : RESOLVE_INTERVAL_MS - since;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      this.lastResolveMs = performance.now();
      const ev = this.pending;
      this.pending = null;
      if (ev) this.#resolve(ev);
    }, delay);
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

    // Cheap picks first — instanced meshes with real bounding spheres, so
    // the frustum/sphere rejection skips most of the scene before we touch
    // any triangles. Tile raycast is the expensive one (~40k tris, no BVH)
    // and only runs if neither cow nor object gives us a label.
    const cowHit = _raycaster.intersectObject(this.cowHitboxes.mesh, false)[0];
    const objHit = _raycaster.intersectObject(this.objectHitboxes.mesh, false)[0];
    const cowDist = cowHit?.instanceId !== undefined ? cowHit.distance : Number.POSITIVE_INFINITY;
    const objDist = objHit?.instanceId !== undefined ? objHit.distance : Number.POSITIVE_INFINITY;

    // Closest hit wins so a wall in front of a cow behind a roof sorts
    // correctly without manual priority rules. Only skip the tile pick when
    // the winning instanced hit actually resolves to a label — otherwise
    // fall through to the tile path.
    if (cowDist < objDist) {
      const ent = this.cowHitboxes.entityFromInstanceId(/** @type {number} */ (cowHit.instanceId));
      if (ent !== null) return this.#cowLabel(ent);
    }
    if (objDist < Number.POSITIVE_INFINITY) {
      const ent = this.objectHitboxes.entityFromInstanceId(
        /** @type {number} */ (objHit.instanceId),
      );
      if (ent !== null) {
        const label = this.#objectLabel(ent) ?? this.#stationLabel(ent);
        if (label) return label;
      }
    }

    const tileHit = _raycaster.intersectObject(this.getTileMesh(), true)[0];
    if (!tileHit) return null;
    const p = tileHit.point;
    const tile = worldToTile(p.x, p.z, this.grid.W, this.grid.H);
    if (tile.i < 0) return null;

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
  #stationLabel(id) {
    if (this.world.get(id, 'Furnace')) return 'Furnace';
    if (this.world.get(id, 'Easel')) return 'Easel';
    if (this.world.get(id, 'Stove')) return 'Stove';
    return null;
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
