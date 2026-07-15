import * as vscode from 'vscode';
import { initLogger, log } from './util/logger';
import { RepositoryManager } from './git/RepositoryManager';
import { RebaseController } from './rebase/RebaseController';
import { LogViewProvider } from './webview/LogViewProvider';
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
  const provider = new LogViewProvider(context.extensionUri, manager, rebase, contentProvider);

  context.subscriptions.push(
    manager,
    vscode.workspace.registerTextDocumentContentProvider(GITRAVEN_SCHEME, contentProvider),
    vscode.window.registerWebviewViewProvider(LogViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  registerCommands(context, manager, rebase, provider);

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
