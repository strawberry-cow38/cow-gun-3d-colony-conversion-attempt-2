/**
 * Shared per-entity bounding-box math for world objects. Feeds two things:
 *   - the yellow/red ghost boxes in objectSelectionViz
 *   - the invisible click hitboxes in objectHitboxes
 *
 * Keeping both in sync means "what I can click" always matches "what lights
 * up when I click it" — a tree's canopy is as clickable as its trunk.
 */

import { objectTypeFor } from '../ui/objectTypes.js';
import { BOULDER_VISUALS } from '../world/boulders.js';
import { TILE_SIZE, UNITS_PER_METER } from '../world/coords.js';
import { FACING_OFFSETS, FACING_YAWS } from '../world/facing.js';
import { STAIR_LENGTH } from '../world/stair.js';
import { LAYER_HEIGHT, WALL_FILL_FULL } from '../world/tileGrid.js';
import { TREE_VISUALS, growthScale } from '../world/trees.js';
import { BED_HEADBOARD_HEIGHT, BED_LENGTH, BED_WIDTH } from './bedInstancer.js';
import { EASEL_FOOTPRINT, EASEL_HEIGHT } from './easelInstancer.js';
import { FURNACE_FOOTPRINT, FURNACE_HEIGHT } from './furnaceInstancer.js';
import { STOVE_BODY_DEPTH, STOVE_BODY_HEIGHT, STOVE_BODY_SPAN } from './stoveInstancer.js';

export const WALL_HEIGHT = 3 * UNITS_PER_METER;
const DOOR_HEIGHT = WALL_HEIGHT;
const ROOF_THICKNESS = 4;
const FLOOR_THICKNESS = 1;
const TORCH_TOTAL_HEIGHT = (1.6 + 0.5) * UNITS_PER_METER;
const TRUNK_HEIGHT_M = 2.2;
const CONE_CANOPY_HEIGHT_M = 1.6;
const SPHERE_CANOPY_HEIGHT_M = 1.8;
const TRUNK_RADIUS_M = 0.18;
const CANOPY_RADIUS_M = 0.9;
const BOULDER_RADIUS_M = 0.55;
const BOULDER_HEIGHT_M = 0.9;
const TORCH_RADIUS_M = 0.22;

/** Every ObjectType.component that participates in box-based hit/ghost logic. */
// Floor is intentionally excluded: a full-tile floor hitbox was swallowing
// clicks on items / build sites / other entities sitting on top of it,
// making it hard to interact with anything once floors were placed. Floors
// stay in the OBJECT_TYPES registry (so the panel still opens when reached
// through other means, e.g. deconstruct overlay), just not through click.
export const TRACKED_COMPONENTS = ['Tree', 'Boulder', 'Wall', 'Door', 'Torch', 'Roof', 'BuildSite'];

/** Crafting stations. Tracked separately because they live outside the
 * OBJECT_TYPES registry (they have dedicated panels) but still want
 * click-what-you-see 3D hitbox picking. */
export const STATION_COMPONENTS = /** @type {const} */ ([
  'Furnace',
  'Easel',
  'Stove',
  'Bed',
  'Stair',
]);

/**
 * @param {import('../ui/objectTypes.js').ObjectType} entry
 * @param {import('../ecs/world.js').World} world
 * @param {number} id
 * @returns {{ w: number, h: number, d: number, yBase: number } | null}
 */
export function boxFor(entry, world, id) {
  switch (entry.type) {
    case 'tree': {
      const tree = world.get(id, 'Tree');
      if (!tree) return null;
      const v = TREE_VISUALS[tree.kind] ?? TREE_VISUALS.oak;
      const g = growthScale(tree.growth);
      const canopyH = v.canopyShape === 'sphere' ? SPHERE_CANOPY_HEIGHT_M : CONE_CANOPY_HEIGHT_M;
      const h =
        (TRUNK_HEIGHT_M * v.trunkScale[1] + canopyH * v.canopyScale[1]) * g * UNITS_PER_METER;
      const radiusM = Math.max(
        TRUNK_RADIUS_M * Math.max(v.trunkScale[0], v.trunkScale[2]),
        CANOPY_RADIUS_M * Math.max(v.canopyScale[0], v.canopyScale[2]),
      );
      const side = 2 * radiusM * g * UNITS_PER_METER;
      return { w: side, h, d: side, yBase: 0 };
    }
    case 'boulder': {
      const b = world.get(id, 'Boulder');
      const v = (b && BOULDER_VISUALS[b.kind]) ?? BOULDER_VISUALS.stone;
      const side = 2 * BOULDER_RADIUS_M * Math.max(v.scale[0], v.scale[2]) * UNITS_PER_METER;
      const h = BOULDER_HEIGHT_M * v.scale[1] * UNITS_PER_METER;
      return { w: side, h, d: side, yBase: 0 };
    }
    case 'wall': {
      const wall = world.get(id, 'Wall');
      const fill = Math.max(1, Math.min(WALL_FILL_FULL, wall?.fill ?? WALL_FILL_FULL));
      return { w: TILE_SIZE, h: WALL_HEIGHT * (fill / WALL_FILL_FULL), d: TILE_SIZE, yBase: 0 };
    }
    case 'door':
      return { w: TILE_SIZE, h: DOOR_HEIGHT, d: TILE_SIZE, yBase: 0 };
    case 'torch': {
      const t = world.get(id, 'Torch');
      const baseY = t?.wallMounted ? 1.8 * UNITS_PER_METER : 0;
      const side = 2 * TORCH_RADIUS_M * UNITS_PER_METER;
      return { w: side, h: TORCH_TOTAL_HEIGHT, d: side, yBase: baseY };
    }
    case 'roof':
      return { w: TILE_SIZE, h: ROOF_THICKNESS, d: TILE_SIZE, yBase: WALL_HEIGHT };
    case 'floor':
      return { w: TILE_SIZE, h: FLOOR_THICKNESS, d: TILE_SIZE, yBase: 0 };
    case 'buildsite': {
      const site = world.get(id, 'BuildSite');
      if (!site) return null;
      switch (site.kind) {
        case 'roof':
          return { w: TILE_SIZE, h: ROOF_THICKNESS, d: TILE_SIZE, yBase: WALL_HEIGHT };
        case 'floor':
          return { w: TILE_SIZE, h: FLOOR_THICKNESS, d: TILE_SIZE, yBase: 0 };
        case 'torch':
        case 'wallTorch':
          return {
            w: 2 * TORCH_RADIUS_M * UNITS_PER_METER,
            h: TORCH_TOTAL_HEIGHT,
            d: 2 * TORCH_RADIUS_M * UNITS_PER_METER,
            yBase: 0,
          };
        case 'furnace':
          return { w: FURNACE_FOOTPRINT, h: FURNACE_HEIGHT, d: FURNACE_FOOTPRINT, yBase: 0 };
        case 'quarterWall':
          return { w: TILE_SIZE, h: WALL_HEIGHT * 0.25, d: TILE_SIZE, yBase: 0 };
        case 'halfWall':
          return { w: TILE_SIZE, h: WALL_HEIGHT * 0.5, d: TILE_SIZE, yBase: 0 };
        default:
          return { w: TILE_SIZE, h: WALL_HEIGHT, d: TILE_SIZE, yBase: 0 };
      }
    }
    default:
      return null;
  }
}

/**
 * Resolve an entity's registered type, then return its box. Returns null if
 * the entity isn't in the object registry.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} id
 */
export function boxForEntity(world, id) {
  const entry = objectTypeFor(world, id);
  if (!entry) return null;
  return boxFor(entry, world, id);
}

/**
 * Box + yaw for a crafting station entity. Stove is long along its body span;
 * its yaw rotates the box around Y so the long edge aligns with the build
 * facing. Furnace/easel are anchored on a single tile and don't rotate.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} id
 * @returns {{ w: number, h: number, d: number, yBase: number, yaw: number, offsetX?: number, offsetZ?: number } | null}
 */
export function boxForStation(world, id) {
  if (world.get(id, 'Furnace')) {
    return { w: FURNACE_FOOTPRINT, h: FURNACE_HEIGHT, d: FURNACE_FOOTPRINT, yBase: 0, yaw: 0 };
  }
  if (world.get(id, 'Easel')) {
    return { w: EASEL_FOOTPRINT, h: EASEL_HEIGHT, d: EASEL_FOOTPRINT, yBase: 0, yaw: 0 };
  }
  const stove = world.get(id, 'Stove');
  if (stove) {
    return {
      w: STOVE_BODY_SPAN,
      h: STOVE_BODY_HEIGHT,
      d: STOVE_BODY_DEPTH,
      yBase: 0,
      yaw: FACING_YAWS[stove.facing | 0] ?? 0,
    };
  }
  const bed = world.get(id, 'Bed');
  if (bed) {
    // Mattress center sits half a tile forward of the anchor (bed spans anchor
    // → forward tile), so shift the box so it covers both tiles rather than
    // floating over just the foot.
    const off = FACING_OFFSETS[bed.facing | 0] ?? FACING_OFFSETS[0];
    return {
      w: BED_WIDTH,
      h: BED_HEADBOARD_HEIGHT,
      d: BED_LENGTH,
      yBase: 0,
      yaw: FACING_YAWS[bed.facing | 0] ?? 0,
      offsetX: off.di * (TILE_SIZE / 2),
      offsetZ: off.dj * (TILE_SIZE / 2),
    };
  }
  const stair = world.get(id, 'Stair');
  if (stair) {
    // Box center sits (length-1)/2 tiles forward of the anchor so it
    // straddles the whole run.
    const off = FACING_OFFSETS[stair.facing | 0] ?? FACING_OFFSETS[0];
    const forwardOffset = ((STAIR_LENGTH - 1) / 2) * TILE_SIZE;
    return {
      w: TILE_SIZE,
      h: LAYER_HEIGHT,
      d: TILE_SIZE * STAIR_LENGTH,
      yBase: 0,
      yaw: FACING_YAWS[stair.facing | 0] ?? 0,
      offsetX: off.di * forwardOffset,
      offsetZ: off.dj * forwardOffset,
    };
  }
  return null;
}
