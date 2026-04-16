/**
 * Save / load: serialize world state to JSON, gzip it on the wire and at rest.
 *
 * Format (v25):
 * {
 *   version: 25,
 *   tileGrid: { W, H, elevation: number[], biome: number[], stockpile: number[], wall: number[], door: number[], torch: number[], roof: number[], ignoreRoof: number[], floor: number[], farmZone: number[], tilled: number[], flower: number[] },
 *   cows: [ {
 *     name, drafted: boolean, position: {x,y,z}, hunger: number,
 *     job: { kind, state, payload }, path: { steps, index },
 *     inventory: { items: { kind: string, count: number }[] }
 *   } ],
 *   trees: [ { i, j, marked: boolean, progress: number, kind: string, growth: number } ],
 *   items: [ { i, j, kind: string, count: number, capacity: number, forbidden: boolean } ],
 *   buildSites: [ { i, j, kind, stuff, requiredKind, required, delivered, progress } ],
 *   walls: [ { i, j, stuff, decon: boolean, progress: number } ],
 *   doors: [ { i, j, stuff, decon: boolean, progress: number } ],
 *   torches: [ { i, j, decon: boolean, progress: number } ],
 *   roofs: [ { i, j, stuff, decon: boolean, progress: number } ],
 *   floors: [ { i, j, stuff, decon: boolean, progress: number } ],
 *   crops: [ { i, j, kind: string, growthTicks: number } ],
 *   furnaces: [ { i, j, stuff, workI, workJ, facing, decon, progress, workTicksRemaining, activeBillId, stored: { kind, count }[], outputs: { kind, count }[], bills, nextBillId } ],
 *   easels: [ { i, j, stuff, workI, workJ, facing, decon, progress, workTicksRemaining, activeBillId, artistCowId, startTick, stored: { kind, count }[], bills, nextBillId } ],
 *   stoves: [ { i, j, stuff, workI, workJ, facing, decon, progress, workTicksRemaining, activeBillId, cookCowId, startTick, mealQuality, mealIngredients: string[], stored: { kind, count }[], bills, nextBillId } ],
 *   paintings: [ { i, j, size, title, palette, shapes, quality, artistCowId, artistName, easelI, easelJ, startTick, finishTick, forbidden } ],
 *   wallArt: [ { i, j, face, size, title, palette, shapes, quality, artistCowId, artistName, easelI, easelJ, startTick, finishTick } ]
 * }
 *
 * Browser uses CompressionStream('gzip'). Node tests use zlib.
 *
 * On load, runs the migration chain (see ./migrations/index.js) so old saves
 * always upgrade cleanly.
 */

import { bedFootprintTiles } from './bed.js';
import { tileToWorld } from './coords.js';
import { CURRENT_VERSION, runMigrations } from './migrations/index.js';
import { stoveFootprintTiles } from './stove.js';
import { TileGrid } from './tileGrid.js';
import { deriveDefaultsFromSkills, sanitizePriorities } from './workPriorities.js';

/**
 * Coerce a free-form `levels` bag into the strict `{ level, xp }` shape.
 * Shared by serialize (tolerates live-data drift) and hydrate (sanitizes
 * untrusted save JSON) so both paths agree on the canonical layout.
 *
 * @param {Record<string, { level: number, xp: number }> | undefined} levels
 */
function sanitizeSkillLevels(levels) {
  /** @type {Record<string, { level: number, xp: number }>} */
  const out = {};
  if (!levels) return out;
  for (const k of Object.keys(levels)) {
    const v = levels[k];
    out[k] = { level: v.level | 0, xp: +v.xp || 0 };
  }
  return out;
}

/**
 * @typedef SerializedIdentity
 * @property {'male' | 'female' | 'nonbinary'} gender
 * @property {number} birthTick
 * @property {number} heightCm
 * @property {string} hairColor
 * @property {string[]} traits
 * @property {string} firstName
 * @property {string} surname
 * @property {'Mr.' | 'Mrs.' | 'Ms.' | 'Mx.' | 'Dr.' | 'Prof.' | 'Col.'} title
 * @property {string} childhood
 * @property {string} profession
 */

/**
 * @typedef SerializedOpinions
 * @property {Record<string, number>} scores        keyed by partner's save-array index (stringified number)
 * @property {Record<string, { text: string, tick: number }>} last
 * @property {number} chats
 */

/**
 * @typedef SerializedHealth
 * @property {import('../world/anatomy.js').Injury[]} injuries
 * @property {number} nextInjuryId
 * @property {boolean} dead
 */

/**
 * @typedef SerializedSkills
 * @property {Record<string, { level: number, xp: number }>} levels
 * @property {number} learnRateMultiplier
 */

/**
 * @typedef SerializedWorkPriorities
 * @property {Record<string, number>} priorities
 */

/**
 * @typedef SerializedCow
 * @property {string} name
 * @property {boolean} drafted
 * @property {{ x: number, y: number, z: number }} position
 * @property {number} hunger
 * @property {number} [tiredness]
 * @property {{ ticksRemaining: number }} [foodPoisoning]
 * @property {{ kind: string, state: string, payload: Record<string, any> }} job
 * @property {{ steps: { i: number, j: number }[], index: number }} path
 * @property {{ items: { kind: string, count: number }[] }} inventory
 * @property {SerializedIdentity} identity
 * @property {SerializedOpinions} [opinions]
 * @property {SerializedHealth} [health]
 * @property {SerializedSkills} [skills]
 * @property {SerializedWorkPriorities} [workPriorities]
 */

/**
 * @typedef SerializedTree
 * @property {number} i
 * @property {number} j
 * @property {boolean} marked
 * @property {number} progress  0..1 chop progress at save time
 * @property {string} kind      species: birch/pine/oak/maple
 * @property {number} growth    0..1 sapling→mature progress
 * @property {boolean} cutMarked  player marked it for cut-plants
 * @property {number} cutProgress 0..1 cut progress at save time
 */

/**
 * @typedef SerializedBoulder
 * @property {number} i
 * @property {number} j
 * @property {boolean} marked
 * @property {number} progress  0..1 mine progress at save time
 * @property {string} kind      stone/metal/coal
 */

/**
 * @typedef SerializedItem
 * @property {number} i
 * @property {number} j
 * @property {string} kind
 * @property {number} count
 * @property {number} capacity
 * @property {boolean} forbidden
 * @property {string} [quality]           meal tier (only on cooked meals)
 * @property {string[]} [ingredients]     source kinds the meal was cooked from
 */

/**
 * @typedef SerializedBuildSite
 * @property {number} i
 * @property {number} j
 * @property {string} kind
 * @property {string} stuff
 * @property {string} requiredKind
 * @property {number} required
 * @property {number} delivered
 * @property {number} progress
 * @property {number} [facing]
 */

/**
 * @typedef SerializedWall
 * @property {number} i
 * @property {number} j
 * @property {string} stuff
 * @property {boolean} decon  player marked it for demolition
 * @property {number} progress  0..1 demolition progress at save time
 */

/**
 * @typedef SerializedDoor
 * @property {number} i
 * @property {number} j
 * @property {string} stuff
 * @property {boolean} decon
 * @property {number} progress
 */

/**
 * @typedef SerializedTorch
 * @property {number} i
 * @property {number} j
 * @property {boolean} decon
 * @property {number} progress
 * @property {boolean} [wallMounted]
 * @property {number} [yaw]
 */

/**
 * @typedef SerializedRoof
 * @property {number} i
 * @property {number} j
 * @property {string} stuff
 * @property {boolean} decon
 * @property {number} progress
 */

/**
 * @typedef SerializedFloor
 * @property {number} i
 * @property {number} j
 * @property {string} stuff
 * @property {boolean} decon
 * @property {number} progress
 */

/**
 * @typedef SerializedCrop
 * @property {number} i
 * @property {number} j
 * @property {string} kind
 * @property {number} growthTicks
 * @property {boolean} cutMarked
 * @property {number} cutProgress
 */

/**
 * @typedef SerializedEasel
 * @property {number} i
 * @property {number} j
 * @property {string} stuff
 * @property {number} workI
 * @property {number} workJ
 * @property {boolean} decon
 * @property {number} progress
 * @property {number} workTicksRemaining
 * @property {number} activeBillId
 * @property {number} artistCowId
 * @property {number} startTick
 * @property {number} [facing]
 * @property {{ kind: string, count: number }[]} [stored]
 * @property {import('./recipes.js').Bill[]} [bills]
 * @property {number} [nextBillId]
 */

/**
 * @typedef SerializedStove
 * @property {number} i
 * @property {number} j
 * @property {string} stuff
 * @property {number} workI
 * @property {number} workJ
 * @property {boolean} decon
 * @property {number} progress
 * @property {number} workTicksRemaining
 * @property {number} activeBillId
 * @property {number} cookCowId
 * @property {number} startTick
 * @property {number} [facing]
 * @property {string} [mealQuality]
 * @property {string[]} [mealIngredients]
 * @property {{ kind: string, count: number }[]} [stored]
 * @property {import('./recipes.js').Bill[]} [bills]
 * @property {number} [nextBillId]
 */

/**
 * @typedef SerializedBed
 * @property {number} i
 * @property {number} j
 * @property {string} stuff
 * @property {boolean} decon
 * @property {number} progress
 * @property {number} facing
 * @property {number} ownerId
 * @property {number} occupantId
 */

/**
 * @typedef SerializedPainting
 * @property {number} i
 * @property {number} j
 * @property {number} size
 * @property {string} title
 * @property {string[]} palette
 * @property {{ type: string, x: number, y: number, w: number, h: number, color: number }[]} shapes
 * @property {string} quality
 * @property {number} artistCowId
 * @property {string} artistName
 * @property {number} easelI
 * @property {number} easelJ
 * @property {number} startTick
 * @property {number} finishTick
 * @property {boolean} forbidden
 */

/**
 * @typedef SerializedWallArt
 * @property {number} i
 * @property {number} j
 * @property {number} face
 * @property {number} size
 * @property {string} title
 * @property {string[]} palette
 * @property {{ type: string, x: number, y: number, w: number, h: number, color: number }[]} shapes
 * @property {string} quality
 * @property {number} artistCowId
 * @property {string} artistName
 * @property {number} easelI
 * @property {number} easelJ
 * @property {number} startTick
 * @property {number} finishTick
 */

/**
 * @typedef SerializedFurnace
 * @property {number} i
 * @property {number} j
 * @property {string} stuff
 * @property {number} workI
 * @property {number} workJ
 * @property {boolean} decon
 * @property {number} progress
 * @property {number} workTicksRemaining
 * @property {number} activeBillId
 * @property {number} [facing]
 * @property {{ kind: string, count: number }[]} [stored]
 * @property {{ kind: string, count: number }[]} [outputs]
 * @property {import('./recipes.js').Bill[]} [bills]
 * @property {number} [nextBillId]
 */

/**
 * @param {TileGrid} tileGrid
 * @param {import('../ecs/world.js').World} world
 */
export function serializeState(tileGrid, world) {
  // Opinion maps are keyed by entity id, which doesn't survive save→load —
  // remap to save-array indices here, back to the new ids in hydrateCows.
  // DEV-mode query proxies revoke between iterations, so the first pass
  // snapshots the opinion data into plain objects before the proxy flips.
  /**
   * @type {{ id: number, serialized: SerializedCow, scores: Record<number, number>, last: Record<number, { text: string, tick: number }>, chats: number }[]}
   */
  const pending = [];
  /** @type {Map<number, number>} */
  const idToIndex = new Map();
  for (const { id, components } of world.query([
    'Cow',
    'Position',
    'Hunger',
    'Tiredness',
    'FoodPoisoning',
    'Brain',
    'Identity',
    'Job',
    'Path',
    'Inventory',
    'Opinions',
    'Health',
    'Skills',
    'WorkPriorities',
  ])) {
    const op = components.Opinions;
    const health = components.Health;
    const skills = components.Skills;
    const workPriorities = components.WorkPriorities;
    const serialized = {
      name: components.Brain.name,
      drafted: components.Cow.drafted === true,
      position: { x: components.Position.x, y: components.Position.y, z: components.Position.z },
      hunger: components.Hunger.value,
      tiredness: components.Tiredness.value,
      foodPoisoning: { ticksRemaining: components.FoodPoisoning.ticksRemaining | 0 },
      job: {
        kind: components.Job.kind,
        state: components.Job.state,
        payload: components.Job.payload,
      },
      path: {
        steps: components.Path.steps.map((s) => ({ i: s.i, j: s.j })),
        index: components.Path.index,
      },
      inventory: {
        items: components.Inventory.items.map((s) => ({ kind: s.kind, count: s.count })),
      },
      identity: {
        gender: components.Identity.gender,
        birthTick: components.Identity.birthTick,
        heightCm: components.Identity.heightCm,
        hairColor: components.Identity.hairColor,
        traits: [...components.Identity.traits],
        firstName: components.Identity.firstName,
        surname: components.Identity.surname,
        title: components.Identity.title,
        childhood: components.Identity.childhood ?? '',
        profession: components.Identity.profession ?? '',
      },
      opinions: { scores: {}, last: {}, chats: 0 },
      health: {
        injuries: health.injuries.map((inj) => ({ ...inj })),
        nextInjuryId: health.nextInjuryId,
        dead: health.dead === true,
      },
      skills: {
        levels: sanitizeSkillLevels(skills.levels),
        learnRateMultiplier: +skills.learnRateMultiplier || 1,
      },
      workPriorities: {
        priorities: sanitizePriorities(workPriorities.priorities),
      },
    };
    idToIndex.set(id, pending.length);
    pending.push({
      id,
      serialized,
      scores: { ...op.scores },
      last: { ...op.last },
      chats: op.chats ?? 0,
    });
  }
  /** @type {SerializedCow[]} */
  const cows = [];
  for (const entry of pending) {
    /** @type {Record<string, number>} */
    const opScores = {};
    for (const key of Object.keys(entry.scores)) {
      const k = Number(key);
      const idx = idToIndex.get(k);
      if (idx !== undefined) opScores[idx] = entry.scores[k];
    }
    /** @type {Record<string, { text: string, tick: number }>} */
    const opLast = {};
    for (const key of Object.keys(entry.last)) {
      const k = Number(key);
      const idx = idToIndex.get(k);
      if (idx !== undefined) opLast[idx] = entry.last[k];
    }
    entry.serialized.opinions = { scores: opScores, last: opLast, chats: entry.chats };
    cows.push(entry.serialized);
  }
  /** @type {SerializedTree[]} */
  const trees = [];
  for (const { components } of world.query(['Tree', 'TileAnchor', 'Cuttable'])) {
    trees.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      marked: components.Tree.markedJobId > 0,
      progress: components.Tree.progress,
      kind: components.Tree.kind,
      growth: components.Tree.growth,
      cutMarked: components.Cuttable.markedJobId > 0,
      cutProgress: components.Cuttable.progress,
    });
  }
  /** @type {SerializedBoulder[]} */
  const boulders = [];
  for (const { components } of world.query(['Boulder', 'TileAnchor'])) {
    boulders.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      marked: components.Boulder.markedJobId > 0,
      progress: components.Boulder.progress,
      kind: components.Boulder.kind,
    });
  }
  /** @type {SerializedItem[]} */
  const items = [];
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    // Paintings are Item entities with per-instance metadata (title, palette,
    // …). They round-trip through the `paintings` section below so that
    // metadata survives; skip them here to avoid a duplicate plain-item entry.
    if (components.Item.kind === 'painting') continue;
    const it = components.Item;
    /** @type {SerializedItem} */
    const entry = {
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      kind: it.kind,
      count: it.count,
      capacity: it.capacity,
      forbidden: it.forbidden === true,
    };
    if (it.quality) entry.quality = it.quality;
    if (Array.isArray(it.ingredients) && it.ingredients.length > 0) {
      entry.ingredients = [...it.ingredients];
    }
    items.push(entry);
  }
  /** @type {SerializedBuildSite[]} */
  const buildSites = [];
  for (const { components } of world.query(['BuildSite', 'TileAnchor'])) {
    buildSites.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      kind: components.BuildSite.kind,
      stuff: components.BuildSite.stuff ?? 'wood',
      requiredKind: components.BuildSite.requiredKind,
      required: components.BuildSite.required,
      delivered: components.BuildSite.delivered,
      progress: components.BuildSite.progress,
      facing: components.BuildSite.facing ?? 0,
    });
  }
  /** @type {SerializedWall[]} */
  const walls = [];
  for (const { components } of world.query(['Wall', 'TileAnchor'])) {
    walls.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      stuff: components.Wall.stuff ?? 'wood',
      decon: components.Wall.deconstructJobId > 0,
      progress: components.Wall.progress ?? 0,
    });
  }
  /** @type {SerializedDoor[]} */
  const doors = [];
  for (const { components } of world.query(['Door', 'TileAnchor'])) {
    doors.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      stuff: components.Door.stuff ?? 'wood',
      decon: components.Door.deconstructJobId > 0,
      progress: components.Door.progress ?? 0,
    });
  }
  /** @type {SerializedTorch[]} */
  const torches = [];
  for (const { components } of world.query(['Torch', 'TileAnchor'])) {
    torches.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      decon: components.Torch.deconstructJobId > 0,
      progress: components.Torch.progress ?? 0,
      wallMounted: components.Torch.wallMounted === true,
      yaw: components.Torch.yaw ?? 0,
    });
  }
  /** @type {SerializedRoof[]} */
  const roofs = [];
  for (const { components } of world.query(['Roof', 'TileAnchor'])) {
    roofs.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      stuff: components.Roof.stuff ?? 'wood',
      decon: components.Roof.deconstructJobId > 0,
      progress: components.Roof.progress ?? 0,
    });
  }
  /** @type {SerializedFloor[]} */
  const floors = [];
  for (const { components } of world.query(['Floor', 'TileAnchor'])) {
    floors.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      stuff: components.Floor.stuff ?? 'wood',
      decon: components.Floor.deconstructJobId > 0,
      progress: components.Floor.progress ?? 0,
    });
  }
  /** @type {SerializedCrop[]} */
  const crops = [];
  for (const { components } of world.query(['Crop', 'TileAnchor', 'Cuttable'])) {
    crops.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      kind: components.Crop.kind,
      growthTicks: components.Crop.growthTicks,
      cutMarked: components.Cuttable.markedJobId > 0,
      cutProgress: components.Cuttable.progress,
    });
  }
  /** @type {SerializedFurnace[]} */
  const furnaces = [];
  for (const { components } of world.query(['Furnace', 'TileAnchor', 'Bills'])) {
    furnaces.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      stuff: components.Furnace.stuff ?? 'stone',
      workI: components.Furnace.workI,
      workJ: components.Furnace.workJ,
      decon: components.Furnace.deconstructJobId > 0,
      progress: components.Furnace.progress ?? 0,
      workTicksRemaining: components.Furnace.workTicksRemaining ?? 0,
      activeBillId: components.Furnace.activeBillId ?? 0,
      facing: components.Furnace.facing ?? 0,
      stored: components.Furnace.stored.map((s) => ({ kind: s.kind, count: s.count })),
      outputs: components.Furnace.outputs.map((s) => ({ kind: s.kind, count: s.count })),
      bills: components.Bills.list.map((b) => ({ ...b })),
      nextBillId: components.Bills.nextBillId,
    });
  }
  /** @type {SerializedEasel[]} */
  const easels = [];
  for (const { components } of world.query(['Easel', 'TileAnchor', 'Bills'])) {
    easels.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      stuff: components.Easel.stuff ?? 'wood',
      workI: components.Easel.workI,
      workJ: components.Easel.workJ,
      decon: components.Easel.deconstructJobId > 0,
      progress: components.Easel.progress ?? 0,
      workTicksRemaining: components.Easel.workTicksRemaining ?? 0,
      activeBillId: components.Easel.activeBillId ?? 0,
      artistCowId: components.Easel.artistCowId ?? 0,
      startTick: components.Easel.startTick ?? 0,
      facing: components.Easel.facing ?? 0,
      stored: (components.Easel.stored ?? []).map((s) => ({ kind: s.kind, count: s.count })),
      bills: components.Bills.list.map((b) => ({ ...b })),
      nextBillId: components.Bills.nextBillId,
    });
  }
  /** @type {SerializedStove[]} */
  const stoves = [];
  for (const { components } of world.query(['Stove', 'TileAnchor', 'Bills'])) {
    stoves.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      stuff: components.Stove.stuff ?? 'stone',
      workI: components.Stove.workI,
      workJ: components.Stove.workJ,
      decon: components.Stove.deconstructJobId > 0,
      progress: components.Stove.progress ?? 0,
      workTicksRemaining: components.Stove.workTicksRemaining ?? 0,
      activeBillId: components.Stove.activeBillId ?? 0,
      cookCowId: components.Stove.cookCowId ?? 0,
      startTick: components.Stove.startTick ?? 0,
      facing: components.Stove.facing ?? 0,
      mealQuality: components.Stove.mealQuality ?? '',
      mealIngredients: (components.Stove.mealIngredients ?? []).slice(),
      stored: (components.Stove.stored ?? []).map((s) => ({ kind: s.kind, count: s.count })),
      bills: components.Bills.list.map((b) => ({ ...b })),
      nextBillId: components.Bills.nextBillId,
    });
  }
  /** @type {SerializedBed[]} */
  const beds = [];
  for (const { components } of world.query(['Bed', 'TileAnchor'])) {
    beds.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      stuff: components.Bed.stuff ?? 'wood',
      decon: components.Bed.deconstructJobId > 0,
      progress: components.Bed.progress ?? 0,
      facing: components.Bed.facing ?? 0,
      ownerId: components.Bed.ownerId ?? 0,
      occupantId: components.Bed.occupantId ?? 0,
    });
  }
  /** @type {SerializedPainting[]} */
  const paintings = [];
  for (const { components } of world.query(['Painting', 'Item', 'TileAnchor'])) {
    const p = components.Painting;
    paintings.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      size: p.size,
      title: p.title,
      palette: p.palette.slice(),
      shapes: p.shapes.map((s) => ({ ...s })),
      quality: p.quality,
      artistCowId: p.artistCowId,
      artistName: p.artistName,
      easelI: p.easelI,
      easelJ: p.easelJ,
      startTick: p.startTick,
      finishTick: p.finishTick,
      forbidden: components.Item.forbidden === true,
    });
  }
  /** @type {SerializedWallArt[]} */
  const wallArt = [];
  for (const { components } of world.query(['WallArt', 'TileAnchor'])) {
    const a = components.WallArt;
    wallArt.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      face: a.face,
      size: a.size,
      title: a.title,
      palette: a.palette.slice(),
      shapes: a.shapes.map((s) => ({ ...s })),
      quality: a.quality,
      artistCowId: a.artistCowId,
      artistName: a.artistName,
      easelI: a.easelI,
      easelJ: a.easelJ,
      startTick: a.startTick,
      finishTick: a.finishTick,
    });
  }
  return {
    version: CURRENT_VERSION,
    tileGrid: {
      W: tileGrid.W,
      H: tileGrid.H,
      elevation: Array.from(tileGrid.elevation),
      biome: Array.from(tileGrid.biome),
      stockpile: Array.from(tileGrid.stockpile),
      wall: Array.from(tileGrid.wall),
      door: Array.from(tileGrid.door),
      torch: Array.from(tileGrid.torch),
      roof: Array.from(tileGrid.roof),
      ignoreRoof: Array.from(tileGrid.ignoreRoof),
      floor: Array.from(tileGrid.floor),
      farmZone: Array.from(tileGrid.farmZone),
      tilled: Array.from(tileGrid.tilled),
      flower: Array.from(tileGrid.flower),
    },
    cows,
    trees,
    boulders,
    items,
    buildSites,
    walls,
    doors,
    torches,
    roofs,
    floors,
    crops,
    furnaces,
    easels,
    stoves,
    beds,
    paintings,
    wallArt,
  };
}

/**
 * @param {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[], stockpile?: number[], wall?: number[], door?: number[], torch?: number[], roof?: number[], ignoreRoof?: number[], floor?: number[], farmZone?: number[], tilled?: number[], flower?: number[] } }} state
 */
export function hydrateTileGrid(state) {
  const tg = new TileGrid(state.tileGrid.W, state.tileGrid.H);
  tg.elevation.set(state.tileGrid.elevation);
  tg.biome.set(state.tileGrid.biome);
  if (state.tileGrid.stockpile) tg.stockpile.set(state.tileGrid.stockpile);
  if (state.tileGrid.wall) tg.wall.set(state.tileGrid.wall);
  if (state.tileGrid.door) tg.door.set(state.tileGrid.door);
  if (state.tileGrid.torch) tg.torch.set(state.tileGrid.torch);
  if (state.tileGrid.roof) tg.roof.set(state.tileGrid.roof);
  if (state.tileGrid.ignoreRoof) tg.ignoreRoof.set(state.tileGrid.ignoreRoof);
  if (state.tileGrid.floor) tg.floor.set(state.tileGrid.floor);
  if (state.tileGrid.farmZone) tg.farmZone.set(state.tileGrid.farmZone);
  if (state.tileGrid.tilled) tg.tilled.set(state.tileGrid.tilled);
  if (state.tileGrid.flower) tg.flower.set(state.tileGrid.flower);
  return tg;
}

/**
 * Spawn cow entities from a (migrated) save state. Existing cows in the world
 * are NOT removed — caller is responsible for clearing the world first if it
 * wants a clean replace.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ cows?: SerializedCow[] }} state
 */
export function hydrateCows(world, state) {
  const cows = state.cows ?? [];
  /** @type {number[]} */
  const spawnedIds = [];
  for (const c of cows) {
    const job = c.job ?? { kind: 'none', state: 'idle', payload: {} };
    const path = c.path ?? { steps: [], index: 0 };
    const inv = c.inventory ?? { items: [] };
    const id = c.identity;
    const newId = world.spawn({
      Cow: { drafted: c.drafted === true },
      Position: { ...c.position },
      PrevPosition: { ...c.position },
      Velocity: { x: 0, y: 0, z: 0 },
      Hunger: { value: c.hunger },
      Tiredness: { value: typeof c.tiredness === 'number' ? c.tiredness : 1 },
      FoodPoisoning: { ticksRemaining: c.foodPoisoning?.ticksRemaining ?? 0 },
      Brain: { name: c.name },
      Identity: {
        name: c.name,
        firstName: id.firstName,
        surname: id.surname,
        title: id.title,
        gender: id.gender,
        birthTick: id.birthTick,
        heightCm: id.heightCm,
        hairColor: id.hairColor,
        traits: Array.isArray(id.traits) ? [...id.traits] : [],
        childhood: id.childhood ?? '',
        profession: id.profession ?? '',
      },
      Job: { kind: job.kind, state: job.state, payload: job.payload ?? {} },
      Path: { steps: path.steps.map((s) => ({ i: s.i, j: s.j })), index: path.index },
      Inventory: { items: (inv.items ?? []).map((s) => ({ kind: s.kind, count: s.count })) },
      Opinions: { scores: {}, last: {}, chats: c.opinions?.chats ?? 0 },
      Chat: { text: '', partnerId: 0, expiresAtTick: 0 },
      Health: {
        injuries: (c.health?.injuries ?? []).map((inj) => ({ ...inj })),
        nextInjuryId: c.health?.nextInjuryId ?? 1,
        dead: c.health?.dead === true,
      },
      Skills: {
        levels: sanitizeSkillLevels(c.skills?.levels),
        learnRateMultiplier: +(c.skills?.learnRateMultiplier ?? 1) || 1,
      },
      WorkPriorities: c.workPriorities
        ? { priorities: sanitizePriorities(c.workPriorities.priorities) }
        : deriveDefaultsFromSkills(c.skills),
      CowViz: {},
    });
    spawnedIds.push(newId);
  }
  // Second pass: rewrite opinion keys from save-array indices to the fresh
  // entity ids allocated above. Skip indices that point to cows that didn't
  // spawn (shouldn't happen, but stays defensive).
  for (let i = 0; i < cows.length; i++) {
    const op = cows[i].opinions;
    if (!op) continue;
    const target = world.get(spawnedIds[i], 'Opinions');
    if (!target) continue;
    for (const key of Object.keys(op.scores ?? {})) {
      const otherId = spawnedIds[Number(key)];
      if (otherId !== undefined) target.scores[otherId] = op.scores[key];
    }
    for (const key of Object.keys(op.last ?? {})) {
      const otherId = spawnedIds[Number(key)];
      if (otherId !== undefined) target.last[otherId] = op.last[key];
    }
  }
}

/**
 * Spawn tree entities from a (migrated) save state. Blocks their tiles on the
 * grid so pathfinding agrees with the render. If a tree was chop-designated at
 * save time, re-posts a chop job via the board and links the tree to it.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ trees?: SerializedTree[] }} state
 */
export function hydrateTrees(world, grid, board, state) {
  const trees = state.trees ?? [];
  for (const t of trees) {
    if (!grid.inBounds(t.i, t.j) || grid.isBlocked(t.i, t.j)) continue;
    grid.blockTile(t.i, t.j);
    const w = tileToWorld(t.i, t.j, grid.W, grid.H);
    const id = world.spawn({
      Tree: { markedJobId: 0, progress: t.progress, kind: t.kind, growth: t.growth },
      TreeViz: {},
      Cuttable: { markedJobId: 0, progress: t.cutProgress ?? 0 },
      TileAnchor: { i: t.i, j: t.j },
      Position: { x: w.x, y: grid.getElevation(t.i, t.j), z: w.z },
    });
    if (t.marked) {
      const job = board.post('chop', { treeId: id, i: t.i, j: t.j });
      const tree = world.get(id, 'Tree');
      if (tree) tree.markedJobId = job.id;
    }
    if (t.cutMarked) {
      const job = board.post('cut', { entityId: id, i: t.i, j: t.j });
      const cut = world.get(id, 'Cuttable');
      if (cut) cut.markedJobId = job.id;
    }
  }
}

/**
 * Spawn boulder entities from a (migrated) save state. Blocks their tiles on
 * the grid; re-posts a mine job for any boulder that was marked at save time.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ boulders?: SerializedBoulder[] }} state
 */
export function hydrateBoulders(world, grid, board, state) {
  const boulders = state.boulders ?? [];
  for (const b of boulders) {
    if (!grid.inBounds(b.i, b.j) || grid.isBlocked(b.i, b.j)) continue;
    grid.blockTile(b.i, b.j);
    const w = tileToWorld(b.i, b.j, grid.W, grid.H);
    const id = world.spawn({
      Boulder: { markedJobId: 0, progress: b.progress, kind: b.kind },
      BoulderViz: {},
      TileAnchor: { i: b.i, j: b.j },
      Position: { x: w.x, y: grid.getElevation(b.i, b.j), z: w.z },
    });
    if (b.marked) {
      const job = board.post('mine', { boulderId: id, i: b.i, j: b.j });
      const boulder = world.get(id, 'Boulder');
      if (boulder) boulder.markedJobId = job.id;
    }
  }
}

/**
 * Spawn item entities from a (migrated) save state.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {{ items?: SerializedItem[] }} state
 */
export function hydrateItems(world, grid, state) {
  const items = state.items ?? [];
  for (const it of items) {
    if (!grid.inBounds(it.i, it.j)) continue;
    if (it.count <= 0) continue;
    const w = tileToWorld(it.i, it.j, grid.W, grid.H);
    world.spawn({
      Item: {
        kind: it.kind,
        count: it.count,
        capacity: it.capacity,
        forbidden: it.forbidden === true,
        quality: it.quality ?? '',
        ingredients: Array.isArray(it.ingredients) ? [...it.ingredients] : [],
      },
      ItemViz: {},
      TileAnchor: { i: it.i, j: it.j },
      Position: { x: w.x, y: grid.getElevation(it.i, it.j), z: w.z },
    });
  }
}

/**
 * Spawn BuildSite entities from a (migrated) save state. Tiles holding a
 * BuildSite do NOT get their wall bit set — the blueprint stays walkable so
 * haulers can deliver. Any outstanding board jobs for these sites (haul /
 * build) are re-posted by the regular rare-tier poster next tick, so we don't
 * snapshot job state here.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {{ buildSites?: SerializedBuildSite[] }} state
 */
export function hydrateBuildSites(world, grid, state) {
  const sites = state.buildSites ?? [];
  for (const s of sites) {
    if (!grid.inBounds(s.i, s.j)) continue;
    const w = tileToWorld(s.i, s.j, grid.W, grid.H);
    world.spawn({
      BuildSite: {
        kind: s.kind,
        stuff: s.stuff ?? 'wood',
        requiredKind: s.requiredKind,
        required: s.required,
        delivered: s.delivered,
        buildJobId: 0,
        progress: s.progress ?? 0,
        facing: s.facing ?? 0,
      },
      BuildSiteViz: {},
      TileAnchor: { i: s.i, j: s.j },
      Position: { x: w.x, y: grid.getElevation(s.i, s.j), z: w.z },
    });
  }
}

/**
 * Spawn structure (Wall/Door/Torch) entities from a (migrated) save state. The
 * grid's wall/door/torch bitmaps are authoritative for pathing (set directly
 * from the tileGrid section in hydrateTileGrid); these entities just own the
 * instance slot for rendering + round-tripping. If a structure was marked for
 * deconstruction at save time, re-post the 'deconstruct' job through `board`
 * so cows resume the demolition.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {Array<{i: number, j: number, stuff?: string, decon?: boolean, progress?: number, wallMounted?: boolean, yaw?: number}>} items
 * @param {'wall'|'door'|'torch'|'roof'|'floor'} kind
 */
const STRUCT_COMP_BY_KIND = /** @type {const} */ ({
  wall: 'Wall',
  door: 'Door',
  torch: 'Torch',
  roof: 'Roof',
  floor: 'Floor',
});

function hydrateStructures(world, grid, board, items, kind) {
  const compName = STRUCT_COMP_BY_KIND[kind];
  const vizName = `${compName}Viz`;
  for (const s of items) {
    if (!grid.inBounds(s.i, s.j)) continue;
    const w = tileToWorld(s.i, s.j, grid.W, grid.H);
    /** @type {Record<string, any>} */
    const tag = { deconstructJobId: 0, progress: s.progress ?? 0 };
    if (kind !== 'torch') {
      tag.stuff = s.stuff ?? 'wood';
    }
    if (kind === 'torch') {
      tag.wallMounted = s.wallMounted === true;
      tag.yaw = s.yaw ?? 0;
    }
    const id = world.spawn({
      [compName]: tag,
      [vizName]: {},
      TileAnchor: { i: s.i, j: s.j },
      Position: { x: w.x, y: grid.getElevation(s.i, s.j), z: w.z },
    });
    if (s.decon) {
      const job = board.post('deconstruct', { entityId: id, kind, i: s.i, j: s.j });
      const rec = world.get(id, compName);
      if (rec) rec.deconstructJobId = job.id;
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ walls?: SerializedWall[] }} state
 */
export function hydrateWalls(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.walls ?? [], 'wall');
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ doors?: SerializedDoor[] }} state
 */
export function hydrateDoors(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.doors ?? [], 'door');
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ torches?: SerializedTorch[] }} state
 */
export function hydrateTorches(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.torches ?? [], 'torch');
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ roofs?: SerializedRoof[] }} state
 */
export function hydrateRoofs(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.roofs ?? [], 'roof');
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ floors?: SerializedFloor[] }} state
 */
export function hydrateFloors(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.floors ?? [], 'floor');
}

/**
 * Spawn Crop entities from a (migrated) save state. Outstanding plant/harvest
 * board jobs re-post next tick via the farm poster.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {{ crops?: SerializedCrop[] }} state
 */
export function hydrateCrops(world, grid, board, state) {
  const crops = state.crops ?? [];
  for (const c of crops) {
    if (!grid.inBounds(c.i, c.j)) continue;
    const w = tileToWorld(c.i, c.j, grid.W, grid.H);
    const id = world.spawn({
      Crop: { kind: c.kind, growthTicks: c.growthTicks ?? 0 },
      CropViz: {},
      Cuttable: { markedJobId: 0, progress: c.cutProgress ?? 0 },
      TileAnchor: { i: c.i, j: c.j },
      Position: { x: w.x, y: grid.getElevation(c.i, c.j), z: w.z },
    });
    if (c.cutMarked) {
      const job = board.post('cut', { entityId: id, i: c.i, j: c.j });
      const cut = world.get(id, 'Cuttable');
      if (cut) cut.markedJobId = job.id;
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ furnaces?: SerializedFurnace[] }} state
 */
export function hydrateFurnaces(world, grid, board, state) {
  const furnaces = state.furnaces ?? [];
  for (const f of furnaces) {
    if (!grid.inBounds(f.i, f.j) || grid.isBlocked(f.i, f.j)) continue;
    grid.blockTile(f.i, f.j);
    const w = tileToWorld(f.i, f.j, grid.W, grid.H);
    const id = world.spawn({
      Furnace: {
        deconstructJobId: 0,
        progress: f.progress ?? 0,
        stuff: f.stuff ?? 'stone',
        workI: f.workI,
        workJ: f.workJ,
        workTicksRemaining: f.workTicksRemaining ?? 0,
        activeBillId: f.activeBillId ?? 0,
        facing: f.facing ?? 0,
        stored: (f.stored ?? []).map((s) => ({ kind: s.kind, count: s.count })),
        outputs: (f.outputs ?? []).map((s) => ({ kind: s.kind, count: s.count })),
      },
      FurnaceViz: {},
      Bills: {
        list: (f.bills ?? []).map((b) => ({ ...b })),
        nextBillId: f.nextBillId ?? 1,
      },
      TileAnchor: { i: f.i, j: f.j },
      Position: { x: w.x, y: grid.getElevation(f.i, f.j), z: w.z },
    });
    if (f.decon) {
      const job = board.post('deconstruct', { entityId: id, kind: 'furnace', i: f.i, j: f.j });
      const rec = world.get(id, 'Furnace');
      if (rec) rec.deconstructJobId = job.id;
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ easels?: SerializedEasel[] }} state
 */
export function hydrateEasels(world, grid, board, state) {
  const easels = state.easels ?? [];
  for (const e of easels) {
    if (!grid.inBounds(e.i, e.j) || grid.isBlocked(e.i, e.j)) continue;
    grid.blockTile(e.i, e.j);
    const w = tileToWorld(e.i, e.j, grid.W, grid.H);
    const id = world.spawn({
      Easel: {
        deconstructJobId: 0,
        progress: e.progress ?? 0,
        stuff: e.stuff ?? 'wood',
        workI: e.workI,
        workJ: e.workJ,
        workTicksRemaining: e.workTicksRemaining ?? 0,
        activeBillId: e.activeBillId ?? 0,
        artistCowId: e.artistCowId ?? 0,
        startTick: e.startTick ?? 0,
        facing: e.facing ?? 0,
        stored: (e.stored ?? []).map((s) => ({ kind: s.kind, count: s.count })),
      },
      EaselViz: {},
      Bills: {
        list: (e.bills ?? []).map((b) => ({ ...b })),
        nextBillId: e.nextBillId ?? 1,
      },
      TileAnchor: { i: e.i, j: e.j },
      Position: { x: w.x, y: grid.getElevation(e.i, e.j), z: w.z },
    });
    if (e.decon) {
      const job = board.post('deconstruct', { entityId: id, kind: 'easel', i: e.i, j: e.j });
      const rec = world.get(id, 'Easel');
      if (rec) rec.deconstructJobId = job.id;
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ stoves?: SerializedStove[] }} state
 */
export function hydrateStoves(world, grid, board, state) {
  const stoves = state.stoves ?? [];
  for (const s of stoves) {
    if (!grid.inBounds(s.i, s.j)) continue;
    const facing = s.facing ?? 0;
    const footprint = stoveFootprintTiles({ i: s.i, j: s.j }, facing);
    if (footprint.some((t) => !grid.inBounds(t.i, t.j) || grid.isBlocked(t.i, t.j))) continue;
    for (const t of footprint) grid.blockTile(t.i, t.j);
    const w = tileToWorld(s.i, s.j, grid.W, grid.H);
    const id = world.spawn({
      Stove: {
        deconstructJobId: 0,
        progress: s.progress ?? 0,
        stuff: s.stuff ?? 'stone',
        workI: s.workI,
        workJ: s.workJ,
        workTicksRemaining: s.workTicksRemaining ?? 0,
        activeBillId: s.activeBillId ?? 0,
        cookCowId: s.cookCowId ?? 0,
        startTick: s.startTick ?? 0,
        facing,
        mealQuality: s.mealQuality ?? '',
        mealIngredients: (s.mealIngredients ?? []).slice(),
        stored: (s.stored ?? []).map((st) => ({ kind: st.kind, count: st.count })),
      },
      StoveViz: {},
      Bills: {
        list: (s.bills ?? []).map((b) => ({ ...b })),
        nextBillId: s.nextBillId ?? 1,
      },
      TileAnchor: { i: s.i, j: s.j },
      Position: { x: w.x, y: grid.getElevation(s.i, s.j), z: w.z },
    });
    if (s.decon) {
      const job = board.post('deconstruct', { entityId: id, kind: 'stove', i: s.i, j: s.j });
      const rec = world.get(id, 'Stove');
      if (rec) rec.deconstructJobId = job.id;
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ beds?: SerializedBed[] }} state
 */
export function hydrateBeds(world, grid, board, state) {
  const beds = state.beds ?? [];
  for (const b of beds) {
    if (!grid.inBounds(b.i, b.j)) continue;
    const facing = b.facing ?? 0;
    const footprint = bedFootprintTiles({ i: b.i, j: b.j }, facing);
    if (footprint.some((t) => !grid.inBounds(t.i, t.j))) continue;
    const w = tileToWorld(b.i, b.j, grid.W, grid.H);
    const id = world.spawn({
      Bed: {
        deconstructJobId: 0,
        progress: b.progress ?? 0,
        stuff: b.stuff ?? 'wood',
        facing,
        ownerId: b.ownerId ?? 0,
        occupantId: b.occupantId ?? 0,
      },
      BedViz: {},
      TileAnchor: { i: b.i, j: b.j },
      Position: { x: w.x, y: grid.getElevation(b.i, b.j), z: w.z },
    });
    if (b.decon) {
      const job = board.post('deconstruct', { entityId: id, kind: 'bed', i: b.i, j: b.j });
      const rec = world.get(id, 'Bed');
      if (rec) rec.deconstructJobId = job.id;
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {{ paintings?: SerializedPainting[] }} state
 */
export function hydratePaintings(world, grid, state) {
  const paintings = state.paintings ?? [];
  for (const p of paintings) {
    if (!grid.inBounds(p.i, p.j)) continue;
    const w = tileToWorld(p.i, p.j, grid.W, grid.H);
    world.spawn({
      Item: { kind: 'painting', count: 1, capacity: 1, forbidden: p.forbidden === true },
      Painting: {
        size: p.size,
        title: p.title,
        palette: (p.palette ?? []).slice(),
        shapes: (p.shapes ?? []).map((s) => ({ ...s })),
        quality: p.quality ?? 'normal',
        artistCowId: p.artistCowId ?? 0,
        artistName: p.artistName ?? '',
        easelI: p.easelI ?? p.i,
        easelJ: p.easelJ ?? p.j,
        startTick: p.startTick ?? 0,
        finishTick: p.finishTick ?? 0,
      },
      PaintingViz: {},
      TileAnchor: { i: p.i, j: p.j },
      Position: { x: w.x, y: grid.getElevation(p.i, p.j), z: w.z },
    });
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {{ wallArt?: SerializedWallArt[] }} state
 */
export function hydrateWallArt(world, grid, state) {
  const list = state.wallArt ?? [];
  for (const a of list) {
    if (!grid.inBounds(a.i, a.j)) continue;
    const w = tileToWorld(a.i, a.j, grid.W, grid.H);
    world.spawn({
      WallArt: {
        face: a.face | 0,
        size: Math.max(1, a.size | 0),
        title: a.title ?? '',
        palette: (a.palette ?? []).slice(),
        shapes: (a.shapes ?? []).map((s) => ({ ...s })),
        quality: a.quality ?? 'normal',
        artistCowId: a.artistCowId ?? 0,
        artistName: a.artistName ?? '',
        easelI: a.easelI ?? a.i,
        easelJ: a.easelJ ?? a.j,
        startTick: a.startTick ?? 0,
        finishTick: a.finishTick ?? 0,
        uninstallJobId: 0,
        progress: 0,
      },
      WallArtViz: {},
      TileAnchor: { i: a.i, j: a.j },
      Position: { x: w.x, y: grid.getElevation(a.i, a.j), z: w.z },
    });
  }
}

/**
 * Migrate a parsed save state up to CURRENT_VERSION and return it as the
 * current schema shape.
 * @param {{ version: number, [k: string]: any }} parsed
 * @returns {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[], stockpile: number[], wall: number[], door: number[], torch: number[], roof: number[], ignoreRoof: number[], floor: number[], farmZone: number[], tilled: number[] }, cows: SerializedCow[], trees: SerializedTree[], boulders: SerializedBoulder[], items: SerializedItem[], buildSites: SerializedBuildSite[], walls: SerializedWall[], doors: SerializedDoor[], torches: SerializedTorch[], roofs: SerializedRoof[], floors: SerializedFloor[], crops: SerializedCrop[], furnaces: SerializedFurnace[], easels: SerializedEasel[], stoves: SerializedStove[], beds: SerializedBed[], paintings: SerializedPainting[], wallArt: SerializedWallArt[] }}
 */
export function loadState(parsed) {
  return /** @type {any} */ (runMigrations(parsed));
}

/**
 * Gzip a string using the browser's CompressionStream API.
 * @param {string} json
 * @returns {Promise<Uint8Array>}
 */
export async function gzipString(json) {
  const encoder = new TextEncoder();
  const stream = new Blob([/** @type {BlobPart} */ (encoder.encode(json))]).stream();
  const gz = stream.pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(gz).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Gunzip bytes back to a string.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function gunzipBytes(bytes) {
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream();
  const ds = stream.pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(ds).arrayBuffer();
  return new TextDecoder().decode(buf);
}
