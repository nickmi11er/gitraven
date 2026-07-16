import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseBlame } from '../../src/extension/git/parsers/blameParser';

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const write = (name: string, content: string) => fs.writeFileSync(path.join(repo, name), content);

let first: string;
let second: string;

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gitraven-blame-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Alice');
  git('config', 'user.email', 'alice@x');
  write('a.txt', 'one\ntwo\nthree\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  first = git('rev-parse', 'HEAD').trim();
  git('config', 'user.name', 'Bob');
  git('config', 'user.email', 'bob@x');
  write('a.txt', 'one\ntwo!\nthree\n');
  git('commit', '-q', '-am', 'second');
  second = git('rev-parse', 'HEAD').trim();
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('blame parser against real git', () => {
  it('attributes each line to its commit and author', () => {
    const lines = parseBlame(git('blame', '--porcelain', '--', 'a.txt'));
    expect(lines).toHaveLength(3);
    const byLine = new Map(lines.map((l) => [l.line, l]));
    expect(byLine.get(1)).toMatchObject({ sha: first, authorName: 'Alice', summary: 'first' });
    expect(byLine.get(2)).toMatchObject({ sha: second, authorName: 'Bob', summary: 'second' });
    expect(byLine.get(3)).toMatchObject({ sha: first, authorName: 'Alice', summary: 'first' });
    expect(byLine.get(1)!.authorTime).toBeGreaterThan(0);
  });

  it('marks uncommitted lines with the zero sha', () => {
    write('a.txt', 'one\ntwo!\nthree changed\n');
    const lines = parseBlame(git('blame', '--porcelain', '--', 'a.txt'));
    const byLine = new Map(lines.map((l) => [l.line, l]));
    expect(byLine.get(3)!.sha).toBe('0'.repeat(40));
    expect(byLine.get(1)!.sha).toBe(first);
    expect(byLine.get(2)!.sha).toBe(second);
  });

  it('fails for untracked files', () => {
    write('untracked.txt', 'x\n');
    expect(() => git('blame', '--porcelain', '--', 'untracked.txt')).toThrow(/no such path/);
  });
});
