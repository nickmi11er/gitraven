import { describe, expect, it } from 'vitest';
import { lineUrl, remoteWebBase } from '../../src/extension/git/remoteUrl';

describe('remoteWebBase', () => {
  it('parses https URLs and strips .git', () => {
    expect(remoteWebBase('https://github.com/owner/repo.git')).toEqual({
      base: 'https://github.com/owner/repo',
      flavor: 'github',
    });
    expect(remoteWebBase('https://github.com/owner/repo')?.base).toBe('https://github.com/owner/repo');
  });

  it('parses scp-like ssh URLs', () => {
    expect(remoteWebBase('git@github.com:owner/repo.git')).toEqual({
      base: 'https://github.com/owner/repo',
      flavor: 'github',
    });
  });

  it('parses ssh:// URLs with user and port', () => {
    expect(remoteWebBase('ssh://git@github.com:22/owner/repo.git')?.base).toBe('https://github.com/owner/repo');
  });

  it('keeps GitLab subgroups and detects the gitlab flavor, incl. self-hosted', () => {
    expect(remoteWebBase('git@gitlab.com:group/sub/repo.git')).toEqual({
      base: 'https://gitlab.com/group/sub/repo',
      flavor: 'gitlab',
    });
    expect(remoteWebBase('https://gitlab.example.io/team/repo.git')?.flavor).toBe('gitlab');
  });

  it('rejects local paths and unrecognized forms', () => {
    expect(remoteWebBase('/srv/git/repo.git')).toBeUndefined();
    expect(remoteWebBase('C:\\repos\\project')).toBeUndefined();
    expect(remoteWebBase('../elsewhere/repo')).toBeUndefined();
    expect(remoteWebBase('')).toBeUndefined();
  });
});

describe('lineUrl', () => {
  const github = { base: 'https://github.com/o/r', flavor: 'github' as const };
  const gitlab = { base: 'https://gitlab.com/o/r', flavor: 'gitlab' as const };

  it('links a single line', () => {
    expect(lineUrl(github, 'abc123', 'src/a.ts', 10)).toBe('https://github.com/o/r/blob/abc123/src/a.ts#L10');
  });

  it('links a range, per host dialect', () => {
    expect(lineUrl(github, 'abc123', 'src/a.ts', 10, 20)).toBe('https://github.com/o/r/blob/abc123/src/a.ts#L10-L20');
    expect(lineUrl(gitlab, 'abc123', 'src/a.ts', 10, 20)).toBe('https://gitlab.com/o/r/-/blob/abc123/src/a.ts#L10-20');
  });

  it('uses GitLab blob paths', () => {
    expect(lineUrl(gitlab, 'abc123', 'a.ts', 1)).toBe('https://gitlab.com/o/r/-/blob/abc123/a.ts#L1');
  });

  it('escapes path segments but keeps slashes', () => {
    expect(lineUrl(github, 'abc', 'dir name/file#1.ts', 2)).toBe(
      'https://github.com/o/r/blob/abc/dir%20name/file%231.ts#L2',
    );
  });
});
