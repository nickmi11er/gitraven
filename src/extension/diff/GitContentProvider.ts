import * as vscode from 'vscode';
import type { Repository } from '../git/Repository';

export const GITRAVEN_SCHEME = 'gitraven-git';

interface UriPayload {
  repoId: string;
  ref: string;
}

/**
 * Serves file content at a git ref via the `gitraven-git:` scheme so the native
 * diff editor can render commit/staged versions. The path segment carries the
 * real file path so the editor picks the right language and title.
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly resolve: (repoId: string) => Repository | undefined) {}

  /** Force VS Code to re-query a virtual document (mutable refs like HEAD/:0). */
  invalidate(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  static makeUri(repoId: string, ref: string, filePath: string): vscode.Uri {
    const payload: UriPayload = { repoId, ref };
    return vscode.Uri.from({
      scheme: GITRAVEN_SCHEME,
      path: '/' + filePath,
      query: encodeURIComponent(JSON.stringify(payload)),
    });
  }

  static parseUri(uri: vscode.Uri): { repoId: string; ref: string; path: string } | undefined {
    if (uri.scheme !== GITRAVEN_SCHEME) return undefined;
    try {
      const { repoId, ref } = JSON.parse(decodeURIComponent(uri.query)) as UriPayload;
      return { repoId, ref, path: uri.path.replace(/^\//, '') };
    } catch {
      return undefined;
    }
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parsed = GitContentProvider.parseUri(uri);
    const repo = parsed && this.resolve(parsed.repoId);
    if (!parsed || !repo) return '';
    const content = await repo.getContentAt(parsed.ref, parsed.path);
    return content.toString('utf8');
  }
}
