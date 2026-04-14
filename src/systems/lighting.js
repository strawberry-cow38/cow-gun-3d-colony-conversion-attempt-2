/**
 * Tile lighting grid. Per-tile light % drives cow pathing speed (below 40% =
 * half speed). Light = max(sun%, torch%):
 *
 * - Sun: 100% 6am-6pm, fade 6-9pm, 0% 9pm-5am, rise 5am-6am. Tiles with a
 *   roof bit set get 0 sun (roof blocks sunlight).
 * - Torch: up to 50% within a 5-tile radius circle (including center), with
 *   line-of-sight occlusion through walls/doors and a wall-adjacency AO term
 *   that softens the torch value near nearby structure.
 *
 * Since the torch contribution caps at 50%, sun ≥ 50% makes torches moot on
 * roofless tiles — but roofed tiles still need torches during the day, so
 * the torch stamp runs unconditionally when any roof exists.
 *
 * Stored as uint8 (0-255). Recomputed on a `rare` tier (every 8 ticks) — the
 * sun curve is continuous and torch placements are infrequent, so sub-second
 * staleness is fine.
 */

export const TORCH_RADIUS_TILES = 5;
export const TORCH_LIGHT_PCT = 0.5;
export const DARKNESS_SLOWDOWN_THRESHOLD = 0.4;
// Per-neighbor AO attenuation. 8 neighbors × 0.06 = ~48% max dim in a pocket,
// ~12% dim for a tile hugging one wall. Tuned by eye.
const AO_PER_NEIGHBOR = 0.06;

/**
 * @param {{
 *   grid: import('../world/tileGrid.js').TileGrid,
 *   timeOfDay: { getSunLightPercent: () => number },
 * }} opts
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeLightingSystem(opts) {
  const { grid, timeOfDay } = opts;
  // TORCH_RADIUS_TILES counts the center tile in its span, so the euclidean
  // radius from the center is TORCH_RADIUS_TILES - 1.
  const radius = TORCH_RADIUS_TILES - 1;
  const radius2 = radius * radius;
  return {
    name: 'lighting',
    tier: 'rare',
    run() {
      const sun = Math.max(0, Math.min(1, timeOfDay.getSunLightPercent()));
      const base = Math.round(sun * 255);
      const { W, H, torch, light, roof, wall, door } = grid;
      let anyRoof = false;
      let anyBlocker = false;
      for (let k = 0; k < roof.length; k++) {
        if (roof[k] !== 0) anyRoof = true;
        if (wall[k] !== 0 || door[k] !== 0) anyBlocker = true;
        if (anyRoof && anyBlocker) break;
      }
      if (!anyRoof) {
        light.fill(base);
      } else {
        for (let k = 0; k < light.length; k++) {
          light[k] = roof[k] !== 0 ? 0 : base;
        }
      }
      if (sun >= TORCH_LIGHT_PCT && !anyRoof) return;
      const torchVal = Math.round(TORCH_LIGHT_PCT * 255);
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          if (torch[j * W + i] === 0) continue;
          const j0 = Math.max(0, j - radius);
          const j1 = Math.min(H - 1, j + radius);
          const i0 = Math.max(0, i - radius);
          const i1 = Math.min(W - 1, i + radius);
          for (let jj = j0; jj <= j1; jj++) {
            const dj = jj - j;
            const dj2 = dj * dj;
            for (let ii = i0; ii <= i1; ii++) {
              const di = ii - i;
              if (di * di + dj2 > radius2) continue;
              if (anyBlocker && !hasLineOfSight(W, wall, door, i, j, ii, jj)) continue;
              const k = jj * W + ii;
              let v = torchVal;
              if (anyBlocker && wall[k] === 0 && door[k] === 0) {
                const occ = countStructureNeighbors(W, H, wall, door, ii, jj);
                v -= Math.round(torchVal * occ * AO_PER_NEIGHBOR);
                if (v < 0) v = 0;
              }
              if (v > light[k]) light[k] = v;
            }
          }
        }
      }
    },
  };
}

/**
 * True if the straight line from (fromI,fromJ) to (toI,toJ) isn't blocked by a
 * wall or door on any tile strictly between the endpoints. Walls/doors at the
 * endpoint can still be lit (so the wall tiles themselves glow next to a
 * torch); the torch tile itself is always the source.
 *
 * DDA-style integer supercover trace: sample `steps` points along the segment,
 * round to tile coords, and reject if any intermediate tile is solid.
 *
 * @param {number} W
 * @param {Uint8Array} wall
 * @param {Uint8Array} door
 */
function hasLineOfSight(W, wall, door, fromI, fromJ, toI, toJ) {
  const dx = toI - fromI;
  const dy = toJ - fromJ;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps <= 1) return true;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const ix = Math.round(fromI + dx * t);
    const iy = Math.round(fromJ + dy * t);
    const k = iy * W + ix;
    if (wall[k] !== 0 || door[k] !== 0) return false;
  }
  return true;
}

/**
 * Count the wall/door tiles in the 8-neighborhood of (i, j). Used as the AO
 * occlusion term — more neighbors = tile is in a deeper pocket of structure.
 *
 * @param {number} W @param {number} H
 * @param {Uint8Array} wall @param {Uint8Array} door
 * @param {number} i @param {number} j
 */
function countStructureNeighbors(W, H, wall, door, i, j) {
  let count = 0;
  const j0 = Math.max(0, j - 1);
  const j1 = Math.min(H - 1, j + 1);
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(W - 1, i + 1);
  for (let jj = j0; jj <= j1; jj++) {
    for (let ii = i0; ii <= i1; ii++) {
      if (ii === i && jj === j) continue;
      const k = jj * W + ii;
      if (wall[k] !== 0 || door[k] !== 0) count++;
    }
  }
  return count;
}
