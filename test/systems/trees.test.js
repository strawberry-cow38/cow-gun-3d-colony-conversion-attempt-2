import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { makeSaplingSpawnSystem } from '../../src/systems/trees.js';
import { TileGrid } from '../../src/world/tileGrid.js';

function makeWorld() {
  const w = new World();
  registerComponents(w);
  return w;
}

function spawnBlueprint(world, i, j) {
  return world.spawn({
    BuildSite: {
      kind: 'wall',
      stuff: 'wood',
      requiredKind: 'wood',
      required: 1,
      delivered: 0,
      buildJobId: 0,
      progress: 0,
    },
    BuildSiteViz: {},
    TileAnchor: { i, j },
    Position: { x: 0, y: 0, z: 0 },
  });
}

describe('sapling spawn: blueprint exclusion', () => {
  it('does not place a sapling within the safe radius of a pending BuildSite', () => {
    // Tiny grid where every grass tile is within radius 2 of (5,5).
    const grid = new TileGrid(11, 11);
    grid.generateTerrain();
    // Force every tile to grass so the biome filter can't accidentally save us.
    for (let k = 0; k < grid.W * grid.H; k++) grid.biome[k] = 0;
    const world = makeWorld();
    spawnBlueprint(world, 5, 5);
    const sys = makeSaplingSpawnSystem({ grid, onSpawn: () => {} });

    for (let n = 0; n < 50; n++) sys.run(world, /** @type {any} */ ({ tick: 0 }));

    // Saplings can still sprout outside the blueprint's radius — what matters
    // is that NONE land within Chebyshev distance 2 of (5,5).
    for (const { components } of world.query(['Tree', 'TileAnchor'])) {
      const a = components.TileAnchor;
      const dist = Math.max(Math.abs(a.i - 5), Math.abs(a.j - 5));
      expect(dist).toBeGreaterThan(2);
    }
  });
});
