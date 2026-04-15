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
 * Tree / TreeViz  { markedJobId, progress, kind, growth }
 *                                   markedJobId>0 means player designated it for
 *                                   chop; progress 0..1 drives chop visual
 *                                   feedback. Kept on Tree itself since the
 *                                   archetype ECS can't add/remove components.
 *                                   `kind` selects the species (birch/pine/oak/
 *                                   maple) and drives trunk+canopy colors and
 *                                   per-instance scale. `growth` 0..1 advances
 *                                   from sapling → mature via the treeGrowth
 *                                   system and caps at 1. Wood yield at chop
 *                                   scales with both (see trees.js).
 * TileAnchor   { i, j }              tile this world entity occupies
 * Item         { kind: string, count, capacity, forbidden } — a stack of N
 *                                   items on a tile; when count reaches 0 the
 *                                   entity is despawned. `forbidden` flags
 *                                   the stack as player-locked — the haul
 *                                   poster skips it entirely, and builders
 *                                   only touch it to relocate one blocking a
 *                                   wall blueprint.
 * ItemViz                            tag — item instancer renders these
 * Inventory    { itemKind: string|null } — one-slot carry for cows hauling items.
 *
 * BuildSite    { kind, requiredKind, delivered, required, buildJobId, progress }
 *              A designated-but-unfinished wall. `delivered` counts wood stacks
 *              dropped on the tile by haulers; when `delivered >= required` a
 *              `build` job opens on the board and a cow comes to erect it.
 *              `progress` 0..1 drives the in-progress visual.
 * Wall / Door / Torch / Roof / Floor
 *              { deconstructJobId, progress }
 *              Tag-ish components for finished structures. The tile's wall/
 *              door/torch/roof/floor bit in TileGrid is the source of truth
 *              for pathing (Roof doesn't affect pathing — it sits *above*
 *              tiles and blocks sunlight. Floor doesn't block either — it
 *              speeds cows up, see tileGrid.js). These entities own the
 *              instance slot for rendering + save/load. `deconstructJobId`
 *              > 0 = player marked it for demolition (a board job exists);
 *              `progress` 0..1 drives visual feedback while a cow is
 *              demolishing.
 *
 * Crop / CropViz  { kind, growthTicks }
 *              A single plant on a tilled+zoned tile. `growthTicks` only
 *              advances while the tile is sunlit ≥51% (see systems/growth.js).
 *              Visible stage is derived from growthTicks via cropStageFor().
 *              Board-level dedupe of plant/harvest jobs lives in the farm
 *              poster (by tile index) — no per-entity jobId tracking needed.
 *
 * Cuttable     { markedJobId, progress }
 *              Generic "this plant-like entity can be cut down" marker. Sits
 *              alongside Tree/Crop (and any future wild foliage) so the cut
 *              designator can query one component to find every valid target.
 *              Separate from Tree.markedJobId (which drives chop specifically),
 *              because a cut job is a strict superset — cut applies to any
 *              growth stage, and cut's yield depends on the target's own kind
 *              (woodYieldFor for Tree, cropYieldFor for Crop).
 *
 * Furnace / FurnaceViz / Bills
 *              { deconstructJobId, progress, stuff, workI, workJ,
 *                workTicksRemaining, activeBillId }
 *              An unmanned production station. Cows haul ingredients to the
 *              work-spot tile (workI, workJ — a cardinal-adjacent walkable
 *              picked at spawn); the furnace ticks autonomously and spawns
 *              output on the same tile for haulers to pick up. `Bills.list`
 *              holds ordered, player-edited recipe jobs (see src/world/recipes.js).
 *              `activeBillId > 0` means a bill is mid-production; `workTicksRemaining`
 *              counts down to 0 on completion. Bills must exist at spawn
 *              (archetype ECS) — empty list is fine.
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
  world.defineComponent('Tree', () => ({
    markedJobId: 0,
    progress: 0,
    kind: 'oak',
    growth: 1,
  }));
  world.defineComponent('TreeViz', () => ({}));
  world.defineComponent('Boulder', () => ({
    markedJobId: 0,
    progress: 0,
    kind: 'stone',
  }));
  world.defineComponent('BoulderViz', () => ({}));
  world.defineComponent('TileAnchor', () => ({ i: 0, j: 0 }));
  world.defineComponent('Item', () => ({ kind: 'wood', count: 1, capacity: 50, forbidden: false }));
  world.defineComponent('ItemViz', () => ({}));
  world.defineComponent('Inventory', () => ({
    /** @type {string | null} */
    itemKind: null,
  }));
  world.defineComponent('BuildSite', () => ({
    kind: 'wall',
    stuff: 'wood',
    requiredKind: 'wood',
    required: 1,
    delivered: 0,
    buildJobId: 0,
    progress: 0,
  }));
  world.defineComponent('BuildSiteViz', () => ({}));
  world.defineComponent('Wall', () => ({ deconstructJobId: 0, progress: 0, stuff: 'wood' }));
  world.defineComponent('WallViz', () => ({}));
  world.defineComponent('Door', () => ({ deconstructJobId: 0, progress: 0, stuff: 'wood' }));
  world.defineComponent('DoorViz', () => ({}));
  world.defineComponent('Torch', () => ({
    deconstructJobId: 0,
    progress: 0,
    wallMounted: false,
    yaw: 0,
  }));
  world.defineComponent('TorchViz', () => ({}));
  world.defineComponent('Roof', () => ({ deconstructJobId: 0, progress: 0, stuff: 'wood' }));
  world.defineComponent('RoofViz', () => ({}));
  world.defineComponent('Floor', () => ({ deconstructJobId: 0, progress: 0, stuff: 'wood' }));
  world.defineComponent('FloorViz', () => ({}));
  world.defineComponent('Crop', () => ({
    kind: 'corn',
    growthTicks: 0,
  }));
  world.defineComponent('CropViz', () => ({}));
  world.defineComponent('Cuttable', () => ({ markedJobId: 0, progress: 0 }));
  world.defineComponent('Furnace', () => ({
    deconstructJobId: 0,
    progress: 0,
    stuff: 'stone',
    workI: 0,
    workJ: 0,
    workTicksRemaining: 0,
    activeBillId: 0,
  }));
  world.defineComponent('FurnaceViz', () => ({}));
  world.defineComponent('Bills', () => ({
    /** @type {import('../world/recipes.js').Bill[]} */
    list: [],
    nextBillId: 1,
  }));
}
