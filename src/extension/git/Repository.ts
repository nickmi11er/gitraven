import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { exec, execBuffer, streamRecords } from './GitExecutor';
import { LOG_FORMAT, REF_FORMAT, RS } from './parsers/formats';
import { parseCommitRecord } from './parsers/logParser';
import { parseRefs } from './parsers/refParser';
import { parseStatus } from './parsers/statusParser';
import { mergeCommitFiles } from './parsers/numstatParser';
import type {
  Commit,
  CommitDetails,
  FilterOptions,
  HeadState,
  LogFilters,
  Ref,
  Remote,
  RepoInfo,
  RepoOperation,
  RepoStatus,
} from '../../shared/model';

export class Repository {
  head: HeadState = { sha: '', detached: false };
  refs: Ref[] = [];
  remotes: Remote[] = [];
  currentOperation: RepoOperation = 'none';
  userName?: string;
  userEmail?: string;

  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly id: string,
    readonly root: string,
    readonly gitDir: string,
    readonly commonDir: string,
    readonly isSubmodule: boolean,
  ) {}

  static async open(root: string, isSubmodule = false): Promise<Repository> {
    const { stdout } = await exec(
      ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
      { cwd: root },
    );
    const [toplevel, gitDir, commonDirRaw] = stdout.trim().split('\n');
    const commonDir = path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(toplevel, commonDirRaw);
    const id = toplevel;
    const repo = new Repository(id, toplevel, gitDir, commonDir, isSubmodule);
    await repo.refreshState();
    return repo;
  }

  get name(): string {
    return path.basename(this.root);
  }

  toInfo(): RepoInfo {
    return {
      id: this.id,
      root: this.root,
      name: this.name,
      head: this.head,
      currentOperation: this.currentOperation,
      isSubmodule: this.isSubmodule,
    };
  }

  /** Serialize mutating operations to avoid `index.lock` collisions. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private cwd(): { cwd: string } {
    return { cwd: this.root };
  }

  async refreshState(): Promise<void> {
    await Promise.all([
      this.refreshHead(),
      this.refreshRefs(),
      this.refreshRemotes(),
      this.refreshOperation(),
      this.refreshIdentity(),
    ]);
  }

  private async refreshIdentity(): Promise<void> {
    const read = async (key: string): Promise<string | undefined> => {
      try {
        return (await exec(['config', '--get', key], this.cwd())).stdout.trim() || undefined;
      } catch {
        return undefined;
      }
    };
    this.userName = await read('user.name');
    this.userEmail = await read('user.email');
  }

  private async refreshHead(): Promise<void> {
    let branch: string | undefined;
    try {
      const r = await exec(['symbolic-ref', '--short', '-q', 'HEAD'], this.cwd());
      branch = r.stdout.trim() || undefined;
    } catch {
      branch = undefined;
    }
    let sha = '';
    try {
      sha = (await exec(['rev-parse', 'HEAD'], this.cwd())).stdout.trim();
    } catch {
      sha = ''; // unborn branch
    }
    this.head = { sha, detached: !branch && sha !== '' };
    if (branch) this.head.branch = branch;
  }

  private async refreshRefs(): Promise<void> {
    const { stdout } = await exec(
      ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'],
      this.cwd(),
    );
    this.refs = parseRefs(stdout);
  }

  private async refreshRemotes(): Promise<void> {
    const { stdout } = await exec(['remote', '-v'], this.cwd());
    const map = new Map<string, Remote>();
    for (const line of stdout.split('\n')) {
      const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
      if (!m) continue;
      const remote = map.get(m[1]) ?? { name: m[1], fetchUrl: '', pushUrl: '' };
      if (m[3] === 'fetch') remote.fetchUrl = m[2];
      else remote.pushUrl = m[2];
      map.set(m[1], remote);
    }
    this.remotes = [...map.values()];
  }

  private async refreshOperation(): Promise<void> {
    const has = async (rel: string) => {
      try {
        await fs.access(path.join(this.gitDir, rel));
        return true;
      } catch {
        return false;
      }
    };
    if ((await has('rebase-merge')) || (await has('rebase-apply'))) this.currentOperation = 'rebase';
    else if (await has('MERGE_HEAD')) this.currentOperation = 'merge';
    else if (await has('CHERRY_PICK_HEAD')) this.currentOperation = 'cherry-pick';
    else if (await has('REVERT_HEAD')) this.currentOperation = 'revert';
    else this.currentOperation = 'none';
  }

  refsBySha(): Map<string, Ref[]> {
    const map = new Map<string, Ref[]>();
    for (const ref of this.refs) {
      const arr = map.get(ref.targetSha) ?? [];
      arr.push(ref);
      map.set(ref.targetSha, arr);
    }
    return map;
  }

  async getLog(filters: LogFilters | undefined, limit: number, skip: number, token?: vscode.CancellationToken): Promise<Commit[]> {
    const query = filters?.query?.trim();
    if (query && /^[0-9a-f]{4,40}$/i.test(query)) {
      return this.logByHash(query);
    }

    const args = ['log', '--topo-order', '--date-order', `--pretty=format:${LOG_FORMAT}`, `--max-count=${limit}`];
    if (skip > 0) args.push(`--skip=${skip}`);
    args.push(filters?.branch ? filters.branch : '--all');
    for (const raw of filters?.authors ?? []) {
      const author = raw === '@me' ? this.userEmail ?? this.userName : raw;
      if (author) args.push(`--author=${author}`);
    }
    if (filters?.since) args.push(`--since=${filters.since}`);
    if (filters?.until) args.push(`--until=${filters.until}`);
    if (query) args.push(`--grep=${query}`, '--regexp-ignore-case');

    const commits: Commit[] = [];
    const opts = token ? { ...this.cwd(), token } : this.cwd();
    try {
      for await (const record of streamRecords(args, opts, RS)) {
        const c = parseCommitRecord(record);
        if (c) commits.push(c);
      }
    } catch (e) {
      // A repo with no commits yet (unborn HEAD) makes `git log` fail; treat as empty.
      if (this.head.sha === '') return [];
      throw e;
    }
    return commits;
  }

  /** Resolve a (possibly abbreviated) hash to its single commit, or nothing. */
  private async logByHash(prefix: string): Promise<Commit[]> {
    let full: string;
    try {
      full = (await exec(['rev-parse', '--verify', '--quiet', `${prefix}^{commit}`], this.cwd())).stdout.trim();
    } catch {
      return []; // not found / ambiguous
    }
    if (!full) return [];
    const { stdout } = await exec(['log', '-1', `--pretty=format:${LOG_FORMAT}`, full], this.cwd());
    const c = parseCommitRecord(stdout);
    return c ? [c] : [];
  }

  async getFilterOptions(): Promise<FilterOptions> {
    const branches = this.refs
      .filter((r) => (r.kind === 'head' || r.kind === 'remote') && !r.name.endsWith('/HEAD'))
      .map((r) => ({ name: r.name, kind: r.kind as 'head' | 'remote' }));

    const authors: { name: string; email: string }[] = [];
    try {
      const { stdout } = await exec(
        ['log', '--all', '--no-merges', '--format=%aN\x1f%aE', '--max-count=2000'],
        this.cwd(),
      );
      const seen = new Set<string>();
      for (const line of stdout.split('\n')) {
        if (!line) continue;
        const [name, email] = line.split('\x1f');
        if (email && !seen.has(email)) {
          seen.add(email);
          authors.push({ name, email });
        }
      }
    } catch {
      // no commits yet — leave authors empty
    }
    authors.sort((a, b) => a.name.localeCompare(b.name));

    const options: FilterOptions = { branches, authors };
    if (this.userEmail) options.me = { name: this.userName ?? this.userEmail, email: this.userEmail };
    return options;
  }

  async getCommitDetails(sha: string): Promise<CommitDetails> {
    const { stdout: logOut } = await exec(
      ['log', '-1', '--topo-order', `--pretty=format:${LOG_FORMAT}`, sha],
      this.cwd(),
    );
    const commit = parseCommitRecord(logOut);
    if (!commit) throw new Error(`Commit ${sha} not found`);

    // --root makes diff-tree emit the added files of a parentless (initial) commit.
    const diffArgs = ['diff-tree', '--no-commit-id', '-r', '-m', '--first-parent', '--root', '-z'];
    const nameStatus = (await exec([...diffArgs, '--name-status', sha], this.cwd())).stdout;
    const numstat = (await exec([...diffArgs, '--numstat', sha], this.cwd())).stdout;
    return { commit, files: mergeCommitFiles({ nameStatus, numstat }) };
  }

  async getStatus(): Promise<RepoStatus> {
    // --no-optional-locks stops `status` from rewriting the index's stat cache,
    // which would otherwise retrigger the index watcher in a refresh loop.
    const { stdout } = await exec(
      ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch'],
      this.cwd(),
    );
    return parseStatus(this.id, stdout);
  }

  /** Content of a path at a ref (`git show ref:path`). Empty buffer if absent. */
  async getContentAt(ref: string, filePath: string): Promise<Buffer> {
    try {
      return await execBuffer(['show', `${ref}:${filePath}`], this.cwd());
    } catch {
      return Buffer.alloc(0);
    }
  }

  // ---- mutating operations (serialized) ----

  stage(paths: string[]): Promise<void> {
    return this.run(async () => {
      await exec(['add', '--', ...paths], this.cwd());
    });
  }

  unstage(paths: string[]): Promise<void> {
    return this.run(async () => {
      await exec(['reset', '-q', 'HEAD', '--', ...paths], this.cwd());
    });
  }

  discard(paths: string[]): Promise<void> {
    return this.run(async () => {
      await exec(['checkout', '--', ...paths], this.cwd());
    });
  }

  commit(message: string, amend: boolean): Promise<void> {
    return this.run(async () => {
      const args = ['commit', '-m', message];
      if (amend) args.push('--amend');
      await exec(args, this.cwd());
    });
  }

  checkout(ref: string, create = false, startPoint?: string): Promise<void> {
    return this.run(async () => {
      const args = ['checkout'];
      if (create) args.push('-b');
      args.push(ref);
      if (startPoint) args.push(startPoint);
      await exec(args, this.cwd());
    });
  }

  createBranch(name: string, startPoint: string | undefined, checkout: boolean): Promise<void> {
    return this.run(async () => {
      if (checkout) {
        const args = ['checkout', '-b', name];
        if (startPoint) args.push(startPoint);
        await exec(args, this.cwd());
      } else {
        const args = ['branch', name];
        if (startPoint) args.push(startPoint);
        await exec(args, this.cwd());
      }
    });
  }

  deleteBranch(name: string, force: boolean): Promise<void> {
    return this.run(async () => {
      await exec(['branch', force ? '-D' : '-d', name], this.cwd());
    });
  }

  renameBranch(oldName: string, newName: string): Promise<void> {
    return this.run(async () => {
      await exec(['branch', '-m', oldName, newName], this.cwd());
    });
  }

  merge(ref: string): Promise<void> {
    return this.run(async () => {
      await exec(['merge', ref], this.cwd());
    });
  }

  cherryPick(sha: string): Promise<void> {
    return this.run(async () => {
      await exec(['cherry-pick', sha], this.cwd());
    });
  }

  revert(sha: string): Promise<void> {
    return this.run(async () => {
      await exec(['revert', '--no-edit', sha], this.cwd());
    });
  }

  createTag(name: string, sha: string, message?: string): Promise<void> {
    return this.run(async () => {
      const args = message ? ['tag', '-m', message, name, sha] : ['tag', name, sha];
      await exec(args, this.cwd());
    });
  }

  reset(mode: 'soft' | 'mixed' | 'hard', sha: string): Promise<void> {
    return this.run(async () => {
      await exec(['reset', `--${mode}`, sha], this.cwd());
    });
  }

  rebase(upstream: string): Promise<void> {
    return this.run(async () => {
      await exec(['rebase', upstream], this.cwd());
    });
  }

  private remoteEnv(): NodeJS.ProcessEnv {
    return { GIT_TERMINAL_PROMPT: '0' };
  }

  fetch(remote: string | undefined, prune: boolean): Promise<void> {
    return this.run(async () => {
      const args = ['fetch'];
      if (prune) args.push('--prune');
      args.push(remote ?? '--all');
      await exec(args, { ...this.cwd(), env: this.remoteEnv() });
    });
  }

  pull(rebase: boolean): Promise<void> {
    return this.run(async () => {
      const args = ['pull'];
      if (rebase) args.push('--rebase');
      await exec(args, { ...this.cwd(), env: this.remoteEnv() });
    });
  }

  push(opts: { remote?: string; branch?: string; force?: boolean; setUpstream?: boolean }): Promise<void> {
    return this.run(async () => {
      const args = ['push'];
      if (opts.force) args.push('--force-with-lease');
      if (opts.setUpstream) args.push('--set-upstream');
      if (opts.remote) args.push(opts.remote);
      if (opts.branch) args.push(opts.branch);
      await exec(args, { ...this.cwd(), env: this.remoteEnv() });
    });
  }

  /** Run an arbitrary git command in this repo (used by the rebase controller). */
  runGit(args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
    return this.run(async () => {
      await exec(args, env ? { ...this.cwd(), env } : this.cwd());
    });
  }
}
