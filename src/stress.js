/**
 * Spawn N entities at random positions with random velocities for the Phase 1
 * stress test. Velocities reflect off a bounding cube so they stay on screen.
 */

import { applyVelocity, snapshotPositions } from './systems/movement.js';

const BOUND = 12;

/**
 * @param {import('./ecs/world.js').World} world
 * @param {number} count
 */
export function spawnStressEntities(world, count) {
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * 2 - 1) * BOUND;
    const y = Math.random() * 6;
    const z = (Math.random() * 2 - 1) * BOUND;
    world.spawn({
      Position: { x, y, z },
      PrevPosition: { x, y, z },
      Velocity: {
        x: (Math.random() * 2 - 1) * 4,
        y: (Math.random() * 2 - 1) * 2,
        z: (Math.random() * 2 - 1) * 4,
      },
      StressViz: {},
    });
  }
}

/**
 * Reflect velocities off a bounding cube so the stress entities stay visible.
 * @type {import('./ecs/schedule.js').SystemDef}
 */
export const stressBounce = {
  name: 'stressBounce',
  tier: 'every',
  run(world) {
    for (const { components } of world.query(['Position', 'Velocity', 'StressViz'])) {
      const p = components.Position;
      const v = components.Velocity;
      if (p.x > BOUND && v.x > 0) v.x = -v.x;
      if (p.x < -BOUND && v.x < 0) v.x = -v.x;
      if (p.z > BOUND && v.z > 0) v.z = -v.z;
      if (p.z < -BOUND && v.z < 0) v.z = -v.z;
      if (p.y > 8 && v.y > 0) v.y = -v.y;
      if (p.y < 0 && v.y < 0) v.y = -v.y;
    }
  },
};

export { applyVelocity, snapshotPositions };
