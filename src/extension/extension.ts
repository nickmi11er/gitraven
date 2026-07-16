import * as vscode from 'vscode';
import { initLogger, log } from './util/logger';
import { RepositoryManager } from './git/RepositoryManager';
import { RebaseController } from './rebase/RebaseController';
import { BlameController } from './blame/BlameController';
import { FileIconService } from './icons/FileIconService';
import { LogViewProvider } from './webview/LogViewProvider';
import { OperationJournal } from './journal/OperationJournal';
import { GitContentProvider, GITRAVEN_SCHEME } from './diff/GitContentProvider';
import { registerCommands } from './commands/registerCommands';
import { resetGitPathCache } from './git/gitPath';

let manager: RepositoryManager | undefined;
let rebase: RebaseController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(initLogger());
  log.info('GitRaven activating');

  manager = new RepositoryManager(context.workspaceState);
  rebase = new RebaseController(context);
  const contentProvider = new GitContentProvider((id) => manager?.get(id));
  const icons = new FileIconService();
  const journal = new OperationJournal(manager, context.workspaceState);
  const provider = new LogViewProvider(context.extensionUri, manager, rebase, contentProvider, icons, journal);
  const commitProvider = new LogViewProvider(context.extensionUri, manager, rebase, contentProvider, icons, journal, {
    viewId: 'gitraven.commitView',
    entry: 'commitView',
  });
  // Show History from the commit view must open the LOG panel, not itself.
  commitProvider.historySink = provider;

  context.subscriptions.push(
    manager,
    icons,
    journal,
    vscode.workspace.registerTextDocumentContentProvider(GITRAVEN_SCHEME, contentProvider),
    vscode.window.registerWebviewViewProvider(LogViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider('gitraven.commitView', commitProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    new BlameController(manager, provider),
  );

  registerCommands(context, manager, rebase, provider, contentProvider, journal);

  const updateContextKeys = () => {
    const repos = manager?.all ?? [];
    void vscode.commands.executeCommand('setContext', 'gitraven.hasRepository', repos.length > 0);
    void vscode.commands.executeCommand(
      'setContext',
      'gitraven.isRebasing',
      repos.some((r) => r.currentOperation === 'rebase'),
    );
  };
  context.subscriptions.push(manager.onDidChangeRepos(updateContextKeys));
  context.subscriptions.push(manager.onDidChangeRepoState(updateContextKeys));

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => void manager?.discover()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gitraven.gitPath')) resetGitPathCache();
      if (e.affectsConfiguration('gitraven.repositories')) void manager?.discover();
    }),
  );

  // The .git watcher only sees index/refs changes; edits to the working tree
  // (saves, file creates/deletes) must trigger a status refresh themselves.
  const statusTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const touchPath = (fsPath: string) => {
    // .git internals are covered by RepositoryWatcher; reacting here too would
    // double-refresh on every git operation.
    if (/[\/\\]\.git([\/\\]|$)/.test(fsPath)) return;
    const repo = (manager?.all ?? [])
      .filter((r) => fsPath.startsWith(r.root))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (!repo) return;
    clearTimeout(statusTimers.get(repo.id));
    statusTimers.set(
      repo.id,
      setTimeout(() => void manager?.handleRepoChange(repo.id, 'index').catch(() => undefined), 300),
    );
  };
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => touchPath(doc.uri.fsPath)),
    vscode.workspace.onDidCreateFiles((e) => e.files.forEach((u) => touchPath(u.fsPath))),
    vscode.workspace.onDidDeleteFiles((e) => e.files.forEach((u) => touchPath(u.fsPath))),
    vscode.workspace.onDidRenameFiles((e) => e.files.forEach((u) => touchPath(u.newUri.fsPath))),
  );

  // Workspace events above only fire for edits made through VS Code itself.
  // External writers (CLIs, build tools, agents) bypass them, so also watch
  // the working tree on disk; `files.watcherExclude` keeps the noise down and
  // touchPath debounces per repository.
  const treeWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    treeWatcher,
    treeWatcher.onDidChange((u) => touchPath(u.fsPath)),
    treeWatcher.onDidCreate((u) => touchPath(u.fsPath)),
    treeWatcher.onDidDelete((u) => touchPath(u.fsPath)),
  );

  try {
    await manager.discover();
  } catch (e) {
    log.error('initial discovery failed', e);
  }
}

export async function deactivate(): Promise<void> {
  await rebase?.disposeAll();
  manager?.dispose();
}
