/**
 * Component definitions for Phase 1.
 * Components are pure data; behavior lives in systems.
 */

/** @typedef {{ x: number, y: number, z: number }} Vec3 */

/**
 * Register Phase 1 components on the given world.
 * @param {import('../ecs/world.js').World} world
 */
export function registerPhase1Components(world) {
  world.defineComponent('Position', () => ({ x: 0, y: 0, z: 0 }));
  world.defineComponent('PrevPosition', () => ({ x: 0, y: 0, z: 0 }));
  world.defineComponent('Velocity', () => ({ x: 0, y: 0, z: 0 }));
  /** Tag-only component used to mark entities that should render via the stress instancer. */
  world.defineComponent('StressViz', () => ({}));
}
