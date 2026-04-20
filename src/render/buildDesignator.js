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
import { LAYER_HEIGHT, TERRAIN_STEP, WALL_FILL_FULL } from '../world/tileGrid.js';
import { createBedGhost } from './bedInstancer.js';
import { createDragSizeLabel } from './dragSizeLabel.js';
import { createFurnaceGhost } from './furnaceInstancer.js';
import { createStairGhost } from './stairInstancer.js';
import { createStoveGhost } from './stoveInstancer.js';
import { createWallGhost } from './wallInstancer.js';

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
    // Wall-family stack gate: ctrl held = allow stacking onto an existing wall
    // tile (z+ blueprints). Default off so a drag-rect outline of a building
    // doesn't sneak second-floor blueprints onto each cell that had a prior
    // wall plan. Re-evaluated on each mousedown / move so the live rect can
    // toggle mid-drag.
    this.allowStack = false;
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
    this.wallGhost = WALL_FAMILY.has(config.kind) ? createWallGhost(scene) : null;
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
    this.allowStack = e.ctrlKey;
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
    this.allowStack = e.ctrlKey;
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
    const activeZ = this.tileWorld?.activeZ ?? 0;
    const layer = this.tileWorld?.layers[activeZ] ?? this.tileGrid;
    const zLift = activeZ * LAYER_HEIGHT;
    if (isStove) {
      const footprint = stoveFootprintTiles({ i, j }, this.currentFacing);
      const anchorElev = layer.getElevation(i, j);
      for (const t of footprint) {
        if (!layer.inBounds(t.i, t.j)) return false;
        if (Math.abs(layer.getElevation(t.i, t.j) - anchorElev) > TERRAIN_STEP * 0.5) return false;
        if (layer.isBlocked(t.i, t.j)) return false;
        if (layer.isDoor(t.i, t.j)) return false;
        if (layer.isTorch(t.i, t.j)) return false;
        if (layer.isStockpile(t.i, t.j)) return false;
        if (activeZ > 0 && !this.#hasUpperSupport(t.i, t.j, activeZ)) return false;
        if (this.#findSiteAt(t.i, t.j, (k) => k !== 'roof' && k !== 'floor', activeZ) !== null) {
          return false;
        }
      }
      if (this.#footprintHasItem(footprint, activeZ)) return false;
      // Reserve the flanking footprint tiles immediately so no cow wanders
      // (or gets picked as a build stand-tile) onto a tile that's about to
      // be blocked when the build completes. The anchor stays walkable since
      // haulers deliver materials there.
      for (const t of footprint) {
        if (t.i === i && t.j === j) continue;
        layer.blockTile(t.i, t.j);
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
        TileAnchor: { i, j, z: activeZ },
        Position: { x: w.x, y: this.tileGrid.getElevation(i, j) + zLift, z: w.z },
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
      const anchorElev = bottomLayer.getElevation(i, j);
      for (const t of footprint) {
        if (!bottomLayer.inBounds(t.i, t.j)) return false;
        if (Math.abs(bottomLayer.getElevation(t.i, t.j) - anchorElev) > TERRAIN_STEP * 0.5) {
          return false;
        }
        if (bottomLayer.isBlocked(t.i, t.j)) return false;
        if (bottomLayer.isDoor(t.i, t.j)) return false;
        if (bottomLayer.isTorch(t.i, t.j)) return false;
        if (bottomLayer.isStockpile(t.i, t.j)) return false;
        if (bottomLayer.isRamp(t.i, t.j)) return false;
        if (this.#findSiteAt(t.i, t.j, (k) => k !== 'roof', bottomZ) !== null) return false;
      }
      if (this.#footprintHasItem(footprint, bottomZ)) return false;
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
      const anchorElev = layer.getElevation(i, j);
      for (const t of footprint) {
        if (!layer.inBounds(t.i, t.j)) return false;
        if (Math.abs(layer.getElevation(t.i, t.j) - anchorElev) > TERRAIN_STEP * 0.5) return false;
        if (layer.isBlocked(t.i, t.j)) return false;
        if (layer.isDoor(t.i, t.j)) return false;
        if (layer.isTorch(t.i, t.j)) return false;
        if (layer.isStockpile(t.i, t.j)) return false;
        if (activeZ > 0 && !this.#hasUpperSupport(t.i, t.j, activeZ)) return false;
        if (this.#findSiteAt(t.i, t.j, (k) => k !== 'roof' && k !== 'floor', activeZ) !== null) {
          return false;
        }
      }
      if (this.#footprintHasItem(footprint, activeZ)) return false;
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
        TileAnchor: { i, j, z: activeZ },
        Position: { x: w.x, y: this.tileGrid.getElevation(i, j) + zLift, z: w.z },
      });
      return true;
    }
    // Wall-family (wall / halfWall / quarterWall) has its own path: baseFill
    // is absolute quarters-from-ground (not layer-local), so a single full-wall
    // blueprint can sit atop any partial below and span z-boundaries freely.
    // Completion distributes the tier's quarters across the z-layer buckets.
    if (WALL_FAMILY.has(kind)) return this.#designateWallStack(i, j, kind);
    if (activeZ > 0 && !isRoof && !this.#hasUpperSupport(i, j, activeZ)) return false;
    if (isRoof) {
      if (layer.isRoof(i, j)) return false;
      if (!hasRoofSupport(layer, this.world, i, j, activeZ)) return false;
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
    const existingSiteId = this.#findSiteAt(i, j, samePlane, activeZ);
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
    if (isDoor && layer.isFullWall(i, j)) {
      this.#queueWallDeconstructAt(i, j, activeZ);
    }
    const stuff = this.config.stuffed ? this.currentStuff : null;
    const requiredKind = stuff ? STUFF[stuff].itemKind : (this.config.requiredKind ?? 'wood');
    const w = tileToWorld(i, j, this.tileGrid.W, this.tileGrid.H);
    const y = this.tileGrid.getElevation(i, j) + zLift;
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
      TileAnchor: { i, j, z: activeZ },
      Position: { x: w.x, y, z: w.z },
    });
    return true;
  }

  /**
   * Spawn one wall-family blueprint at (i,j) of `kind` sitting on top of any
   * existing wall stack. `baseFill` is absolute quarters-from-ground — the
   * new blueprint stacks on whatever's already built or pending at this tile,
   * whether that's a quarter, half, three-quarters, a full wall, or more.
   *
   * The BuildSite is anchored to z=0 regardless of how high up the stack
   * lands; the renderer and completion code read `baseFill` to place it in
   * world-space and to distribute the tier's quarters across the right z-layer
   * buckets when it finishes building.
   *
   * @param {number} i @param {number} j @param {string} kind
   */
  #designateWallStack(i, j, kind) {
    const tier = WALL_TIER_BY_KIND[kind];
    if (!tier) return false;
    const baseFill = this.#totalWallFillAt(i, j);
    const maxFill = (this.tileWorld?.layers.length ?? 1) * WALL_FILL_FULL;
    if (baseFill + tier > maxFill) return false;
    // Stack gate: only build atop an existing wall/blueprint when the player
    // explicitly asks for it (ctrl). Otherwise the corner tiles of a drag-rect
    // outline would silently get a 2nd-floor blueprint stacked on top of the
    // ground-floor wall they share with the adjacent edges.
    if (baseFill > 0 && !this.allowStack) return false;
    const ground = this.tileGrid;
    if (ground.isOccupied(i, j)) return false;
    if (ground.isDoor(i, j)) return false;
    if (ground.isTorch(i, j)) return false;
    if (ground.isStockpile(i, j)) return false;
    // A finished full wall rooted at the ground covers the floor entirely;
    // cancel any pending floor blueprint at this tile to refund its materials.
    if (kind === 'wall' && baseFill === 0) {
      const floorSiteId = this.#findSiteAt(i, j, (k) => k === 'floor');
      if (floorSiteId !== null) {
        const floorSite = this.world.get(floorSiteId, 'BuildSite');
        if (floorSite) {
          releaseBuildSite(this.world, this.board, this.tileGrid, floorSite, i, j);
          this.world.despawn(floorSiteId);
        }
      }
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
        facing: 0,
        baseFill,
      },
      BuildSiteViz: {},
      TileAnchor: { i, j, z: 0 },
      Position: { x: w.x, y, z: w.z },
    });
    return true;
  }

  /**
   * Reject multi-tile placement if an item stack sits on any footprint tile.
   * Items don't set TileGrid.occupancy, so isBlocked misses them — scan the
   * ECS directly. Matches the active blueprint layer; items live at their
   * TileAnchor.z (defaults to 0 at spawn).
   *
   * @param {Array<{i:number,j:number}>} footprint
   * @param {number} z
   */
  #footprintHasItem(footprint, z) {
    for (const { components } of this.world.query(['Item', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if ((a.z | 0) !== z) continue;
      for (const t of footprint) {
        if (a.i === t.i && a.j === t.j) return true;
      }
    }
    return false;
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
   * Built + pending wall fill at (i,j) that lands inside z-layer `z`'s bucket,
   * clamped to 0..WALL_FILL_FULL. BuildSites live at z=0 with absolute
   * baseFill, so per-layer fill is the overlap of each blueprint's
   * [baseFill, baseFill+tier) quarter range with [z*4, (z+1)*4).
   *
   * Consumers (stair support, upper-support check) need to know "will this
   * layer be walled up when everything finishes building" — that's what this
   * reports.
   * @param {number} i @param {number} j @param {number} z
   */
  #pendingWallFillAt(i, j, z) {
    const layer = z === 0 ? this.tileGrid : this.tileWorld?.layers[z];
    let fill = layer ? layer.wallFill(i, j) : 0;
    const zBase = z * WALL_FILL_FULL;
    const zTop = zBase + WALL_FILL_FULL;
    for (const { components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      const tier = WALL_TIER_BY_KIND[components.BuildSite.kind];
      if (!tier) continue;
      const bpBase = components.BuildSite.baseFill | 0;
      const bpTop = bpBase + tier;
      const overlap = Math.max(0, Math.min(bpTop, zTop) - Math.max(bpBase, zBase));
      fill += overlap;
      if (fill >= WALL_FILL_FULL) return WALL_FILL_FULL;
    }
    return fill;
  }

  /**
   * Absolute quarter-unit wall stack height at (i,j), summed over all z-layers
   * plus every pending wall-family BuildSite's tier at this tile. A wall
   * blueprint clicks down with `baseFill` equal to this value, so clicking
   * "full wall" on a 3/4 wall produces a single full-wall BuildSite with
   * baseFill 3 — the renderer lifts it off the ground by 3 × TERRAIN_STEP and
   * completion distributes the 4 quarters across the appropriate z buckets.
   * @param {number} i @param {number} j
   */
  #totalWallFillAt(i, j) {
    const depth = this.tileWorld?.layers.length ?? 1;
    let fill = 0;
    for (let z = 0; z < depth; z++) {
      const layer = z === 0 ? this.tileGrid : this.tileWorld?.layers[z];
      if (layer) fill += layer.wallFill(i, j);
    }
    for (const { components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      const tier = WALL_TIER_BY_KIND[components.BuildSite.kind];
      if (tier) fill += tier;
    }
    return fill;
  }

  /** @param {number} i @param {number} j @param {number} [z] */
  #queueWallDeconstructAt(i, j, z = 0) {
    for (const { id, components } of this.world.query(['Wall', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      if ((a.z | 0) !== z) continue;
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
    const activeZ = this.tileWorld?.activeZ ?? 0;
    let id;
    if (kind === 'stove') id = this.#findStoveSiteCovering(i, j, activeZ);
    else if (kind === 'bed') id = this.#findBedSiteCovering(i, j, activeZ);
    else if (kind === 'stair') id = this.#findStairSiteCovering(i, j);
    else if (WALL_FAMILY.has(kind)) id = this.#findTopmostWallSiteAt(i, j);
    else id = this.#findSiteAt(i, j, (k) => k === kind, activeZ);
    if (id === null) return false;
    const site = this.world.get(id, 'BuildSite');
    if (!site) return false;
    const siteAnchor = this.world.get(id, 'TileAnchor');
    const footprintZ = siteAnchor ? siteAnchor.z | 0 : activeZ;
    const footprintLayer = this.tileWorld?.layers[footprintZ] ?? this.tileGrid;
    releaseBuildSite(this.world, this.board, this.tileGrid, site, i, j, footprintLayer);
    this.world.despawn(id);
    return true;
  }

  /**
   * Topmost wall-family blueprint at (i,j), ordered by absolute baseFill. Used
   * by wall cancel so the player peels stacked blueprints from the top down —
   * any wall/halfWall/quarterWall designator cancels any tier.
   * @param {number} i @param {number} j
   */
  #findTopmostWallSiteAt(i, j) {
    let bestId = null;
    let bestRank = -1;
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      if (!WALL_FAMILY.has(components.BuildSite.kind)) continue;
      const baseFill = components.BuildSite.baseFill | 0;
      if (baseFill > bestRank) {
        bestRank = baseFill;
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
   * @param {number} i @param {number} j @param {number} [z]
   */
  #findStoveSiteCovering(i, j, z = 0) {
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const site = components.BuildSite;
      if (site.kind !== 'stove') continue;
      const anchor = components.TileAnchor;
      if ((anchor.z | 0) !== z) continue;
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

  /** @param {number} i @param {number} j @param {number} [z] */
  #findBedSiteCovering(i, j, z = 0) {
    for (const { id, components } of this.world.query(['BuildSite', 'TileAnchor'])) {
      const site = components.BuildSite;
      if (site.kind !== 'bed') continue;
      const anchor = components.TileAnchor;
      if ((anchor.z | 0) !== z) continue;
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
    // Walls are anchored at z=0 and stack via absolute baseFill; offset the
    // preview by the current pending stack height so it hovers at the tile's
    // real top. Every other kind rides the layer switcher so the ghost shows
    // on the active z-layer.
    const activeZ = this.tileWorld?.activeZ ?? 0;
    const isWallFamily = WALL_FAMILY.has(this.config.kind);
    const elev = grid.getElevation(i0, j0);
    const y =
      isWallFamily && !this.removing
        ? elev + this.#totalWallFillAt(i0, j0) * TERRAIN_STEP + PREVIEW_CLEARANCE
        : elev + activeZ * LAYER_HEIGHT + PREVIEW_CLEARANCE;
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
      const stoveY = grid.getElevation(anchor.i, anchor.j) + activeZ * LAYER_HEIGHT;
      this.stoveGhost.group.position.set(aw.x, stoveY, aw.z);
      this.stoveGhost.group.rotation.y = FACING_YAWS[this.currentFacing] ?? 0;
      this.stoveGhost.group.visible = !this.removing;
    }
    if (this.bedGhost) {
      const anchor = this.curTile;
      const aw = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const bedY = grid.getElevation(anchor.i, anchor.j) + activeZ * LAYER_HEIGHT;
      this.bedGhost.group.position.set(aw.x, bedY, aw.z);
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
    if (this.wallGhost) {
      if (this.removing) {
        this.wallGhost.hide();
      } else {
        const tier = WALL_TIER_BY_KIND[this.config.kind];
        const maxFill = (this.tileWorld?.layers.length ?? 1) * WALL_FILL_FULL;
        const depth = this.tileWorld?.layers.length ?? 1;
        // Scan BuildSites once, not per-cell — a 20x20 drag would otherwise do
        // 400 full world.query scans each mousemove.
        const pendingByCell = new Map();
        for (const { components } of this.world.query(['BuildSite', 'TileAnchor'])) {
          const t = WALL_TIER_BY_KIND[components.BuildSite.kind];
          if (!t) continue;
          const a = components.TileAnchor;
          const k = a.j * grid.W + a.i;
          pendingByCell.set(k, (pendingByCell.get(k) ?? 0) + t);
        }
        const cells = [];
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            if (!grid.inBounds(i, j)) continue;
            if (grid.isOccupied(i, j)) continue;
            if (grid.isDoor(i, j) || grid.isTorch(i, j) || grid.isStockpile(i, j)) continue;
            let baseFill = pendingByCell.get(j * grid.W + i) ?? 0;
            for (let z = 0; z < depth; z++) {
              const layer = z === 0 ? this.tileGrid : this.tileWorld?.layers[z];
              if (layer) baseFill += layer.wallFill(i, j);
            }
            if (baseFill + tier > maxFill) continue;
            if (baseFill > 0 && !this.allowStack) continue;
            const w = tileToWorld(i, j, grid.W, grid.H);
            cells.push({ cx: w.x, cz: w.z, y: grid.getElevation(i, j), baseFill });
          }
        }
        this.wallGhost.setCells(cells, tier, this.config.previewColorAdd);
      }
    }
    if (this.workSpotPreview) {
      // Work spot is the tile the front faces. If that tile is blocked or
      // off-grid, fall back to any walkable cardinal neighbor so the player
      // can still see *some* indicator (the build job will do the same fallback
      // at completion). Uses the active-layer grid so upper-floor stations find
      // their stand-tile on that same level.
      const spotLayer = this.tileWorld?.layers[activeZ] ?? grid;
      const off = FACING_OFFSETS[this.currentFacing] ?? FACING_OFFSETS[0];
      const fi = this.curTile.i + off.di;
      const fj = this.curTile.j + off.dj;
      let spot =
        spotLayer.inBounds(fi, fj) && defaultWalkable(spotLayer, fi, fj) ? { i: fi, j: fj } : null;
      if (!spot)
        spot = findAdjacentWalkable(spotLayer, defaultWalkable, this.curTile.i, this.curTile.j);
      if (spot && !this.removing) {
        renderTilePreview(
          this.workSpotPreview,
          grid,
          spot.i,
          spot.j,
          WORK_SPOT_COLOR,
          activeZ * LAYER_HEIGHT,
        );
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
    if (this.wallGhost) this.wallGhost.hide();
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
 * @param {number} i @param {number} j @param {number} [z]
 */
function hasRoofSupport(grid, world, i, j, z = 0) {
  if (roofIsSupported(grid, i, j)) return true;
  if (!structureWithinChebyshev(grid, i, j, ROOF_MAX_WALL_DISTANCE)) return false;
  for (const { components } of world.query(['BuildSite', 'TileAnchor'])) {
    if (components.BuildSite.kind !== 'roof') continue;
    const a = components.TileAnchor;
    if ((a.z | 0) !== z) continue;
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
 * `footprintLayer` is the TileGrid whose footprint bits the blueprint reserved
 * (stove flanking tiles). For z>0 placements that's the upper-layer grid; for
 * ground, it's the same as `tileGrid`. Refund items always drop on the ground
 * tile — upper-floor items would need a z-aware item system, which is future
 * work.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} tileGrid
 * @param {{ kind?: string, facing?: number, buildJobId: number, delivered: number, requiredKind: string }} site
 * @param {number} i @param {number} j
 * @param {import('../world/tileGrid.js').TileGrid} [footprintLayer]
 */
export function releaseBuildSite(world, board, tileGrid, site, i, j, footprintLayer) {
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
    const layer = footprintLayer ?? tileGrid;
    for (const t of stoveFootprintTiles({ i, j }, (site.facing ?? 0) | 0)) {
      if (t.i === i && t.j === j) continue;
      layer.unblockTile(t.i, t.j);
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
 * @param {number} [yOffset] extra lift for upper-floor previews
 */
function renderTilePreview(preview, grid, i, j, color, yOffset = 0) {
  const w = tileToWorld(i, j, grid.W, grid.H);
  const x0 = w.x - TILE_SIZE * 0.5;
  const x1 = w.x + TILE_SIZE * 0.5;
  const z0 = w.z - TILE_SIZE * 0.5;
  const z1 = w.z + TILE_SIZE * 0.5;
  const y = grid.getElevation(i, j) + PREVIEW_CLEARANCE + yOffset;
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
