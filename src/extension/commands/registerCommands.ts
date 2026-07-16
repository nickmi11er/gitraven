import * as path from 'node:path';
import * as vscode from 'vscode';
import { toGitErrorDTO } from '../git/GitError';
import { GitContentProvider } from '../diff/GitContentProvider';
import { lineUrl, repoWebRemote } from '../git/remoteUrl';
import type { RepositoryManager } from '../git/RepositoryManager';
import type { RebaseController } from '../rebase/RebaseController';
import type { LogViewProvider } from '../webview/LogViewProvider';
import type { OperationJournal } from '../journal/OperationJournal';
import type { Repository } from '../git/Repository';

export function registerCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
  rebase: RebaseController,
  provider: LogViewProvider,
  content: GitContentProvider,
  journal: OperationJournal,
): void {
  const pickRepo = async (predicate?: (r: Repository) => boolean): Promise<Repository | undefined> => {
    let repos = manager.all;
    if (predicate) repos = repos.filter(predicate);
    if (repos.length === 0) {
      void vscode.window.showInformationMessage('GitRaven: no matching repository.');
      return undefined;
    }
    if (repos.length === 1) return repos[0];
    const pick = await vscode.window.showQuickPick(
      repos.map((r) => ({ label: r.name, description: r.root, repo: r })),
      { title: 'Select repository' },
    );
    return pick?.repo;
  };

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      void vscode.window.showErrorMessage(`GitRaven: ${toGitErrorDTO(e).message}`);
    }
  };

  const register = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register('gitraven.refresh', () =>
    guard(async () => {
      await manager.discover();
    }),
  );

  register('gitraven.selectRepositories', () =>
    guard(async () => {
      const picks = await vscode.window.showQuickPick(
        manager.all.map((r) => ({
          label: r.name,
          description: r.root,
          picked: manager.selectedIds.includes(r.id),
          id: r.id,
        })),
        { canPickMany: true, title: 'Show repositories' },
      );
      if (picks) await manager.setSelection(picks.map((p) => p.id));
    }),
  );

  register('gitraven.fetch', () =>
    guard(async () => {
      const repo = await pickRepo();
      if (repo) await repo.fetch(undefined, true);
    }),
  );

  register('gitraven.pull', () =>
    guard(async () => {
      const repo = await pickRepo();
      if (repo) await repo.pull(false);
    }),
  );

  register('gitraven.push', () =>
    guard(async () => {
      const repo = await pickRepo();
      if (repo) await repo.push({});
    }),
  );

  register('gitraven.commit', () =>
    guard(async () => {
      const repo = await pickRepo();
      if (!repo) return;
      const message = await vscode.window.showInputBox({ title: 'Commit message', prompt: 'Commits staged changes' });
      if (message) await repo.commit(message, false);
    }),
  );

  register('gitraven.createBranch', () =>
    guard(async () => {
      const repo = await pickRepo();
      if (!repo) return;
      const name = await vscode.window.showInputBox({ title: 'New branch name' });
      if (name) await repo.createBranch(name, undefined, true);
    }),
  );

  register('gitraven.checkout', () =>
    guard(async () => {
      const repo = await pickRepo();
      if (!repo) return;
      const branches = repo.refs.filter((r) => r.kind === 'head');
      const pick = await vscode.window.showQuickPick(
        branches.map((b) => ({ label: b.name })),
        { title: 'Checkout branch' },
      );
      if (pick) await repo.checkout(pick.label);
    }),
  );

  register('gitraven.startInteractiveRebase', () =>
    guard(async () => {
      const repo = await pickRepo();
      if (!repo) return;
      const base = await vscode.window.showInputBox({
        title: 'Interactive rebase',
        prompt: 'Base commit/ref to rebase onto (e.g. HEAD~5, origin/main)',
        value: 'HEAD~5',
      });
      if (!base) return;
      provider.reveal();
      provider.post({ type: 'event', kind: 'openRebaseDialog', repoId: repo.id, base });
    }),
  );

  register('gitraven.rebaseContinue', () =>
    guard(async () => {
      const repo = await pickRepo((r) => r.currentOperation === 'rebase');
      if (repo) {
        const state = await rebase.continue(repo);
        provider.post({ type: 'event', kind: 'operationStateChanged', repoId: repo.id, state });
      }
    }),
  );

  register('gitraven.undoLastOperation', () => guard(() => journal.undoLast()));
  register('gitraven.showOperationJournal', () => guard(() => journal.show()));

  register('gitraven.rebaseAbort', () =>
    guard(async () => {
      const repo = await pickRepo((r) => r.currentOperation === 'rebase');
      if (repo) {
        await rebase.abort(repo);
        provider.post({ type: 'event', kind: 'operationStateChanged', repoId: repo.id, state: null });
      }
    }),
  );

  // Editor entry points into log history. The context menu passes the document
  // uri; the command palette falls back to the active editor.
  const repoForFile = (fsPath: string): Repository | undefined =>
    manager.all
      .filter((r) => fsPath === r.root || fsPath.startsWith(r.root + path.sep))
      .sort((a, b) => b.root.length - a.root.length)[0];

  const editorTarget = (arg: unknown): { repo: Repository; rel: string; editor?: vscode.TextEditor } | undefined => {
    const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') return undefined;
    const repo = repoForFile(uri.fsPath);
    if (!repo) {
      void vscode.window.showInformationMessage('GitRaven: file is not inside a git repository.');
      return undefined;
    }
    // The Explorer also passes folders; the repository root itself maps to `.`.
    const rel = path.relative(repo.root, uri.fsPath).split(path.sep).join('/') || '.';
    const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
    return { repo, rel, editor };
  };

  register('gitraven.showFileHistory', (arg) =>
    guard(async () => {
      const target = editorTarget(arg);
      if (!target) return;
      provider.showHistory({ paths: [{ repoId: target.repo.id, path: target.rel }], lineRange: undefined });
    }),
  );

  register('gitraven.showSelectionHistory', (arg) =>
    guard(async () => {
      const target = editorTarget(arg);
      if (!target) return;
      const selection = (target.editor ?? vscode.window.activeTextEditor)?.selection;
      if (!selection) return;
      const start = selection.start.line + 1;
      // A selection ending at column 0 doesn't really include that line.
      const end = Math.max(start, selection.end.line + (selection.end.character === 0 && !selection.isEmpty ? 0 : 1));
      provider.showHistory({
        lineRange: { repoId: target.repo.id, path: target.rel, start, end },
        paths: undefined,
      });
    }),
  );

  // Branch/tag QuickPick that also accepts a typed revision (sha, HEAD~2, main@{1}).
  const pickRef = (repo: Repository): Promise<string | undefined> =>
    new Promise((resolve) => {
      type RefItem = vscode.QuickPickItem & { ref?: string };
      const section = (label: string, kind: 'head' | 'remote' | 'tag'): RefItem[] => {
        const refs = repo.refs.filter((r) => r.kind === kind && !r.name.endsWith('/HEAD'));
        if (refs.length === 0) return [];
        return [
          { label, kind: vscode.QuickPickItemKind.Separator },
          ...refs.map((r) => ({ label: r.name, description: r.targetSha.slice(0, 7), ref: r.name })),
        ];
      };
      const qp = vscode.window.createQuickPick<RefItem>();
      qp.title = 'Compare with';
      qp.placeholder = 'Pick a branch or tag, or type any revision (sha, HEAD~2)';
      qp.items = [...section('Branches', 'head'), ...section('Remote branches', 'remote'), ...section('Tags', 'tag')];
      qp.onDidAccept(() => {
        const picked = qp.selectedItems[0]?.ref ?? (qp.value.trim() || undefined);
        qp.hide();
        resolve(picked);
      });
      qp.onDidHide(() => {
        qp.dispose();
        resolve(undefined);
      });
      qp.show();
    });

  register('gitraven.compareWithRef', (arg) =>
    guard(async () => {
      const target = editorTarget(arg);
      if (!target || target.rel === '.') return;
      const { repo, rel } = target;
      const ref = await pickRef(repo);
      if (!ref) return;
      // Branch picks are known-valid; this catches typed revisions that don't resolve.
      if (!(await repo.resolveRevision(ref))) {
        void vscode.window.showErrorMessage(`GitRaven: '${ref}' is not a valid revision.`);
        return;
      }
      const left = GitContentProvider.makeUri(repo.id, ref, rel);
      // Refs are mutable (branch tips move) — don't serve a stale blob.
      content.invalidate(left);
      const right = vscode.Uri.file(path.join(repo.root, rel));
      await vscode.commands.executeCommand(
        'vscode.diff', left, right,
        `${path.basename(rel)} (${ref} ↔ working tree)`,
      );
    }),
  );

  // Permalink to the caret line (or selection), pinned to a commit: HEAD for
  // working-tree files, the document's own revision for gitraven-git: docs
  // (an old version opened from blame or a diff).
  const linePermalink = async (arg: unknown): Promise<string | undefined> => {
    const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
    if (!uri) return undefined;
    let repo: Repository | undefined;
    let rel: string | undefined;
    let sha: string | undefined;
    if (uri.scheme === 'file') {
      repo = repoForFile(uri.fsPath);
      if (repo) {
        rel = path.relative(repo.root, uri.fsPath).split(path.sep).join('/');
        sha = repo.head.sha || undefined; // empty on an unborn branch
      }
    } else {
      const parsed = GitContentProvider.parseUri(uri);
      repo = parsed && manager.get(parsed.repoId);
      rel = parsed?.path;
      sha = parsed && (await repo?.resolveRevision(parsed.ref));
    }
    if (!repo || !rel) {
      void vscode.window.showInformationMessage('GitRaven: file is not inside a git repository.');
      return undefined;
    }
    if (!sha) {
      void vscode.window.showInformationMessage('GitRaven: no commit to link to yet.');
      return undefined;
    }
    const web = repoWebRemote(repo.remotes);
    if (!web) {
      void vscode.window.showInformationMessage('GitRaven: no remote with a recognizable web URL.');
      return undefined;
    }
    const selection = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString())
      ?.selection ?? vscode.window.activeTextEditor?.selection;
    const start = (selection?.start.line ?? 0) + 1;
    const end = selection
      ? Math.max(start, selection.end.line + (selection.end.character === 0 && !selection.isEmpty ? 0 : 1))
      : start;
    return lineUrl(web, sha, rel, start, end);
  };

  register('gitraven.openLineOnRemote', (arg) =>
    guard(async () => {
      const url = await linePermalink(arg);
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  register('gitraven.copyLinePermalink', (arg) =>
    guard(async () => {
      const url = await linePermalink(arg);
      if (!url) return;
      await vscode.env.clipboard.writeText(url);
      vscode.window.setStatusBarMessage('GitRaven: permalink copied', 3000);
    }),
  );
}
