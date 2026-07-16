// Typed message protocol for the webview <-> extension-host postMessage channel.
// Imported by both sides; keep free of `vscode`/Node imports.

import type {
  FileChange,
  CommitDetails,
  FileIconDef,
  FileIconTheme,
  FilterOptions,
  GitErrorDTO,
  GraphRow,
  LogFilters,
  LogRow,
  OperationState,
  RebaseStep,
  Ref,
  RepoInfo,
  RepoStatus,
  StashEntry,
} from './model';

/** Requests: webview -> extension. Each is wrapped in {@link RequestEnvelope}. */
export type Request =
  | { kind: 'ready' }
  | { kind: 'getRepos' }
  | { kind: 'selectRepos'; repoIds: string[] }
  | { kind: 'getLog'; repoIds: string[]; filters?: LogFilters; cursor?: number; limit: number }
  | { kind: 'getFilterOptions'; repoIds: string[] }
  | { kind: 'getRefs'; repoIds: string[] }
  | { kind: 'renameBranchPrompt'; repoId: string; name: string }
  | { kind: 'listFiles'; repoIds: string[] }
  | { kind: 'getCommitDetails'; repoId: string; sha: string }
  | { kind: 'getRangeDetails'; repoId: string; from: string; to: string }
  | { kind: 'getStatus'; repoId: string }
  | { kind: 'stage'; repoId: string; paths: string[] }
  | { kind: 'unstage'; repoId: string; paths: string[] }
  | { kind: 'discard'; repoId: string; paths: string[] }
  | { kind: 'addToGitignore'; repoId: string; paths: string[] }
  | { kind: 'openFile'; repoId: string; path: string }
  | { kind: 'showFileHistory'; repoId: string; path: string }
  | { kind: 'getHeadMessage'; repoId: string }
  | { kind: 'commit'; repoId: string; message: string; amend: boolean; paths?: string[] }
  | { kind: 'getStashes'; repoId: string }
  | { kind: 'getStashFiles'; repoId: string; ref: string }
  | { kind: 'stashPush'; repoId: string }
  | { kind: 'stashApply'; repoId: string; ref: string }
  | { kind: 'stashPop'; repoId: string; ref: string }
  | { kind: 'stashDrop'; repoId: string; ref: string }
  | { kind: 'checkout'; repoId: string; ref: string; create?: boolean; startPoint?: string }
  | { kind: 'createBranch'; repoId: string; name: string; startPoint?: string; checkout: boolean }
  | { kind: 'deleteBranch'; repoId: string; name: string; force: boolean }
  | { kind: 'renameBranch'; repoId: string; oldName: string; newName: string }
  | { kind: 'merge'; repoId: string; ref: string }
  | { kind: 'rebase'; repoId: string; upstream: string }
  | { kind: 'cherryPick'; repoId: string; shas: string[] }
  | { kind: 'fixupInto'; repoId: string; sha: string }
  | { kind: 'revert'; repoId: string; shas: string[] }
  | { kind: 'createTagAt'; repoId: string; sha: string }
  | { kind: 'newBranchAt'; repoId: string; sha: string }
  | { kind: 'resetTo'; repoId: string; sha: string }
  | { kind: 'fetch'; repoId: string; remote?: string; prune?: boolean }
  | { kind: 'pull'; repoId: string; rebase?: boolean }
  | { kind: 'push'; repoId: string; remote?: string; branch?: string; force?: boolean; setUpstream?: boolean }
  | { kind: 'openDiff'; repoId: string; path: string; sha?: string; staged?: boolean; base?: string }
  | { kind: 'openOnRemote'; repoId: string; sha: string; path?: string }
  | { kind: 'copyPermalink'; repoId: string; sha: string; path?: string }
  | { kind: 'startRebase'; repoId: string; base: string }
  | { kind: 'submitRebasePlan'; repoId: string; base: string; steps: RebaseStep[] }
  | { kind: 'rebaseContinue'; repoId: string }
  | { kind: 'rebaseSkip'; repoId: string }
  | { kind: 'rebaseAbort'; repoId: string }
  | { kind: 'getOperationState'; repoId: string }
  | { kind: 'getFileIconTheme' }
  | { kind: 'getFileIcons'; names: string[] };

export interface RequestEnvelope {
  id: number;
  req: Request;
}

/** Responses: extension -> webview, correlated to a request by id. */
export type Response =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: GitErrorDTO };

/** Payload shapes returned in successful responses, keyed by request kind. */
export interface ResponseData {
  getRepos: { repos: RepoInfo[]; selected: string[] };
  getLog: LogPage;
  getFilterOptions: FilterOptions;
  /** Current refs per repository, keyed by repo id. */
  getRefs: Record<string, Ref[]>;
  /** Tracked files per repository (repo-relative, sorted), keyed by repo id. */
  listFiles: Record<string, string[]>;
  getCommitDetails: CommitDetails;
  /** Files changed between two commits (`git diff from to`). */
  getRangeDetails: FileChange[];
  getStatus: RepoStatus;
  getHeadMessage: string;
  getStashes: StashEntry[];
  getStashFiles: FileChange[];
  startRebase: { steps: RebaseStep[] };
  getOperationState: OperationState | null;
  getFileIconTheme: FileIconTheme;
  getFileIcons: Record<string, FileIconDef | null>;
}

export interface LogPage {
  rows: LogRow[];
  graphByRepo: Record<string, GraphRow[]>;
  /** Pass back as `cursor` to extend the loaded window; absent when history is exhausted.
   *  Each response returns the WHOLE window from HEAD, not a delta. */
  nextCursor?: number;
  version: number;
}

/** Events: extension -> webview, unsolicited pushes (no id). */
export type Event =
  | { kind: 'reposChanged'; repos: RepoInfo[]; selected: string[] }
  | { kind: 'logInvalidated'; repoIds: string[] }
  | { kind: 'statusChanged'; repoId: string; status: RepoStatus }
  | { kind: 'refsChanged'; repoId: string; refs: Ref[] }
  | { kind: 'operationStateChanged'; repoId: string; state: OperationState | null }
  | { kind: 'openRebaseDialog'; repoId: string; base: string }
  | { kind: 'progress'; opId: string; label: string; done: boolean }
  | { kind: 'notify'; level: 'info' | 'warn' | 'error'; message: string }
  | { kind: 'revealCommit'; repoId: string; sha: string }
  | { kind: 'applyFilters'; filters: Partial<LogFilters> }
  | { kind: 'fileIconThemeChanged' };

/** The union of everything the extension may post to the webview. */
export type OutboundMessage = ({ type: 'response' } & Response) | ({ type: 'event' } & Event);

/** The union of everything the webview may post to the extension. */
export type InboundMessage = { type: 'request' } & RequestEnvelope;
