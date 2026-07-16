import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { exec } from '../git/GitExecutor';
import { log } from '../util/logger';
import type { Repository } from '../git/Repository';
import type { OperationState, RebaseStep } from '../../shared/model';

interface RebaseSession {
  workDir: string;
  env: NodeJS.ProcessEnv;
}

function quote(p: string): string {
  return '"' + p.replace(/\\/g, '/') + '"';
}

export class RebaseController {
  private sessions = new Map<string, RebaseSession>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Commits in base..HEAD, oldest first (rebase todo order), as pick steps. */
  async buildSteps(repo: Repository, base: string): Promise<RebaseStep[]> {
    // %B (full message) is multi-line — records are separated by %x1e, not \n.
    const { stdout } = await exec(
      ['log', '--reverse', '--topo-order', '--format=%H\x1f%s\x1f%B\x1e', `${base}..HEAD`],
      { cwd: repo.root },
    );
    const steps: RebaseStep[] = [];
    let id = 0;
    for (const record of stdout.split('\x1e')) {
      const trimmed = record.replace(/^\n+/, '');
      if (!trimmed.trim()) continue;
      const [sha, subject, ...body] = trimmed.split('\x1f');
      steps.push({
        id: id++,
        sha,
        action: 'pick',
        subject: subject ?? '',
        original: body.join('\x1f').replace(/\n+$/, ''),
      });
    }
    return steps;
  }

  async run(repo: Repository, base: string, rawSteps: RebaseStep[]): Promise<OperationState | null> {
    const steps = sanitizeSteps(rawSteps);
    const workDir = await this.prepareWorkDir(repo);
    const planPath = path.join(workDir, 'plan.json');

    const planSteps = [];
    for (const step of steps) {
      const wantsMessage =
        (step.action === 'reword' || step.action === 'squash') && !!step.message && step.message.length > 0;
      if (wantsMessage) {
        await fs.writeFile(path.join(workDir, `msg-${step.id}.txt`), step.message ?? '', 'utf8');
      }
      planSteps.push({ id: step.id, sha: step.sha, action: step.action, hasMessage: wantsMessage });
    }
    await fs.writeFile(
      planPath,
      JSON.stringify({ steps: planSteps, execPrefix: this.execPrefix(), msgDir: workDir }),
      'utf8',
    );

    const env = this.buildEnv(planPath);
    this.sessions.set(repo.id, { workDir, env });

    return this.execRebase(repo, ['rebase', '-i', base], env);
  }

  /** `rebase -i --autosquash` accepting git's auto-arranged todo as-is —
   *  folds `fixup!`/`squash!` commits into their targets without a dialog. */
  async autosquash(repo: Repository, base: string): Promise<OperationState | null> {
    const node = process.execPath;
    const noop = `${quote(node)} ${quote(this.helper('noopEditor.cjs'))}`;
    const env: NodeJS.ProcessEnv = { GIT_SEQUENCE_EDITOR: noop, GIT_EDITOR: noop };
    // Register a session so continue/skip after a conflict reuse the noop editors.
    this.sessions.set(repo.id, { workDir: await this.prepareWorkDir(repo), env });
    return this.execRebase(repo, ['rebase', '-i', '--autosquash', base], env);
  }

  async continue(repo: Repository): Promise<OperationState | null> {
    const session = this.sessions.get(repo.id);
    const env = session?.env ?? this.buildEnv(undefined);
    return this.execRebase(repo, ['rebase', '--continue'], env);
  }

  async skip(repo: Repository): Promise<OperationState | null> {
    const session = this.sessions.get(repo.id);
    const env = session?.env ?? this.buildEnv(undefined);
    return this.execRebase(repo, ['rebase', '--skip'], env);
  }

  async abort(repo: Repository): Promise<OperationState | null> {
    try {
      await repo.runGit(['rebase', '--abort']);
    } finally {
      await this.cleanup(repo.id);
    }
    return null;
  }

  private async execRebase(repo: Repository, args: string[], env: NodeJS.ProcessEnv): Promise<OperationState | null> {
    try {
      await repo.runGit(args, env);
    } catch (e) {
      // A stop (conflict / `edit`) leaves the rebase in progress; that is not a
      // hard failure — surface the state. Anything else re-throws.
      const state = await this.getState(repo);
      if (state) return state;
      // Malformed/aborted start (e.g. git rejected the todo) can leave a rebase
      // dir with no parsable state; abort it so the repo isn't stranded.
      await repo.refreshState();
      if (repo.currentOperation === 'rebase') {
        await repo.runGit(['rebase', '--abort']).catch(() => undefined);
        await this.cleanup(repo.id);
      }
      throw e;
    }
    // Completed: no rebase state remains.
    await repo.refreshState();
    const state = await this.getState(repo);
    if (!state) await this.cleanup(repo.id);
    return state;
  }

  async getState(repo: Repository): Promise<OperationState | null> {
    const dir = path.join(repo.gitDir, 'rebase-merge');
    const read = async (name: string): Promise<string | undefined> => {
      try {
        return (await fs.readFile(path.join(dir, name), 'utf8')).trim();
      } catch {
        return undefined;
      }
    };
    const end = await read('end');
    if (end === undefined) return null; // not an interactive rebase in progress

    const current = Number((await read('msgnum')) ?? '0');
    const stoppedSha = await read('stopped-sha');

    let conflictedFiles: string[] = [];
    try {
      const { stdout } = await exec(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: repo.root });
      conflictedFiles = stdout.split('\0').filter((p) => p.length > 0);
    } catch {
      conflictedFiles = [];
    }

    const state: OperationState = {
      repoId: repo.id,
      operation: 'rebase',
      current,
      total: Number(end),
      conflictedFiles,
    };
    if (stoppedSha) state.stoppedSha = stoppedSha;
    return state;
  }

  private buildEnv(planPath: string | undefined): NodeJS.ProcessEnv {
    const node = process.execPath;
    const env: NodeJS.ProcessEnv = {
      GIT_SEQUENCE_EDITOR: `${quote(node)} ${quote(this.helper('sequenceEditor.cjs'))}`,
      GIT_EDITOR: `${quote(node)} ${quote(this.helper('noopEditor.cjs'))}`,
    };
    if (planPath) env.DETACHED_REBASE_PLAN = planPath;
    return env;
  }

  private execPrefix(): string {
    return `${quote(process.execPath)} ${quote(this.helper('messageEditor.cjs'))}`;
  }

  private helper(name: string): string {
    return path.join(this.context.extensionPath, 'dist', 'helpers', name);
  }

  private async prepareWorkDir(repo: Repository): Promise<string> {
    const base = this.context.storageUri ?? this.context.globalStorageUri;
    const workDir = path.join(base.fsPath, 'rebase', slug(repo.id));
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.mkdir(workDir, { recursive: true });
    return workDir;
  }

  private async cleanup(repoId: string): Promise<void> {
    const session = this.sessions.get(repoId);
    this.sessions.delete(repoId);
    if (session) {
      await fs.rm(session.workDir, { recursive: true, force: true }).catch((e) => log.warn(`cleanup failed: ${String(e)}`));
    }
  }

  async disposeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.cleanup(id);
  }
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
}

/**
 * A squash/fixup needs a preceding commit in the todo. If the first non-dropped
 * step is squash or fixup (git would reject the rebase), demote it to pick.
 */
function sanitizeSteps(steps: RebaseStep[]): RebaseStep[] {
  const firstKept = steps.find((s) => s.action !== 'drop');
  if (firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')) {
    return steps.map((s) => (s === firstKept ? { ...s, action: 'pick' } : s));
  }
  return steps;
}
