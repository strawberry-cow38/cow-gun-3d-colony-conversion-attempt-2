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
import { TREE_VISUALS, growthScale } from '../world/trees.js';
import { FURNACE_FOOTPRINT, FURNACE_HEIGHT } from './furnaceInstancer.js';

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
export const TRACKED_COMPONENTS = [
  'Tree',
  'Boulder',
  'Wall',
  'Door',
  'Torch',
  'Roof',
  'Floor',
  'BuildSite',
];

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
    case 'wall':
      return { w: TILE_SIZE, h: WALL_HEIGHT, d: TILE_SIZE, yBase: 0 };
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
