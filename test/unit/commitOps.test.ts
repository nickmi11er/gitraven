import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function mkRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'detached-ops-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  const commit = (file: string, msg: string) => {
    fs.writeFileSync(path.join(repo, file), msg);
    git('add', '.');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD').trim();
  };
  const has = (file: string) => fs.existsSync(path.join(repo, file));
  return { repo, git, commit, has };
}

describe('commit operations against real git', () => {
  it('cherry-picks a commit from another branch', () => {
    const { git, commit, has } = mkRepo();
    commit('a.txt', 'a');
    git('checkout', '-q', '-b', 'feature');
    const c = commit('c.txt', 'add c');
    git('checkout', '-q', 'main');
    git('cherry-pick', c);
    expect(has('c.txt')).toBe(true);
    expect(git('log', '-1', '--format=%s').trim()).toBe('add c');
  });

  it('reverts a commit (--no-edit) creating a new commit', () => {
    const { git, commit, has } = mkRepo();
    commit('a.txt', 'a');
    const b = commit('b.txt', 'b');
    git('revert', '--no-edit', b);
    expect(has('b.txt')).toBe(false);
    expect(git('log', '-1', '--format=%s').trim()).toMatch(/^Revert/);
  });

  it('creates lightweight and annotated tags at a commit', () => {
    const { git, commit } = mkRepo();
    const a = commit('a.txt', 'a');
    git('tag', 'light', a);
    git('tag', '-m', 'release one', 'annot', a);
    expect(git('tag', '-l').split('\n')).toEqual(expect.arrayContaining(['light', 'annot']));
    expect(git('cat-file', '-t', 'annot').trim()).toBe('tag');
    expect(git('rev-list', '-n', '1', 'light').trim()).toBe(a);
  });

  it('resets the current branch (hard) to an earlier commit', () => {
    const { git, commit, has } = mkRepo();
    const a = commit('a.txt', 'a');
    commit('b.txt', 'b');
    git('reset', '--hard', a);
    expect(git('rev-parse', 'HEAD').trim()).toBe(a);
    expect(has('b.txt')).toBe(false);
  });

  it('soft reset keeps working tree and index', () => {
    const { git, commit, has } = mkRepo();
    const a = commit('a.txt', 'a');
    commit('b.txt', 'b');
    git('reset', '--soft', a);
    expect(git('rev-parse', 'HEAD').trim()).toBe(a);
    expect(has('b.txt')).toBe(true); // working tree untouched
    expect(git('diff', '--cached', '--name-only').trim()).toBe('b.txt'); // staged
  });

  it('reads back HEAD\'s full message (subject + body) for amend prefill', () => {
    const { repo, git } = mkRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    git('add', '.');
    git('commit', '-q', '-m', 'subject line', '-m', 'body paragraph');
    // Repository.getHeadMessage strips only the trailing newlines git appends.
    expect(git('log', '-1', '--format=%B', 'HEAD').replace(/\n+$/, '')).toBe('subject line\n\nbody paragraph');
  });

  it('ignores an untracked file once its anchored path lands in .gitignore', () => {
    const { repo, git } = mkRepo();
    git('commit', '-q', '--allow-empty', '-m', 'init');
    fs.writeFileSync(path.join(repo, 'secret.env'), 'x');
    expect(git('status', '--porcelain').trim()).toBe('?? secret.env');
    fs.writeFileSync(path.join(repo, '.gitignore'), '/secret.env\n');
    const porcelain = git('status', '--porcelain');
    expect(porcelain).not.toContain('secret.env');
    expect(porcelain).toContain('.gitignore');
  });
});
