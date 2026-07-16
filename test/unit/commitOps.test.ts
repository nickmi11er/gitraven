import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mergeCommitFiles } from '../../src/extension/git/parsers/numstatParser';

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

  it('cherry-picks several commits in one invocation, oldest first', () => {
    const { git, commit, has } = mkRepo();
    commit('a.txt', 'a');
    git('checkout', '-q', '-b', 'feature');
    const c1 = commit('c1.txt', 'add c1');
    const c2 = commit('c2.txt', 'add c2');
    git('checkout', '-q', 'main');
    git('cherry-pick', c1, c2);
    expect(has('c1.txt')).toBe(true);
    expect(has('c2.txt')).toBe(true);
    expect(git('log', '--format=%s', '-2').trim().split('\n')).toEqual(['add c2', 'add c1']);
  });

  it('reverts several commits in one invocation, newest first', () => {
    const { git, commit, has } = mkRepo();
    commit('a.txt', 'a');
    const b = commit('b.txt', 'b');
    const c = commit('c.txt', 'c');
    git('revert', '--no-edit', c, b);
    expect(has('b.txt')).toBe(false);
    expect(has('c.txt')).toBe(false);
  });

  it('diffs a range between two commits with status and counts', () => {
    const { repo, git, commit } = mkRepo();
    const a = commit('a.txt', 'one\n');
    commit('b.txt', 'b');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
    git('commit', '-q', '-am', 'grow a');
    const c = git('rev-parse', 'HEAD').trim();
    const nameStatus = git('diff', '-z', '--name-status', a, c);
    const numstat = git('diff', '-z', '--numstat', a, c);
    const files = mergeCommitFiles({ nameStatus, numstat });
    const byPath = new Map(files.map((f) => [f.path, f]));
    expect(byPath.get('b.txt')?.status).toBe('added');
    expect(byPath.get('a.txt')?.status).toBe('modified');
    expect(byPath.get('a.txt')?.added).toBe(1);
    expect(byPath.get('a.txt')?.deleted).toBe(0);
  });

  it('folds a --fixup commit into its target via non-interactive autosquash', () => {
    const { repo, git, commit } = mkRepo();
    commit('base.txt', 'base');
    const target = commit('a.txt', 'feature a');
    commit('b.txt', 'later work');

    // Stage a fix for a.txt and commit it as fixup! of the target.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'feature a\nfixed\n');
    git('add', 'a.txt');
    git('commit', '-q', `--fixup=${target}`);
    expect(git('log', '-1', '--format=%s').trim()).toMatch(/^fixup! feature a/);

    // The controller runs `rebase -i --autosquash` with noop editors — the
    // auto-arranged todo is accepted as-is and never blocks on an editor.
    execFileSync('git', ['rebase', '-i', '--autosquash', `${target}^`], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GIT_SEQUENCE_EDITOR: 'true', GIT_EDITOR: 'true' },
    });

    const subjects = git('log', '--format=%s').trim().split('\n');
    expect(subjects).toEqual(['later work', 'feature a', 'base']);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toContain('fixed');
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
