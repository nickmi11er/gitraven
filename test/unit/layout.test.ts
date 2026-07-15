import { describe, expect, it } from 'vitest';
import { layout, type CommitNode } from '../../src/extension/graph/layout';

function nodes(spec: [string, string[]][]): CommitNode[] {
  return spec.map(([sha, parents]) => ({ sha, parents }));
}

describe('graph layout', () => {
  it('places a linear history on a single lane', () => {
    const rows = layout(nodes([
      ['A', ['B']],
      ['B', ['C']],
      ['C', []],
    ]));
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.color)).toEqual([0, 0, 0]);
    // every gap edge is a straight vertical in lane 0
    expect(rows[0].edges).toEqual([{ fromLane: 0, toLane: 0, color: 0, kind: 'straight' }]);
    expect(rows[2].edges).toEqual([]); // last row has no gap below
  });

  it('branches a merge parent into a second lane and merges it back', () => {
    const rows = layout(nodes([
      ['M', ['A', 'B']],
      ['A', ['base']],
      ['B', ['base']],
      ['base', []],
    ]));
    expect(rows[0].lane).toBe(0);
    expect(rows[0].isMerge).toBe(true);
    // gap below the merge: mainline stays, second parent branches to lane 1
    expect(rows[0].edges).toContainEqual({ fromLane: 0, toLane: 1, color: 1, kind: 'merge' });
    expect(rows[1].lane).toBe(0); // A on mainline
    expect(rows[2].lane).toBe(1); // B on second lane
    expect(rows[3].lane).toBe(0); // base back on lane 0
    // B's lane converges back into lane 0 at base
    expect(rows[2].edges).toContainEqual({ fromLane: 1, toLane: 0, color: 1, kind: 'branch' });
    expect(Math.max(...rows.map((r) => r.maxLane))).toBe(1);
  });

  it('reuses a freed lane for an unrelated later branch (compaction)', () => {
    // Two independent tips sharing a root; after the first closes, its lane frees.
    const rows = layout(nodes([
      ['X', ['root']],
      ['Y', ['root']],
      ['root', []],
    ]));
    expect(rows[0].lane).toBe(0);
    expect(rows[1].lane).toBe(1);
    expect(rows[2].lane).toBe(0);
    // Y's lane (1) merges into lane 0 at root
    expect(rows[1].edges).toContainEqual({ fromLane: 1, toLane: 0, color: 1, kind: 'branch' });
  });

  it('keeps two independent chains (interleaved multi-repo) on separate lanes', () => {
    // Two repos with no shared shas, interleaved chronologically.
    const rows = layout(nodes([
      ['A1', ['A2']],
      ['B1', ['B2']],
      ['A2', ['A3']],
      ['B2', ['B3']],
      ['A3', []],
      ['B3', []],
    ]));
    const laneOf = (sha: string) => rows.find((r) => r.sha === sha)!.lane;
    // each chain stays on its own single lane despite the interleaving
    expect(new Set([laneOf('A1'), laneOf('A2'), laneOf('A3')]).size).toBe(1);
    expect(new Set([laneOf('B1'), laneOf('B2'), laneOf('B3')]).size).toBe(1);
    expect(laneOf('A1')).not.toBe(laneOf('B1'));
    // the foreign lane passes straight through each intervening row
    expect(rows[1].edges).toContainEqual({ fromLane: laneOf('A1'), toLane: laneOf('A1'), color: rows[0].color, kind: 'straight' });
  });

  it('handles octopus merges (three parents)', () => {
    const rows = layout(nodes([
      ['O', ['p1', 'p2', 'p3']],
      ['p1', []],
      ['p2', []],
      ['p3', []],
    ]));
    expect(rows[0].isMerge).toBe(true);
    // three outgoing lanes 0,1,2 for the three parents
    const below = rows[0].edges.map((e) => e.toLane).sort();
    expect(below).toEqual([0, 1, 2]);
  });
});
