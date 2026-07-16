import * as path from 'node:path';
import * as vscode from 'vscode';
import { renderHtml } from './html';
import { GitContentProvider } from '../diff/GitContentProvider';
import { toGitErrorDTO } from '../git/GitError';
import { log } from '../util/logger';
import { DisposableStore } from '../util/disposable';
import type { RepositoryManager } from '../git/RepositoryManager';
import type { RebaseController } from '../rebase/RebaseController';
import type { InboundMessage, OutboundMessage, Request } from '../../shared/protocol';

const MUTATING = new Set<Request['kind']>([
  'stage', 'unstage', 'discard', 'commit',
  'stashPush', 'stashApply', 'stashPop', 'stashDrop',
  'checkout', 'createBranch', 'deleteBranch', 'renameBranch',
  'merge', 'rebase', 'cherryPick', 'revert', 'createTagAt', 'newBranchAt', 'resetTo',
  'fetch', 'pull', 'push',
  'submitRebasePlan', 'rebaseContinue', 'rebaseSkip', 'rebaseAbort',
]);

export class LogViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'gitraven.logView';

  private view?: vscode.WebviewView;
  private viewStore?: DisposableStore;
  private ready = false;
  private eventQueue: OutboundMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: RepositoryManager,
    private readonly rebase: RebaseController,
    private readonly content: GitContentProvider,
    private readonly opts: { viewId: string; entry: string } = { viewId: LogViewProvider.viewId, entry: 'webview' },
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    // A view can be resolved again after being hidden/moved; start a fresh store.
    this.viewStore?.dispose();
    const store = new DisposableStore();
    this.viewStore = store;
    this.view = view;
    this.ready = false;
    // Keep any events queued before resolution (e.g. openRebaseDialog posted
    // right after reveal()); they flush once the webview signals 'ready'.

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = renderHtml(view.webview, this.extensionUri, this.opts.entry);

    store.add(
      view.webview.onDidReceiveMessage((msg: InboundMessage) => {
        if (msg?.type === 'request') void this.dispatch(msg.id, msg.req);
      }),
    );
    store.add(this.manager.onDidChangeRepos(() => this.postReposChanged()));
    store.add(this.manager.onDidChangeRepoState(({ repoId, kind }) => void this.onRepoState(repoId, kind)));
    store.add(
      view.onDidDispose(() => {
        this.view = undefined;
        this.ready = false;
        this.eventQueue = [];
        store.dispose();
      }),
    );
  }

  reveal(preserveFocus = false): void {
    // show() honors preserveFocus but needs a resolved view; the focus command
    // forces first-time resolution (and steals focus — once).
    if (this.view) this.view.show(preserveFocus);
    else void vscode.commands.executeCommand(`${this.opts.viewId}.focus`);
  }

  post(msg: OutboundMessage): void {
    // Queue unsolicited events until the webview has mounted and signalled ready,
    // so events posted right after reveal() aren't dropped. Responses always flow.
    if (msg.type === 'event' && !this.ready) {
      this.eventQueue.push(msg);
      return;
    }
    void this.view?.webview.postMessage(msg);
  }

  private postReposChanged(): void {
    this.post({ type: 'event', kind: 'reposChanged', repos: this.manager.reposInfo(), selected: this.manager.selectedIds });
  }

  private async onRepoState(repoId: string, kind: string): Promise<void> {
    this.post({ type: 'event', kind: 'logInvalidated', repoIds: [repoId] });
    const repo = this.manager.get(repoId);
    if (!repo) return;
    if (kind === 'index' || kind === 'head') {
      try {
        this.post({ type: 'event', kind: 'statusChanged', repoId, status: await repo.getStatus() });
      } catch (e) {
        log.warn(`status refresh failed: ${String(e)}`);
      }
    }
    if (kind === 'refs' || kind === 'head') {
      this.post({ type: 'event', kind: 'refsChanged', repoId, refs: repo.refs });
    }
    if (kind === 'operation' || kind === 'head') {
      const state = await this.rebase.getState(repo);
      this.post({ type: 'event', kind: 'operationStateChanged', repoId, state });
    }
  }

  private async dispatch(id: number, req: Request): Promise<void> {
    try {
      const data = await this.handle(req);
      this.post({ type: 'response', id, ok: true, data });
    } catch (e) {
      log.error(`request ${req.kind} failed`, e);
      this.post({ type: 'response', id, ok: false, error: toGitErrorDTO(e) });
    }
    // Proactively refresh after a mutation (even a failed one — a conflict still
    // changes repo state) so the log, branch list and status update immediately
    // instead of waiting on the sometimes-laggy FS watcher.
    if (MUTATING.has(req.kind) && 'repoId' in req) {
      await this.manager.handleRepoChange(req.repoId, 'head').catch(() => undefined);
    }
  }

  private logLimit(): number {
    return vscode.workspace.getConfiguration('gitraven').get<number>('log.maxCommits', 5000);
  }

  private async handle(req: Request): Promise<unknown> {
    const repoOf = (id: string) => {
      const repo = this.manager.get(id);
      if (!repo) throw new Error(`Unknown repository ${id}`);
      return repo;
    };

    switch (req.kind) {
      case 'ready': {
        this.ready = true;
        const queued = this.eventQueue;
        this.eventQueue = [];
        for (const msg of queued) void this.view?.webview.postMessage(msg);
        return { repos: this.manager.reposInfo(), selected: this.manager.selectedIds };
      }
      case 'getRepos':
        return { repos: this.manager.reposInfo(), selected: this.manager.selectedIds };
      case 'selectRepos':
        await this.manager.setSelection(req.repoIds);
        return { repos: this.manager.reposInfo(), selected: this.manager.selectedIds };
      case 'getLog':
        return this.manager.getLogPage(req.repoIds, req.filters, req.limit || this.logLimit(), req.cursor);
      case 'getFilterOptions':
        return this.manager.getFilterOptions(req.repoIds);
      case 'getCommitDetails':
        return repoOf(req.repoId).getCommitDetails(req.sha);
      case 'getStatus':
        return repoOf(req.repoId).getStatus();
      case 'stage':
        await repoOf(req.repoId).stage(req.paths);
        return null;
      case 'unstage':
        await repoOf(req.repoId).unstage(req.paths);
        return null;
      case 'discard':
        await repoOf(req.repoId).discard(req.paths);
        return null;
      case 'commit':
        await repoOf(req.repoId).commit(req.message, req.amend, req.paths);
        return null;
      case 'getStashes':
        return repoOf(req.repoId).stashes();
      case 'getStashFiles':
        return repoOf(req.repoId).stashFiles(req.ref);
      case 'stashPush': {
        const message = await vscode.window.showInputBox({
          title: 'Stash Changes',
          prompt: 'Optional stash message',
        });
        if (message === undefined) return null;
        await repoOf(req.repoId).stashPush(message || undefined);
        return null;
      }
      case 'stashApply':
        await repoOf(req.repoId).stashApply(req.ref);
        return null;
      case 'stashPop':
        await repoOf(req.repoId).stashPop(req.ref);
        return null;
      case 'stashDrop': {
        const ok = await vscode.window.showWarningMessage(`Drop ${req.ref}?`, { modal: true }, 'Drop');
        if (ok !== 'Drop') return null;
        await repoOf(req.repoId).stashDrop(req.ref);
        return null;
      }
      case 'checkout':
        await repoOf(req.repoId).checkout(req.ref, req.create, req.startPoint);
        return null;
      case 'createBranch':
        await repoOf(req.repoId).createBranch(req.name, req.startPoint, req.checkout);
        return null;
      case 'deleteBranch':
        await repoOf(req.repoId).deleteBranch(req.name, req.force);
        return null;
      case 'renameBranch':
        await repoOf(req.repoId).renameBranch(req.oldName, req.newName);
        return null;
      case 'merge':
        await repoOf(req.repoId).merge(req.ref);
        return null;
      case 'rebase':
        await repoOf(req.repoId).rebase(req.upstream);
        return null;
      case 'cherryPick':
        await repoOf(req.repoId).cherryPick(req.sha);
        return null;
      case 'revert':
        await repoOf(req.repoId).revert(req.sha);
        return null;
      case 'createTagAt': {
        const name = await vscode.window.showInputBox({ title: 'New Tag', prompt: `Tag ${req.sha.slice(0, 7)}` });
        if (!name) return null;
        const message = await vscode.window.showInputBox({
          title: 'Tag Message',
          prompt: 'Optional — leave empty for a lightweight tag',
        });
        await repoOf(req.repoId).createTag(name, req.sha, message || undefined);
        return null;
      }
      case 'newBranchAt': {
        const name = await vscode.window.showInputBox({
          title: 'New Branch',
          prompt: `Create and checkout a branch at ${req.sha.slice(0, 7)}`,
        });
        if (!name) return null;
        await repoOf(req.repoId).createBranch(name, req.sha, true);
        return null;
      }
      case 'resetTo': {
        const pick = await vscode.window.showQuickPick(
          [
            { label: 'Mixed', description: 'Move HEAD, reset index, keep working tree', mode: 'mixed' as const },
            { label: 'Soft', description: 'Move HEAD only, keep index and working tree', mode: 'soft' as const },
            { label: 'Hard', description: 'Discard all index and working-tree changes', mode: 'hard' as const },
          ],
          { title: `Reset current branch to ${req.sha.slice(0, 7)}` },
        );
        if (!pick) return null;
        if (pick.mode === 'hard') {
          const ok = await vscode.window.showWarningMessage(
            'Discard all uncommitted changes?',
            { modal: true },
            'Reset Hard',
          );
          if (ok !== 'Reset Hard') return null;
        }
        await repoOf(req.repoId).reset(pick.mode, req.sha);
        return null;
      }
      case 'fetch':
        return this.withProgress('Fetching…', () => repoOf(req.repoId).fetch(req.remote, req.prune ?? false));
      case 'pull':
        return this.withProgress('Pulling…', () => repoOf(req.repoId).pull(req.rebase ?? false));
      case 'push':
        return this.withProgress('Pushing…', () =>
          repoOf(req.repoId).push({
            remote: req.remote,
            branch: req.branch,
            force: req.force,
            setUpstream: req.setUpstream,
          }),
        );
      case 'openDiff':
        await this.openDiff(req);
        return null;
      case 'startRebase':
        return { steps: await this.rebase.buildSteps(repoOf(req.repoId), req.base) };
      case 'submitRebasePlan': {
        const state = await this.rebase.run(repoOf(req.repoId), req.base, req.steps);
        this.post({ type: 'event', kind: 'operationStateChanged', repoId: req.repoId, state });
        return null;
      }
      case 'rebaseContinue':
      case 'rebaseSkip':
      case 'rebaseAbort': {
        const repo = repoOf(req.repoId);
        const state =
          req.kind === 'rebaseContinue'
            ? await this.rebase.continue(repo)
            : req.kind === 'rebaseSkip'
              ? await this.rebase.skip(repo)
              : await this.rebase.abort(repo);
        this.post({ type: 'event', kind: 'operationStateChanged', repoId: req.repoId, state });
        return null;
      }
      case 'getOperationState':
        return this.rebase.getState(repoOf(req.repoId));
    }
  }

  private withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress({ location: { viewId: this.opts.viewId }, title }, task) as Promise<T>;
  }

  private async openDiff(req: Extract<Request, { kind: 'openDiff' }>): Promise<void> {
    const repo = this.manager.get(req.repoId);
    if (!repo) return;
    const name = path.basename(req.path);
    if (req.sha) {
      const left = GitContentProvider.makeUri(req.repoId, `${req.sha}^`, req.path);
      const right = GitContentProvider.makeUri(req.repoId, req.sha, req.path);
      await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${req.sha.slice(0, 7)})`);
      return;
    }
    const left = GitContentProvider.makeUri(req.repoId, 'HEAD', req.path);
    const right = req.staged
      ? GitContentProvider.makeUri(req.repoId, ':0', req.path)
      : vscode.Uri.file(path.join(repo.root, req.path));
    // HEAD/:0 are mutable — invalidate so a re-opened diff isn't served stale.
    this.content.invalidate(left);
    if (req.staged) this.content.invalidate(right);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${req.staged ? 'staged' : 'working tree'})`);
  }
}
