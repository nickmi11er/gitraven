import type { FileChange, FileStatus, RepoStatus } from '../../../shared/model';

const CODE_TO_STATUS: Record<string, FileStatus> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
};

function statusOf(code: string): FileStatus {
  return CODE_TO_STATUS[code] ?? 'modified';
}

/**
 * Parse `git status --porcelain=v2 -z --branch`. With `-z` every entry is
 * NUL-terminated; a rename/copy (type `2`) entry is followed by an extra
 * NUL-separated original path token, so we advance the cursor by two.
 */
export function parseStatus(repoId: string, raw: string): RepoStatus {
  const tokens = raw.split('\0');
  const status: RepoStatus = {
    repoId,
    detached: false,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.length === 0) continue;

    if (t.startsWith('# ')) {
      applyHeader(status, t.slice(2));
      continue;
    }

    const type = t[0];
    if (type === '1') {
      const parts = t.split(' ');
      const xy = parts[1];
      const path = parts.slice(8).join(' ');
      pushOrdinary(status, xy, path);
    } else if (type === '2') {
      const parts = t.split(' ');
      const xy = parts[1];
      const path = parts.slice(9).join(' ');
      const oldPath = tokens[++i] ?? '';
      pushOrdinary(status, xy, path, oldPath);
    } else if (type === 'u') {
      const parts = t.split(' ');
      const path = parts.slice(10).join(' ');
      status.conflicted.push({ path, status: 'conflicted', staged: false });
    } else if (type === '?') {
      status.untracked.push({ path: t.slice(2), status: 'untracked', staged: false });
    }
    // '!' (ignored) entries are skipped.
  }

  return status;
}

function pushOrdinary(status: RepoStatus, xy: string, path: string, oldPath?: string): void {
  const x = xy[0];
  const y = xy[1];
  if (x !== '.') {
    const change: FileChange = { path, status: statusOf(x), staged: true };
    if (oldPath) change.oldPath = oldPath;
    status.staged.push(change);
  }
  if (y !== '.') {
    const change: FileChange = { path, status: statusOf(y), staged: false };
    if (oldPath) change.oldPath = oldPath;
    status.unstaged.push(change);
  }
}

function applyHeader(status: RepoStatus, header: string): void {
  if (header.startsWith('branch.head ')) {
    const name = header.slice('branch.head '.length);
    if (name === '(detached)') {
      status.detached = true;
    } else {
      status.branch = name;
    }
  } else if (header.startsWith('branch.ab ')) {
    const m = /\+(\d+) -(\d+)/.exec(header);
    if (m) {
      status.ahead = Number(m[1]);
      status.behind = Number(m[2]);
    }
  }
}
