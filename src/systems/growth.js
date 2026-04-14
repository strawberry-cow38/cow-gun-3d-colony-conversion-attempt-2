/**
 * Crop growth system. Rare-tier.
 *
 * For each Crop entity, advances `growthTicks` when its tile currently receives
 * real sunlight (≥ SUN_GROWTH_THRESHOLD and no roof above). The tile's `light`
 * byte can't be used on its own because torches contribute to it; crops must
 * grow from SUN, so we gate on `timeOfDay.getSunLightPercent()` + `grid.roof`
 * directly. When a crop crosses a stage boundary, `onStageChange` fires so the
 * renderer can re-upload its instancer matrices.
 */

import { CROP_GROWTH_TICKS, SUN_GROWTH_THRESHOLD, cropStageFor } from '../world/crops.js';

/**
 * @param {{
 *   grid: import('../world/tileGrid.js').TileGrid,
 *   timeOfDay: import('../world/timeOfDay.js').TimeOfDay,
 *   onStageChange: () => void,
 * }} deps
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeGrowthSystem({ grid, timeOfDay, onStageChange }) {
  return {
    name: 'cropGrowth',
    tier: 'rare',
    run(world) {
      const sun = timeOfDay.getSunLightPercent();
      if (sun < SUN_GROWTH_THRESHOLD) return;
      let stageChanged = false;
      for (const { components } of world.query(['Crop', 'TileAnchor'])) {
        const a = components.TileAnchor;
        const c = components.Crop;
        const idx = grid.idx(a.i, a.j);
        if (grid.roof[idx] !== 0) continue;
        const total = CROP_GROWTH_TICKS[c.kind] ?? 0;
        if (total <= 0 || c.growthTicks >= total) continue;
        const before = cropStageFor(c.kind, c.growthTicks);
        // Rare tier fires every 8 sim ticks, so credit 8 ticks of growth per run.
        c.growthTicks = Math.min(total, c.growthTicks + 8);
        const after = cropStageFor(c.kind, c.growthTicks);
        if (after !== before) stageChanged = true;
      }
      if (stageChanged) onStageChange();
    },
  };
}
