import type { FileChange, FileStatus } from '../../../shared/model';

interface NameStatusEntry {
  status: FileStatus;
  path: string;
  oldPath?: string;
}

const LETTER_TO_STATUS: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
};

/** Parse `git diff-tree --name-status -z` (renames/copies carry two paths). */
export function parseNameStatusZ(raw: string): NameStatusEntry[] {
  const tokens = raw.split('\0').filter((t) => t.length > 0);
  const out: NameStatusEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i];
    const letter = code[0];
    const status = LETTER_TO_STATUS[letter] ?? 'modified';
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[++i] ?? '';
      const path = tokens[++i] ?? '';
      out.push({ status, path, oldPath });
    } else {
      const path = tokens[++i] ?? '';
      out.push({ status, path });
    }
  }
  return out;
}

/** Parse `git diff-tree --numstat -z` into per-path added/deleted counts. */
export function parseNumstatZ(raw: string): Map<string, { added?: number; deleted?: number }> {
  const tokens = raw.split('\0');
  const map = new Map<string, { added?: number; deleted?: number }>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length === 0 || !token.includes('\t')) continue;
    const parts = token.split('\t');
    const added = parts[0] === '-' ? undefined : Number(parts[0]);
    const deleted = parts[1] === '-' ? undefined : Number(parts[1]);
    const rest = parts.slice(2).join('\t');
    let key: string;
    if (rest === '') {
      // rename/copy: the old and new paths follow as separate NUL tokens.
      i++; // old path (unused for keying)
      key = tokens[++i] ?? '';
    } else {
      key = rest;
    }
    map.set(key, { added, deleted });
  }
  return map;
}

/** Merge name-status (authoritative for status + rename) with numstat counts. */
export function mergeCommitFiles(raw: {
  nameStatus: string;
  numstat: string;
}): FileChange[] {
  const entries = parseNameStatusZ(raw.nameStatus);
  const counts = parseNumstatZ(raw.numstat);
  return entries.map((e) => {
    const c = counts.get(e.path);
    const change: FileChange = { path: e.path, status: e.status, staged: false };
    if (e.oldPath) change.oldPath = e.oldPath;
    if (c?.added !== undefined) change.added = c.added;
    if (c?.deleted !== undefined) change.deleted = c.deleted;
    return change;
  });
}
