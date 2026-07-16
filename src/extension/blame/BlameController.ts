import * as path from 'node:path';
import * as vscode from 'vscode';
import { debounce } from '../util/debounce';
import { DisposableStore } from '../util/disposable';
import { toGitErrorDTO } from '../git/GitError';
import { GitContentProvider, GITRAVEN_SCHEME } from '../diff/GitContentProvider';
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
  /** Repo-relative path of the annotated document, for the hover's command links. */
  rel: string;
  lines: BlameLine[];
}

const HOVER_COMMANDS = [
  'gitraven.blameShowDiff',
  'gitraven.blameCopyRevision',
  'gitraven.blameAnnotatePrevious',
];

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
    // Hover-link commands (not contributed to any menu or the palette).
    this.store.add(
      vscode.commands.registerCommand('gitraven.blameShowDiff', (repoId: string, sha: string, rel: string) =>
        this.showDiff(repoId, sha, rel),
      ),
    );
    this.store.add(
      vscode.commands.registerCommand('gitraven.blameCopyRevision', (sha: string) =>
        vscode.env.clipboard.writeText(sha),
      ),
    );
    this.store.add(
      vscode.commands.registerCommand('gitraven.blameAnnotatePrevious', (repoId: string, sha: string, rel: string) =>
        this.annotatePrevious(repoId, sha, rel),
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

  /** Repo, repo-relative path and (for `gitraven-git:` docs) the pinned revision to blame. */
  private targetFor(uri: vscode.Uri): { repo: Repository; rel: string; rev?: string } | undefined {
    if (uri.scheme === 'file') {
      const repo = this.repoFor(uri.fsPath);
      return repo ? { repo, rel: this.relPath(repo, uri) } : undefined;
    }
    const parsed = GitContentProvider.parseUri(uri);
    const repo = parsed && this.manager.get(parsed.repoId);
    return repo ? { repo, rel: parsed.path, rev: parsed.ref } : undefined;
  }

  private async annotate(uri?: vscode.Uri): Promise<void> {
    const editor = this.editorFor(uri);
    if (!editor) return;
    const scheme = editor.document.uri.scheme;
    if (scheme !== 'file' && scheme !== GITRAVEN_SCHEME) return;
    const target = this.targetFor(editor.document.uri);
    if (!target) {
      void vscode.window.showInformationMessage('GitRaven: file is not inside a discovered git repository.');
      return;
    }
    let lines: BlameLine[];
    try {
      lines = await target.repo.blame(target.rel, target.rev);
    } catch (e) {
      const dto = toGitErrorDTO(e);
      const message = /no such path/i.test(dto.stderr) ? 'File is not tracked by git.' : dto.message;
      void vscode.window.showErrorMessage(`GitRaven: ${message}`);
      return;
    }
    this.annotations.set(editor.document.uri.toString(), { repoId: target.repo.id, rel: target.rel, lines });
    this.lastRevealed = undefined;
    this.apply(editor);
    this.updateContext();
  }

  private async showDiff(repoId: string, sha: string, rel: string): Promise<void> {
    const left = GitContentProvider.makeUri(repoId, `${sha}^`, rel);
    const right = GitContentProvider.makeUri(repoId, sha, rel);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(rel)} (${sha.slice(0, 7)})`);
  }

  /** Open the file as it was just before `sha` and blame that revision. */
  private async annotatePrevious(repoId: string, sha: string, rel: string): Promise<void> {
    const repo = this.manager.get(repoId);
    if (!repo) return;
    // Pin the resolved parent sha (not `sha^`) so the tab and further hops are stable.
    const prev = await repo.resolveRevision(`${sha}^`);
    if (!prev) {
      void vscode.window.showInformationMessage(
        `GitRaven: ${sha.slice(0, 7)} is the first commit — there is no earlier revision to annotate.`,
      );
      return;
    }
    const editor = await vscode.window.showTextDocument(GitContentProvider.makeUri(repoId, prev, rel));
    await this.annotate(editor.document.uri);
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
      .map((l) => this.lineDecoration(l, nowSec, annotation));
    editor.setDecorations(this.decoration, options);
  }

  private lineDecoration(l: BlameLine, nowSec: number, annotation: FileAnnotation): vscode.DecorationOptions {
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
    const args = encodeURIComponent(JSON.stringify([annotation.repoId, l.sha, annotation.rel]));
    const shaArg = encodeURIComponent(JSON.stringify([l.sha]));
    const hover = new vscode.MarkdownString(
      `**${l.summary}**\n\n${l.authorName}, ${when}\n\n` +
        `\`${l.sha.slice(0, 7)}\` · ` +
        `[Show Diff](command:gitraven.blameShowDiff?${args} "Diff this commit's change to the file") · ` +
        `[Copy Revision](command:gitraven.blameCopyRevision?${shaArg} "Copy the full sha") · ` +
        `[Annotate Previous Revision](command:gitraven.blameAnnotatePrevious?${args} "Re-blame the file as it was before this commit")`,
    );
    hover.isTrusted = { enabledCommands: HOVER_COMMANDS };
    return {
      range,
      renderOptions: { before },
      hoverMessage: hover,
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
