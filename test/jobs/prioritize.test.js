import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { JobBoard } from '../../src/jobs/board.js';
import { findPrioritizableJobsAtTile, prioritizeJob } from '../../src/jobs/prioritize.js';

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
});
