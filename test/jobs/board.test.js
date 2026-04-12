import { describe, expect, it } from 'vitest';
import { JobBoard } from '../../src/jobs/board.js';

describe('JobBoard', () => {
  it('post + claim + complete flow', () => {
    const b = new JobBoard();
    const j = b.post('chop', { i: 5, j: 5 });
    expect(j.claimedBy).toBeNull();
    expect(b.openCount).toBe(1);
    expect(b.claim(j.id, 42)).toBe(true);
    expect(j.claimedBy).toBe(42);
    expect(b.openCount).toBe(0);
    expect(b.claim(j.id, 99)).toBe(false);
    b.complete(j.id);
    expect(j.completed).toBe(true);
  });

  it('release returns a job to the open pool', () => {
    const b = new JobBoard();
    const j = b.post('haul');
    b.claim(j.id, 1);
    b.release(j.id);
    expect(j.claimedBy).toBeNull();
    expect(b.openCount).toBe(1);
  });

  it('findUnclaimed prefers nearest by Chebyshev distance', () => {
    const b = new JobBoard();
    b.post('chop', { i: 0, j: 0 });
    const near = b.post('chop', { i: 5, j: 5 });
    b.post('chop', { i: 20, j: 20 });
    const found = b.findUnclaimed({ i: 6, j: 5 });
    expect(found).toBe(near);
  });

  it('skips claimed and completed jobs', () => {
    const b = new JobBoard();
    const claimed = b.post('chop', { i: 0, j: 0 });
    b.claim(claimed.id, 1);
    const open = b.post('chop', { i: 1, j: 1 });
    expect(b.findUnclaimed({ i: 0, j: 0 })).toBe(open);
  });

  it('reap drops completed jobs', () => {
    const b = new JobBoard();
    const a = b.post('chop');
    b.post('chop');
    b.complete(a.id);
    b.reap();
    expect(b.jobs.length).toBe(1);
  });
});
