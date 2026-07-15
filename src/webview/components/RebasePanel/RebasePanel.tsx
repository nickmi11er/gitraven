import { useStore } from '../../store/store';

export function RebasePanel() {
  const operationByRepo = useStore((s) => s.operationByRepo);
  const repos = useStore((s) => s.repos);
  const action = useStore((s) => s.rebaseAction);
  const openDiff = useStore((s) => s.openDiff);

  const active = Object.entries(operationByRepo).filter(([, state]) => state !== null);
  if (active.length === 0) return null;

  return (
    <>
      {active.map(([repoId, state]) => {
        if (!state) return null;
        const name = repos.find((r) => r.id === repoId)?.name ?? repoId;
        const pct = state.total > 0 ? Math.min(100, (state.current / state.total) * 100) : 0;
        return (
          <div key={repoId} className="rebase-panel">
            <div className="rebase-panel-head">
              <span className="codicon codicon-source-control" aria-hidden />
              <strong>Rebasing {name}</strong>
              <span className="rebase-progress-text">
                {state.current} of {state.total}
              </span>
            </div>
            <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={state.current}>
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            {state.conflictedFiles.length > 0 && (
              <div className="conflict-list">
                <div className="conflict-title">
                  <span className="codicon codicon-warning" aria-hidden />
                  Conflicts — resolve, then Continue
                </div>
                {state.conflictedFiles.map((f) => (
                  <div key={f} className="conflict-file" onClick={() => openDiff(repoId, undefined, f)}>
                    <span className="codicon codicon-file" aria-hidden />
                    {f}
                  </div>
                ))}
              </div>
            )}
            <div className="rebase-panel-actions">
              <button className="btn-primary" onClick={() => void action(repoId, 'rebaseContinue')}>
                Continue
              </button>
              <button className="btn-secondary" onClick={() => void action(repoId, 'rebaseSkip')}>
                Skip
              </button>
              <button className="btn-danger" onClick={() => void action(repoId, 'rebaseAbort')}>
                Abort
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
