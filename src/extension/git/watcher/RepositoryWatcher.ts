import * as vscode from 'vscode';
import { debounce } from '../../util/debounce';
import { DisposableStore } from '../../util/disposable';
import type { RepoChangeKind } from '../RepositoryManager';

/**
 * Watches a repository's git-dir internals and emits coarse, debounced change
 * kinds. HEAD/rebase state live in the per-worktree git-dir; refs live in the
 * common dir (shared across linked worktrees), so both are watched.
 */
export class RepositoryWatcher implements vscode.Disposable {
  private readonly store = new DisposableStore();

  constructor(
    gitDir: string,
    commonDir: string,
    onChange: (kind: RepoChangeKind) => void,
  ) {
    const fire = (kind: RepoChangeKind) => debounce(() => onChange(kind), 250);
    const head = fire('head');
    const refs = fire('refs');
    const index = fire('index');
    const operation = fire('operation');

    this.watch(gitDir, 'HEAD', head);
    this.watch(gitDir, 'index', index);
    this.watch(gitDir, 'ORIG_HEAD', head);
    this.watch(gitDir, 'MERGE_HEAD', operation);
    this.watch(gitDir, 'CHERRY_PICK_HEAD', operation);
    this.watch(gitDir, 'REVERT_HEAD', operation);
    this.watch(gitDir, 'rebase-merge/**', operation);
    this.watch(gitDir, 'rebase-apply/**', operation);
    this.watch(commonDir, 'refs/**', refs);
    this.watch(commonDir, 'packed-refs', refs);

    this.store.add({ dispose: () => [head, refs, index, operation].forEach((d) => d.cancel()) });
  }

  private watch(base: string, glob: string, handler: () => void): void {
    const watcher = this.store.add(
      vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), glob)),
    );
    const onEvent = (uri: vscode.Uri) => {
      if (uri.fsPath.endsWith('.lock')) return; // ignore transient lock churn
      handler();
    };
    this.store.add(watcher.onDidChange(onEvent));
    this.store.add(watcher.onDidCreate(onEvent));
    this.store.add(watcher.onDidDelete(onEvent));
  }

  dispose(): void {
    this.store.dispose();
  }
}
