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
import { findAdjacentWalkable } from '../jobs/chop.js';
import { defaultWalkable } from '../sim/pathfinding.js';
import {
  ROOF_MAX_WALL_DISTANCE,
  hasOrthoStructure,
  roofIsSupported,
  structureWithinChebyshev,
} from '../systems/autoRoof.js';
import { TORCH_RADIUS_TILES } from '../systems/lighting.js';
import { bedFootprintTiles } from '../world/bed.js';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld, worldToTile } from '../world/coords.js';
import { FACING_OFFSETS, FACING_YAWS } from '../world/facing.js';
import { stairFootprintTiles } from '../world/stair.js';
import { stoveFootprintTiles } from '../world/stove.js';
import { DEFAULT_STUFF, STUFF } from '../world/stuff.js';
import { LAYER_HEIGHT, WALL_FILL_FULL } from '../world/tileGrid.js';
import { createBedGhost } from './bedInstancer.js';
import { createDragSizeLabel } from './dragSizeLabel.js';
import { createFurnaceGhost } from './furnaceInstancer.js';
import { createStairGhost } from './stairInstancer.js';
import { createStoveGhost } from './stoveInstancer.js';

const _ndc = new THREE.Vector2();
const PREVIEW_CLEARANCE = 0.08 * UNITS_PER_METER;
const PREVIEW_COLOR_REMOVE = 0xff6a4a;
const WORK_SPOT_COLOR = 0x7cffb0;

/** Station kinds that have a facing (R-cycles during placement). */
const FACING_KINDS = new Set(['furnace', 'easel', 'stove', 'bed', 'stair']);
/** Wall-family kinds: full, half, quarter. All stack via BuildSite.baseFill. */
const WALL_FAMILY = new Set(['wall', 'halfWall', 'quarterWall']);
/** Fill contributed per wall-family BuildSite kind, in quarter-layer units. */
const WALL_TIER_BY_KIND = /** @type {Record<string, number>} */ ({
  wall: 4,
  halfWall: 2,
  quarterWall: 1,
});
/** Inverse of WALL_TIER_BY_KIND — used when placement downgrades tier to fit. */
const KIND_BY_WALL_TIER = /** @type {Record<number, string>} */ ({
  4: 'wall',
  2: 'halfWall',
  1: 'quarterWall',
});

/**
 * Largest wall tier (4 / 2 / 1) that fits in `room` quarter-units, or 0 if
 * none. Used by placement to downgrade a wall click when the requested tier
 * would overflow the tile's remaining wall budget — clicking "full wall" on
 * a half wall places a half-wall blueprint to top it off, instead of jumping
 * to z+1 and failing the support check.
 * @param {number} room
 */
function largestWallTierFitting(room) {
  if (room >= 4) return 4;
  if (room >= 2) return 2;
  if (room >= 1) return 1;
  return 0;
}
/** Facing kinds that also have a "work here" tile preview. Beds don't — cows
 * just climb onto the mattress, there's no adjacent stand tile. */
const WORK_SPOT_KINDS = new Set(['furnace', 'easel', 'stove']);

/**
 * @typedef {Object} BuildDesignatorConfig
 * @property {'wall' | 'halfWall' | 'quarterWall' | 'door' | 'torch' | 'wallTorch' | 'roof' | 'floor' | 'furnace' | 'easel' | 'stove' | 'bed' | 'stair'} kind - BuildSite.kind to spawn
 * @property {number} previewColorAdd - hex color for ADD preview line + label border
 * @property {string} addVerb - label verb on add ("build", "door")
 * @property {string} cancelVerb - label verb on cancel ("cancel", "cancel door")
 * @property {boolean} [singlePlace] - if true, mousedown places exactly one
 *   tile (doors + torches). No drag, no size label; a one-tile hover preview
 *   tracks the cursor instead.
 * @property {number} [previewRadiusTiles] - if set, draw a circle at this
 *   tile-radius around the single-place hover preview (e.g. torch light reach).
 * @property {number} [required] - material units required (default 1). 0 =
 *   free build, no haul phase (roofs).
 * @property {string} [requiredKind] - item kind (default 'wood'). Ignored when
 *   `stuffed` is true — the stuff registry drives the item kind instead.
 * @property {boolean} [stuffed] - if true, this kind honors the stuff system:
 *   the designator tracks a `currentStuff` material (wood, stone, …) and
 *   stamps it onto spawned BuildSites. Torches stay wood-only (stuffed:false).
 */

/** @type {BuildDesignatorConfig} */
export const WALL_DESIGNATOR_CONFIG = {
  kind: 'wall',
  previewColorAdd: 0xe9d477,
  addVerb: 'build',
  cancelVerb: 'cancel',
  stuffed: true,
};

/** @type {BuildDesignatorConfig} */
export const HALF_WALL_DESIGNATOR_CONFIG = {
  kind: 'halfWall',
  previewColorAdd: 0xe9c060,
  addVerb: 'half wall',
  cancelVerb: 'cancel half wall',
  stuffed: true,
};

/** @type {BuildDesignatorConfig} */
export const QUARTER_WALL_DESIGNATOR_CONFIG = {
  kind: 'quarterWall',
  previewColorAdd: 0xe9a850,
  addVerb: 'quarter wall',
  cancelVerb: 'cancel quarter wall',
  stuffed: true,
};

/** @type {BuildDesignatorConfig} */
export const DOOR_DESIGNATOR_CONFIG = {
  kind: 'door',
  previewColorAdd: 0xffb070,
  addVerb: 'door',
  cancelVerb: 'cancel door',
  singlePlace: true,
  stuffed: true,
};

/** @type {BuildDesignatorConfig} */
export const TORCH_DESIGNATOR_CONFIG = {
  kind: 'torch',
  previewColorAdd: 0xffb84a,
  addVerb: 'torch',
  cancelVerb: 'cancel torch',
  singlePlace: true,
  previewRadiusTiles: TORCH_RADIUS_TILES,
};

/** @type {BuildDesignatorConfig} */
export const WALL_TORCH_DESIGNATOR_CONFIG = {
  kind: 'wallTorch',
  previewColorAdd: 0xffd070,
  addVerb: 'wall torch',
  cancelVerb: 'cancel wall torch',
  singlePlace: true,
  previewRadiusTiles: TORCH_RADIUS_TILES,
};

/** @type {BuildDesignatorConfig} */
export const ROOF_DESIGNATOR_CONFIG = {
  kind: 'roof',
  previewColorAdd: 0xc0a080,
  addVerb: 'roof',
  cancelVerb: 'cancel roof',
  required: 0,
  stuffed: true,
};

/** @type {BuildDesignatorConfig} */
export const FLOOR_DESIGNATOR_CONFIG = {
  kind: 'floor',
  previewColorAdd: 0xbf9a6a,
  addVerb: 'floor',
  cancelVerb: 'cancel floor',
  stuffed: true,
};

/** @type {BuildDesignatorConfig} */
export const FURNACE_DESIGNATOR_CONFIG = {
  kind: 'furnace',
  previewColorAdd: 0xd2785a,
  addVerb: 'furnace',
  cancelVerb: 'cancel furnace',
  singlePlace: true,
  required: 15,
  requiredKind: 'stone',
};

/** @type {BuildDesignatorConfig} */
export const EASEL_DESIGNATOR_CONFIG = {
  kind: 'easel',
  previewColorAdd: 0xd8b26a,
  addVerb: 'easel',
  cancelVerb: 'cancel easel',
  singlePlace: true,
  required: 8,
  requiredKind: 'wood',
};

/** @type {BuildDesignatorConfig} */
export const STOVE_DESIGNATOR_CONFIG = {
  kind: 'stove',
  previewColorAdd: 0xd2b98a,
  addVerb: 'stove',
  cancelVerb: 'cancel stove',
  singlePlace: true,
  required: 25,
  requiredKind: 'stone',
};

/** @type {BuildDesignatorConfig} */
export const STAIR_DESIGNATOR_CONFIG = {
  kind: 'stair',
  previewColorAdd: 0xb0c8e9,
  addVerb: 'stair',
  cancelVerb: 'cancel stair',
  singlePlace: true,
  required: 10,
  stuffed: true,
};

/** @type {BuildDesignatorConfig} */
export const BED_DESIGNATOR_CONFIG = {
  kind: 'bed',
  previewColorAdd: 0x8fbcdb,
  addVerb: 'bed',
  cancelVerb: 'cancel bed',
  singlePlace: true,
  required: 8,
  requiredKind: 'wood',
};

export class BuildDesignator {
  /**
   * `deconstructOverlay` is the dirty-flag sink for the door-on-wall path:
   * queuing a wall deconstruct needs to tip the overlay so the red tile
   * marker appears.
   *
   * @param {{
   *   config: BuildDesignatorConfig,
   *   canvas: HTMLElement,
   *   camera: THREE.PerspectiveCamera,
   *   tileMesh: () => THREE.Group,
   *   tileGrid: import('../world/tileGrid.js').TileGrid,
   *   tileWorld?: import('../world/tileWorld.js').TileWorld,
   *   world: import('../ecs/world.js').World,
   *   jobBoard: import('../jobs/board.js').JobBoard,
   *   buildSiteInstancer: { markDirty: () => void },
   *   scene: THREE.Scene,
   *   onChanged: () => void,
   *   audio?: { play: (kind: string) => void },
   *   deconstructOverlay?: { markDirty: () => void },
   * }} opts
   */
  constructor({
    config,
    canvas,
    camera,
    tileMesh,
    tileGrid,
    tileWorld,
    world,
    jobBoard,
    buildSiteInstancer,
    scene,
    onChanged,
    audio,
    deconstructOverlay,
  }) {
    this.config = config;
    this.dom = canvas;
    this.camera = camera;
    this.getTileMesh = tileMesh;
    this.tileGrid = tileGrid;
    this.tileWorld = tileWorld;
    this.world = world;
    this.board = jobBoard;
    this.buildSites = buildSiteInstancer;
    this.onStateChanged = onChanged;
    this.audio = audio;
    this.deconstructOverlay = deconstructOverlay;
    this.active = false;
    /** @type {string} */
    this.currentStuff = DEFAULT_STUFF;
    /** Furnace facing 0..3 (S/E/N/W). Cycled with R while the tool is active. */
    this.currentFacing = 0;
    this.raycaster = new THREE.Raycaster();
    this.mousedown = false;
    this.removing = false;
    /** @type {{ i: number, j: number } | null} */
    this.startTile = null;
    /** @type {{ i: number, j: number } | null} */
    this.curTile = null;

    this.preview = buildPreview(scene, config.previewColorAdd);
    this.sizeLabel = createDragSizeLabel({
      addVerb: config.addVerb,
      cancelVerb: config.cancelVerb,
      addHex: config.previewColorAdd,
      removeHex: PREVIEW_COLOR_REMOVE,
    });
    this.radiusRing = config.previewRadiusTiles
      ? buildRadiusRing(scene, config.previewColorAdd, (config.previewRadiusTiles - 1) * TILE_SIZE)
      : null;
    // Furnace ghost: translucent silhouette at the hover tile + a green wire
    // square at the interaction spot (where cows will stand). Both ride along
    // the cursor so the player can see footprint AND facing-implied workspot
    // before committing.
    this.furnaceGhost = config.kind === 'furnace' ? createFurnaceGhost(scene) : null;
    this.stoveGhost = config.kind === 'stove' ? createStoveGhost(scene) : null;
    this.bedGhost = config.kind === 'bed' ? createBedGhost(scene) : null;
    this.stairGhost = config.kind === 'stair' ? createStairGhost(scene) : null;
    this.workSpotPreview = WORK_SPOT_KINDS.has(config.kind)
      ? buildPreview(scene, WORK_SPOT_COLOR)
      : null;

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
    if (!this.active) return;
    if (e.code === 'Escape') {
      this.deactivate();
      return;
    }
    if (e.code === 'KeyR' && FACING_KINDS.has(this.config.kind)) {
      const step = e.shiftKey ? 3 : 1;
      this.currentFacing = (this.currentFacing + step) % 4;
      this.#renderPreview();
    }
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

  /**
   * Pick the material that future BuildSite spawns from this designator will
   * request. No-op for designators with `stuffed !== true` (torches), since
   * those don't consult the stuff registry.
   * @param {string} id
   */
  setStuff(id) {
    if (!this.config.stuffed) return;
    if (!STUFF[id]) return;
    if (this.currentStuff === id) return;
    this.currentStuff = id;
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
    this.sizeLabel.render(e, this.startTile, this.curTile, this.removing);
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
    if (!this.mousedown) {
      // Drag-mode hover: 1-tile preview at the cursor so the player can see
      // where a click would start before pressing.
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
    const tile = this.#pickTile(e);
    if (!tile) return;
    this.curTile = tile;
    this.#renderPreview();
    this.sizeLabel.render(e, this.startTile, this.curTile, this.removing);
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
    const kind = this.config.kind;
    const isRoof = kind === 'roof';
    const isDoor = kind === 'door';
    const isWallTorch = kind === 'wallTorch';
    const isFloor = kind === 'floor';
    const isStove = kind === 'stove';
    if (isStove) {
      const footprint = stoveFootprintTiles({ i, j }, this.currentFacing);
      for (const t of footprint) {
        if (!this.tileGrid.inBounds(t.i, t.j)) return false;
        if (this.tileGrid.isBlocked(t.i, t.j)) return false;
        if (this.tileGrid.isDoor(t.i, t.j)) return false;
        if (this.tileGrid.isTorch(t.i, t.j)) return false;
        if (this.tileGrid.isStockpile(t.i, t.j)) return false;
        if (this.#findSiteAt(t.i, t.j, (k) => k !== 'roof' && k !== 'floor') !== null) {
          return false;
        }
      }
      // Reserve the flanking footprint tiles immediately so no cow wanders
      // (or gets picked as a build stand-tile) onto a tile that's about to
      // be blocked when the build completes. The anchor stays walkable since
      // haulers deliver materials there.
      for (const t of footprint) {
        if (t.i === i && t.j === j) continue;
        this.tileGrid.blockTile(t.i, t.j);
      }
      const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
      this.world.spawn({
        BuildSite: {
          kind,
          stuff: 'stone',
          requiredKind: this.config.requiredKind ?? 'stone',
          required: this.config.required ?? 1,
          delivered: 0,
          buildJobId: 0,
          progress: 0,
          facing: this.currentFacing,
        },
        BuildSiteViz: {},
        TileAnchor: { i, j },
        Position: { x: w.x, y: this.tileGrid.getElevation(i, j), z: w.z },
      });
      return true;
    }
    if (kind === 'stair') {
      const bottomZ = this.tileWorld?.activeZ ?? 0;
      const depth = this.tileWorld?.layers.length ?? 1;
      // Stair writes a ramp on bottomZ and a floor on bottomZ+1; bail if the
      // upper layer isn't in the stack so we never spawn a dangling blueprint.
      if (bottomZ + 1 >= depth) return false;
      const bottomLayer = this.tileWorld?.layers[bottomZ] ?? this.tileGrid;
      const topLayer = this.tileWorld?.layers[bottomZ + 1] ?? null;
      const footprint = stairFootprintTiles({ i, j }, this.currentFacing);
      for (const t of footprint) {
        if (!bottomLayer.inBounds(t.i, t.j)) return false;
        if (bottomLayer.isBlocked(t.i, t.j)) return false;
        if (bottomLayer.isDoor(t.i, t.j)) return false;
        if (bottomLayer.isTorch(t.i, t.j)) return false;
        if (bottomLayer.isStockpile(t.i, t.j)) return false;
        if (bottomLayer.isRamp(t.i, t.j)) return false;
        if (this.#findSiteAt(t.i, t.j, (k) => k !== 'roof', bottomZ) !== null) return false;
      }
      // Upper-level stairs need a floor / wall-top on every footprint tile to
      // actually stand on — otherwise the ramp would hang in the air above the
      // ground layer. Support mirrors the pathfinder's z>0 passable rule.
      if (bottomZ > 0) {
        for (const t of footprint) {
          if (!this.#hasUpperSupport(t.i, t.j, bottomZ)) return false;
        }
      }
      // Top landing lives on bottomZ+1; reject if that tile is already claimed
      // on the upper layer (walls, blueprints, existing floor etc.).
      const landing = stairFootprintTiles({ i, j }, this.currentFacing).at(-1);
      if (landing && topLayer) {
        if (topLayer.isBlocked(landing.i, landing.j)) return false;
        if (this.#findSiteAt(landing.i, landing.j, () => true, bottomZ + 1) !== null) return false;
      }
      const stuff = this.config.stuffed ? this.currentStuff : null;
      const requiredKind = stuff ? STUFF[stuff].itemKind : (this.config.requiredKind ?? 'wood');
      const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
      this.world.spawn({
        BuildSite: {
          kind,
          stuff: stuff ?? 'wood',
          requiredKind,
          required: this.config.required ?? 1,
          delivered: 0,
          buildJobId: 0,
          progress: 0,
          facing: this.currentFacing,
        },
        BuildSiteViz: {},
        TileAnchor: { i, j, z: bottomZ },
        Position: { x: w.x, y: this.tileGrid.getElevation(i, j) + bottomZ * LAYER_HEIGHT, z: w.z },
      });
      return true;
    }
    const isBed = kind === 'bed';
    if (isBed) {
      const footprint = bedFootprintTiles({ i, j }, this.currentFacing);
      for (const t of footprint) {
        if (!this.tileGrid.inBounds(t.i, t.j)) return false;
        if (this.tileGrid.isBlocked(t.i, t.j)) return false;
        if (this.tileGrid.isDoor(t.i, t.j)) return false;
        if (this.tileGrid.isTorch(t.i, t.j)) return false;
        if (this.tileGrid.isStockpile(t.i, t.j)) return false;
        if (this.#findSiteAt(t.i, t.j, (k) => k !== 'roof' && k !== 'floor') !== null) {
          return false;
        }
      }
      // Beds stay walkable (cows need to lie on them), so no blockTile here.
      const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
      this.world.spawn({
        BuildSite: {
          kind,
          stuff: 'wood',
          requiredKind: this.config.requiredKind ?? 'wood',
          required: this.config.required ?? 1,
          delivered: 0,
          buildJobId: 0,
          progress: 0,
          facing: this.currentFacing,
        },
        BuildSiteViz: {},
        TileAnchor: { i, j },
        Position: { x: w.x, y: this.tileGrid.getElevation(i, j), z: w.z },
      });
      return true;
    }
    // Wall-family (wall / halfWall / quarterWall) has its own multi-step path:
    // a single click may spawn several blueprints in sequence to cover the
    // requested quarter-unit tier, crossing z boundaries as needed (e.g. click
    // "full wall" on a 1/4 wall → tops off z=0 with 3 quarters, then drops a
    // 1/4 on z=1). Hops out of the generic flow before the non-wall guards.
    if (WALL_FAMILY.has(kind)) return this.#designateWallStack(i, j, WALL_TIER_BY_KIND[kind]);
    const layer = this.tileGrid;
    if (isRoof) {
      if (layer.isRoof(i, j)) return false;
      if (!hasRoofSupport(layer, this.world, i, j)) return false;
    } else if (isFloor) {
      // Floors sit on the ground plane but don't block anything. Skip tiles
      // already floored, walled (wall replaces the ground), or occupied by
      // natural blockers (tree/rock). Doors, torches, stockpiles, and roofs
      // are fine overhead or co-located — they don't hide the floor.
      if (layer.isFloor(i, j)) return false;
      if (layer.isBlocked(i, j)) return false;
    } else {
      // Doors can be placed on full-height walls — queued as "deconstruct
      // wall, then build door on the cleared tile" below. Partial walls can't
      // host a door and everything else keeps the hard blocked check.
      if (layer.isBlocked(i, j) && !(isDoor && layer.isFullWall(i, j))) return false;
      if (layer.isDoor(i, j)) return false;
      if (layer.isTorch(i, j)) return false;
    }
    // Wall torches need an orthogonal wall to mount on — they hang off its
    // face and would be visually orphaned floating in an open tile.
    if (isWallTorch && !hasOrthoStructure(layer, i, j)) return false;
    // Torches + floors are decorative and non-blocking; letting them sit on
    // stockpile tiles means players can floor/light a storage area without
    // having to redraw the stockpile around them. Roofs don't touch the
    // ground plane so stockpiles underneath them are fine too.
    if (!isRoof && !isFloor && kind !== 'torch' && !isWallTorch && layer.isStockpile(i, j)) {
      return false;
    }
    // Roofs sit above, floors below, and everything else shares the ground
    // plane. Blueprints only conflict with others in the same plane.
    const samePlane = isRoof
      ? /** @param {string} k */ (k) => k === 'roof'
      : isFloor
        ? /** @param {string} k */ (k) => k === 'floor'
        : /** @param {string} k */ (k) => k !== 'roof' && k !== 'floor';
    const existingSiteId = this.#findSiteAt(i, j, samePlane, 0);
    if (existingSiteId !== null) {
      // Door over wall blueprint: upgrade the plan in-place — cancel the
      // wall blueprint (refunds delivered resources) and drop through to
      // spawn the door blueprint. Only full-wall blueprints convert; half
      // or quarter can't host a door.
      if (isDoor) {
        const existingSite = this.world.get(existingSiteId, 'BuildSite');
        if (existingSite && existingSite.kind === 'wall') {
          releaseBuildSite(this.world, this.board, this.tileGrid, existingSite, i, j);
          this.world.despawn(existingSiteId);
        } else {
          return false;
        }
      } else {
        return false;
      }
    }
    // Door over built wall: queue the wall's deconstruct. The haul poster
    // holds the door's build job until grid.isFullWall flips back to 0.
    if (isDoor && this.tileGrid.isFullWall(i, j)) {
      this.#queueWallDeconstructAt(i, j);
    }
    const stuff = this.config.stuffed ? this.currentStuff : null;
    const requiredKind = stuff ? STUFF[stuff].itemKind : (this.config.requiredKind ?? 'wood');
    const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
    const y = this.tileGrid.getElevation(i, j);
    this.world.spawn({
      BuildSite: {
        kind,
        stuff: stuff ?? 'wood',
        requiredKind,
        required: this.config.required ?? 1,
        delivered: 0,
        buildJobId: 0,
        progress: 0,
        facing: FACING_KINDS.has(kind) ? this.currentFacing : 0,
        baseFill: 0,
      },
      BuildSiteViz: {},
      TileAnchor: { i, j, z: 0 },
      Position: { x: w.x, y, z: w.z },
    });
    return true;
  }

  /**
   * Spawn one or more wall-family blueprints at (i,j) to cover `requestedTier`
   * quarter-units, advancing through z-layers as each one fills. Returns true
   * if at least one blueprint was placed.
   *
   * The click's requested tier isn't capped to one layer: clicking "full wall"
   * (tier 4) on a tile whose z=0 already has a 1/4 wall yields a halfWall +
   * quarterWall on z=0 (filling it) plus a quarterWall on z=1. That's what
   * lets players mix-and-match partial walls without having to click each
   * piece individually.
   *
   * Per-step guards mirror the non-wall flow: the layer's tile can't host a
   * tree/rock, door, torch, or stockpile, and z>0 needs upper support (which
   * re-queries pending fills after each spawn so a just-filled z=0 counts as
   * support for the next z=1 step).
   *
   * @param {number} i @param {number} j @param {number} requestedTier
   */
  #designateWallStack(i, j, requestedTier) {
    const stuff = this.config.stuffed ? this.currentStuff : null;
    const requiredKind = stuff ? STUFF[stuff].itemKind : (this.config.requiredKind ?? 'wood');
    const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
    let remaining = requestedTier;
    let any = false;
    while (remaining > 0) {
      const step = this.#resolveWallPlacement(i, j, remaining);
      if (!step) break;
      const layer =
        step.z === 0 ? this.tileGrid : (this.tileWorld?.layers[step.z] ?? this.tileGrid);
      if (step.z > 0 && !this.#hasUpperSupport(i, j, step.z)) break;
      if (layer.isOccupied(i, j)) break;
      if (layer.isDoor(i, j)) break;
      if (layer.isTorch(i, j)) break;
      if (layer.isStockpile(i, j)) break;
      // A finished full wall covers the floor entirely, so any pending floor
      // blueprint at z=0 under a ground-layer wall is wasted work — cancel it
      // to refund materials. Only fires when a full-tier piece lands on z=0.
      if (step.tier === WALL_FILL_FULL && step.z === 0) {
        const floorSiteId = this.#findSiteAt(i, j, (k) => k === 'floor');
        if (floorSiteId !== null) {
          const floorSite = this.world.get(floorSiteId, 'BuildSite');
          if (floorSite) {
            releaseBuildSite(this.world, this.board, this.tileGrid, floorSite, i, j);
            this.world.despawn(floorSiteId);
          }
        }
      }
      const y = this.tileGrid.getElevation(i, j) + step.z * LAYER_HEIGHT;
      this.world.spawn({
        BuildSite: {
          kind: step.kind,
          stuff: stuff ?? 'wood',
          requiredKind,
          required: this.config.required ?? 1,
          delivered: 0,
          buildJobId: 0,
          progress: 0,
          facing: 0,
          baseFill: step.baseFill,
        },
        BuildSiteViz: {},
        TileAnchor: { i, j, z: step.z },
        Position: { x: w.x, y, z: w.z },
      });
      remaining -= step.tier;
      any = true;
    }
    return any;
  }

  /**
   * Support check for "standing on (i, j) at layer z". Mirrors the pathfinder's
   * z>0 passable rule (wall or ramp below, or a floor on the same layer), plus
   * pending wall/floor blueprints so the player can plan multi-story buildings
   * top-down. z===0 is always supported (ground is solid).
   *
   * Reused by the stair footprint check and the wall-floating prevention
   * check — any blueprint that needs "something to stand on" routes here.
   *
   * @param {number} i @param {number} j @param {number} z
   */
  #hasUpperSupport(i, j, z) {
    if (z === 0) return true;
    const below = this.tileWorld?.layers[z - 1];
    if (below) {
      if (below.isFullWall(i, j)) return true;
      if (below.isRamp(i, j)) return true;
    }
    const here = this.tileWorld?.layers[z] ?? this.tileGrid;
    if (here.isFloor(i, j)) return true;
    if (this.#pendingWallFillAt(i, j, z - 1) >= WALL_FILL_FULL) return true;
    if (this.#findSiteAt(i, j, (k) => k === 'floor', z) !== null) return true;
    return false;
  }

  /**
   * Sum of built + pending wall-family fill at (i,j,z), in quarter units.
   * Drives auto-stacking so two halfWall blueprints at the same tile land at
   * baseFill 0 and baseFill 2.
   * @param {number} i @param {number} j @param {number} z
   */
  #pendingWallFillAt(i, j, z) {
    const layer = z === 0 ? this.tileGrid : this.tileWorld?.layers[z];
    let fill = layer ? layer.wallFill(i, j) : 0;
    for (const { components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      if ((a.z | 0) !== z) continue;
      const tier = WALL_TIER_BY_KIND[components.BuildSite.kind];
      if (tier) fill += tier;
    }
    return fill;
  }

  /**
   * Pick a z, baseFill, and effective tier for a wall-family blueprint of
   * `requestedTier` quarter-units at (i,j). Scans from activeZ upward and
   * picks the first layer with any remaining wall budget; if the requested
   * tier doesn't fit at that layer, downgrades to the largest tier that does
   * (4 → 2 → 1). Returns null when no layer has any room — the caller bails.
   *
   * The downgrade is what makes "click full wall on a half wall" do the
   * intuitive thing (top it off with a half-wall blueprint) instead of
   * jumping to z+1 where there's no support.
   *
   * @param {number} i @param {number} j @param {number} requestedTier
   * @returns {{ z: number, baseFill: number, tier: number, kind: string } | null}
   */
  #resolveWallPlacement(i, j, requestedTier) {
    const activeZ = this.tileWorld?.activeZ ?? 0;
    const depth = this.tileWorld?.layers.length ?? 1;
    for (let z = activeZ; z < depth; z++) {
      const fill = this.#pendingWallFillAt(i, j, z);
      const room = WALL_FILL_FULL - fill;
      if (room <= 0) continue;
      const tier = Math.min(requestedTier, largestWallTierFitting(room));
      if (tier <= 0) continue;
      return { z, baseFill: fill, tier, kind: KIND_BY_WALL_TIER[tier] };
    }
    return null;
  }

  /** @param {number} i @param {number} j */
  #queueWallDeconstructAt(i, j) {
    for (const { id, components } of this.world.query(['Wall', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      const wall = components.Wall;
      if (wall.deconstructJobId > 0) return;
      const job = this.board.post('deconstruct', {
        entityId: id,
        kind: 'wall',
        i,
        j,
      });
      wall.deconstructJobId = job.id;
      wall.progress = 0;
      this.deconstructOverlay?.markDirty();
      return;
    }
  }

  /** @param {number} i @param {number} j */
  #cancelTile(i, j) {
    // Only cancel blueprints of our own kind so wall/door modes don't step on
    // each other's pending work on shared tiles. Walls auto-pick the highest
    // blueprint z at (i,j) — mirrors the auto-stack placement so cancel eats
    // the topmost layer first (and the player can click twice to peel two
    // stacked blueprints).
    const kind = this.config.kind;
    let id;
    if (kind === 'stove') id = this.#findStoveSiteCovering(i, j);
    else if (kind === 'bed') id = this.#findBedSiteCovering(i, j);
    else if (kind === 'stair') id = this.#findStairSiteCovering(i, j);
    else if (WALL_FAMILY.has(kind)) id = this.#findTopmostWallSiteAt(i, j);
    else id = this.#findSiteAt(i, j, (k) => k === kind, 0);
    if (id === null) return false;
    const site = this.world.get(id, 'BuildSite');
    if (!site) return false;
    releaseBuildSite(this.world, this.board, this.tileGrid, site, i, j);
    this.world.despawn(id);
    return true;
  }

  /**
   * Topmost wall-family blueprint at (i,j), ordered by (z, baseFill). Used by
   * wall cancel so the player peels stacked blueprints from the top down —
   * any wall/halfWall/quarterWall designator cancels any tier, since a single
   * "full wall" click may have spawned a mix of tiers across layers.
   * @param {number} i @param {number} j
   */
  #findTopmostWallSiteAt(i, j) {
    let bestId = null;
    let bestRank = -1;
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      if (!WALL_FAMILY.has(components.BuildSite.kind)) continue;
      const z = a.z | 0;
      const baseFill = components.BuildSite.baseFill | 0;
      const rank = z * (WALL_FILL_FULL + 1) + baseFill;
      if (rank > bestRank) {
        bestRank = rank;
        bestId = id;
      }
    }
    return bestId;
  }

  /**
   * @param {number} i @param {number} j
   * @param {(kind: string) => boolean} [matchKind]
   * @param {number} [z]  layer to match (default 0). TileAnchor.z is treated
   *   as 0 when absent so pre-z-aware callers keep working.
   */
  #findSiteAt(i, j, matchKind, z = 0) {
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      if ((a.z | 0) !== z) continue;
      if (matchKind && !matchKind(components.BuildSite.kind)) continue;
      return id;
    }
    return null;
  }

  /**
   * Cancel needs to match the stove blueprint whose 3-tile footprint includes
   * the clicked tile, since the player can click any of the three positions.
   * @param {number} i @param {number} j
   */
  #findStoveSiteCovering(i, j) {
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const site = components.BuildSite;
      if (site.kind !== 'stove') continue;
      const anchor = components.TileAnchor;
      for (const t of stoveFootprintTiles(anchor, site.facing | 0)) {
        if (t.i === i && t.j === j) return id;
      }
    }
    return null;
  }

  /** @param {number} i @param {number} j */
  #findStairSiteCovering(i, j) {
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const site = components.BuildSite;
      if (site.kind !== 'stair') continue;
      const anchor = components.TileAnchor;
      for (const t of stairFootprintTiles(anchor, site.facing | 0)) {
        if (t.i === i && t.j === j) return id;
      }
    }
    return null;
  }

  /** @param {number} i @param {number} j */
  #findBedSiteCovering(i, j) {
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const site = components.BuildSite;
      if (site.kind !== 'bed') continue;
      const anchor = components.TileAnchor;
      for (const t of bedFootprintTiles(anchor, site.facing | 0)) {
        if (t.i === i && t.j === j) return id;
      }
    }
    return null;
  }

  #renderPreview() {
    if (!this.startTile || !this.curTile) {
      this.#hidePreview();
      return;
    }
    const grid = this.tileGrid;
    let i0;
    let i1;
    let j0;
    let j1;
    if (this.config.kind === 'stove') {
      const fp = stoveFootprintTiles(this.curTile, this.currentFacing);
      i0 = Math.min(...fp.map((t) => t.i));
      i1 = Math.max(...fp.map((t) => t.i));
      j0 = Math.min(...fp.map((t) => t.j));
      j1 = Math.max(...fp.map((t) => t.j));
    } else if (this.config.kind === 'bed') {
      const fp = bedFootprintTiles(this.curTile, this.currentFacing);
      i0 = Math.min(...fp.map((t) => t.i));
      i1 = Math.max(...fp.map((t) => t.i));
      j0 = Math.min(...fp.map((t) => t.j));
      j1 = Math.max(...fp.map((t) => t.j));
    } else if (this.config.kind === 'stair') {
      const fp = stairFootprintTiles(this.curTile, this.currentFacing);
      i0 = Math.min(...fp.map((t) => t.i));
      i1 = Math.max(...fp.map((t) => t.i));
      j0 = Math.min(...fp.map((t) => t.j));
      j1 = Math.max(...fp.map((t) => t.j));
    } else {
      i0 = Math.min(this.startTile.i, this.curTile.i);
      i1 = Math.max(this.startTile.i, this.curTile.i);
      j0 = Math.min(this.startTile.j, this.curTile.j);
      j1 = Math.max(this.startTile.j, this.curTile.j);
    }
    const nw = tileToWorld(i0, j0, grid.W, grid.H);
    const se = tileToWorld(i1, j1, grid.W, grid.H);
    const x0 = nw.x - TILE_SIZE * 0.5;
    const x1 = se.x + TILE_SIZE * 0.5;
    const z0 = nw.z - TILE_SIZE * 0.5;
    const z1 = se.z + TILE_SIZE * 0.5;
    // Walls follow the layer switcher PLUS auto-stack — preview at whatever
    // z the actual placement will pick. Stairs honor the switcher directly.
    // Other kinds stay pinned to z=0 for now.
    const activeZ = this.tileWorld?.activeZ ?? 0;
    const previewZ = this.removing
      ? 0
      : WALL_FAMILY.has(this.config.kind)
        ? (this.#resolveWallPlacement(i0, j0, WALL_TIER_BY_KIND[this.config.kind])?.z ?? activeZ)
        : this.config.kind === 'stair'
          ? activeZ
          : 0;
    const y = grid.getElevation(i0, j0) + previewZ * LAYER_HEIGHT + PREVIEW_CLEARANCE;
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
    if (this.radiusRing) {
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      this.radiusRing.line.position.set(cx, y, cz);
      /** @type {THREE.LineBasicMaterial} */
      (this.radiusRing.line.material).color.setHex(
        this.removing ? PREVIEW_COLOR_REMOVE : this.config.previewColorAdd,
      );
      this.radiusRing.line.visible = true;
    }
    if (this.furnaceGhost) {
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      this.furnaceGhost.group.position.set(cx, y, cz);
      this.furnaceGhost.group.rotation.y = FACING_YAWS[this.currentFacing] ?? 0;
      this.furnaceGhost.group.visible = !this.removing;
    }
    if (this.stoveGhost) {
      const anchor = this.curTile;
      const aw = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      this.stoveGhost.group.position.set(aw.x, grid.getElevation(anchor.i, anchor.j), aw.z);
      this.stoveGhost.group.rotation.y = FACING_YAWS[this.currentFacing] ?? 0;
      this.stoveGhost.group.visible = !this.removing;
    }
    if (this.bedGhost) {
      const anchor = this.curTile;
      const aw = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      this.bedGhost.group.position.set(aw.x, grid.getElevation(anchor.i, anchor.j), aw.z);
      this.bedGhost.group.rotation.y = FACING_YAWS[this.currentFacing] ?? 0;
      this.bedGhost.group.visible = !this.removing;
    }
    if (this.stairGhost) {
      const anchor = this.curTile;
      const aw = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const stairY = grid.getElevation(anchor.i, anchor.j) + activeZ * LAYER_HEIGHT;
      this.stairGhost.group.position.set(aw.x, stairY, aw.z);
      this.stairGhost.group.rotation.y = FACING_YAWS[this.currentFacing] ?? 0;
      this.stairGhost.group.visible = !this.removing;
    }
    if (this.workSpotPreview) {
      // Work spot is the tile the front faces. If that tile is blocked or
      // off-grid, fall back to any walkable cardinal neighbor so the player
      // can still see *some* indicator (the build job will do the same fallback
      // at completion).
      const off = FACING_OFFSETS[this.currentFacing] ?? FACING_OFFSETS[0];
      const fi = this.curTile.i + off.di;
      const fj = this.curTile.j + off.dj;
      let spot = grid.inBounds(fi, fj) && defaultWalkable(grid, fi, fj) ? { i: fi, j: fj } : null;
      if (!spot) spot = findAdjacentWalkable(grid, defaultWalkable, this.curTile.i, this.curTile.j);
      if (spot && !this.removing) {
        renderTilePreview(this.workSpotPreview, grid, spot.i, spot.j, WORK_SPOT_COLOR);
      } else {
        this.workSpotPreview.line.visible = false;
      }
    }
  }

  #hidePreview() {
    this.preview.line.visible = false;
    if (this.radiusRing) this.radiusRing.line.visible = false;
    if (this.furnaceGhost) this.furnaceGhost.group.visible = false;
    if (this.stoveGhost) this.stoveGhost.group.visible = false;
    if (this.bedGhost) this.bedGhost.group.visible = false;
    if (this.stairGhost) this.stairGhost.group.visible = false;
    if (this.workSpotPreview) this.workSpotPreview.line.visible = false;
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

/**
 * True if (i,j) is a valid roof placement: within reach of a wall/door AND
 * orthogonally adjacent to a built wall/door/roof OR to an existing roof
 * blueprint. The blueprint case lets drag-rects grow inward — the row-major
 * apply loop places tile N+1 after tile N's blueprint already exists.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../ecs/world.js').World} world
 * @param {number} i @param {number} j
 */
function hasRoofSupport(grid, world, i, j) {
  if (roofIsSupported(grid, i, j)) return true;
  if (!structureWithinChebyshev(grid, i, j, ROOF_MAX_WALL_DISTANCE)) return false;
  for (const { components } of world.query(['BuildSite', 'TileAnchor'])) {
    if (components.BuildSite.kind !== 'roof') continue;
    const a = components.TileAnchor;
    if (Math.abs(a.i - i) + Math.abs(a.j - j) === 1) return true;
  }
  return false;
}

/**
 * Release the resources a BuildSite was holding: cancel its build job, drop
 * any delivered units as a loose Item stack, and cancel haul jobs targeting
 * this tile. Caller is responsible for despawning the BuildSite entity
 * afterward (the two-pass pattern matters when iterating a world.query).
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} tileGrid
 * @param {{ kind?: string, facing?: number, buildJobId: number, delivered: number, requiredKind: string }} site
 * @param {number} i @param {number} j
 */
export function releaseBuildSite(world, board, tileGrid, site, i, j) {
  if (site.buildJobId > 0) board.complete(site.buildJobId);
  if (site.delivered > 0) {
    const w = tileToWorld(i, j, tileGrid.W, tileGrid.H);
    world.spawn({
      Item: { kind: site.requiredKind, count: site.delivered, capacity: 50 },
      ItemViz: {},
      TileAnchor: { i, j },
      Position: { x: w.x, y: tileGrid.getElevation(i, j), z: w.z },
    });
  }
  if (site.kind === 'stove') {
    for (const t of stoveFootprintTiles({ i, j }, (site.facing ?? 0) | 0)) {
      if (t.i === i && t.j === j) continue;
      tileGrid.unblockTile(t.i, t.j);
    }
  }
  for (const job of board.jobs) {
    if (job.completed || job.kind !== 'deliver') continue;
    if (job.payload.toI === i && job.payload.toJ === j) board.complete(job.id);
  }
}

/**
 * Re-position an existing buildPreview line so it spans a single tile (i, j).
 * Used by the furnace work-spot indicator.
 *
 * @param {{ geo: THREE.BufferGeometry, positions: Float32Array, line: THREE.Line }} preview
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 * @param {number} color
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

/**
 * @param {THREE.Scene} scene
 * @param {number} color
 * @param {number} radius
 */
function buildRadiusRing(scene, color, radius) {
  const segments = 48;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((segments + 1) * 3);
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    positions[s * 3] = Math.cos(a) * radius;
    positions[s * 3 + 1] = 0;
    positions[s * 3 + 2] = Math.sin(a) * radius;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { geo, line };
}
