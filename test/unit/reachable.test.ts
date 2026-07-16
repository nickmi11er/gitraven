import { describe, expect, it } from 'vitest';
import { reachableFromHead } from '../../src/extension/graph/reachable';

const nodes = (spec: [string, string[]][]) => spec.map(([sha, parents]) => ({ sha, parents }));

describe('reachableFromHead', () => {
  it('marks ancestors of HEAD, excluding side branches', () => {
    // main: A <- B(head).  feature: C off B's parent A, not reachable from B.
    const commits = nodes([
      ['C', ['A']], // feature tip
      ['B', ['A']], // HEAD
      ['A', []],
    ]);
    const r = reachableFromHead(commits, 'B')!;
    expect(r.has('B')).toBe(true);
    expect(r.has('A')).toBe(true);
    expect(r.has('C')).toBe(false);
  });

  it('includes both sides of a merge reachable from HEAD', () => {
    const commits = nodes([
      ['M', ['A', 'C']], // HEAD merge
      ['A', ['base']],
      ['C', ['base']],
      ['base', []],
    ]);
    const r = reachableFromHead(commits, 'M')!;
    expect([...r].sort()).toEqual(['A', 'C', 'M', 'base']);
  });

  it('returns null for unborn HEAD or a hash outside the window', () => {
    expect(reachableFromHead(nodes([['A', []]]), '')).toBeNull();
    expect(reachableFromHead(nodes([['A', []]]), 'ZZZ')).toBeNull();
  });
});

describe('incremental reachability (append equivalence)', () => {
  const DAG: [string, string[]][] = [
    ['X', ['B']], // side tip, not from HEAD
    ['M', ['A', 'F']], // HEAD (merge)
    ['A', ['B']],
    ['F', ['G']],
    ['B', ['C']],
    ['G', ['C']],
    ['C', ['D']],
    ['D', []],
  ];

  it('chunked appends agree with the one-shot walk', async () => {
    const { newReachState, reachAppend } = await import('../../src/extension/graph/reachable');
    const all = nodes(DAG);
    const oneShot = reachableFromHead(all, 'M')!;
    for (let split = 1; split < all.length; split++) {
      const state = newReachState('M');
      reachAppend(state, all.slice(0, split));
      reachAppend(state, all.slice(split));
      expect(state.sawHead).toBe(true);
      expect([...state.reachable].sort()).toEqual([...oneShot].sort());
    }
  });

  it('resumes through parents that pointed beyond the window', async () => {
    const { newReachState, reachAppend } = await import('../../src/extension/graph/reachable');
    const all = nodes(DAG);
    const state = newReachState('M');
    reachAppend(state, all.slice(0, 2)); // X + M only; A/F beyond the window
    expect(state.reachable.has('M')).toBe(true);
    expect(state.pending.has('A')).toBe(true);
    expect(state.pending.has('F')).toBe(true);
    reachAppend(state, all.slice(2));
    expect(state.reachable.has('D')).toBe(true);
    expect(state.reachable.has('X')).toBe(false);
    expect(state.pending.size).toBe(0);
  });
});
