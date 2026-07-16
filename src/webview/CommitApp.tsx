import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { changedFiles, checkKey, untrackedFiles, useCommitStore } from './store/commitStore';
import { FileTypeIcon } from './util/fileIcons';
import { buildTree, type DirNode } from './util/fileTree';
import { ContextMenu, type MenuItem } from './components/common/ContextMenu';
import type { FileChange, RepoInfo } from '../shared/model';

/** A file paired with its repository — lists can mix repos when repo grouping is off. */
interface Entry {
  repoId: string;
  file: FileChange;
}

/** Left padding of a row at tree depth 0; matches the flat rows' CSS padding. */
const INDENT_SECTION = 22;
const INDENT_REPO_GROUP = 38;
const INDENT_STEP = 12;

const STATUS_LABEL: Record<FileChange['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: '!',
  'type-changed': 'T',
};

function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/');
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
}

type FileContext = (e: React.MouseEvent, repoId: string, file: FileChange, untracked: boolean) => void;

/** Applies Expand All / Collapse All broadcasts; `apply` must be referentially stable. */
function useExpandSignal(apply: (open: boolean) => void) {
  const signal = useCommitStore((s) => s.expandSignal);
  const seen = useRef(signal.seq);
  useEffect(() => {
    if (signal.seq === seen.current) return;
    seen.current = signal.seq;
    apply(signal.open);
  }, [signal, apply]);
}

function Section({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  useExpandSignal(setOpen);
  return (
    <div className="cv-section">
      <div className="cv-section-header" onClick={() => setOpen((v) => !v)}>
        <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden />
        <span className="cv-section-title">{title}</span>
        <span className="count-badge">{count}</span>
        <span className="cv-section-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      </div>
      {/* Hidden, not unmounted — nested expand state must survive a collapsed ancestor. */}
      <div hidden={!open}>{children}</div>
    </div>
  );
}

/** Collapsible repository sub-header inside a section (multi-repo grouping). */
function RepoGroup({ repo, branch, count, actions, children }: {
  repo: RepoInfo;
  branch?: string;
  count: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  useExpandSignal(setOpen);
  return (
    <div className="cv-repo-group">
      <div className="cv-repo-header" title={repo.id} onClick={() => setOpen((v) => !v)}>
        <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden />
        <span className="codicon codicon-repo" aria-hidden />
        <span className="cv-repo-title">{repo.name}</span>
        {branch && <span className="cv-repo-branch">{branch}</span>}
        <span className="count-badge">{count}</span>
        <span className="cv-section-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      </div>
      <div hidden={!open}>{children}</div>
    </div>
  );
}

function StashRow({ repoId, ref_, message }: { repoId: string; ref_: string; message: string }) {
  const ref = ref_;
  const [open, setOpen] = useState(false);
  const stashAction = useCommitStore((s) => s.stashAction);
  const loadStashFiles = useCommitStore((s) => s.loadStashFiles);
  const files = useCommitStore((s) => s.stashFiles[checkKey(repoId, ref)]);
  const openDiff = useCommitStore((s) => s.openDiff);

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) void loadStashFiles(repoId, ref);
  };

  useExpandSignal(
    useCallback(
      (o: boolean) => {
        setOpen(o);
        if (o) void loadStashFiles(repoId, ref);
      },
      [loadStashFiles, repoId, ref],
    ),
  );

  return (
    <>
      <div className="cv-stash-row" title={`${ref}: ${message}`} onClick={toggle}>
        <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden />
        <span className="codicon codicon-git-stash" aria-hidden />
        <span className="cv-stash-ref">{ref}</span>
        <span className="cv-stash-msg">{message}</span>
        <span className="cv-stash-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-button small" title="Pop (apply and drop)" onClick={() => void stashAction('stashPop', repoId, ref)}>
            <span className="codicon codicon-git-stash-pop" aria-hidden />
          </button>
          <button className="icon-button small" title="Apply" onClick={() => void stashAction('stashApply', repoId, ref)}>
            <span className="codicon codicon-git-stash-apply" aria-hidden />
          </button>
          <button className="icon-button small" title="Drop" onClick={() => void stashAction('stashDrop', repoId, ref)}>
            <span className="codicon codicon-trash" aria-hidden />
          </button>
        </span>
      </div>
      {open && !files && <div className="empty-hint cv-stash-files">Loading…</div>}
      {open &&
        files?.map((f) => {
          const { dir, name } = splitPath(f.path);
          return (
            <div
              key={f.path}
              className="file-row cv-file-row cv-stash-files"
              title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
              onClick={() => openDiff(repoId, f.path, ref)}
            >
              <FileTypeIcon name={name} />
              <span className={`cv-name status-${f.status}`}>{name}</span>
              {dir && <span className="file-dir">{dir}</span>}
              <span className={`file-status status-${f.status}`}>{STATUS_LABEL[f.status]}</span>
            </div>
          );
        })}
    </>
  );
}

function FileRow({
  repoId,
  file,
  untracked,
  showDir,
  indent,
  onContext,
}: {
  repoId: string;
  file: FileChange;
  untracked: boolean;
  showDir: boolean;
  indent?: number;
  onContext: FileContext;
}) {
  const checked = useCommitStore((s) => s.checked[checkKey(repoId, file.path)]);
  const toggle = useCommitStore((s) => s.toggle);
  const openDiff = useCommitStore((s) => s.openDiff);
  const rollback = useCommitStore((s) => s.rollback);
  const stageFiles = useCommitStore((s) => s.stageFiles);
  const unstageFiles = useCommitStore((s) => s.unstageFiles);
  const { dir, name } = splitPath(file.path);

  return (
    <div
      className="file-row cv-file-row"
      title={file.path}
      style={indent !== undefined ? { paddingLeft: indent } : undefined}
      onContextMenu={(e) => onContext(e, repoId, file, untracked)}
    >
      <input
        type="checkbox"
        className="cv-check"
        checked={!!checked}
        onChange={() => toggle(repoId, file.path)}
        aria-label={`Include ${file.path}`}
      />
      <FileTypeIcon name={name} />
      <span className={`cv-name status-${file.status}`} onClick={() => openDiff(repoId, file.path)}>
        {name}
      </span>
      {showDir && dir && <span className="file-dir">{dir}</span>}
      {untracked ? (
        <button
          className="icon-button small cv-row-action"
          title="Add to git (stage)"
          aria-label={`Add ${file.path} to git`}
          onClick={() => void stageFiles(repoId, [file.path])}
        >
          <span className="codicon codicon-add" aria-hidden />
        </button>
      ) : (
        <button
          className="icon-button small cv-row-action"
          title={file.status === 'added' ? 'Rollback (move to Unversioned)' : 'Rollback changes'}
          aria-label={`Rollback ${file.path}`}
          onClick={() =>
            file.status === 'added'
              ? void unstageFiles(repoId, [file.path])
              : void rollback(repoId, [file.path])
          }
        >
          <span className="codicon codicon-discard" aria-hidden />
        </button>
      )}
      <span className={`file-status status-${file.status}`}>{STATUS_LABEL[file.status]}</span>
    </div>
  );
}

function FileTree({ entries, untracked, indent, onContext }: {
  entries: Entry[];
  untracked: boolean;
  indent: number;
  onContext: FileContext;
}) {
  const root = useMemo(() => buildTree(entries, (e) => e.file.path), [entries]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (p: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const allDirPaths = useMemo(() => {
    const acc: string[] = [];
    const walk = (n: DirNode<Entry>) => {
      for (const d of n.dirs) {
        acc.push(d.path);
        walk(d);
      }
    };
    walk(root);
    return acc;
  }, [root]);
  useExpandSignal(
    useCallback((o: boolean) => setCollapsed(o ? new Set() : new Set(allDirPaths)), [allDirPaths]),
  );

  const render = (node: DirNode<Entry>, depth: number): ReactNode => (
    <>
      {node.dirs.map((d) => {
        const shut = collapsed.has(d.path);
        return (
          <Fragment key={d.path}>
            <div className="cv-tree-dir" style={{ paddingLeft: indent + depth * INDENT_STEP }} onClick={() => toggle(d.path)}>
              <span className={`codicon codicon-chevron-${shut ? 'right' : 'down'}`} aria-hidden />
              <span className={`codicon codicon-folder${shut ? '' : '-opened'}`} aria-hidden />
              <span className="cv-tree-dirname">{d.name}</span>
            </div>
            {!shut && render(d, depth + 1)}
          </Fragment>
        );
      })}
      {node.items.map((e) => (
        <FileRow
          key={checkKey(e.repoId, e.file.path)}
          repoId={e.repoId}
          file={e.file}
          untracked={untracked}
          showDir={false}
          indent={indent + depth * INDENT_STEP}
          onContext={onContext}
        />
      ))}
    </>
  );

  return render(root, 0);
}

function FileList({ entries, untracked, tree, indent, onContext }: {
  entries: Entry[];
  untracked: boolean;
  tree: boolean;
  indent: number;
  onContext: FileContext;
}) {
  if (tree) return <FileTree entries={entries} untracked={untracked} indent={indent} onContext={onContext} />;
  return (
    <>
      {entries.map((e) => (
        <FileRow key={checkKey(e.repoId, e.file.path)} repoId={e.repoId} file={e.file} untracked={untracked} showDir onContext={onContext} />
      ))}
    </>
  );
}

export function CommitApp() {
  const init = useCommitStore((s) => s.init);
  const repos = useCommitStore((s) => s.repos);
  const data = useCommitStore((s) => s.data);
  const checked = useCommitStore((s) => s.checked);
  const setAll = useCommitStore((s) => s.setAll);
  const message = useCommitStore((s) => s.message);
  const setMessage = useCommitStore((s) => s.setMessage);
  const amend = useCommitStore((s) => s.amend);
  const setAmend = useCommitStore((s) => s.setAmend);
  const viewOptions = useCommitStore((s) => s.viewOptions);
  const setViewOptions = useCommitStore((s) => s.setViewOptions);
  const setAllExpanded = useCommitStore((s) => s.setAllExpanded);
  const refreshAll = useCommitStore((s) => s.refreshAll);
  const busy = useCommitStore((s) => s.busy);
  const commit = useCommitStore((s) => s.commit);
  const stashPush = useCommitStore((s) => s.stashPush);
  const openFile = useCommitStore((s) => s.openFile);
  const showFileHistory = useCommitStore((s) => s.showFileHistory);
  const addToGitignore = useCommitStore((s) => s.addToGitignore);
  const rollback = useCommitStore((s) => s.rollback);
  const unstageFiles = useCommitStore((s) => s.unstageFiles);
  const error = useCommitStore((s) => s.error);
  const dismissError = useCommitStore((s) => s.dismissError);

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>();

  useEffect(() => {
    void init();
  }, [init]);

  if (repos.length === 0)
    return (
      <div className="commit-app">
        <div className="empty-state">
          <span className="codicon codicon-source-control" aria-hidden />
          <div>No git repository in this workspace.</div>
        </div>
      </div>
    );

  const onFileContext: FileContext = (e, repoId, file, untracked) => {
    e.preventDefault();
    e.stopPropagation();
    const root = repos.find((r) => r.id === repoId)?.root ?? '';
    const abs = root ? `${root}/${file.path}` : file.path;
    const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);
    const items: MenuItem[] = [
      { label: 'Open File', action: () => openFile(repoId, file.path), disabled: file.status === 'deleted' },
    ];
    if (!untracked) items.push({ label: 'Show History', action: () => showFileHistory(repoId, file.path) });
    items.push(
      { divider: true },
      { label: 'Copy Path', action: () => copy(abs) },
      { label: 'Add to .gitignore', action: () => void addToGitignore(repoId, [file.path]) },
    );
    if (!untracked)
      items.push(
        { divider: true },
        {
          label: 'Rollback',
          danger: true,
          action: () =>
            file.status === 'added'
              ? void unstageFiles(repoId, [file.path])
              : void rollback(repoId, [file.path]),
        },
      );
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, Math.max(8, window.innerHeight - 260)),
      items,
    });
  };

  const multi = repos.length > 1;
  const groupByRepo = multi && viewOptions.repos;

  const openViewMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items: MenuItem[] = [];
    if (multi)
      items.push({
        label: 'Repositories',
        checked: viewOptions.repos,
        action: () => setViewOptions({ repos: !viewOptions.repos }),
      });
    items.push({
      label: 'Directories',
      checked: viewOptions.dirs,
      action: () => setViewOptions({ dirs: !viewOptions.dirs }),
    });
    setMenu({ x: r.left, y: r.bottom + 2, items });
  };

  const groups = repos.map((repo) => {
    const bundle = data[repo.id];
    const branch = bundle?.status?.branch ?? (bundle?.status?.detached ? 'detached HEAD' : undefined);
    return {
      repo,
      branch,
      changed: changedFiles(bundle?.status),
      untracked: untrackedFiles(bundle?.status),
      stashes: bundle?.stashes ?? [],
    };
  });
  const totalChanged = groups.reduce((n, g) => n + g.changed.length, 0);
  const totalUntracked = groups.reduce((n, g) => n + g.untracked.length, 0);
  const totalStashes = groups.reduce((n, g) => n + g.stashes.length, 0);
  const checkedCount = groups.reduce(
    (n, g) =>
      n + [...g.changed, ...g.untracked].filter((f) => checked[checkKey(g.repo.id, f.path)]).length,
    0,
  );
  const canCommit = !busy && checkedCount > 0 && (message.trim().length > 0 || amend);

  const groupCheckbox = (repoId: string, files: FileChange[]) => (
    <input
      type="checkbox"
      className="cv-check"
      title="Select all"
      aria-label="Select all in repository"
      checked={files.every((f) => checked[checkKey(repoId, f.path)])}
      onChange={(e) => setAll(files.map((f) => ({ repoId, path: f.path })), e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  );

  const stashButton = (repoId: string, name: string) => (
    <button
      className="icon-button small"
      title="Stash changes…"
      aria-label={`Stash changes in ${name}`}
      onClick={() => void stashPush(repoId)}
    >
      <span className="codicon codicon-git-stash" aria-hidden />
    </button>
  );

  const fileSection = (kind: 'changed' | 'untracked') => {
    const nonEmpty = groups.filter((g) => g[kind].length > 0);
    if (nonEmpty.length === 0)
      return (
        <div className="empty-hint cv-empty">
          {kind === 'changed' ? 'No changed files.' : 'No unversioned files.'}
        </div>
      );
    if (groupByRepo)
      return nonEmpty.map((g) => (
        <RepoGroup
          key={g.repo.id}
          repo={g.repo}
          branch={g.branch}
          count={g[kind].length}
          actions={
            <>
              {kind === 'changed' && stashButton(g.repo.id, g.repo.name)}
              {groupCheckbox(g.repo.id, g[kind])}
            </>
          }
        >
          <FileList
            entries={g[kind].map((file) => ({ repoId: g.repo.id, file }))}
            untracked={kind === 'untracked'}
            tree={viewOptions.dirs}
            indent={INDENT_REPO_GROUP}
            onContext={onFileContext}
          />
        </RepoGroup>
      ));
    const entries = nonEmpty.flatMap((g) => g[kind].map((file) => ({ repoId: g.repo.id, file })));
    return (
      <FileList
        entries={entries}
        untracked={kind === 'untracked'}
        tree={viewOptions.dirs}
        indent={INDENT_SECTION}
        onContext={onFileContext}
      />
    );
  };

  const stashRows = (repoId: string, stashes: { ref: string; message: string }[]) =>
    stashes.map((s) => <StashRow key={s.ref} repoId={repoId} ref_={s.ref} message={s.message} />);

  const stashGroups = groups.filter((g) => g.stashes.length > 0);

  return (
    <div className="commit-app">
      <div className="cv-toolbar">
        <button className="icon-button small" title="Refresh" aria-label="Refresh" onClick={() => void refreshAll()}>
          <span className="codicon codicon-refresh" aria-hidden />
        </button>
        <button className="icon-button small" title="Expand All" aria-label="Expand all" onClick={() => setAllExpanded(true)}>
          <span className="codicon codicon-expand-all" aria-hidden />
        </button>
        <button className="icon-button small" title="Collapse All" aria-label="Collapse all" onClick={() => setAllExpanded(false)}>
          <span className="codicon codicon-collapse-all" aria-hidden />
        </button>
        <button
          className="icon-button small"
          title="View Options"
          aria-label="View options"
          aria-haspopup="menu"
          onClick={openViewMenu}
        >
          <span className="codicon codicon-eye" aria-hidden />
        </button>
      </div>

      <div className="cv-sections">
        <Section title="Changed Files" count={totalChanged}>
          {fileSection('changed')}
        </Section>

        <Section title="Unversioned Files" count={totalUntracked}>
          {fileSection('untracked')}
        </Section>

        <Section
          title="Stash"
          count={totalStashes}
          actions={
            !multi && (
              <button
                className="icon-button small"
                title="Stash changes…"
                aria-label="Stash changes"
                onClick={() => void stashPush(repos[0].id)}
              >
                <span className="codicon codicon-git-stash" aria-hidden />
              </button>
            )
          }
        >
          {totalStashes === 0 && <div className="empty-hint cv-empty">No stashes.</div>}
          {groupByRepo
            ? stashGroups.map((g) => (
                <RepoGroup key={g.repo.id} repo={g.repo} branch={g.branch} count={g.stashes.length}>
                  {stashRows(g.repo.id, g.stashes)}
                </RepoGroup>
              ))
            : stashGroups.map((g) => (
                <Fragment key={g.repo.id}>{stashRows(g.repo.id, g.stashes)}</Fragment>
              ))}
        </Section>
      </div>

      <div className="cv-footer">
        <textarea
          className="cv-message"
          placeholder="Commit message"
          aria-label="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
        />
        <label className="cv-amend">
          <input type="checkbox" className="cv-check" checked={amend} onChange={(e) => void setAmend(e.target.checked)} />
          Amend
        </label>
        <div className="cv-buttons">
          <button className="btn-primary" disabled={!canCommit} onClick={() => void commit(false)}>
            Commit
          </button>
          <button className="btn-secondary" disabled={!canCommit} onClick={() => void commit(true)}>
            Commit and Push
          </button>
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(undefined)} />}

      {error && (
        <div className="notification-toast" role="alert">
          <span className="codicon codicon-error" aria-hidden />
          <div className="notification-message">{error}</div>
          <button className="icon-button" title="Dismiss" aria-label="Dismiss" onClick={dismissError}>
            <span className="codicon codicon-close" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
