import { useState } from 'react';
import { useStore } from '../../store/store';
import { shortSha } from '../../util/format';
import { FileTypeIcon } from '../../util/fileIcons';
import type { FileChange } from '../../../shared/model';

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

export function CommitDetails() {
  const details = useStore((s) => s.details);
  const selected = useStore((s) => s.selectedCommit);
  const openDiff = useStore((s) => s.openDiff);
  const [copiedSha, setCopiedSha] = useState<string>();

  if (!selected)
    return (
      <div className="commit-details empty-state">
        <span className="codicon codicon-git-commit" aria-hidden />
        <div>Select a commit to see its changes</div>
      </div>
    );
  if (!details)
    return (
      <div className="commit-details empty-state">
        <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden />
        <div>Loading…</div>
      </div>
    );

  const c = details.commit;

  const copySha = () => {
    void navigator.clipboard?.writeText(c.sha).catch(() => undefined);
    setCopiedSha(c.sha);
    window.setTimeout(() => setCopiedSha(undefined), 1500);
  };

  return (
    <div className="commit-details">
      <div className="details-subject">{c.subject}</div>
      <div className="details-meta">
        <span className="meta-item" title={c.authorEmail}>
          <span className="codicon codicon-account" aria-hidden />
          {c.authorName}
        </span>
        <span className="meta-item" title={new Date(c.authorDate).toISOString()}>
          <span className="codicon codicon-history" aria-hidden />
          {new Date(c.authorDate).toLocaleString()}
        </span>
        <button className="sha-chip" title="Copy full SHA" onClick={copySha}>
          {shortSha(c.sha)}
          <span
            className={`codicon ${copiedSha === c.sha ? 'codicon-check copied' : 'codicon-copy'}`}
            aria-hidden
          />
        </button>
      </div>
      {c.body.trim() && <pre className="details-body">{c.body.trim()}</pre>}
      <div className="details-section-title">
        Changed Files
        <span className="count-badge">{details.files.length}</span>
      </div>
      <div className="details-files">
        {details.files.length === 0 && <div className="empty-hint">No file changes.</div>}
        {details.files.map((f) => {
          const { dir, name } = splitPath(f.path);
          return (
            <div
              key={f.path}
              className="file-row"
              onClick={() => openDiff(selected.repoId, c.sha, f.path)}
              title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
            >
              <FileTypeIcon name={name} />
              <span className="file-name">{name}</span>
              {dir && <span className="file-dir">{dir}</span>}
              {(f.added !== undefined || f.deleted !== undefined) && (
                <span className="file-stat">
                  {f.added !== undefined && <span className="stat-add">+{f.added}</span>}
                  {f.deleted !== undefined && <span className="stat-del">−{f.deleted}</span>}
                </span>
              )}
              <span className={`file-status status-${f.status}`}>{STATUS_LABEL[f.status]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
