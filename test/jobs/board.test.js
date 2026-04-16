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

  it('findUnclaimed picks lower tier first even when farther', () => {
    const b = new JobBoard();
    // haul (tier 3) is right next to us
    b.post('haul', { fromI: 5, fromJ: 5, toI: 6, toJ: 6, i: 5, j: 5 });
    // chop (tier 2) is across the map but more urgent
    const chop = b.post('chop', { treeId: 1, i: 30, j: 30 });
    expect(b.findUnclaimed({ i: 5, j: 5 })).toBe(chop);
  });

  it('post stamps tier from the kind', () => {
    const b = new JobBoard();
    expect(b.post('chop').tier).toBe(2);
    expect(b.post('haul').tier).toBe(3);
  });

  it('skips claimed and completed jobs', () => {
    const b = new JobBoard();
    const claimed = b.post('chop', { i: 0, j: 0 });
    b.claim(claimed.id, 1);
    const open = b.post('chop', { i: 1, j: 1 });
    expect(b.findUnclaimed({ i: 0, j: 0 })).toBe(open);
  });

  it('findUnclaimed sorts by priority within the same tier', () => {
    const b = new JobBoard();
    const far = b.post('chop', { i: 30, j: 30 });
    const near = b.post('chop', { i: 1, j: 1 });
    // Caller ranks the far job as priority 1 and the near one as priority 4.
    // Priority beats distance within a tier, so `far` wins.
    const found = b.findUnclaimed({ i: 0, j: 0 }, undefined, (j) => (j === far ? 1 : 4));
    expect(found).toBe(far);
    // And when priorities tie, distance breaks the tie.
    const tieFound = b.findUnclaimed({ i: 0, j: 0 }, undefined, () => 2);
    expect(tieFound).toBe(near);
  });

  it('tier still beats priority across tiers', () => {
    const b = new JobBoard();
    // chop (tier 2) with priority 8 (lowest urgency) must still beat
    // a haul (tier 3) with priority 1 (highest within its tier).
    const chop = b.post('chop', { i: 10, j: 10 });
    b.post('haul', { i: 0, j: 0 });
    const found = b.findUnclaimed({ i: 0, j: 0 }, undefined, (j) => (j.kind === 'chop' ? 8 : 1));
    expect(found).toBe(chop);
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
