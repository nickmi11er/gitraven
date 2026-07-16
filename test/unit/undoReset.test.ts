import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// The operation journal's Undo is `git reset --keep <pre-op sha>`: it must
// restore the branch tip, carry uncommitted changes along, and abort (rather
// than clobber) when those changes collide with the pre-op state.

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const write = (name: string, content: string) => fs.writeFileSync(path.join(repo, name), content);
const head = () => git('rev-parse', 'HEAD').trim();

let base: string;

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gitraven-undo-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'T');
  git('config', 'user.email', 't@t');
  write('a.txt', 'one\n');
  write('b.txt', 'keep me\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  base = head();

  git('checkout', '-q', '-b', 'feature');
  write('a.txt', 'one\nfeature\n');
  git('commit', '-q', '-am', 'feature work');
  git('checkout', '-q', 'main');
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('undo via reset --keep against real git', () => {
  it('restores the pre-merge tip and keeps unrelated uncommitted changes', () => {
    expect(head()).toBe(base);
    write('b.txt', 'keep me\nedited but uncommitted\n');
    git('merge', '--no-ff', '-m', 'merge feature', 'feature');
    expect(head()).not.toBe(base);

    git('reset', '--keep', base);

    expect(head()).toBe(base);
    expect(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8')).toContain('uncommitted');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\n');
  });

  it('aborts instead of clobbering local changes that collide with the target', () => {
    git('merge', '--no-ff', '-m', 'merge feature again', 'feature');
    const merged = head();
    // a.txt differs between HEAD and the reset target AND has local edits.
    write('a.txt', 'one\nfeature\nlocal edit\n');

    expect(() => git('reset', '--keep', base)).toThrow(/would be overwritten|cannot|not uptodate/i);

    expect(head()).toBe(merged); // nothing moved
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toContain('local edit');
  });
});
