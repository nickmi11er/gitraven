import * as path from 'node:path';
import * as vscode from 'vscode';
import { debounce } from '../util/debounce';
import { DisposableStore } from '../util/disposable';
import { toGitErrorDTO } from '../git/GitError';
import type { RepositoryManager } from '../git/RepositoryManager';
import type { LogViewProvider } from '../webview/LogViewProvider';
import type { Repository } from '../git/Repository';
import type { BlameLine } from '../../shared/model';

const ZERO_SHA = '0'.repeat(40);

const DATE_WIDTH = 10; // YYYY-MM-DD
const AUTHOR_WIDTH = 10;
const COLUMN_WIDTH = DATE_WIDTH + 1 + AUTHOR_WIDTH;

/** Age → background alpha for the heatmap tint; older than a year gets none. */
const HEAT_BUCKETS: { maxAgeSec: number; alpha: number }[] = [
  { maxAgeSec: 7 * 86400, alpha: 0.24 },
  { maxAgeSec: 30 * 86400, alpha: 0.18 },
  { maxAgeSec: 90 * 86400, alpha: 0.12 },
  { maxAgeSec: 365 * 86400, alpha: 0.06 },
];

interface FileAnnotation {
  repoId: string;
  lines: BlameLine[];
}

/**
 * Editor blame annotations: a per-line author/date/sha column rendered as a
 * `before` decoration, toggled from the gutter context menu. While active,
 * placing the caret on a line reveals that line's commit in the log panel.
 */
export class BlameController implements vscode.Disposable {
  private readonly store = new DisposableStore();
  private readonly annotations = new Map<string, FileAnnotation>();
  private readonly decoration: vscode.TextEditorDecorationType;
  private lastRevealed?: string;

  private readonly revealDebounced = debounce(
    (editor: vscode.TextEditor) => this.revealCaretCommit(editor),
    150,
  );

  constructor(
    private readonly manager: RepositoryManager,
    private readonly logProvider: LogViewProvider,
  ) {
    this.decoration = this.store.add(
      vscode.window.createTextEditorDecorationType({
        before: {
          color: new vscode.ThemeColor('editorLineNumber.foreground'),
          // Full line height + a -1px seam so adjacent same-color heatmap
          // tints merge into one solid block instead of striping.
          height: '100%',
          margin: '0 1.5em -1px 0',
        },
      }),
    );

    this.store.add(
      vscode.commands.registerCommand('gitraven.annotateWithBlame', (arg?: { uri?: vscode.Uri }) =>
        this.annotate(arg?.uri),
      ),
    );
    this.store.add(
      vscode.commands.registerCommand('gitraven.clearBlame', (arg?: { uri?: vscode.Uri }) =>
        this.clear(arg?.uri),
      ),
    );

    this.store.add(vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()));
    this.store.add(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) this.apply(editor);
      }),
    );
    this.store.add(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.annotations.delete(doc.uri.toString());
        this.updateContext();
      }),
    );
    this.store.add(vscode.workspace.onDidSaveTextDocument((doc) => void this.refresh(doc)));
    this.store.add(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (this.annotations.has(e.textEditor.document.uri.toString())) this.revealDebounced(e.textEditor);
      }),
    );
  }

  dispose(): void {
    this.revealDebounced.cancel();
    this.store.dispose();
  }

  private async annotate(uri?: vscode.Uri): Promise<void> {
    const editor = this.editorFor(uri);
    if (!editor || editor.document.uri.scheme !== 'file') return;
    const repo = this.repoFor(editor.document.uri.fsPath);
    if (!repo) {
      void vscode.window.showInformationMessage('GitRaven: file is not inside a discovered git repository.');
      return;
    }
    let lines: BlameLine[];
    try {
      lines = await repo.blame(this.relPath(repo, editor.document.uri));
    } catch (e) {
      const dto = toGitErrorDTO(e);
      const message = /no such path/i.test(dto.stderr) ? 'File is not tracked by git.' : dto.message;
      void vscode.window.showErrorMessage(`GitRaven: ${message}`);
      return;
    }
    this.annotations.set(editor.document.uri.toString(), { repoId: repo.id, lines });
    this.lastRevealed = undefined;
    this.apply(editor);
    this.updateContext();
  }

  private clear(uri?: vscode.Uri): void {
    const target = (uri ?? vscode.window.activeTextEditor?.document.uri)?.toString();
    if (!target) return;
    this.annotations.delete(target);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === target) editor.setDecorations(this.decoration, []);
    }
    this.updateContext();
  }

  private async refresh(doc: vscode.TextDocument): Promise<void> {
    const key = doc.uri.toString();
    const annotation = this.annotations.get(key);
    if (!annotation) return;
    const repo = this.manager.get(annotation.repoId);
    if (!repo) {
      this.clear(doc.uri);
      return;
    }
    try {
      annotation.lines = await repo.blame(this.relPath(repo, doc.uri));
    } catch {
      return; // e.g. the file left the index; keep the last good annotations
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === key) this.apply(editor);
    }
  }

  private apply(editor: vscode.TextEditor): void {
    const annotation = this.annotations.get(editor.document.uri.toString());
    if (!annotation) return;
    const nowSec = Date.now() / 1000;
    const options = annotation.lines
      .filter((l) => l.line <= editor.document.lineCount)
      .map((l) => this.lineDecoration(l, nowSec));
    editor.setDecorations(this.decoration, options);
  }

  private lineDecoration(l: BlameLine, nowSec: number): vscode.DecorationOptions {
    const range = new vscode.Range(l.line - 1, 0, l.line - 1, 0);
    if (l.sha === ZERO_SHA) {
      return {
        range,
        renderOptions: { before: { contentText: nbsp('Uncommitted'.padEnd(COLUMN_WIDTH)) } },
        hoverMessage: new vscode.MarkdownString('Uncommitted changes'),
      };
    }
    const author = clamp(l.authorName, AUTHOR_WIDTH).padEnd(AUTHOR_WIDTH);
    const before: vscode.ThemableDecorationAttachmentRenderOptions = {
      contentText: nbsp(`${isoDate(l.authorTime)} ${author}`),
    };
    const alpha = HEAT_BUCKETS.find((b) => nowSec - l.authorTime < b.maxAgeSec)?.alpha;
    if (alpha) before.backgroundColor = `rgba(255, 140, 66, ${alpha})`;
    const when = new Date(l.authorTime * 1000).toLocaleString();
    return {
      range,
      renderOptions: { before },
      hoverMessage: new vscode.MarkdownString(
        `**${l.summary}**\n\n${l.authorName}, ${when}\n\n\`${l.sha.slice(0, 7)}\``,
      ),
    };
  }

  private revealCaretCommit(editor: vscode.TextEditor): void {
    const annotation = this.annotations.get(editor.document.uri.toString());
    if (!annotation) return;
    const line = editor.selection.active.line + 1;
    const entry = annotation.lines.find((l) => l.line === line);
    if (!entry || entry.sha === ZERO_SHA) return;
    const key = `${annotation.repoId} ${entry.sha}`;
    if (key === this.lastRevealed) return; // caret is still inside the same commit's lines
    this.lastRevealed = key;
    this.logProvider.reveal(true);
    this.logProvider.post({ type: 'event', kind: 'revealCommit', repoId: annotation.repoId, sha: entry.sha });
  }

  private editorFor(uri?: vscode.Uri): vscode.TextEditor | undefined {
    if (!uri) return vscode.window.activeTextEditor;
    return vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
  }

  private repoFor(fsPath: string): Repository | undefined {
    return this.manager.all
      .filter((r) => fsPath.startsWith(r.root + path.sep))
      .sort((a, b) => b.root.length - a.root.length)[0];
  }

  private relPath(repo: Repository, uri: vscode.Uri): string {
    return path.relative(repo.root, uri.fsPath).split(path.sep).join('/');
  }

  private updateContext(): void {
    const uri = vscode.window.activeTextEditor?.document.uri.toString();
    void vscode.commands.executeCommand(
      'setContext',
      'gitraven.blameActive',
      uri !== undefined && this.annotations.has(uri),
    );
  }
}

function clamp(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Padding spaces collapse in the decoration's CSS `content`; nbsp does not. */
function nbsp(s: string): string {
  return s.replace(/ /g, '\u00a0');
}

/** Local-time YYYY-MM-DD (toISOString would shift the date near midnight). */
function isoDate(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
