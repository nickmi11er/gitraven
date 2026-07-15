import { describe, expect, it } from 'vitest';
import { childIndexOf, parentIndexOf } from '../../src/webview/components/LogGraph/navigation';
import type { LogRow } from '../../src/shared/model';

const row = (repoId: string, sha: string, parents: string[]): LogRow =>
  ({ repoId, commit: { sha, parents } }) as LogRow;

// Display order (newest first):
//   0 D (merge of B + C)
//   1 C (parent A)   ← side branch
//   2 B (parent A)   ← mainline
//   3 A (root)
//   4 X (other repo, parent A's sha — must be ignored)
const rows: LogRow[] = [
  row('r1', 'd', ['b', 'c']),
  row('r1', 'c', ['a']),
  row('r1', 'b', ['a']),
  row('r1', 'a', []),
  row('r2', 'x', ['a']),
];

describe('log graph navigation', () => {
  it('parent follows the first parent (mainline) of a merge', () => {
    expect(parentIndexOf(rows, 0)).toBe(2); // d → b, not c
  });

  it('parent falls back to the next parent when the first is not listed', () => {
    const truncated = [row('r1', 'd', ['missing', 'c']), row('r1', 'c', ['a'])];
    expect(parentIndexOf(truncated, 0)).toBe(1);
  });

  it('parent of a root commit is -1', () => {
    expect(parentIndexOf(rows, 3)).toBe(-1);
  });

  it('child picks the nearest child above in display order', () => {
    expect(childIndexOf(rows, 3)).toBe(2); // a → b (closest above), not c or d
    expect(childIndexOf(rows, 2)).toBe(0); // b → d
  });

  it('child of the newest commit is -1', () => {
    expect(childIndexOf(rows, 0)).toBe(-1);
  });

  it('ignores commits from other repositories', () => {
    expect(parentIndexOf(rows, 4)).toBe(-1); // x's parent sha exists only in r1
  });

  it('is a no-op for an out-of-range index', () => {
    expect(parentIndexOf(rows, -1)).toBe(-1);
    expect(childIndexOf(rows, 99)).toBe(-1);
  });
});
