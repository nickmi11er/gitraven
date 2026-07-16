// Data transfer objects shared between the extension host and the webview.
// This module must not import `vscode` or any Node builtin so it can be bundled
// into the browser-side webview as well.

export type RefKind = 'head' | 'remote' | 'tag';

export interface Ref {
  kind: RefKind;
  /** Full refname, e.g. refs/heads/main, refs/remotes/origin/main, refs/tags/v1. */
  fullName: string;
  /** Short, display name, e.g. main, origin/main, v1. */
  name: string;
  /** Commit the ref points at. */
  targetSha: string;
  /** True for the ref currently checked out (only meaningful for `head`). */
  isHead: boolean;
  /** Upstream short name for a local branch, if configured. */
  upstream?: string;
  /** Ahead/behind counts relative to upstream, when available. */
  ahead?: number;
  behind?: number;
}

export interface Commit {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  subject: string;
  body: string;
}

export type GraphEdgeKind = 'straight' | 'merge' | 'branch';

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  color: number;
  kind: GraphEdgeKind;
}

export interface GraphRow {
  sha: string;
  lane: number;
  color: number;
  isMerge: boolean;
  /** Edges drawn in the gap between this row and the next one. */
  edges: GraphEdge[];
  /** Highest lane index occupied at this row (for width calculation). */
  maxLane: number;
}

/** A single row in the (possibly aggregated) log: commit + its repo + graph. */
export interface LogRow {
  repoId: string;
  commit: Commit;
  refs: Ref[];
  graph: GraphRow;
  /** Reachable from the repo's current HEAD (else it lives only on other branches). */
  inCurrentBranch: boolean;
}

export interface RepoInfo {
  id: string;
  /** Absolute path to the working-tree root. */
  root: string;
  /** Display name (basename of root, disambiguated when needed). */
  name: string;
  head: HeadState;
  currentOperation: RepoOperation;
  isSubmodule: boolean;
}

export interface HeadState {
  sha: string;
  branch?: string;
  detached: boolean;
}

export type RepoOperation = 'none' | 'rebase' | 'merge' | 'cherry-pick' | 'revert';

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'type-changed';

export interface FileChange {
  path: string;
  /** Original path for renames/copies. */
  oldPath?: string;
  status: FileStatus;
  staged: boolean;
  added?: number;
  deleted?: number;
}

export interface RepoStatus {
  repoId: string;
  branch?: string;
  detached: boolean;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  conflicted: FileChange[];
}

export interface CommitDetails {
  commit: Commit;
  files: FileChange[];
}

export interface StashEntry {
  /** Reflog selector, e.g. `stash@{0}`. */
  ref: string;
  /** Reflog subject, e.g. `WIP on main: 1a2b3c4 subject` or `On main: message`. */
  message: string;
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseStep {
  id: number;
  sha: string;
  action: RebaseAction;
  /** Original subject, for display. */
  subject: string;
  /** New message for reword / combined message for squash. */
  message?: string;
}

/** Snapshot of an in-progress rebase, surfaced to the rebase panel. */
export interface OperationState {
  repoId: string;
  operation: RepoOperation;
  /** 1-based index of the step git stopped on. */
  current: number;
  total: number;
  stoppedSha?: string;
  conflictedFiles: string[];
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

/** A font shipped by the active file-icon theme, inlined as a data: URI. */
export interface FileIconFont {
  id: string;
  src: string;
  format: string;
  weight?: string;
  style?: string;
  size?: string;
}

export interface FileIconTheme {
  /** Theme id, or null when the user has file icons disabled. */
  id: string | null;
  fonts: FileIconFont[];
}

/** A resolved per-file icon: either a font glyph or an inlined image. */
export interface FileIconDef {
  font?: {
    fontId?: string;
    character: string;
    color?: string;
    /** Override used when the webview renders on a light theme. */
    colorLight?: string;
    size?: string;
  };
  image?: {
    src: string;
    srcLight?: string;
  };
}

/** One line of a working-tree `git blame`. */
export interface BlameLine {
  /** 1-based line number in the current file. */
  line: number;
  /** All-zeros sha for lines not yet committed. */
  sha: string;
  authorName: string;
  /** Author time, unix epoch seconds. */
  authorTime: number;
  summary: string;
}

export interface LogFilters {
  /** Ref to show (e.g. `main`, `origin/main`); undefined means all branches. */
  branch?: string;
  /** Authors (name/email, one `--author` each, ORed by git); the sentinel `@me` = the repo's own user. */
  authors?: string[];
  /** Start of range: git approxidate (`7 days ago`) or `YYYY-MM-DD` (`--since`). */
  since?: string;
  /** End of range (`--until`). */
  until?: string;
  /** Free text matched against the message (`--grep`), or a commit-hash prefix. */
  query?: string;
}

export interface FilterOptions {
  branches: { name: string; kind: 'head' | 'remote' }[];
  authors: { name: string; email: string }[];
  me?: { name: string; email: string };
}

export interface GitErrorDTO {
  message: string;
  exitCode: number | null;
  stderr: string;
  command: string;
  /** Coarse classification for UI reactions. */
  kind: 'conflict' | 'auth' | 'locked' | 'not-a-repo' | 'unknown';
}
