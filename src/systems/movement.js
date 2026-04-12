/**
 * Movement systems.
 *
 * `snapshotPositions` runs FIRST every tick: copies current Position → PrevPosition
 * so render interpolation has a stable "previous" frame to lerp from.
 *
 * `applyVelocity` then advances Position by Velocity * dt.
 */

/** @type {import('../ecs/schedule.js').SystemDef} */
export const snapshotPositions = {
  name: 'snapshotPositions',
  tier: 'every',
  run(world) {
    for (const { components } of world.query(['Position', 'PrevPosition'])) {
      const p = components.Position;
      const pp = components.PrevPosition;
      pp.x = p.x;
      pp.y = p.y;
      pp.z = p.z;
    }
  },
};

/** @type {import('../ecs/schedule.js').SystemDef} */
export const applyVelocity = {
  name: 'applyVelocity',
  tier: 'every',
  run(world, ctx) {
    const dt = ctx.dt;
    for (const { components } of world.query(['Position', 'Velocity'])) {
      const p = components.Position;
      const v = components.Velocity;
      p.x += v.x * dt;
      p.y += v.y * dt;
      p.z += v.z * dt;
    }
  },
};
