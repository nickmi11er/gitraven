/**
 * Set of commits (within the loaded window) reachable from `headSha` by walking
 * parents. Returns null when HEAD is unborn or outside the window, so callers
 * treat every row as in-branch (no dimming).
 */
export function reachableFromHead(
  commits: { sha: string; parents: string[] }[],
  headSha: string,
): Set<string> | null {
  if (!headSha) return null;
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  if (!bySha.has(headSha)) return null;
  const reachable = new Set<string>();
  const stack = [headSha];
  while (stack.length) {
    const sha = stack.pop()!;
    if (reachable.has(sha)) continue;
    reachable.add(sha);
    const c = bySha.get(sha);
    if (c) for (const p of c.parents) if (bySha.has(p)) stack.push(p);
  }
  return reachable;
}
