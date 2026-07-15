import { useEffect, useState, type ReactNode } from 'react';
import { changedFiles, checkKey, untrackedFiles, useCommitStore } from './store/commitStore';
import type { FileChange, RepoInfo } from '../shared/model';

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
      {open && children}
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
      {open && children}
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
              <span className={`cv-name status-${f.status}`}>{name}</span>
              {dir && <span className="file-dir">{dir}</span>}
              <span className={`file-status status-${f.status}`}>{STATUS_LABEL[f.status]}</span>
            </div>
          );
        })}
    </>
  );
}

function FileRows({ repoId, files, untracked }: { repoId: string; files: FileChange[]; untracked: boolean }) {
  const checked = useCommitStore((s) => s.checked);
  const toggle = useCommitStore((s) => s.toggle);
  const openDiff = useCommitStore((s) => s.openDiff);
  const rollback = useCommitStore((s) => s.rollback);
  const stageFiles = useCommitStore((s) => s.stageFiles);
  const unstageFiles = useCommitStore((s) => s.unstageFiles);

  return (
    <>
      {files.map((file) => {
        const { dir, name } = splitPath(file.path);
        return (
          <div key={file.path} className="file-row cv-file-row" title={file.path}>
            <input
              type="checkbox"
              className="cv-check"
              checked={!!checked[checkKey(repoId, file.path)]}
              onChange={() => toggle(repoId, file.path)}
              aria-label={`Include ${file.path}`}
            />
            <span className={`cv-name status-${file.status}`} onClick={() => openDiff(repoId, file.path)}>
              {name}
            </span>
            {dir && <span className="file-dir">{dir}</span>}
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
      })}
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
  const busy = useCommitStore((s) => s.busy);
  const commit = useCommitStore((s) => s.commit);
  const stashPush = useCommitStore((s) => s.stashPush);
  const error = useCommitStore((s) => s.error);
  const dismissError = useCommitStore((s) => s.dismissError);

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

  const multi = repos.length > 1;
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
    if (nonEmpty.length === 0) return <div className="empty-hint">Nothing here.</div>;
    return nonEmpty.map((g) =>
      multi ? (
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
          <FileRows repoId={g.repo.id} files={g[kind]} untracked={kind === 'untracked'} />
        </RepoGroup>
      ) : (
        <FileRows key={g.repo.id} repoId={g.repo.id} files={g[kind]} untracked={kind === 'untracked'} />
      ),
    );
  };

  const stashRows = (repoId: string, stashes: { ref: string; message: string }[]) =>
    stashes.map((s) => <StashRow key={s.ref} repoId={repoId} ref_={s.ref} message={s.message} />);

  const stashGroups = groups.filter((g) => g.stashes.length > 0);

  return (
    <div className="commit-app">
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
          {totalStashes === 0 && <div className="empty-hint">No stashes.</div>}
          {multi
            ? stashGroups.map((g) => (
                <RepoGroup key={g.repo.id} repo={g.repo} branch={g.branch} count={g.stashes.length}>
                  {stashRows(g.repo.id, g.stashes)}
                </RepoGroup>
              ))
            : stashRows(repos[0].id, groups[0]?.stashes ?? [])}
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
          <input type="checkbox" className="cv-check" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
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
