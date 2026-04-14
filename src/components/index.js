/**
 * Component definitions. Components are pure data; behavior lives in systems.
 *
 * Position/PrevPosition/Velocity    kinematic state + interpolation prev
 * StressViz                          tag — stress instancer renders these
 * Cow          { drafted: boolean }  drafted cows skip autonomous AI and
 *                                    wait for player orders (RMB paths, FP
 *                                    takeover). CowViz is just the render tag.
 * Hunger      { value: 0..1 }        drains slowly; 1 = full, 0 = starving
 * Brain       { name, jobDirty, vitalsDirty, lastBoardVersion }
 *                                    Dirty flags gate the expensive decide-what-
 *                                    to-do block in the brain loop. jobDirty is
 *                                    raised on draft toggle and job completion;
 *                                    vitalsDirty on hunger drain; lastBoardVersion
 *                                    compared against JobBoard.version so a new
 *                                    posting wakes idle cows. Default true on
 *                                    spawn/hydrate so fresh cows evaluate once.
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
 *
 * BuildSite    { kind, requiredKind, delivered, required, buildJobId, progress }
 *              A designated-but-unfinished wall. `delivered` counts wood stacks
 *              dropped on the tile by haulers; when `delivered >= required` a
 *              `build` job opens on the board and a cow comes to erect it.
 *              `progress` 0..1 drives the in-progress visual.
 * Wall / Door / Torch / Roof
 *              { deconstructJobId, progress }
 *              Tag-ish components for finished structures. The tile's wall/
 *              door/torch/roof bit in TileGrid is the source of truth for
 *              pathing (Roof doesn't affect pathing — it sits *above* tiles
 *              and blocks sunlight). These entities own the instance slot for
 *              rendering + save/load. `deconstructJobId` > 0 = player marked
 *              it for demolition (a board job exists); `progress` 0..1 drives
 *              visual feedback while a cow is demolishing.
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
  world.defineComponent('Brain', () => ({
    name: 'cow',
    jobDirty: true,
    vitalsDirty: true,
    lastBoardVersion: -1,
  }));
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
  world.defineComponent('BuildSite', () => ({
    kind: 'wall',
    requiredKind: 'wood',
    required: 1,
    delivered: 0,
    buildJobId: 0,
    progress: 0,
  }));
  world.defineComponent('BuildSiteViz', () => ({}));
  world.defineComponent('Wall', () => ({ deconstructJobId: 0, progress: 0 }));
  world.defineComponent('WallViz', () => ({}));
  world.defineComponent('Door', () => ({ deconstructJobId: 0, progress: 0 }));
  world.defineComponent('DoorViz', () => ({}));
  world.defineComponent('Torch', () => ({
    deconstructJobId: 0,
    progress: 0,
    wallMounted: false,
    yaw: 0,
  }));
  world.defineComponent('TorchViz', () => ({}));
  world.defineComponent('Roof', () => ({ deconstructJobId: 0, progress: 0 }));
  world.defineComponent('RoofViz', () => ({}));
}
