/**
 * Declarative registry of clickable world objects. The generic ObjectSelector
 * and ObjectPanel look up an entity's type here to decide what label, what
 * description, and what context orders to offer.
 *
 * Adding a new clickable type = append one entry to OBJECT_TYPES. No changes
 * to the selector or the panel. Existing order handlers are reused when a new
 * type shares a behaviour (e.g. any future "plantable" could piggy-back on
 * `chop`-like wiring).
 *
 * Out of scope here: cows, item stacks, furnaces/easels, wall-art. Those have
 * dedicated selectors + panels with specialized UX; forcing them through this
 * generic path would eat their richer controls. They'll migrate in later if we
 * want one panel to rule them all.
 */

import { buildTicksForKind } from '../jobs/build.js';
import { releaseBuildSite } from '../render/buildDesignator.js';
import { TREE_MAX_WOOD, TREE_MIN_YIELD_GROWTH, woodYieldFor } from '../world/trees.js';

/**
 * @typedef {Object} ObjectOrderCtx
 * @property {import('../ecs/world.js').World} world
 * @property {import('../jobs/board.js').JobBoard} board
 * @property {import('../world/tileGrid.js').TileGrid} [tileGrid]
 *   needed by orders that despawn tile-anchored entities (blueprint cancel)
 * @property {{ play: (kind: string) => void }} [audio]
 */

/**
 * @typedef {Object} ObjectInfoCtx
 * @property {import('../jobs/board.js').JobBoard} [board]
 *   lets subtitle/description callbacks reach into the job board for live
 *   info (e.g. "Bessie is on the way").
 */

/**
 * @typedef {Object} ObjectOrder
 * @property {string} id                   unique within its type
 * @property {string} label                button text
 * @property {(world: import('../ecs/world.js').World, id: number) => boolean} enabled
 *   gate the button on per-entity state (e.g. "only show Chop when not marked")
 * @property {(ctx: ObjectOrderCtx, ids: number[]) => number}  apply
 *   perform the order on every id; return count actually applied so the panel
 *   can play an audio cue only when at least one was accepted
 */

/**
 * @typedef {Object} ObjectType
 * @property {string} type                  stable id
 * @property {string} component             primary ECS component to query
 * @property {(world: import('../ecs/world.js').World, id: number) => string} label
 *   display label for a single selected entity
 * @property {(world: import('../ecs/world.js').World, id: number, info?: ObjectInfoCtx) => string} [subtitle]
 *   short sub-line under the title (e.g. "mature · 100% grown")
 * @property {(world: import('../ecs/world.js').World, id: number, info?: ObjectInfoCtx) => string} description
 * @property {(world: import('../ecs/world.js').World, id: number) => string | null} [kindOf]
 *   double-click "select-similar" bucket. Return a sub-key (e.g. 'oak',
 *   'stone') and only entities with the same key are picked up. Omit to
 *   treat all entities of this type as one bucket.
 * @property {ObjectOrder[]} orders
 */

/**
 * Generic "cancel the pending job on this entity" factory for anything that
 * stores a job id on a tag component.
 *
 * @param {string} component
 * @param {string} jobField
 */
function cancelOrder(component, jobField) {
  return {
    /** @param {import('../ecs/world.js').World} world @param {number} id */
    enabled(world, id) {
      const tag = world.get(id, component);
      return !!tag && tag[jobField] > 0;
    },
    /** @param {ObjectOrderCtx} ctx @param {number[]} ids */
    apply(ctx, ids) {
      let n = 0;
      for (const id of ids) {
        const tag = ctx.world.get(id, component);
        if (!tag) continue;
        if (tag[jobField] > 0) {
          const job = ctx.board.get(tag[jobField]);
          // Matches the chop/mine/cut designators: complete the board job
          // unconditionally. The cow's run*Job checks boardJob.completed at
          // the top of each tick and cleanly drops the work mid-walk / mid-
          // swing, so there's no risk of stranding a claimed cow.
          if (job && !job.completed) {
            ctx.board.complete(job.id);
            tag[jobField] = 0;
            if ('progress' in tag) tag.progress = 0;
            n++;
          }
        }
      }
      return n;
    },
  };
}

/**
 * @param {string} kind
 * @param {string} component
 */
function deconstructOrder(kind, component) {
  return {
    id: 'deconstruct',
    label: 'Deconstruct',
    /** @param {import('../ecs/world.js').World} world @param {number} id */
    enabled(world, id) {
      const tag = world.get(id, component);
      return !!tag && tag.deconstructJobId === 0;
    },
    /** @param {ObjectOrderCtx} ctx @param {number[]} ids */
    apply(ctx, ids) {
      let n = 0;
      for (const id of ids) {
        const tag = ctx.world.get(id, component);
        const anchor = ctx.world.get(id, 'TileAnchor');
        if (!tag || !anchor) continue;
        if (tag.deconstructJobId > 0) continue;
        const job = ctx.board.post('deconstruct', {
          entityId: id,
          kind,
          i: anchor.i,
          j: anchor.j,
        });
        tag.deconstructJobId = job.id;
        tag.progress = 0;
        n++;
      }
      return n;
    },
  };
}

/** @param {string} component */
function cancelDeconstructOrder(component) {
  return {
    id: 'cancel-deconstruct',
    label: 'Cancel deconstruct',
    ...cancelOrder(component, 'deconstructJobId'),
  };
}

/** @type {ObjectType[]} */
export const OBJECT_TYPES = [
  {
    type: 'tree',
    component: 'Tree',
    kindOf(world, id) {
      return world.get(id, 'Tree')?.kind ?? null;
    },
    label(world, id) {
      const tree = world.get(id, 'Tree');
      const kind = tree?.kind ?? 'tree';
      return `${kind[0].toUpperCase()}${kind.slice(1)} tree`;
    },
    subtitle(world, id) {
      const tree = world.get(id, 'Tree');
      if (!tree) return '';
      const pct = Math.round(tree.growth * 100);
      const stage = tree.growth < TREE_MIN_YIELD_GROWTH ? 'sapling' : 'mature';
      return `${stage} · ${pct}% grown`;
    },
    description(world, id) {
      const tree = world.get(id, 'Tree');
      if (!tree) return 'A tree.';
      const yieldNow = woodYieldFor(tree.kind, tree.growth);
      const yieldMax = TREE_MAX_WOOD[tree.kind] ?? 0;
      if (yieldNow === 0) {
        return 'Too young to chop — immature saplings yield no wood. Use Cut to clear it anyway.';
      }
      return `Chopping yields ~${yieldNow} wood (up to ${yieldMax} when fully mature).`;
    },
    orders: [
      {
        id: 'chop',
        label: 'Chop',
        enabled(world, id) {
          const tree = world.get(id, 'Tree');
          if (!tree) return false;
          if (tree.markedJobId > 0) return false;
          return tree.growth >= TREE_MIN_YIELD_GROWTH;
        },
        apply(ctx, ids) {
          let n = 0;
          for (const id of ids) {
            const tree = ctx.world.get(id, 'Tree');
            const anchor = ctx.world.get(id, 'TileAnchor');
            if (!tree || !anchor) continue;
            if (tree.markedJobId > 0) continue;
            if (tree.growth < TREE_MIN_YIELD_GROWTH) continue;
            const job = ctx.board.post('chop', { treeId: id, i: anchor.i, j: anchor.j });
            tree.markedJobId = job.id;
            tree.progress = 0;
            n++;
          }
          return n;
        },
      },
      {
        id: 'cancel-chop',
        label: 'Cancel chop',
        ...cancelOrder('Tree', 'markedJobId'),
      },
    ],
  },
  {
    type: 'boulder',
    component: 'Boulder',
    kindOf(world, id) {
      return world.get(id, 'Boulder')?.kind ?? null;
    },
    label(world, id) {
      const b = world.get(id, 'Boulder');
      const kind = b?.kind ?? 'stone';
      return `${kind[0].toUpperCase()}${kind.slice(1)} boulder`;
    },
    subtitle() {
      return 'mineable · yields stone';
    },
    description() {
      return 'A boulder of raw stone. Mine it to harvest stone blocks for walls, floors, and production stations.';
    },
    orders: [
      {
        id: 'mine',
        label: 'Mine',
        enabled(world, id) {
          const b = world.get(id, 'Boulder');
          return !!b && b.markedJobId === 0;
        },
        apply(ctx, ids) {
          let n = 0;
          for (const id of ids) {
            const b = ctx.world.get(id, 'Boulder');
            const anchor = ctx.world.get(id, 'TileAnchor');
            if (!b || !anchor) continue;
            if (b.markedJobId > 0) continue;
            const job = ctx.board.post('mine', { boulderId: id, i: anchor.i, j: anchor.j });
            b.markedJobId = job.id;
            b.progress = 0;
            n++;
          }
          return n;
        },
      },
      {
        id: 'cancel-mine',
        label: 'Cancel mine',
        ...cancelOrder('Boulder', 'markedJobId'),
      },
    ],
  },
  {
    type: 'wall',
    component: 'Wall',
    label(world, id) {
      const w = world.get(id, 'Wall');
      return w?.stuff === 'stone' ? 'Stone wall' : 'Wooden wall';
    },
    subtitle() {
      return 'built · blocks pathing';
    },
    description() {
      return 'Load-bearing wall. Forms rooms when closed; supports adjacent roofs. Deconstructing returns ~half its material.';
    },
    orders: [deconstructOrder('wall', 'Wall'), cancelDeconstructOrder('Wall')],
  },
  {
    type: 'door',
    component: 'Door',
    label(world, id) {
      const d = world.get(id, 'Door');
      return d?.stuff === 'stone' ? 'Stone door' : 'Wooden door';
    },
    subtitle() {
      return 'built · walkable';
    },
    description() {
      return 'A door. Seals a room while letting colonists pass.';
    },
    orders: [deconstructOrder('door', 'Door'), cancelDeconstructOrder('Door')],
  },
  {
    type: 'torch',
    component: 'Torch',
    label(world, id) {
      const t = world.get(id, 'Torch');
      return t?.wallMounted ? 'Wall torch' : 'Floor torch';
    },
    subtitle() {
      return 'built · lights the room';
    },
    description() {
      return 'A torch. Casts a radius of light at night so cows keep working past sundown.';
    },
    orders: [deconstructOrder('torch', 'Torch'), cancelDeconstructOrder('Torch')],
  },
  {
    type: 'roof',
    component: 'Roof',
    label(world, id) {
      const r = world.get(id, 'Roof');
      return r?.stuff === 'stone' ? 'Stone roof' : 'Wooden roof';
    },
    subtitle() {
      return 'built · blocks sunlight';
    },
    description() {
      return 'A roof tile. Seals the tile below from sun and rain — required for enclosed rooms.';
    },
    orders: [deconstructOrder('roof', 'Roof'), cancelDeconstructOrder('Roof')],
  },
  {
    type: 'floor',
    component: 'Floor',
    label(world, id) {
      const f = world.get(id, 'Floor');
      return f?.stuff === 'stone' ? 'Stone floor' : 'Wooden floor';
    },
    subtitle() {
      return 'built · speeds movement';
    },
    description() {
      return 'A constructed floor tile. Faster to walk across than raw terrain.';
    },
    orders: [deconstructOrder('floor', 'Floor'), cancelDeconstructOrder('Floor')],
  },
  {
    type: 'buildsite',
    component: 'BuildSite',
    kindOf(world, id) {
      return world.get(id, 'BuildSite')?.kind ?? null;
    },
    label(world, id) {
      const site = world.get(id, 'BuildSite');
      if (!site) return 'Blueprint';
      // Kinds whose finished instancer ignores `stuff` (torches are metal,
      // furnaces are brick) — don't prefix them with "Wooden"/"Stone".
      const stuffless =
        site.kind === 'torch' || site.kind === 'wallTorch' || site.kind === 'furnace';
      const stuff = stuffless ? '' : site.stuff === 'stone' ? 'Stone ' : 'Wooden ';
      const label = `${stuff}${site.kind} blueprint`;
      return label[0].toUpperCase() + label.slice(1);
    },
    subtitle(world, id) {
      const site = world.get(id, 'BuildSite');
      if (!site) return '';
      if (site.forbidden) return 'forbidden · construction paused';
      return `${site.delivered}/${site.required} ${site.requiredKind} delivered`;
    },
    description(world, id, info) {
      const site = world.get(id, 'BuildSite');
      if (!site) return '';
      const lines = [];
      if (site.buildJobId > 0 && info?.board) {
        const job = info.board.get(site.buildJobId);
        const cowId = job?.claimedBy ?? null;
        if (cowId !== null) {
          const name = world.get(cowId, 'Brain')?.name;
          lines.push(name ? `${name} is on the way.` : 'A cow is on the way.');
        }
        if (site.progress > 0) {
          const total = buildTicksForKind(site.kind);
          const remaining = Math.max(0, Math.round((1 - site.progress) * total));
          lines.push(`~${remaining} work ticks remaining.`);
        }
      } else if (site.delivered < site.required) {
        lines.push('Waiting for haulers to bring materials.');
      } else {
        lines.push('Waiting for a builder.');
      }
      return lines.join(' ');
    },
    orders: [
      {
        id: 'cancel-blueprint',
        label: 'Cancel blueprint',
        enabled() {
          return true;
        },
        apply(ctx, ids) {
          if (!ctx.tileGrid) return 0;
          let n = 0;
          for (const id of ids) {
            const site = ctx.world.get(id, 'BuildSite');
            const anchor = ctx.world.get(id, 'TileAnchor');
            if (!site || !anchor) continue;
            releaseBuildSite(ctx.world, ctx.board, ctx.tileGrid, site, anchor.i, anchor.j);
            ctx.world.despawn(id);
            n++;
          }
          return n;
        },
      },
      {
        id: 'forbid',
        label: 'Forbid',
        enabled(world, id) {
          return world.get(id, 'BuildSite')?.forbidden === false;
        },
        apply(ctx, ids) {
          let n = 0;
          for (const id of ids) {
            const site = ctx.world.get(id, 'BuildSite');
            if (!site || site.forbidden) continue;
            site.forbidden = true;
            // Cancel the outstanding build job so the claimed cow drops it on
            // her next tick. The haul poster also skips posting a new one
            // while forbidden stays true.
            if (site.buildJobId > 0) {
              const job = ctx.board.get(site.buildJobId);
              if (job && !job.completed) ctx.board.complete(job.id);
              site.buildJobId = 0;
            }
            n++;
          }
          return n;
        },
      },
      {
        id: 'unforbid',
        label: 'Unforbid',
        enabled(world, id) {
          return world.get(id, 'BuildSite')?.forbidden === true;
        },
        apply(ctx, ids) {
          let n = 0;
          for (const id of ids) {
            const site = ctx.world.get(id, 'BuildSite');
            if (!site || !site.forbidden) continue;
            site.forbidden = false;
            n++;
          }
          return n;
        },
      },
    ],
  },
];

/** @type {Map<string, ObjectType>} */
const BY_TYPE = new Map(OBJECT_TYPES.map((t) => [t.type, t]));
/** @type {Map<string, ObjectType>} */
const BY_COMPONENT = new Map(OBJECT_TYPES.map((t) => [t.component, t]));

/** @param {string} type */
export function objectTypeById(type) {
  return BY_TYPE.get(type) ?? null;
}

/**
 * Resolve an entity's registered type by checking which of the tracked
 * components it carries. Returns `null` for entities outside the registry
 * (cows, items, furnaces, ...) — those have their own UI.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} id
 */
export function objectTypeFor(world, id) {
  for (const [comp, entry] of BY_COMPONENT) {
    if (world.get(id, comp)) return entry;
  }
  return null;
}
