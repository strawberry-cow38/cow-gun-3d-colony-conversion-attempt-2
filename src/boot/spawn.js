/**
 * Cow spawning helpers: primitive `spawnCowAt` + `spawnInitialCows` wrapper
 * and the BFS-outward `nearestFreeTile` both operate only on world/grid so
 * they live outside the main boot module.
 */

import { ageYears } from '../sim/calendar.js';
import { skillsForChildhood, skillsForProfession } from '../world/backstories.js';
import { tileToWorld } from '../world/coords.js';
import { pickCowName } from '../world/cowNames.js';
import { fullName, rollCowIdentity } from '../world/identity.js';
import { rollStartingSkills, skillLevelFor } from '../world/skills.js';
import { isWaterBiome } from '../world/tileGrid.js';
import {
  CATEGORY_TO_SKILL,
  DEFAULT_PRIORITY,
  WORK_CATEGORIES,
  deriveDefaultsFromSkills,
} from '../world/workPriorities.js';

/**
 * BFS outward from (i,j) to the nearest non-blocked, non-water in-bounds
 * tile. Used so cow spawn never lands on a tree/rock/lake. Returns null
 * only if the whole grid is blocked, which shouldn't happen.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
export function nearestFreeTile(grid, i, j) {
  const seen = new Uint8Array(grid.W * grid.H);
  const queue = [{ i, j }];
  seen[j * grid.W + i] = 1;
  let head = 0;
  while (head < queue.length) {
    const t = queue[head++];
    if (
      grid.inBounds(t.i, t.j) &&
      !grid.isBlocked(t.i, t.j) &&
      !isWaterBiome(grid.getBiome(t.i, t.j))
    ) {
      return t;
    }
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = t.i + di;
      const nj = t.j + dj;
      if (ni < 0 || nj < 0 || ni >= grid.W || nj >= grid.H) continue;
      const idx = nj * grid.W + ni;
      if (seen[idx]) continue;
      seen[idx] = 1;
      queue.push({ i: ni, j: nj });
    }
  }
  return null;
}

/**
 * Spawn one cow on the nearest free tile to (i, j). No-op if the request is
 * out of bounds or the whole map is blocked. `currentTick` seeds the random
 * birthday so ages are sensible relative to the sim clock at spawn time.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 * @param {number} [currentTick] sim tick at spawn, for age back-dating
 * @param {{ skillMultiplier?: number }} [opts]
 */
export function spawnCowAt(world, grid, i, j, currentTick = 0, opts = {}) {
  if (!grid.inBounds(i, j)) return;
  const placed = nearestFreeTile(grid, i, j);
  if (!placed) return;
  const w = tileToWorld(placed.i, placed.j, grid.W, grid.H);
  const y = grid.getElevation(placed.i, placed.j);
  const firstName = pickCowName();
  const id = rollCowIdentity(currentTick, firstName);
  const skills = rollStartingSkills({
    ageYears: ageYears(id.birthTick, currentTick),
    childhoodBonus: skillsForChildhood(id.childhood),
    professionBonus: skillsForProfession(id.profession),
    skillMultiplier: opts.skillMultiplier,
  });
  world.spawn({
    Cow: { drafted: false },
    Position: { x: w.x, y, z: w.z },
    PrevPosition: { x: w.x, y, z: w.z },
    Velocity: { x: 0, y: 0, z: 0 },
    Hunger: { value: 1 },
    Tiredness: { value: 1 },
    FoodPoisoning: { ticksRemaining: 0 },
    Brain: { name: id.nickname, layerZ: 0 },
    Identity: { name: fullName(id), ...id },
    Job: { kind: 'none', state: 'idle', payload: {} },
    Path: { steps: [], index: 0 },
    Inventory: { items: [] },
    Opinions: { scores: {}, last: {}, chats: 0 },
    Chat: { text: '', partnerId: 0, expiresAtTick: 0 },
    Health: { injuries: [], nextInjuryId: 1, dead: false },
    Skills: skills,
    WorkPriorities: deriveDefaultsFromSkills(skills),
    CowViz: {},
  });
}

/**
 * Scatter `count` cows within a few tiles of grid center. Each call hits
 * `spawnCowAt`, which BFSes to free ground.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} count
 * @param {number} [currentTick]
 */
export function spawnInitialCows(world, grid, count, currentTick = 0) {
  for (let n = 0; n < count; n++) {
    const i = Math.floor(grid.W / 2 + (Math.random() * 6 - 3));
    const j = Math.floor(grid.H / 2 + (Math.random() * 6 - 3));
    // Initial roster gets a 2× skill-roll multiplier so the starting band of
    // colonists feels meaningfully more experienced than a mid-game recruit.
    spawnCowAt(world, grid, i, j, currentTick, { skillMultiplier: 2 });
  }
  ensureEveryCategoryCovered(world);
}

/**
 * Every work category must have at least one cow willing to take it, otherwise
 * essential jobs (cook, mine, grow) sit on the board with nobody to claim
 * them. After spawn, scan the roster; if a category has no takers, enable it
 * on the cow with the highest backing skill (or any cow if the category has
 * no backing skill).
 *
 * @param {import('../ecs/world.js').World} world
 */
function ensureEveryCategoryCovered(world) {
  const cows = [...world.query(['Cow', 'WorkPriorities'])];
  if (cows.length === 0) return;
  for (const cat of WORK_CATEGORIES) {
    const covered = cows.some((c) => (c.components.WorkPriorities.priorities?.[cat] | 0) > 0);
    if (covered) continue;
    const skillId = CATEGORY_TO_SKILL[cat];
    let pick = cows[0];
    if (skillId) {
      let bestLvl = -1;
      for (const c of cows) {
        const lvl = skillLevelFor(world, c.id, skillId);
        if (lvl > bestLvl) {
          bestLvl = lvl;
          pick = c;
        }
      }
    }
    pick.components.WorkPriorities.priorities[cat] = DEFAULT_PRIORITY;
  }
}
