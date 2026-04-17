import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { JobBoard } from '../../src/jobs/board.js';
import {
  findHaulableItemAtTile,
  findPrioritizableJobsAtTile,
  postAndPrioritizeHaul,
  prioritizeJob,
  stockpileSlotAvailable,
} from '../../src/jobs/prioritize.js';
import { TileGrid } from '../../src/world/tileGrid.js';

function makeWorld() {
  const w = new World();
  registerComponents(w);
  return w;
}

function spawnCow(world) {
  return world.spawn({
    Cow: { drafted: false, name: 'test' },
    Position: { x: 0, y: 0, z: 0 },
    Job: { kind: 'none', state: 'idle', payload: {} },
    Path: { steps: [], index: 0 },
    Brain: { jobDirty: false, vitalsDirty: false, lastBoardVersion: 0 },
    Inventory: { items: [] },
    Hunger: { value: 1 },
    Velocity: { x: 0, y: 0, z: 0 },
  });
}

describe('findPrioritizableJobsAtTile', () => {
  it('returns jobs whose payload targets (i, j)', () => {
    const b = new JobBoard();
    const chop = b.post('chop', { treeId: 1, i: 5, j: 5 });
    b.post('chop', { treeId: 2, i: 9, j: 9 }); // different tile
    const results = findPrioritizableJobsAtTile(b, 5, 5);
    expect(results).toEqual([chop]);
  });

  it('matches haul-family on source tile (fromI, fromJ)', () => {
    const b = new JobBoard();
    const haul = b.post('haul', { fromI: 2, fromJ: 3, toI: 9, toJ: 9, itemId: 42 });
    expect(findPrioritizableJobsAtTile(b, 2, 3)).toEqual([haul]);
    expect(findPrioritizableJobsAtTile(b, 9, 9)).toEqual([]);
  });

  it('skips completed jobs', () => {
    const b = new JobBoard();
    const j = b.post('chop', { treeId: 1, i: 5, j: 5 });
    b.complete(j.id);
    expect(findPrioritizableJobsAtTile(b, 5, 5)).toEqual([]);
  });

  it('skips non-prioritizable kinds (wander, move, eat)', () => {
    const b = new JobBoard();
    b.post('eat', { i: 5, j: 5 });
    b.post('move', { i: 5, j: 5 });
    expect(findPrioritizableJobsAtTile(b, 5, 5)).toEqual([]);
  });

  it('skips post-pickup haul jobs (payload.count === 0)', () => {
    const b = new JobBoard();
    // Post-pickup: cow is already carrying the cargo. Prioritizing this would
    // force her to drop mid-trip, so the menu must not offer it.
    b.post('haul', { fromI: 2, fromJ: 3, toI: 9, toJ: 9, itemId: 42, count: 0 });
    expect(findPrioritizableJobsAtTile(b, 2, 3)).toEqual([]);
  });
});

function spawnItem(world, i, j, kind, count) {
  return world.spawn({
    Item: { kind, count, capacity: 50, forbidden: false },
    ItemViz: {},
    TileAnchor: { i, j },
    Position: { x: 0, y: 0, z: 0 },
  });
}

describe('findHaulableItemAtTile', () => {
  it('returns loose unforbidden stacks', () => {
    const w = makeWorld();
    const grid = new TileGrid(4, 4);
    spawnItem(w, 1, 1, 'wood', 5);
    const r = findHaulableItemAtTile(w, grid, 1, 1);
    expect(r?.kind).toBe('wood');
    expect(r?.count).toBe(5);
  });

  it('ignores stockpile stacks (already in place)', () => {
    const w = makeWorld();
    const grid = new TileGrid(4, 4);
    grid.setStockpile(1, 1, 1);
    spawnItem(w, 1, 1, 'wood', 5);
    expect(findHaulableItemAtTile(w, grid, 1, 1)).toBeNull();
  });
});

describe('postAndPrioritizeHaul', () => {
  it('posts a bundled haul and assigns it to the cow', () => {
    const w = makeWorld();
    const grid = new TileGrid(4, 4);
    grid.setStockpile(3, 3, 1);
    const cow = spawnCow(w);
    spawnItem(w, 1, 1, 'wood', 8);
    const b = new JobBoard();

    const job = postAndPrioritizeHaul(w, grid, b, cow, 1, 1);
    expect(job).not.toBeNull();
    expect(job?.kind).toBe('haul');
    expect(job?.payload.count).toBe(8);
    expect(job?.claimedBy).toBe(cow);
    expect(w.get(cow, 'Job').kind).toBe('haul');
  });

  it('returns null when no stockpile slot is available', () => {
    const w = makeWorld();
    const grid = new TileGrid(4, 4); // no stockpile
    const cow = spawnCow(w);
    spawnItem(w, 1, 1, 'wood', 8);
    const b = new JobBoard();

    expect(postAndPrioritizeHaul(w, grid, b, cow, 1, 1)).toBeNull();
    expect(b.jobs).toHaveLength(0);
  });

  it('targets the remainder, not cow A in-flight, after source claim release', () => {
    // Regression: cow A carries 12/50 with payload.count=0 on the board.
    // Cow B right-clicks the 38-unit remainder. The menu must post a FRESH
    // job for B — not steal A's in-flight haul and make her drop her cargo.
    const w = makeWorld();
    const grid = new TileGrid(8, 8);
    grid.setStockpile(7, 7, 1);
    const cowA = spawnCow(w);
    const cowB = spawnCow(w);
    const item = spawnItem(w, 1, 1, 'wood', 38); // post-pickup remainder
    const b = new JobBoard();

    // Simulate cow A mid-trip: source claim released (count=0), carrying 12.
    const aJob = b.post('haul', {
      itemId: item,
      kind: 'wood',
      count: 0,
      fromI: 1,
      fromJ: 1,
      toI: 7,
      toJ: 7,
    });
    b.claim(aJob.id, cowA);
    const aCowJob = w.get(cowA, 'Job');
    aCowJob.kind = 'haul';
    aCowJob.state = 'walking-to-drop';
    aCowJob.payload = { jobId: aJob.id, itemId: item, count: 0, toI: 7, toJ: 7 };
    w.get(cowA, 'Inventory').items = [{ kind: 'wood', count: 12 }];

    const posted = postAndPrioritizeHaul(w, grid, b, cowB, 1, 1);
    expect(posted).not.toBeNull();
    expect(posted?.id).not.toBe(aJob.id);
    expect(posted?.claimedBy).toBe(cowB);

    // Cow A untouched — still hauling, still carrying.
    expect(aJob.claimedBy).toBe(cowA);
    expect(w.get(cowA, 'Job').kind).toBe('haul');
    expect(w.get(cowA, 'Inventory').items).toEqual([{ kind: 'wood', count: 12 }]);
  });
});

describe('stockpileSlotAvailable', () => {
  it('true when a matching/empty slot exists', () => {
    const w = makeWorld();
    const grid = new TileGrid(4, 4);
    grid.setStockpile(3, 3, 1);
    const b = new JobBoard();
    expect(stockpileSlotAvailable(w, grid, b, 'wood', 1, 1)).toBe(true);
  });

  it('false when all slots are full', () => {
    const w = makeWorld();
    const grid = new TileGrid(4, 4);
    grid.setStockpile(3, 3, 1);
    spawnItem(w, 3, 3, 'wood', 50); // wood maxStack = 50
    const b = new JobBoard();
    expect(stockpileSlotAvailable(w, grid, b, 'wood', 1, 1)).toBe(false);
  });
});

describe('prioritizeJob', () => {
  it('assigns an unclaimed job to the selected cow', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    const job = b.post('chop', { treeId: 1, i: 4, j: 4 });

    expect(prioritizeJob(w, b, job.id, cow)).toBe(true);
    expect(job.claimedBy).toBe(cow);

    const cowJob = w.get(cow, 'Job');
    expect(cowJob.kind).toBe('chop');
    expect(cowJob.state).toBe('pathing');
    expect(cowJob.payload.jobId).toBe(job.id);
    expect(cowJob.payload.treeId).toBe(1);
  });

  it('kicks a different cow off the job and assigns to the selected cow', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const oldCow = spawnCow(w);
    const newCow = spawnCow(w);
    const job = b.post('chop', { treeId: 7, i: 1, j: 1 });
    b.claim(job.id, oldCow);
    // Simulate the old cow being in the middle of that job.
    const oldCowJob = w.get(oldCow, 'Job');
    oldCowJob.kind = 'chop';
    oldCowJob.state = 'walking';
    oldCowJob.payload = { jobId: job.id, treeId: 7, i: 1, j: 1 };
    w.get(oldCow, 'Path').steps = [{ i: 0, j: 0 }];

    expect(prioritizeJob(w, b, job.id, newCow)).toBe(true);
    expect(job.claimedBy).toBe(newCow);

    // Old cow back to idle, brain dirty so it re-decides.
    expect(w.get(oldCow, 'Job').kind).toBe('none');
    expect(w.get(oldCow, 'Path').steps.length).toBe(0);
    expect(w.get(oldCow, 'Brain').jobDirty).toBe(true);

    // New cow has the job.
    expect(w.get(newCow, 'Job').kind).toBe('chop');
  });

  it('releases the selected cow prior claim before taking the new job', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    const prior = b.post('haul', { fromI: 0, fromJ: 0, toI: 9, toJ: 9, itemId: 11 });
    const target = b.post('chop', { treeId: 3, i: 5, j: 5 });
    b.claim(prior.id, cow);
    const cowJob = w.get(cow, 'Job');
    cowJob.kind = 'haul';
    cowJob.state = 'pathing-to-item';
    cowJob.payload = { jobId: prior.id, itemId: 11, fromI: 0, fromJ: 0, toI: 9, toJ: 9 };

    expect(prioritizeJob(w, b, target.id, cow)).toBe(true);
    expect(prior.claimedBy).toBeNull();
    expect(target.claimedBy).toBe(cow);
    expect(w.get(cow, 'Job').kind).toBe('chop');
  });

  it('returns false for a completed job', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    const job = b.post('chop', { treeId: 1, i: 0, j: 0 });
    b.complete(job.id);
    expect(prioritizeJob(w, b, job.id, cow)).toBe(false);
    expect(w.get(cow, 'Job').kind).toBe('none');
  });

  it('no-op reassign to same cow leaves claim intact', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    const job = b.post('mine', { boulderId: 5, i: 2, j: 2 });
    b.claim(job.id, cow);

    expect(prioritizeJob(w, b, job.id, cow)).toBe(true);
    expect(job.claimedBy).toBe(cow);
  });

  it('sets haul-family state to pathing-to-item', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    const job = b.post('haul', { fromI: 1, fromJ: 1, toI: 4, toJ: 4, itemId: 9 });

    expect(prioritizeJob(w, b, job.id, cow)).toBe(true);
    expect(w.get(cow, 'Job').state).toBe('pathing-to-item');
  });

  it('flags the cow job as prioritized on immediate assignment', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    const job = b.post('chop', { treeId: 1, i: 4, j: 4 });

    prioritizeJob(w, b, job.id, cow);
    expect(w.get(cow, 'Job').prioritized).toBe(true);
  });

  it('queue mode: busy cow appends to priorityQueue instead of replacing', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    // Cow is already chopping A.
    const current = b.post('chop', { treeId: 1, i: 1, j: 1 });
    b.claim(current.id, cow);
    const cowJob = w.get(cow, 'Job');
    cowJob.kind = 'chop';
    cowJob.state = 'walking';
    cowJob.payload = { jobId: current.id, treeId: 1, i: 1, j: 1 };

    const queued = b.post('chop', { treeId: 2, i: 5, j: 5 });
    expect(prioritizeJob(w, b, queued.id, cow, { queue: true })).toBe(true);

    // Current job untouched, queued job's board claim flipped to this cow.
    expect(cowJob.kind).toBe('chop');
    expect(cowJob.payload.treeId).toBe(1);
    expect(queued.claimedBy).toBe(cow);
    expect(cowJob.priorityQueue).toEqual([queued.id]);
  });

  it('queue mode on idle cow falls through to immediate assignment', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    const job = b.post('chop', { treeId: 1, i: 4, j: 4 });

    expect(prioritizeJob(w, b, job.id, cow, { queue: true })).toBe(true);
    expect(w.get(cow, 'Job').kind).toBe('chop');
    expect(w.get(cow, 'Job').priorityQueue).toEqual([]);
  });

  it('non-queue prioritize clears any pending queue entries and releases them', () => {
    const w = makeWorld();
    const b = new JobBoard();
    const cow = spawnCow(w);
    // Cow chopping A, with B queued.
    const current = b.post('chop', { treeId: 1, i: 1, j: 1 });
    const queued = b.post('chop', { treeId: 2, i: 5, j: 5 });
    b.claim(current.id, cow);
    b.claim(queued.id, cow);
    const cowJob = w.get(cow, 'Job');
    cowJob.kind = 'chop';
    cowJob.state = 'walking';
    cowJob.payload = { jobId: current.id, treeId: 1, i: 1, j: 1 };
    cowJob.priorityQueue.push(queued.id);

    // Non-queue prioritize on C: should drop current AND queued B.
    const target = b.post('chop', { treeId: 3, i: 7, j: 7 });
    expect(prioritizeJob(w, b, target.id, cow)).toBe(true);
    expect(cowJob.kind).toBe('chop');
    expect(cowJob.payload.treeId).toBe(3);
    expect(cowJob.priorityQueue).toEqual([]);
    expect(queued.claimedBy).toBeNull();
    expect(current.claimedBy).toBeNull();
  });
});
