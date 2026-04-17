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
 *                                    `name` is authoritative — Identity mirrors
 *                                    it so colonist UI has one record to read.
 * Identity    { name, firstName, surname, title, gender, birthTick,
 *                heightCm, hairColor, traits, childhood, profession }
 *                                    Demographic card for a colonist. `name`
 *                                    is the composed display string
 *                                    ("Dr. Bessie Moonfield"); the part
 *                                    fields drive UI that wants them
 *                                    independently. Title is
 *                                    Mr./Mrs./Ms./Mx./Dr./Prof. Gender enum
 *                                    is 'male' | 'female' | 'nonbinary' —
 *                                    the last is reserved for future robot
 *                                    colonists, cow spawner only rolls M/F.
 *                                    `birthTick` is sim-calendar ticks and may
 *                                    be negative (colonists older than the
 *                                    colony). Age is derived on read via
 *                                    calendar.ageYears so it advances live.
 *                                    `traits` is 0..N trait ids (see
 *                                    world/traits.js) — small personality
 *                                    markers that drive per-colonist visual
 *                                    quirks and, eventually, gameplay stats.
 * Job         { kind, state, payload } kind='none' = idle
 * Path        { steps, index }       current path; index >= steps.length = arrived
 *
 * Opinions    { scores, last, chats }
 *                                    Per-cow sparse map of this cow's feeling
 *                                    toward every other cow they've met.
 *                                    `scores[otherId]` clamps to [-100, +100];
 *                                    `last[otherId] = { text, tick }` caches
 *                                    the most recent interaction phrase for
 *                                    the Social tab. `chats` is a lifetime
 *                                    counter for fun stats.
 * Chat        { text, partnerId, expiresAtTick }
 *                                    Transient speech bubble driven by the
 *                                    social system. The render-side chat-
 *                                    bubble layer reads this and hides it
 *                                    once `ctx.tick >= expiresAtTick`. Only
 *                                    one active chat per cow at a time — the
 *                                    system overwrites on new interactions.
 *
 * Skills     { levels: Record<SkillId, { level, xp }>, learnRateMultiplier }
 *                                   Per-colonist competence in each work
 *                                   domain (cooking/construction/mining/
 *                                   crafting/plants) plus two dormant combat
 *                                   ids (melee/shooting) that store + display
 *                                   fine but have no XP source yet. Rolled
 *                                   at spawn from profession/childhood/age
 *                                   hints; awarded at job finish. See
 *                                   world/skills.js. learnRateMultiplier is
 *                                   stored per-cow and already honored by
 *                                   awardXp, but nothing currently varies it.
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
 * TileAnchor   { i, j, z }           tile this world entity occupies. `z` is
 *                                   the vertical layer (0 = ground); reserved
 *                                   for future stacked-level support, defaults
 *                                   to 0 everywhere today.
 * Item         { kind: string, count, capacity, forbidden } — a stack of N
 *                                   items on a tile; when count reaches 0 the
 *                                   entity is despawned. `forbidden` flags
 *                                   the stack as player-locked — the haul
 *                                   poster skips it entirely, and builders
 *                                   only touch it to relocate one blocking a
 *                                   wall blueprint.
 * ItemViz                            tag — item instancer renders these
 * Inventory    { items: { kind, count }[] } — multi-stack carry gated by a 60kg
 *              mass budget (see items.js WEIGHT_PER_UNIT + COW_CARRY_KG). In
 *              practice a haul cow carries a single kind per trip because
 *              picking-up fills one stack before walking to drop.
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
 *              { deconstructJobId, progress, stuff, workI, workJ, facing,
 *                workTicksRemaining, activeBillId, stored[], outputs[] }
 *              An unmanned production station. Cows haul ingredients to the
 *              work-spot tile (workI, workJ — a cardinal-adjacent walkable
 *              picked at spawn) and deposit them INTO `stored`. The furnace
 *              consumes from `stored` and pushes finished goods into
 *              `outputs`, which a haul job then pulls out and carries to a
 *              stockpile. Both arrays use the same `{kind,count}[]` shape as
 *              cow Inventory. `Bills.list` holds ordered, player-edited
 *              recipe jobs (see src/world/recipes.js). `activeBillId > 0`
 *              means a bill is mid-production; `workTicksRemaining` counts
 *              down to 0 on completion.
 *
 * Easel / EaselViz
 *              { deconstructJobId, progress, stuff, workI, workJ, facing,
 *                workTicksRemaining, activeBillId, artistCowId, startTick,
 *                stored: { kind, count }[] }
 *              A MANNED production station: the artist-cow stands on the
 *              work-spot for the full duration. Supply lands in `stored`
 *              (same pattern as furnace); ingredients are consumed at craft
 *              start and there is NO output buffer — the finished painting
 *              entity spawns on the easel tile as a one-off Item for haulers
 *              to pick up. Paintings are unique, non-stackable. `artistCowId`
 *              locks the work-in-progress to one cow; if she's pulled away
 *              the bill pauses and only she can resume (preserves
 *              attribution).
 *
 * Stove / StoveViz
 *              { deconstructJobId, progress, stuff, workI, workJ, facing,
 *                workTicksRemaining, activeBillId, cookCowId, startTick,
 *                mealQuality, mealIngredients[], stored: { kind, count }[] }
 *              A MANNED 3x1 cooking station. Anchor tile sits in the middle;
 *              the two span-neighbors (perpendicular to facing) are also
 *              blocked, presenting one long edge with a single work-spot.
 *              Supply lands in `stored`; at craft start ingredients are
 *              consumed and `mealQuality` is rolled against the cook's skill.
 *              The cook stands on the work-spot for the full duration, then
 *              spawns N `meal` Item stacks on the anchor tile with quality +
 *              ingredients baked in so the poisoning/stack-match rules can
 *              discriminate between gourmet and yucky dishes.
 *
 * Painting / PaintingViz
 *              { size, title, palette[], shapes[], quality,
 *                artistCowId, artistName, easelI, easelJ, startTick, finishTick }
 *              A non-stackable creative work. `palette` and `shapes` drive
 *              the procgen render. `size` is 1..4 tiles (wall-mount span).
 *              Attribution fields are snapshots — `artistName` is frozen
 *              even if the cow dies or gets renamed. `quality` is a forward-
 *              compat framework field; always `'normal'` today.
 *
 * WallArt / WallArtViz
 *              { face, size, title, palette[], shapes[], quality,
 *                artistCowId, artistName, easelI, easelJ, startTick, finishTick,
 *                uninstallJobId, progress }
 *              The "installed" form of a painting: mounted flat against a wall
 *              face on its TileAnchor tile. `face` is a FACING index (0..3,
 *              S/E/N/W) pointing at the wall the art hangs on. `size` mirrors
 *              Painting.size and spans that many tiles along the wall. All
 *              Painting metadata is duplicated here so the WallArt can round-
 *              trip without the original Item entity. `uninstallJobId > 0`
 *              means a cow has been dispatched to pry it off the wall;
 *              `progress` 0..1 drives in-progress visual feedback.
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
  world.defineComponent('Tiredness', () => ({ value: 1 }));
  world.defineComponent('FoodPoisoning', () => ({
    /** ticks until the debuff lifts; 0 = not poisoned. */
    ticksRemaining: 0,
  }));
  world.defineComponent('Brain', () => ({
    name: 'cow',
    jobDirty: true,
    vitalsDirty: true,
    lastBoardVersion: -1,
    /** Current z-layer the cow stands on. Updated by the follow-path loop
     * whenever the cow arrives on a path step; consumed by job pathing so
     * start.z matches the layer the cow is actually on. */
    layerZ: 0,
  }));
  world.defineComponent('Identity', () => ({
    name: 'cow',
    firstName: 'cow',
    surname: '',
    /** @type {'Mr.' | 'Mrs.' | 'Ms.' | 'Mx.' | 'Dr.' | 'Prof.' | 'Col.'} */
    title: 'Mx.',
    /** @type {'male' | 'female' | 'nonbinary'} */
    gender: 'female',
    birthTick: 0,
    heightCm: 170,
    hairColor: '#4a2f20',
    /** @type {string[]} */
    traits: [],
    childhood: '',
    profession: '',
  }));
  world.defineComponent('Job', () => ({
    kind: 'none',
    state: 'idle',
    /** @type {Record<string, any>} */
    payload: {},
    // Player right-clicked this cow onto a specific job. Blocks hunger/
    // tiredness preempt so player-directed work always finishes before
    // self-care kicks in.
    prioritized: false,
    // Shift-clicked priority orders stack here as board jobIds. When the
    // current job ends and this queue has entries, the brain pops the next
    // id, claims it, and starts walking. Empty = no queue.
    /** @type {number[]} */
    priorityQueue: [],
  }));
  world.defineComponent('Path', () => ({
    /** @type {{ i: number, j: number }[]} */
    steps: [],
    index: 0,
  }));
  world.defineComponent('CowViz', () => ({}));
  world.defineComponent('Opinions', () => ({
    /** @type {Record<number, number>} opinion of other cow by entity id, clamped -100..+100 */
    scores: {},
    /** @type {Record<number, { text: string, tick: number }>} last chat recall per partner */
    last: {},
    /** @type {number} total chats this cow has participated in */
    chats: 0,
  }));
  world.defineComponent('Chat', () => ({
    /** @type {string} the bubble text, e.g. "babbled about the weather" */
    text: '',
    /** @type {number} partner cow entity id (0 = none) */
    partnerId: 0,
    /** @type {number} sim tick the bubble should hide at */
    expiresAtTick: 0,
  }));
  world.defineComponent('Health', () => ({
    /** @type {import('../world/anatomy.js').Injury[]} */
    injuries: [],
    /** Monotonic id assigner for injuries on this body; stable for UI keys. */
    nextInjuryId: 1,
    /** `true` once a vital part drops to 0 HP; systems should stop scheduling work for a dead cow. */
    dead: false,
  }));
  world.defineComponent('Skills', () => ({
    /** @type {Record<string, { level: number, xp: number }>} */
    levels: {},
    /** Per-cow XP-gain multiplier. Reserved for a future learning/passion
     * pass — nothing reads it as a gameplay gate yet, but awardXp already
     * honors it so the system doesn't need re-plumbing later. */
    learnRateMultiplier: 1,
  }));
  world.defineComponent('WorkPriorities', () => ({
    /** @type {Record<string, number>} Category → priority. 0 = disabled, 1..8 = enabled (lower = sooner). */
    priorities: {},
  }));
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
  world.defineComponent('TileAnchor', () => ({ i: 0, j: 0, z: 0 }));
  world.defineComponent('Item', () => ({
    kind: 'wood',
    count: 1,
    capacity: 50,
    forbidden: false,
    /** Meal tier — '' for non-meals. See world/quality.js. */
    quality: '',
    /** Source kinds that cooked into this meal — '' for non-meals. */
    ingredients: /** @type {string[]} */ ([]),
  }));
  world.defineComponent('ItemViz', () => ({}));
  world.defineComponent('Inventory', () => ({
    /** @type {{ kind: string, count: number }[]} */
    items: [],
  }));
  world.defineComponent('BuildSite', () => ({
    kind: 'wall',
    stuff: 'wood',
    requiredKind: 'wood',
    required: 1,
    delivered: 0,
    buildJobId: 0,
    progress: 0,
    facing: 0,
    forbidden: false,
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
    facing: 0,
    /** @type {{ kind: string, count: number }[]} */
    stored: [],
    /** @type {{ kind: string, count: number }[]} */
    outputs: [],
  }));
  world.defineComponent('FurnaceViz', () => ({}));
  world.defineComponent('Bills', () => ({
    /** @type {import('../world/recipes.js').Bill[]} */
    list: [],
    nextBillId: 1,
  }));
  world.defineComponent('Easel', () => ({
    deconstructJobId: 0,
    progress: 0,
    stuff: 'wood',
    workI: 0,
    workJ: 0,
    facing: 0,
    workTicksRemaining: 0,
    activeBillId: 0,
    artistCowId: 0,
    startTick: 0,
    /** @type {{ kind: string, count: number }[]} */
    stored: [],
  }));
  world.defineComponent('EaselViz', () => ({}));
  world.defineComponent('Bed', () => ({
    deconstructJobId: 0,
    progress: 0,
    stuff: 'wood',
    facing: 0,
    /** Assigned sleeper; 0 = unclaimed. Set on first sleep (phase 3). */
    ownerId: 0,
    /** Currently occupying cow; 0 = empty. Updated by sleep job (phase 3). */
    occupantId: 0,
  }));
  world.defineComponent('BedViz', () => ({}));
  world.defineComponent('Stove', () => ({
    deconstructJobId: 0,
    progress: 0,
    stuff: 'stone',
    workI: 0,
    workJ: 0,
    facing: 0,
    workTicksRemaining: 0,
    activeBillId: 0,
    cookCowId: 0,
    startTick: 0,
    /** Quality tier rolled at craft start; written onto the spawned meal. */
    mealQuality: '',
    /** Ingredients consumed this craft; written onto the spawned meal. */
    mealIngredients: /** @type {string[]} */ ([]),
    /** @type {{ kind: string, count: number }[]} */
    stored: [],
  }));
  world.defineComponent('StoveViz', () => ({}));
  world.defineComponent('Stair', () => ({
    deconstructJobId: 0,
    progress: 0,
    stuff: 'wood',
    facing: 0,
    /** Layer of the bottom landing; top landing lives on bottomZ+1. */
    bottomZ: 0,
  }));
  world.defineComponent('StairViz', () => ({}));
  world.defineComponent('Painting', () => ({
    size: 1,
    title: '',
    /** @type {string[]} */
    palette: [],
    /** @type {{ type: string, x: number, y: number, w: number, h: number, color: number }[]} */
    shapes: [],
    quality: 'normal',
    artistCowId: 0,
    artistName: '',
    easelI: 0,
    easelJ: 0,
    startTick: 0,
    finishTick: 0,
  }));
  world.defineComponent('PaintingViz', () => ({}));
  world.defineComponent('WallArt', () => ({
    face: 0,
    size: 1,
    title: '',
    /** @type {string[]} */
    palette: [],
    /** @type {{ type: string, x: number, y: number, w: number, h: number, color: number }[]} */
    shapes: [],
    quality: 'normal',
    artistCowId: 0,
    artistName: '',
    easelI: 0,
    easelJ: 0,
    startTick: 0,
    finishTick: 0,
    uninstallJobId: 0,
    progress: 0,
  }));
  world.defineComponent('WallArtViz', () => ({}));
}
