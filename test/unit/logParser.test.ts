import { describe, expect, it } from 'vitest';
import { parseLog, parseCommitRecord } from '../../src/extension/git/parsers/logParser';
import { US, RS } from '../../src/extension/git/parsers/formats';

function record(fields: string[]): string {
  return fields.join(US) + RS;
}

const base = ['deadbeef', 'cafe1 cafe2', 'Ann', 'ann@x', '2024-01-01T00:00:00Z', 'Cam', 'cam@x', '2024-01-02T00:00:00Z', 'HEAD -> main', 'subject line', 'body\nmore body'];

describe('log parser', () => {
  it('maps fields positionally and splits parents', () => {
    const c = parseCommitRecord(record(base));
    expect(c).not.toBeNull();
    expect(c!.sha).toBe('deadbeef');
    expect(c!.parents).toEqual(['cafe1', 'cafe2']);
    expect(c!.authorName).toBe('Ann');
    expect(c!.subject).toBe('subject line');
    expect(c!.body).toBe('body\nmore body');
  });

  it('treats a root commit (no parents) as an empty array', () => {
    const c = parseCommitRecord(record(['sha', '', 'A', 'a@x', 'd', 'C', 'c@x', 'd', '', 'subj', '']));
    expect(c!.parents).toEqual([]);
  });

  it('keeps a stray unit separator inside the body', () => {
    const c = parseCommitRecord(record([...base.slice(0, 10), `line1${US}line2`]));
    expect(c!.body).toBe(`line1${US}line2`);
  });

  it('parses a multi-commit buffer and skips blanks', () => {
    const buf = record(base) + record(['second', '', 'B', 'b@x', 'd', 'C', 'c@x', 'd', '', 's2', '']);
    const commits = parseLog(buf);
    expect(commits.map((c) => c.sha)).toEqual(['deadbeef', 'second']);
  });
});
