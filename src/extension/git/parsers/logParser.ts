import type { Commit } from '../../../shared/model';
import { US } from './formats';

/**
 * Parse one record (the text between two record separators). Returns null for
 * blank records. The subject is field 9 and the body is everything after it, so
 * a stray US byte inside the body cannot corrupt earlier fields.
 */
export function parseCommitRecord(record: string): Commit | null {
  const trimmed = record.replace(/^\n+/, '').replace(/\x1e$/, '');
  if (trimmed.length === 0) return null;
  const f = trimmed.split(US);
  if (f.length < 11) return null;
  const parents = f[1].length ? f[1].split(' ') : [];
  return {
    sha: f[0],
    parents,
    authorName: f[2],
    authorEmail: f[3],
    authorDate: f[4],
    committerName: f[5],
    committerEmail: f[6],
    committerDate: f[7],
    // f[8] is %D (ref decoration); refs come from for-each-ref instead.
    subject: f[9],
    body: f.slice(10).join(US),
  };
}

/** Parse a full `git log` buffer (used by tests / buffered paths). */
export function parseLog(buffer: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of buffer.split('\x1e')) {
    const c = parseCommitRecord(record);
    if (c) commits.push(c);
  }
  return commits;
}
