import { describe, expect, it } from 'vitest';
import { buildTree } from '../../src/webview/util/fileTree';
import type { FileChange } from '../../src/shared/model';

const f = (path: string): FileChange => ({ path, status: 'modified', staged: false });
const tree = (files: FileChange[]) => buildTree(files, (x) => x.path);

describe('buildTree', () => {
  it('keeps root-level files at the top with no directory node', () => {
    const root = tree([f('README.md'), f('package.json')]);
    expect(root.dirs).toHaveLength(0);
    expect(root.items.map((x) => x.path)).toEqual(['README.md', 'package.json']);
  });

  it('collapses single-child directory chains into one node', () => {
    const root = tree([f('src/webview/components/LogGraph/CommitRow.tsx')]);
    expect(root.dirs).toHaveLength(1);
    expect(root.dirs[0].name).toBe('src/webview/components/LogGraph');
    expect(root.dirs[0].path).toBe('src/webview/components/LogGraph');
    expect(root.dirs[0].items.map((x) => x.path)).toEqual(['src/webview/components/LogGraph/CommitRow.tsx']);
  });

  it('stops collapsing where a directory branches', () => {
    const root = tree([f('src/a/one.ts'), f('src/b/two.ts')]);
    expect(root.dirs).toHaveLength(1);
    const src = root.dirs[0];
    expect(src.name).toBe('src');
    expect(src.dirs.map((d) => d.name)).toEqual(['a', 'b']);
  });

  it('sorts sibling directories alphabetically', () => {
    const root = tree([f('z/one.ts'), f('a/two.ts'), f('m/three.ts')]);
    expect(root.dirs.map((d) => d.name)).toEqual(['a', 'm', 'z']);
  });

  it('places a file alongside a subdirectory at the same level', () => {
    const root = tree([f('src/index.ts'), f('src/util/helper.ts')]);
    const src = root.dirs[0];
    expect(src.name).toBe('src');
    expect(src.items.map((x) => x.path)).toEqual(['src/index.ts']);
    expect(src.dirs.map((d) => d.name)).toEqual(['util']);
  });

  it('merges items from different sources sharing a directory path', () => {
    const entries = [
      { repoId: 'r1', file: f('src/one.ts') },
      { repoId: 'r2', file: f('src/two.ts') },
    ];
    const root = buildTree(entries, (e) => e.file.path);
    expect(root.dirs).toHaveLength(1);
    expect(root.dirs[0].items.map((e) => `${e.repoId}:${e.file.path}`)).toEqual([
      'r1:src/one.ts',
      'r2:src/two.ts',
    ]);
  });
});
