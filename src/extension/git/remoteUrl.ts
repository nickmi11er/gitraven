// Turn a git remote URL into a browsable web URL. Pure (no vscode import) so
// it is unit-testable and reusable by the log's "Open on remote" (#10).

export interface RemoteWeb {
  /** Repository home page, e.g. https://github.com/owner/repo */
  base: string;
  /** Host dialect for path/anchor shapes. Unknown hosts get GitHub's. */
  flavor: 'github' | 'gitlab';
}

/**
 * Parse the common remote URL forms — https://, ssh://, git:// (with optional
 * user and port) and scp-like git@host:path — into a web base URL. Local paths
 * and anything unrecognized yield nothing.
 */
export function remoteWebBase(url: string): RemoteWeb | undefined {
  let host: string | undefined;
  let repoPath: string | undefined;
  const full = /^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(url.trim());
  if (full) {
    [, host, repoPath] = full;
  } else {
    // scp-like syntax. The user@ part is required so Windows paths (C:\…) and
    // plain local paths don't parse as host:path.
    const scp = /^([^@/]+)@([^:/]+):(.+)$/.exec(url.trim());
    if (scp) [, , host, repoPath] = scp;
  }
  if (!host || !repoPath) return undefined;
  const cleaned = repoPath.replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!cleaned) return undefined;
  return {
    base: `https://${host}/${cleaned}`,
    flavor: /gitlab/i.test(host) ? 'gitlab' : 'github',
  };
}

/** Permalink to a line (or range) of a file pinned at a commit. */
export function lineUrl(web: RemoteWeb, sha: string, filePath: string, start: number, end = start): string {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const blob = web.flavor === 'gitlab' ? '-/blob' : 'blob';
  const anchor = end > start ? (web.flavor === 'gitlab' ? `#L${start}-${end}` : `#L${start}-L${end}`) : `#L${start}`;
  return `${web.base}/${blob}/${sha}/${encodedPath}${anchor}`;
}
