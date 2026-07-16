import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LOG_FORMAT } from '../../src/extension/git/parsers/formats';
import { parseLog } from '../../src/extension/git/parsers/logParser';

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const commitAs = (name: string, email: string, msg: string) => {
  fs.writeFileSync(path.join(repo, `${msg.replace(/\s+/g, '_')}.txt`), msg);
  git('add', '.');
  git('-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg);
};
const base = ['log', '--topo-order', '--date-order', `--pretty=format:${LOG_FORMAT}`, '--max-count=50'];
const subjects = (out: string) => parseLog(out).map((c) => c.subject);

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'detached-filters-'));
  git('init', '-q', '-b', 'main');
  commitAs('Alice', 'alice@x', 'alpha');
  commitAs('Bob', 'bob@x', 'beta feature');
  git('checkout', '-q', '-b', 'feature');
  commitAs('Alice', 'alice@x', 'gamma');
  git('checkout', '-q', 'main');
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('log filter flags against real git', () => {
  it('filters by author', () => {
    const out = git(...base, '--all', '--author=bob@x');
    expect(subjects(out)).toEqual(['beta feature']);
  });

  it('ORs multiple --author flags', () => {
    const out = git(...base, '--all', '--author=bob@x', '--author=alice@x');
    expect(new Set(subjects(out))).toEqual(new Set(['alpha', 'beta feature', 'gamma']));
  });

  it('filters by message grep (case-insensitive)', () => {
    const out = git(...base, '--all', '--grep=FEATURE', '--regexp-ignore-case');
    expect(subjects(out)).toEqual(['beta feature']);
  });

  it('filters by branch (feature has gamma, main does not)', () => {
    expect(subjects(git(...base, 'feature'))).toContain('gamma');
    expect(subjects(git(...base, 'main'))).not.toContain('gamma');
  });

  it('resolves an abbreviated hash to its commit', () => {
    const full = git('rev-parse', 'feature').trim();
    const prefix = full.slice(0, 8);
    const resolved = git('rev-parse', '--verify', '--quiet', `${prefix}^{commit}`).trim();
    expect(resolved).toBe(full);
    const one = parseLog(git('log', '-1', `--pretty=format:${LOG_FORMAT}`, resolved));
    expect(one).toHaveLength(1);
    expect(one[0].subject).toBe('gamma');
  });

  it('extracts distinct authors via the FilterOptions format', () => {
    const out = git('log', '--all', '--no-merges', '--format=%aN\x1f%aE', '--max-count=2000');
    const emails = new Set(out.split('\n').filter(Boolean).map((l) => l.split('\x1f')[1]));
    expect(emails).toEqual(new Set(['alice@x', 'bob@x']));
  });
});

describe('path filter and pickaxe against real git', () => {
  let repo2: string;
  const git2 = (...args: string[]) => execFileSync('git', args, { cwd: repo2, encoding: 'utf8' });
  const write2 = (rel: string, content: string) => {
    const abs = path.join(repo2, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const commit2 = (msg: string) => {
    git2('add', '.');
    git2('commit', '-q', '-m', msg);
  };
  const base2 = ['log', '--topo-order', '--date-order', `--pretty=format:${LOG_FORMAT}`, '--max-count=50'];
  const subjects2 = (out: string) => parseLog(out).map((c) => c.subject);

  beforeAll(() => {
    repo2 = fs.mkdtempSync(path.join(os.tmpdir(), 'detached-paths-'));
    git2('init', '-q', '-b', 'main');
    git2('config', 'user.name', 'T');
    git2('config', 'user.email', 't@t');
    write2('src/app/main.ts', 'const magicToken = 1;\n');
    commit2('add main');
    write2('docs/readme.md', 'magicToken is documented here\n');
    commit2('add docs');
    write2('src/app/main.ts', 'const other = 2;\n');
    commit2('rewrite main');
  });

  afterAll(() => fs.rmSync(repo2, { recursive: true, force: true }));

  it('filters by a file path (git log -- <file>)', () => {
    const out = git2(...base2, '--all', '--', 'src/app/main.ts');
    expect(subjects2(out)).toEqual(['rewrite main', 'add main']);
  });

  it('filters by a folder path (git log -- <dir>)', () => {
    const out = git2(...base2, '--all', '--', 'docs');
    expect(subjects2(out)).toEqual(['add docs']);
  });

  it('ORs multiple paths', () => {
    const out = git2(...base2, '--all', '--', 'docs', 'src');
    expect(subjects2(out)).toHaveLength(3);
  });

  it('pickaxe (-S) finds commits changing the text, not ones mentioning it', () => {
    const out = git2(...base2, '--all', '-SmagicToken', '--', 'src');
    // 'add docs' mentions magicToken in a committed file but not under src.
    expect(subjects2(out)).toEqual(['rewrite main', 'add main']);
  });

  it('pickaxe alone sees additions and removals everywhere', () => {
    const out = git2(...base2, '--all', '-SmagicToken');
    expect(subjects2(out)).toEqual(['rewrite main', 'add docs', 'add main']);
  });

  it('`.` as a pathspec selects the whole repository', () => {
    // The tree picker's repo checkbox emits `.` — scoped per repo by the provider.
    const out = git2(...base2, '--all', '--', '.');
    expect(subjects2(out)).toHaveLength(3);
  });

  it('ls-files -z lists tracked files NUL-separated', () => {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: repo2 });
    const files = out.toString().split('\0').filter(Boolean);
    expect(new Set(files)).toEqual(new Set(['docs/readme.md', 'src/app/main.ts']));
  });
});
