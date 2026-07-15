import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LOG_FORMAT, REF_FORMAT } from '../../src/extension/git/parsers/formats';
import { parseLog } from '../../src/extension/git/parsers/logParser';
import { parseRefs } from '../../src/extension/git/parsers/refParser';
import { parseStatus } from '../../src/extension/git/parsers/statusParser';
import { mergeCommitFiles } from '../../src/extension/git/parsers/numstatParser';
import { layout, type CommitNode } from '../../src/extension/graph/layout';

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'detached-realgit-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');

  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  git('add', '.');
  git('commit', '-q', '-m', 'on feature');

  git('checkout', '-q', 'main');
  fs.appendFileSync(path.join(repo, 'a.txt'), 'two\n');
  git('add', '.');
  git('commit', '-q', '-m', 'second on main');

  git('merge', '-q', '--no-ff', 'feature', '-m', 'merge feature');
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('parsers against real git', () => {
  it('parses status: staged + untracked', () => {
    fs.appendFileSync(path.join(repo, 'a.txt'), 'staged\n');
    git('add', 'a.txt');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'u\n');

    const raw = git('status', '--porcelain=v2', '-z', '--branch');
    const status = parseStatus('r', raw);
    expect(status.branch).toBe('main');
    expect(status.staged.map((f) => f.path)).toContain('a.txt');
    expect(status.untracked.map((f) => f.path)).toContain('untracked.txt');

    // reset working tree for later assertions
    git('reset', '-q', '--hard');
    fs.rmSync(path.join(repo, 'untracked.txt'), { force: true });
  });

  it('parses refs including branches and HEAD marker', () => {
    const raw = git('for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags');
    const refs = parseRefs(raw);
    const names = refs.map((r) => r.name);
    expect(names).toContain('main');
    expect(names).toContain('feature');
    expect(refs.some((r) => r.isHead && r.name === 'main')).toBe(true);
  });

  it('parses the log and lays out a merge graph', () => {
    const raw = git('log', '--topo-order', '--date-order', `--pretty=format:${LOG_FORMAT}`, '--all');
    const commits = parseLog(raw);
    expect(commits.length).toBe(4);
    const merge = commits.find((c) => c.subject === 'merge feature');
    expect(merge?.parents.length).toBe(2);

    const rows = layout(commits as CommitNode[]);
    expect(rows.length).toBe(4);
    expect(rows.some((r) => r.isMerge)).toBe(true);
    expect(Math.max(...rows.map((r) => r.maxLane))).toBeGreaterThanOrEqual(1);
  });

  it('lists files of a root (parentless) commit via --root', () => {
    const root = git('rev-list', '--max-parents=0', 'HEAD').trim().split('\n')[0];
    const flags = ['diff-tree', '--no-commit-id', '-r', '-m', '--first-parent', '--root', '-z'];
    const nameStatus = execFileSync('git', [...flags, '--name-status', root], { cwd: repo, encoding: 'utf8' });
    const numstat = execFileSync('git', [...flags, '--numstat', root], { cwd: repo, encoding: 'utf8' });
    const files = mergeCommitFiles({ nameStatus, numstat });
    expect(files.map((f) => f.path)).toContain('a.txt');
    expect(files.every((f) => f.status === 'added')).toBe(true);
  });

  it('parses commit file changes (name-status + numstat)', () => {
    const sha = git('rev-parse', 'main').trim();
    const flags = ['diff-tree', '--no-commit-id', '-r', '-m', '--first-parent', '-z'];
    const nameStatus = execFileSync('git', [...flags, '--name-status', sha], { cwd: repo, encoding: 'utf8' });
    const numstat = execFileSync('git', [...flags, '--numstat', sha], { cwd: repo, encoding: 'utf8' });
    const files = mergeCommitFiles({ nameStatus, numstat });
    // the merge commit's first-parent diff brings in b.txt from the feature branch
    expect(files.some((f) => f.path === 'b.txt')).toBe(true);
  });
});
