import { create } from 'zustand';
import { onEvent, request } from '../vscodeApi';
import { recordRecentPathSet } from '../util/pathRecents';
import type { Request } from '../../shared/protocol';
import type {
  CommitDetails,
  FileChange,
  FilterOptions,
  LogFilters,
  LogRow,
  OperationState,
  RebaseStep,
  RepoInfo,
  RepoStatus,
} from '../../shared/model';
import type { LogPage } from '../../shared/protocol';

export interface RebaseDialogState {
  repoId: string;
  base: string;
  steps: RebaseStep[];
}

interface AppState {
  repos: RepoInfo[];
  selected: string[];
  rows: LogRow[];
  loading: boolean;
  /** Pass back to getLog to grow the window; undefined = history fully loaded. */
  nextCursor?: number;
  loadingMore: boolean;
  filters: LogFilters;
  filterOptions: FilterOptions;
  /** Focus/anchor commit — the details target and the base of shift-ranges. */
  selectedCommit?: { repoId: string; sha: string };
  /** Every selected row in display order; multi-commit actions read this. */
  selection: { repoId: string; sha: string }[];
  /** Files changed between the two selected commits (2-selection, same repo). */
  rangeDetails?: { repoId: string; from: string; to: string; files: FileChange[] };
  /** Pending reveal from the host (blame click); consumed by LogGraph. */
  revealRequest?: { repoId: string; sha: string };
  details?: CommitDetails;
  statusByRepo: Record<string, RepoStatus>;
  operationByRepo: Record<string, OperationState | null>;
  rebaseDialog?: RebaseDialogState;
  error?: string;

  init(): Promise<void>;
  reloadLog(): Promise<void>;
  loadMore(): Promise<void>;
  loadFilterOptions(): Promise<void>;
  setFilters(patch: Partial<LogFilters>): Promise<void>;
  loadPathOptions(): Promise<Record<string, string[]>>;
  setSelected(ids: string[]): Promise<void>;
  selectCommit(repoId: string, sha: string): Promise<void>;
  setSelection(entries: { repoId: string; sha: string }[], primary: { repoId: string; sha: string }): Promise<void>;
  openDiff(repoId: string, sha: string | undefined, path: string, staged?: boolean, base?: string): void;
  startRebase(repoId: string, base: string, squashShas?: string[]): Promise<void>;
  setRebaseSteps(steps: RebaseStep[]): void;
  submitRebase(): Promise<void>;
  cancelRebase(): void;
  rebaseAction(repoId: string, action: 'rebaseContinue' | 'rebaseSkip' | 'rebaseAbort'): Promise<void>;
  runGuarded(req: Request): Promise<void>;
  dismissError(): void;
}

let logReqSeq = 0;

export const useStore = create<AppState>((set, get) => ({
  repos: [],
  selected: [],
  rows: [],
  loading: false,
  loadingMore: false,
  filters: { branch: 'HEAD' },
  filterOptions: { branches: [], authors: [] },
  selection: [],
  statusByRepo: {},
  operationByRepo: {},

  async init() {
    const data = await request<{ repos: RepoInfo[]; selected: string[] }>({ kind: 'ready' });
    set({ repos: data.repos, selected: data.selected });
    await get().reloadLog();
    void get().loadFilterOptions();
    for (const id of data.selected) {
      void request<OperationState | null>({ kind: 'getOperationState', repoId: id }).then((state) =>
        set((s) => ({ operationByRepo: { ...s.operationByRepo, [id]: state } })),
      );
    }
  },

  async reloadLog() {
    const { selected, filters } = get();
    if (selected.length === 0) {
      set({ rows: [], nextCursor: undefined });
      return;
    }
    const mine = ++logReqSeq;
    set({ loading: true });
    try {
      const page = await request<LogPage>({ kind: 'getLog', repoIds: selected, filters, limit: 0 });
      if (mine !== logReqSeq) return; // a newer request superseded this one
      set({ rows: page.rows, nextCursor: page.nextCursor, loading: false, loadingMore: false, error: undefined });
    } catch (e) {
      if (mine !== logReqSeq) return; // don't surface a superseded load's failure
      set({ loading: false, error: errMsg(e) });
    }
  },

  async loadMore() {
    const { selected, filters, nextCursor, loading, loadingMore } = get();
    if (nextCursor === undefined || loading || loadingMore || selected.length === 0) return;
    const mine = ++logReqSeq;
    set({ loadingMore: true });
    try {
      const page = await request<LogPage>({ kind: 'getLog', repoIds: selected, filters, cursor: nextCursor, limit: 0 });
      if (mine !== logReqSeq) return;
      set({ rows: page.rows, nextCursor: page.nextCursor, loadingMore: false, error: undefined });
    } catch (e) {
      if (mine !== logReqSeq) return;
      set({ loadingMore: false, error: errMsg(e) });
    }
  },

  async loadFilterOptions() {
    const { selected } = get();
    if (selected.length === 0) {
      set({ filterOptions: { branches: [], authors: [] } });
      return;
    }
    try {
      const options = await request<FilterOptions>({ kind: 'getFilterOptions', repoIds: selected });
      set({ filterOptions: options });
    } catch {
      // best-effort; leave existing options
    }
  },

  async setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
    await get().reloadLog();
  },

  async loadPathOptions() {
    const { selected } = get();
    if (selected.length === 0) return {};
    try {
      return await request<Record<string, string[]>>({ kind: 'listFiles', repoIds: selected });
    } catch (e) {
      set({ error: errMsg(e) });
      return {};
    }
  },

  async setSelected(ids) {
    const data = await request<{ repos: RepoInfo[]; selected: string[] }>({ kind: 'selectRepos', repoIds: ids });
    set({ repos: data.repos, selected: data.selected });
    await get().reloadLog();
    void get().loadFilterOptions();
  },

  async selectCommit(repoId, sha) {
    await get().setSelection([{ repoId, sha }], { repoId, sha });
  },

  async setSelection(entries, primary) {
    set({ selection: entries, selectedCommit: primary, details: undefined, rangeDetails: undefined });
    const stillCurrent = () => get().selection === entries;
    try {
      if (entries.length === 1) {
        const { repoId, sha } = entries[0];
        const details = await request<CommitDetails>({ kind: 'getCommitDetails', repoId, sha });
        if (stillCurrent()) set({ details });
      } else if (entries.length === 2 && entries[0].repoId === entries[1].repoId) {
        // Display order is newest-first: diff the older against the newer.
        const [newer, older] = entries;
        const files = await request<FileChange[]>({
          kind: 'getRangeDetails',
          repoId: newer.repoId,
          from: older.sha,
          to: newer.sha,
        });
        if (stillCurrent())
          set({ rangeDetails: { repoId: newer.repoId, from: older.sha, to: newer.sha, files } });
      }
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  openDiff(repoId, sha, path, staged, base) {
    void request({ kind: 'openDiff', repoId, path, sha, staged, base });
  },

  async startRebase(repoId, base, squashShas) {
    try {
      const data = await request<{ steps: RebaseStep[] }>({ kind: 'startRebase', repoId, base });
      let steps = data.steps;
      if (squashShas?.length) {
        // Steps run oldest-first: the oldest selected keeps `pick`, the rest
        // squash into it — the user still reviews the plan before submitting.
        let first = true;
        steps = steps.map((s) => {
          if (!squashShas.includes(s.sha)) return s;
          if (first) {
            first = false;
            return s;
          }
          return { ...s, action: 'squash' as const };
        });
      }
      set({ rebaseDialog: { repoId, base, steps } });
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  setRebaseSteps(steps) {
    const d = get().rebaseDialog;
    if (d) set({ rebaseDialog: { ...d, steps } });
  },

  async submitRebase() {
    const d = get().rebaseDialog;
    if (!d) return;
    set({ rebaseDialog: undefined });
    try {
      await request({ kind: 'submitRebasePlan', repoId: d.repoId, base: d.base, steps: d.steps });
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  cancelRebase() {
    set({ rebaseDialog: undefined });
  },

  async rebaseAction(repoId, action) {
    try {
      await request({ kind: action, repoId });
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  async runGuarded(req) {
    try {
      await request(req);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  dismissError() {
    set({ error: undefined });
  },
}));

// Wire push events from the extension into the store.
onEvent((ev) => {
  const store = useStore.getState();
  switch (ev.kind) {
    case 'reposChanged':
      useStore.setState({ repos: ev.repos, selected: ev.selected });
      void store.reloadLog();
      void store.loadFilterOptions();
      break;
    case 'logInvalidated':
      void store.reloadLog();
      break;
    case 'refsChanged':
      void store.reloadLog();
      void store.loadFilterOptions();
      break;
    case 'statusChanged':
      useStore.setState((s) => ({ statusByRepo: { ...s.statusByRepo, [ev.repoId]: ev.status } }));
      break;
    case 'operationStateChanged':
      useStore.setState((s) => ({ operationByRepo: { ...s.operationByRepo, [ev.repoId]: ev.state } }));
      break;
    case 'openRebaseDialog':
      void store.startRebase(ev.repoId, ev.base);
      break;
    case 'revealCommit':
      useStore.setState({ revealRequest: { repoId: ev.repoId, sha: ev.sha } });
      break;
    case 'applyFilters':
      if (ev.filters.paths?.length) recordRecentPathSet(ev.filters.paths);
      void store.setFilters(ev.filters);
      break;
    case 'notify':
      if (ev.level === 'error') useStore.setState({ error: ev.message });
      break;
  }
});

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
