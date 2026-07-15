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
