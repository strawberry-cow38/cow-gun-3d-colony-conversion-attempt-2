/**
 * Phase 3 cow components.
 *
 * Cow         tag (used for queries + render)
 * Hunger      { value: 0..1 } — drains slowly; 1 = full, 0 = starving
 * Brain       { name: string } — for now just identity; mood/traits later
 * Job         { kind: string, state: string, payload: object } — kind='none' = idle
 * Path        { steps, index } — current path being followed; index >= steps.length = arrived
 * CowViz      tag — instancer renders these
 */

/**
 * @param {import('../ecs/world.js').World} world
 */
export function registerPhase3Components(world) {
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
