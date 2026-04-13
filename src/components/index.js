/**
 * Component definitions. Components are pure data; behavior lives in systems.
 *
 * Position/PrevPosition/Velocity    kinematic state + interpolation prev
 * StressViz                          tag — stress instancer renders these
 * Cow          { drafted: boolean }  drafted cows skip autonomous AI and
 *                                    wait for player orders (RMB paths, FP
 *                                    takeover). CowViz is just the render tag.
 * Hunger      { value: 0..1 }        drains slowly; 1 = full, 0 = starving
 * Brain       { name: string }       identity for now; mood/traits later
 * Job         { kind, state, payload } kind='none' = idle
 * Path        { steps, index }       current path; index >= steps.length = arrived
 *
 * Tree / TreeViz  { markedJobId, progress } — markedJobId>0 means player
 *                                   designated it for chop; progress 0..1 drives
 *                                   visual feedback. Kept on Tree itself since
 *                                   the archetype ECS can't add/remove components.
 * TileAnchor   { i, j }              tile this world entity occupies
 * Item         { kind: string, count, capacity } — a stack of N items on a tile;
 *                                   when count reaches 0 the entity is despawned.
 * ItemViz                            tag — item instancer renders these
 * Inventory    { itemKind: string|null } — one-slot carry for cows hauling items.
 */

/**
 * @param {import('../ecs/world.js').World} world
 */
export function registerComponents(world) {
  world.defineComponent('Position', () => ({ x: 0, y: 0, z: 0 }));
  world.defineComponent('PrevPosition', () => ({ x: 0, y: 0, z: 0 }));
  world.defineComponent('Velocity', () => ({ x: 0, y: 0, z: 0 }));
  world.defineComponent('StressViz', () => ({}));
  world.defineComponent('Cow', () => ({ drafted: false }));
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
  world.defineComponent('Tree', () => ({ markedJobId: 0, progress: 0 }));
  world.defineComponent('TreeViz', () => ({}));
  world.defineComponent('TileAnchor', () => ({ i: 0, j: 0 }));
  world.defineComponent('Item', () => ({ kind: 'wood', count: 1, capacity: 50 }));
  world.defineComponent('ItemViz', () => ({}));
  world.defineComponent('Inventory', () => ({
    /** @type {string | null} */
    itemKind: null,
  }));
}
