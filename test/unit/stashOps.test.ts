import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const write = (name: string, content: string) => fs.writeFileSync(path.join(repo, name), content);

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gitraven-stash-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'T');
  git('config', 'user.email', 't@x');
  write('a.txt', 'a\n');
  write('b.txt', 'b\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('stash + pathspec commit against real git', () => {
  it('commits only the checked paths (--only), leaving others dirty', () => {
    write('a.txt', 'a2\n');
    write('b.txt', 'b2\n');
    write('new.txt', 'n\n'); // untracked, checked
    git('add', '-A', '--', 'a.txt', 'new.txt');
    git('commit', '-m', 'partial', '--only', '--', 'a.txt', 'new.txt');
    const status = git('status', '--porcelain');
    expect(status).toContain('M b.txt'); // b stays uncommitted
    expect(status).not.toContain('a.txt');
    expect(status).not.toContain('new.txt');
  });

  it('stash push/list/pop roundtrip with untracked files', () => {
    write('c.txt', 'c\n'); // untracked
    git('stash', 'push', '--include-untracked', '-m', 'wip test');
    const list = git('stash', 'list', '--format=%gd\x1f%gs');
    const [ref, msg] = list.trim().split('\x1f');
    expect(ref).toBe('stash@{0}');
    expect(msg).toContain('wip test');
    expect(git('status', '--porcelain')).not.toContain('b.txt');
    git('stash', 'pop', 'stash@{0}');
    const after = git('status', '--porcelain');
    expect(after).toContain('M b.txt');
    expect(after).toContain('?? c.txt');
    expect(git('stash', 'list')).toBe('');
  });
});
