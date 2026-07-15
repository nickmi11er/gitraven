import * as vscode from 'vscode';

/** Aggregates disposables and disposes them in reverse registration order. */
export class DisposableStore implements vscode.Disposable {
  private readonly items: vscode.Disposable[] = [];
  private disposed = false;

  add<T extends vscode.Disposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
    } else {
      this.items.push(item);
    }
    return item;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.items.length) {
      try {
        this.items.pop()?.dispose();
      } catch {
        // ignore disposal errors
      }
    }
  }
}
