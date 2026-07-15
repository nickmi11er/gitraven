import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { Repository } from './Repository';
import { RepositoryWatcher } from './watcher/RepositoryWatcher';
import { layout, type CommitNode } from '../graph/layout';
import { reachableFromHead } from '../graph/reachable';
import { log } from '../util/logger';
import { exec } from './GitExecutor';
import type { FilterOptions, LogFilters, LogRow, RepoInfo } from '../../shared/model';
import type { LogPage } from '../../shared/protocol';

export type RepoChangeKind = 'head' | 'refs' | 'index' | 'operation';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'vendor', 'dist', 'out', '.hg', '.svn', '.cache']);
const SELECTED_KEY = 'gitraven.selectedRepoIds';

export class RepositoryManager implements vscode.Disposable {
  private repos = new Map<string, Repository>();
  private watchers = new Map<string, RepositoryWatcher>();
  private selected = new Set<string>();
  private version = 0;

  private readonly _onDidChangeRepos = new vscode.EventEmitter<void>();
  readonly onDidChangeRepos = this._onDidChangeRepos.event;
  private readonly _onDidChangeRepoState = new vscode.EventEmitter<{ repoId: string; kind: RepoChangeKind }>();
  readonly onDidChangeRepoState = this._onDidChangeRepoState.event;

  constructor(private readonly memento: vscode.Memento) {
    const persisted = memento.get<string[]>(SELECTED_KEY, []);
    for (const id of persisted) this.selected.add(id);
  }

  dispose(): void {
    for (const w of this.watchers.values()) w.dispose();
    this.watchers.clear();
    this._onDidChangeRepos.dispose();
    this._onDidChangeRepoState.dispose();
  }

  get all(): Repository[] {
    return [...this.repos.values()];
  }

  get(id: string): Repository | undefined {
    return this.repos.get(id);
  }

  get selectedIds(): string[] {
    return this.effectiveSelection();
  }

  get currentVersion(): number {
    return this.version;
  }

  private effectiveSelection(): string[] {
    const live = [...this.repos.keys()];
    const chosen = live.filter((id) => this.selected.has(id));
    return chosen.length > 0 ? chosen : live; // default: everything
  }

  reposInfo(): RepoInfo[] {
    return this.all.map((r) => r.toInfo());
  }

  async setSelection(ids: string[]): Promise<void> {
    this.selected = new Set(ids);
    await this.memento.update(SELECTED_KEY, [...this.selected]);
    this.bumpVersion();
    this._onDidChangeRepos.fire();
  }

  private bumpVersion(): void {
    this.version++;
  }

  async discover(): Promise<void> {
    const config = vscode.workspace.getConfiguration('gitraven');
    const autoDiscover = config.get<boolean>('repositories.autoDiscover', true);
    const scanDepth = config.get<number>('repositories.scanDepth', 3);

    const roots = new Map<string, boolean>(); // toplevel -> isSubmodule
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const dir = folder.uri.fsPath;
      await this.tryRegisterRoot(dir, roots);
      if (autoDiscover) await this.scanNested(dir, scanDepth, roots);
    }

    // Submodules of every discovered root.
    for (const root of [...roots.keys()]) {
      await this.collectSubmodules(root, roots);
    }

    // Reconcile: open new repos, keep existing, drop removed.
    const next = new Map<string, Repository>();
    for (const [root, isSubmodule] of roots) {
      const existing = [...this.repos.values()].find((r) => r.root === root);
      if (existing) {
        next.set(existing.id, existing);
      } else {
        try {
          const repo = await Repository.open(root, isSubmodule);
          next.set(repo.id, repo);
          log.info(`discovered repo ${repo.id}${isSubmodule ? ' (submodule)' : ''}`);
        } catch (e) {
          log.error(`failed to open repo at ${root}`, e);
        }
      }
    }
    this.repos = next;
    this.reconcileWatchers();
    this.bumpVersion();
    this._onDidChangeRepos.fire();
  }

  private reconcileWatchers(): void {
    for (const [id, w] of this.watchers) {
      if (!this.repos.has(id)) {
        w.dispose();
        this.watchers.delete(id);
      }
    }
    for (const [id, repo] of this.repos) {
      if (this.watchers.has(id)) continue;
      this.watchers.set(
        id,
        new RepositoryWatcher(repo.gitDir, repo.commonDir, (kind) => void this.handleRepoChange(id, kind)),
      );
    }
  }

  private async tryRegisterRoot(dir: string, roots: Map<string, boolean>): Promise<void> {
    if (!(await pathExists(path.join(dir, '.git')))) {
      // dir itself may still be inside a repo whose root is an ancestor
      try {
        const { stdout } = await exec(['rev-parse', '--show-toplevel'], { cwd: dir });
        const top = stdout.trim();
        if (top && !roots.has(top)) roots.set(top, false);
      } catch {
        // not a repo
      }
      return;
    }
    try {
      const { stdout } = await exec(['rev-parse', '--show-toplevel'], { cwd: dir });
      const top = stdout.trim();
      if (top && !roots.has(top)) roots.set(top, false);
    } catch {
      // ignore
    }
  }

  private async scanNested(dir: string, depth: number, roots: Map<string, boolean>): Promise<void> {
    if (depth < 0) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const child = path.join(dir, entry.name);
      if (await pathExists(path.join(child, '.git'))) {
        await this.tryRegisterRoot(child, roots);
      }
      await this.scanNested(child, depth - 1, roots);
    }
  }

  private async collectSubmodules(root: string, roots: Map<string, boolean>): Promise<void> {
    if (!(await pathExists(path.join(root, '.gitmodules')))) return;
    try {
      const { stdout } = await exec(['submodule', 'status', '--recursive'], { cwd: root });
      // Format: `<1-char-status><sha> <path> (<describe>)`. The leading status
      // char (space/+/-/U) precedes the sha with no separator; the path follows
      // one space after the sha and may itself contain spaces.
      for (const line of stdout.split('\n')) {
        const m = /^.?[0-9a-f]{7,64}\s+(.+?)(?:\s+\([^)]*\))?$/.exec(line);
        if (!m) continue;
        const sub = path.resolve(root, m[1]);
        if (await pathExists(path.join(sub, '.git'))) {
          try {
            const { stdout: top } = await exec(['rev-parse', '--show-toplevel'], { cwd: sub });
            const t = top.trim();
            if (t) roots.set(t, true);
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      log.warn(`submodule scan failed for ${root}: ${String(e)}`);
    }
  }

  async getFilterOptions(repoIds: string[]): Promise<FilterOptions> {
    const ids = repoIds.filter((id) => this.repos.has(id));
    const branchByName = new Map<string, { name: string; kind: 'head' | 'remote' }>();
    const authorByEmail = new Map<string, { name: string; email: string }>();
    let me: FilterOptions['me'];
    for (const id of ids) {
      const opts = await this.repos.get(id)!.getFilterOptions();
      for (const b of opts.branches) if (!branchByName.has(b.name)) branchByName.set(b.name, b);
      for (const a of opts.authors) if (!authorByEmail.has(a.email)) authorByEmail.set(a.email, a);
      if (!me && opts.me) me = opts.me;
    }
    const branches = [...branchByName.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'head' ? -1 : 1; // locals first
      return a.name.localeCompare(b.name);
    });
    const authors = [...authorByEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
    const result: FilterOptions = { branches, authors };
    if (me) result.me = me;
    return result;
  }

  async handleRepoChange(repoId: string, kind: RepoChangeKind): Promise<void> {
    const repo = this.repos.get(repoId);
    if (!repo) return;
    await repo.refreshState();
    this.bumpVersion();
    this._onDidChangeRepoState.fire({ repoId, kind });
  }

  /** Build a (possibly aggregated) log page across the given repos. */
  async getLogPage(
    repoIds: string[],
    filters: LogFilters | undefined,
    limit: number,
    cursor: number | undefined,
    token?: vscode.CancellationToken,
  ): Promise<LogPage> {
    const skip = cursor ?? 0;
    const ids = repoIds.filter((id) => this.repos.has(id));
    let anyFull = false;

    type Entry = Omit<LogRow, 'graph'>;
    const perRepo: Entry[][] = [];
    for (const id of ids) {
      const repo = this.repos.get(id)!;
      const commits = await repo.getLog(filters, limit, skip, token);
      if (commits.length >= limit) anyFull = true;
      const refsBySha = repo.refsBySha();
      const reachable = reachableFromHead(commits, repo.head.sha);
      perRepo.push(
        commits.map((commit) => ({
          repoId: id,
          commit,
          refs: refsBySha.get(commit.sha) ?? [],
          inCurrentBranch: reachable ? reachable.has(commit.sha) : true,
        })),
      );
    }

    // Interleave all repos chronologically (IntelliJ-style). A single graph
    // layout over the merged list keeps each repo's lanes continuous even when
    // foreign-repo rows sit between a commit and its parent (repos share no shas).
    const merged = ids.length <= 1 ? perRepo[0] ?? [] : mergeByDate(perRepo);
    const graphRows = layout(merged.map((e) => ({ sha: e.commit.sha, parents: e.commit.parents })) as CommitNode[]);
    const rows: LogRow[] = merged.map((e, i) => ({ ...e, graph: graphRows[i] }));

    const page: LogPage = { rows, graphByRepo: {}, version: this.version };
    if (anyFull) page.nextCursor = skip + limit;
    return page;
  }
}

/**
 * K-way merge of already-ordered per-repo lists by committer date (desc). ISO-8601
 * dates compare lexically, and preserving each list's internal order keeps every
 * repo's child-before-parent topology intact in the merged sequence.
 */
function mergeByDate<T extends { commit: { committerDate: string } }>(lists: T[][]): T[] {
  const idx = lists.map(() => 0);
  const total = lists.reduce((s, l) => s + l.length, 0);
  const out: T[] = [];
  while (out.length < total) {
    let best = -1;
    for (let i = 0; i < lists.length; i++) {
      if (idx[i] >= lists[i].length) continue;
      if (best === -1 || lists[i][idx[i]].commit.committerDate > lists[best][idx[best]].commit.committerDate) {
        best = i;
      }
    }
    out.push(lists[best][idx[best]]);
    idx[best]++;
  }
  return out;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
