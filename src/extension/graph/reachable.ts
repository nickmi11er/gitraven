/**
 * Running reachability state for a growing (append-only) log window: which
 * commits are reachable from HEAD, plus the parents that point beyond the
 * loaded window (`pending`) — the walk resumes from them when older commits
 * arrive in a later batch.
 */
export interface ReachState {
  reachable: Set<string>;
  pending: Set<string>;
  /** HEAD appeared in the window; until then no dimming can be decided. */
  sawHead: boolean;
}

export function newReachState(headSha: string): ReachState {
  return { reachable: new Set(), pending: new Set(headSha ? [headSha] : []), sawHead: false };
}

/** Extend the walk with the next (older) batch of the window. */
export function reachAppend(
  state: ReachState,
  commits: { sha: string; parents: string[] }[],
): void {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const stack: string[] = [];
  for (const sha of state.pending) {
    if (bySha.has(sha)) {
      stack.push(sha);
      state.pending.delete(sha);
    }
  }
  while (stack.length) {
    const sha = stack.pop()!;
    if (state.reachable.has(sha)) continue;
    state.reachable.add(sha);
    const c = bySha.get(sha);
    if (!c) continue;
    for (const p of c.parents) {
      if (state.reachable.has(p)) continue;
      if (bySha.has(p)) stack.push(p);
      else state.pending.add(p);
    }
  }
  if (!state.sawHead && state.reachable.size > 0) state.sawHead = true;
}

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
  const state = newReachState(headSha);
  reachAppend(state, commits);
  return state.sawHead ? state.reachable : null;
}
