/**
 * Component definitions. Components are pure data; behavior lives in systems.
 *
 * Position/PrevPosition/Velocity    kinematic state + interpolation prev
 * StressViz                          tag — stress instancer renders these
 * Cow / CowViz                       tag — cow + cow instancer renders these
 * Hunger      { value: 0..1 }        drains slowly; 1 = full, 0 = starving
 * Brain       { name: string }       identity for now; mood/traits later
 * Job         { kind, state, payload } kind='none' = idle
 * Path        { steps, index }       current path; index >= steps.length = arrived
 */

/**
 * @param {import('../ecs/world.js').World} world
 */
export function registerComponents(world) {
  world.defineComponent('Position', () => ({ x: 0, y: 0, z: 0 }));
  world.defineComponent('PrevPosition', () => ({ x: 0, y: 0, z: 0 }));
  world.defineComponent('Velocity', () => ({ x: 0, y: 0, z: 0 }));
  world.defineComponent('StressViz', () => ({}));
  world.defineComponent('Cow', () => ({}));
  world.defineComponent('Hunger', () => ({ value: 1 }));
  world.defineComponent('Brain', () => ({ name: 'cow' }));
  world.defineComponent('Job', () => ({
    kind: 'none',
    state: 'idle',
    /** @type {Record<string, any>} */
    payload: {},
  }));
  world.defineComponent('Path', () => ({
    /** @type {{ i: number, j: number }[]} */
    steps: [],
    index: 0,
  }));
  world.defineComponent('CowViz', () => ({}));
}
