import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { exec, execBuffer, streamRecords } from './GitExecutor';
import { LOG_FORMAT, REF_FORMAT, RS } from './parsers/formats';
import { parseCommitRecord } from './parsers/logParser';
import { parseRefs } from './parsers/refParser';
import { parseStatus } from './parsers/statusParser';
import { mergeCommitFiles } from './parsers/numstatParser';
import { parseBlame } from './parsers/blameParser';
import type {
  BlameLine,
  Commit,
  FileChange,
  CommitDetails,
  FilterOptions,
  HeadState,
  LogFilters,
  Ref,
  Remote,
  RepoInfo,
  RepoOperation,
  RepoStatus,
  StashEntry,
} from '../../shared/model';

export interface ReflogEntry {
  sha: string;
  /** Reflog selector, e.g. `HEAD@{3}`. */
  selector: string;
  /** Reflog subject, e.g. `rebase (finish): returning to refs/heads/main`. */
  subject: string;
}

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

  async getLog(
    filters: LogFilters | undefined,
    limit: number,
    token?: vscode.CancellationToken,
    skip = 0,
  ): Promise<Commit[]> {
    const query = filters?.query?.trim();
    // A hex string could be a legit pickaxe term — only shortcut in message mode.
    if (query && !filters?.searchInChanges && /^[0-9a-f]{4,40}$/i.test(query)) {
      return this.logByHash(query);
    }

    // Line-range tracing and path entries are repo-scoped; a filter that names
    // only other repos means "nothing from this one".
    const lineRange = filters?.lineRange;
    if (lineRange && lineRange.repoId !== this.id) return [];
    const paths = filters?.paths?.filter((p) => p.repoId === this.id).map((p) => p.path);
    if (!lineRange && filters?.paths?.length && paths?.length === 0) return [];

    const args = ['log', `--pretty=format:${LOG_FORMAT}`, `--max-count=${limit}`];
    if (skip > 0) args.push(`--skip=${skip}`);
    if (lineRange) {
      // -L rejects ordinary pathspecs and rev walking flags vary; keep it lean.
      // --no-patch suppresses the diffs -L forces (git >= 2.42; on older gits the
      // patch text bleeds into the stream and is stripped per record below).
      args.push(`-L${lineRange.start},${lineRange.end}:${lineRange.path}`, '--no-patch');
      args.push(filters?.branch ? filters.branch : 'HEAD');
    } else {
      args.push('--topo-order', '--date-order');
      args.push(filters?.branch ? filters.branch : '--all');
    }
    for (const raw of filters?.authors ?? []) {
      const author = raw === '@me' ? this.userEmail ?? this.userName : raw;
      if (author) args.push(`--author=${author}`);
    }
    if (filters?.since) args.push(`--since=${filters.since}`);
    if (filters?.until) args.push(`--until=${filters.until}`);
    if (query) {
      if (filters?.searchInChanges && !lineRange) args.push(`-S${query}`);
      else args.push(`--grep=${query}`, '--regexp-ignore-case');
    }
    if (!lineRange && paths?.length) args.push('--', ...paths);

    const commits: Commit[] = [];
    const opts = token ? { ...this.cwd(), token } : this.cwd();
    try {
      for await (const record of streamRecords(args, opts, RS)) {
        // Patch text leaked by -L (pre-2.42 git) trails the record separator, so
        // it lands at the HEAD of the next record — cut everything before the sha.
        const cleaned = lineRange ? record.replace(/^[\s\S]*?(?=^[0-9a-f]{40}\x1f)/m, '') : record;
        const c = parseCommitRecord(cleaned);
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

  /** Files changed between two commits (`git diff from to`), with add/del counts. */
  async getRangeDetails(from: string, to: string): Promise<FileChange[]> {
    const diffArgs = ['diff', '-z'];
    const nameStatus = (await exec([...diffArgs, '--name-status', from, to], this.cwd())).stdout;
    const numstat = (await exec([...diffArgs, '--numstat', from, to], this.cwd())).stdout;
    return mergeCommitFiles({ nameStatus, numstat });
  }

  async getStatus(): Promise<RepoStatus> {
    // --no-optional-locks stops `status` from rewriting the index's stat cache,
    // which would otherwise retrigger the index watcher in a refresh loop.
    const query = () =>
      // -uall expands untracked directories into individual files (default git
      // collapses a new directory to a single `dir/` entry).
      exec(['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], this.cwd());
    let status = parseStatus(this.id, (await query()).stdout);
    // --no-optional-locks means `status` can't refresh the stat cache, so files
    // whose mtime changed (builds, branch switches) keep reporting as modified
    // although their content is identical. Refresh once and re-read.
    if (status.unstaged.length > 0) {
      await exec(['update-index', '-q', '--refresh'], this.cwd()).catch(() => undefined);
      status = parseStatus(this.id, (await query()).stdout);
    }
    return status;
  }

  /** Tracked files, repo-relative with forward slashes (`git ls-files`). */
  async listFiles(): Promise<string[]> {
    const { stdout } = await exec(['ls-files', '-z'], this.cwd());
    return stdout.split('\0').filter(Boolean);
  }

  /** Blame at a revision, or the working tree when omitted (uncommitted lines carry the zero sha). */
  async blame(relPath: string, rev?: string): Promise<BlameLine[]> {
    const args = ['blame', '--porcelain', ...(rev ? [rev] : []), '--', relPath];
    const { stdout } = await exec(args, this.cwd());
    return parseBlame(stdout);
  }

  /** Resolve a revision expression (branch, tag, sha, HEAD~2…) to a commit sha, or nothing. */
  async resolveRevision(rev: string): Promise<string | undefined> {
    try {
      const { stdout } = await exec(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], this.cwd());
      return stdout.trim() || undefined;
    } catch {
      return undefined; // not found / ambiguous
    }
  }

  /** Content of a path at a ref (`git show ref:path`). Empty buffer if absent. */
  async getContentAt(ref: string, filePath: string): Promise<Buffer> {
    try {
      return await execBuffer(['show', `${ref}:${filePath}`], this.cwd());
    } catch {
      return Buffer.alloc(0);
    }
  }

  /** HEAD reflog entries, newest first (`git reflog`). Empty on an unborn branch. */
  async reflog(limit = 200): Promise<ReflogEntry[]> {
    let stdout = '';
    try {
      stdout = (await exec(['reflog', '--format=%H\x1f%gd\x1f%gs', '-n', String(limit)], this.cwd())).stdout;
    } catch {
      return []; // no commits yet — no reflog either
    }
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, selector, subject] = line.split('\x1f');
        return { sha, selector, subject: subject ?? '' };
      });
  }

  /** HEAD straight from git — `this.head` may lag the watcher during operations. */
  async freshHead(): Promise<{ sha: string; branch?: string }> {
    let branch: string | undefined;
    try {
      branch = (await exec(['symbolic-ref', '--short', '-q', 'HEAD'], this.cwd())).stdout.trim() || undefined;
    } catch {
      branch = undefined;
    }
    let sha = '';
    try {
      sha = (await exec(['rev-parse', 'HEAD'], this.cwd())).stdout.trim();
    } catch {
      sha = ''; // unborn branch
    }
    return branch ? { sha, branch } : { sha };
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
      // From HEAD, not the index — a rollback must also drop staged edits.
      await exec(['checkout', 'HEAD', '--', ...paths], this.cwd());
    });
  }

  /** Full commit message of HEAD (subject + body), or empty on an unborn branch. */
  async getHeadMessage(): Promise<string> {
    if (this.head.sha === '') return '';
    const { stdout } = await exec(['log', '-1', '--format=%B', 'HEAD'], this.cwd());
    return stdout.replace(/\n+$/, '');
  }

  /** Append repo-relative patterns to `.gitignore`, one per line, deduped. */
  addToGitignore(paths: string[]): Promise<void> {
    return this.run(async () => {
      const file = path.join(this.root, '.gitignore');
      let existing = '';
      try {
        existing = await fs.readFile(file, 'utf8');
      } catch {
        existing = '';
      }
      const present = new Set(existing.split('\n').map((l) => l.trim()));
      const additions = paths.map((p) => `/${p}`).filter((p) => !present.has(p));
      if (additions.length === 0) return;
      const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
      await fs.appendFile(file, `${prefix}${additions.join('\n')}\n`);
    });
  }

  commit(message: string, amend: boolean, paths?: string[]): Promise<void> {
    return this.run(async () => {
      // With paths this mirrors IntelliJ: commit exactly the checked files'
      // working-tree state (`--only`), regardless of what else is staged.
      // Untracked files must be added first or the pathspec won't match.
      if (paths && paths.length > 0) await exec(['add', '-A', '--', ...paths], this.cwd());
      const args = ['commit', '-m', message];
      if (amend) args.push('--amend');
      if (paths && paths.length > 0) args.push('--only', '--', ...paths);
      await exec(args, this.cwd());
    });
  }

  async stashes(): Promise<StashEntry[]> {
    const { stdout } = await exec(['stash', 'list', '--format=%gd\x1f%gs'], this.cwd());
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, message] = line.split('\x1f');
        return { ref, message: message ?? '' };
      });
  }

  stashPush(message?: string): Promise<void> {
    return this.run(async () => {
      const args = ['stash', 'push', '--include-untracked'];
      if (message) args.push('-m', message);
      await exec(args, this.cwd());
    });
  }

  async stashFiles(ref: string): Promise<FileChange[]> {
    const { stdout } = await exec(['stash', 'show', '--name-status', '--include-untracked', ref], this.cwd());
    const map: Record<string, FileChange['status']> = {
      M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed',
    };
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [st, a, b] = line.split('\t');
        const status = map[st?.[0] ?? ''] ?? 'modified';
        return b !== undefined
          ? { path: b, oldPath: a, status, staged: false }
          : { path: a, status, staged: false };
      });
  }

  stashApply(ref: string): Promise<void> {
    return this.run(async () => {
      await exec(['stash', 'apply', ref], this.cwd());
    });
  }

  stashPop(ref: string): Promise<void> {
    return this.run(async () => {
      await exec(['stash', 'pop', ref], this.cwd());
    });
  }

  stashDrop(ref: string): Promise<void> {
    return this.run(async () => {
      await exec(['stash', 'drop', ref], this.cwd());
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

  /** Commit staged (or, with `all`, every tracked) change as `fixup! <sha>`. */
  commitFixup(sha: string, all: boolean): Promise<void> {
    return this.run(async () => {
      const args = ['commit', `--fixup=${sha}`];
      if (all) args.push('-a');
      await exec(args, this.cwd());
    });
  }

  /** Apply commits in the given order (pass oldest first). */
  cherryPick(shas: string[]): Promise<void> {
    return this.run(async () => {
      await exec(['cherry-pick', ...shas], this.cwd());
    });
  }

  /** Revert commits in the given order (pass newest first to minimize conflicts). */
  revert(shas: string[]): Promise<void> {
    return this.run(async () => {
      await exec(['revert', '--no-edit', ...shas], this.cwd());
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

  /** Undo's reset: moves HEAD but carries uncommitted changes along, aborting
   *  (instead of clobbering them) when they collide with the target state. */
  resetKeep(sha: string): Promise<void> {
    return this.run(async () => {
      await exec(['reset', '--keep', sha], this.cwd());
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
