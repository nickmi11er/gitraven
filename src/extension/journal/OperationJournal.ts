import * as vscode from 'vscode';
import { DisposableStore } from '../util/disposable';
import { toGitErrorDTO } from '../git/GitError';
import type { RepositoryManager } from '../git/RepositoryManager';
import type { Repository } from '../git/Repository';

const STORAGE_KEY = 'gitraven.journal';
const MAX_ENTRIES = 50;

export interface JournalEntry {
  id: string;
  repoId: string;
  label: string;
  at: number;
  /** Branch checked out when the operation started; absent = detached HEAD. */
  branch?: string;
  /** HEAD sha before the operation ran. */
  preSha: string;
  /** HEAD sha once the operation (incl. conflict resolution) finished. */
  postSha?: string;
  /** Offer an Undo toast when the operation completes. */
  notify?: boolean;
}

/**
 * The raven remembers: every scary operation GitRaven runs is journaled with
 * the pre-op HEAD so it can be undone with one click (`git reset --keep`,
 * which carries uncommitted changes along and aborts rather than clobber
 * them). Entries persist in workspace state across reloads.
 */
export class OperationJournal implements vscode.Disposable {
  private readonly store = new DisposableStore();
  private entries: JournalEntry[];
  private seq = 0;

  constructor(
    private readonly manager: RepositoryManager,
    private readonly memento: vscode.Memento,
  ) {
    this.entries = memento.get<JournalEntry[]>(STORAGE_KEY, []);
    // Ops that end in conflicts complete only when the sequencer finishes —
    // watch repo state and stamp the post-op sha once the repo is quiet again.
    this.store.add(
      this.manager.onDidChangeRepoState(({ repoId }) => void this.completePending(repoId)),
    );
  }

  dispose(): void {
    this.store.dispose();
  }

  /** Journal a mutating operation: capture pre-op HEAD, run it, arm completion. */
  async record<T>(repo: Repository, label: string, fn: () => Promise<T>, opts?: { notify?: boolean }): Promise<T> {
    const pre = await repo.freshHead();
    if (!pre.sha) return fn(); // unborn branch — nothing to restore to
    const entry: JournalEntry = {
      id: `${Date.now().toString(36)}-${this.seq++}`,
      repoId: repo.id,
      label,
      at: Date.now(),
      preSha: pre.sha,
    };
    if (pre.branch) entry.branch = pre.branch;
    if (opts?.notify) entry.notify = true;
    this.entries.unshift(entry);
    this.trimAndSave();
    try {
      const result = await fn();
      await this.completePending(repo.id);
      return result;
    } catch (e) {
      // A failed op that moved nothing (bad ref, refused merge) isn't undoable
      // history — drop it. A conflicted one left a sequencer running: keep it.
      // The error kind is checked (not just currentOperation) because the
      // watcher refreshes operation state asynchronously and may still be stale.
      const now = await repo.freshHead();
      if (toGitErrorDTO(e).kind !== 'conflict' && repo.currentOperation === 'none' && now.sha === pre.sha) {
        this.entries = this.entries.filter((x) => x.id !== entry.id);
        this.trimAndSave();
      }
      throw e;
    }
  }

  /** Stamp post-op shas for a repo's unfinished entries once it has no operation running. */
  private async completePending(repoId: string): Promise<void> {
    const repo = this.manager.get(repoId);
    if (!repo || repo.currentOperation !== 'none') return;
    const pending = this.entries.filter((x) => x.repoId === repoId && x.postSha === undefined);
    if (pending.length === 0) return;
    const { sha } = await repo.freshHead();
    if (!sha) return;
    for (const entry of pending) {
      entry.postSha = sha;
      if (entry.notify) {
        delete entry.notify;
        void vscode.window
          .showInformationMessage(`GitRaven: ${entry.label} — done.`, 'Undo')
          .then((pick) => (pick === 'Undo' ? this.undo(entry.id) : undefined));
      }
    }
    this.trimAndSave();
  }

  /** Newest journal entry, optionally per repo. */
  latest(repoId?: string): JournalEntry | undefined {
    return this.entries.find((x) => (repoId ? x.repoId === repoId : true) && this.manager.get(x.repoId));
  }

  /** Undo the newest operation (asks for confirmation). */
  async undoLast(): Promise<void> {
    const entry = this.latest();
    if (!entry) {
      void vscode.window.showInformationMessage('GitRaven: the operation journal is empty.');
      return;
    }
    await this.undo(entry.id);
  }

  /** Show the journal as a QuickPick; picking an entry offers to undo it. */
  async show(): Promise<void> {
    const items = this.entries
      .filter((x) => this.manager.get(x.repoId))
      .map((x) => {
        const repo = this.manager.get(x.repoId)!;
        return {
          label: `$(discard) ${x.label}`,
          description: `${repo.name} · ${x.branch ?? 'detached'} · ${timeAgo(x.at)}`,
          detail: `${x.preSha.slice(0, 7)} → ${x.postSha?.slice(0, 7) ?? '(in progress)'} — pick to undo`,
          id: x.id,
        };
      });
    if (items.length === 0) {
      void vscode.window.showInformationMessage('GitRaven: the operation journal is empty.');
      return;
    }
    const pick = await vscode.window.showQuickPick(items, {
      title: 'Git Operation Journal',
      placeHolder: 'Undoing restores the branch tip from before the operation',
    });
    if (pick) await this.undo(pick.id);
  }

  /** Restore the pre-op branch tip for an entry, after a confirmation modal. */
  async undo(id: string): Promise<void> {
    const entry = this.entries.find((x) => x.id === id);
    if (!entry) return;
    const repo = this.manager.get(entry.repoId);
    if (!repo) {
      void vscode.window.showInformationMessage('GitRaven: the repository is no longer open.');
      return;
    }
    if (repo.currentOperation !== 'none') {
      void vscode.window.showInformationMessage(
        `GitRaven: a ${repo.currentOperation} is in progress — finish or abort it first.`,
      );
      return;
    }
    const now = await repo.freshHead();
    if (entry.branch && now.branch !== entry.branch) {
      void vscode.window.showInformationMessage(
        `GitRaven: "${entry.label}" ran on branch '${entry.branch}' — check it out to undo.`,
      );
      return;
    }
    if (now.sha === entry.preSha) {
      this.remove(entry, false);
      void vscode.window.showInformationMessage('GitRaven: already at the state before this operation.');
      return;
    }
    const target = entry.branch ? `branch '${entry.branch}'` : 'detached HEAD';
    const moved =
      entry.postSha !== undefined && entry.postSha !== now.sha
        ? `\n\nHistory has changed since this operation (expected ${entry.postSha.slice(0, 7)}, ` +
          `now ${now.sha.slice(0, 7)}) — commits made after it will be dropped from the branch tip.`
        : '';
    const ok = await vscode.window.showWarningMessage(
      `Undo "${entry.label}"?`,
      {
        modal: true,
        detail:
          `Moves ${target} from ${now.sha.slice(0, 7)} back to ${entry.preSha.slice(0, 7)}. ` +
          `Uncommitted changes are kept.${moved}`,
      },
      'Undo',
    );
    if (ok !== 'Undo') return;
    await repo.resetKeep(entry.preSha);
    this.remove(entry, true);
    vscode.window.setStatusBarMessage(`GitRaven: undid ${entry.label}`, 5000);
    void this.manager.handleRepoChange(entry.repoId, 'head');
  }

  /** Drop an entry — and, after an undo, the now-invalid newer ones of that repo. */
  private remove(entry: JournalEntry, alsoNewer: boolean): void {
    this.entries = this.entries.filter(
      (x) => x.id !== entry.id && !(alsoNewer && x.repoId === entry.repoId && x.at > entry.at),
    );
    this.trimAndSave();
  }

  private trimAndSave(): void {
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
    void this.memento.update(STORAGE_KEY, this.entries);
  }
}

function timeAgo(epochMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
