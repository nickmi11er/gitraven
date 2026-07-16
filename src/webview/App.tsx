import { useEffect } from 'react';
import { useStore } from './store/store';
import { useSize } from './util/useSize';
import { LogGraph } from './components/LogGraph/LogGraph';
import { CommitDetails } from './components/CommitDetails/CommitDetails';
import { BranchesPanel } from './components/BranchesPanel/BranchesPanel';
import { RebaseDialog } from './components/RebaseDialog/RebaseDialog';
import { RebasePanel } from './components/RebasePanel/RebasePanel';
import { SplitPane } from './components/common/SplitPane';
import { FilterBar } from './components/FilterBar/FilterBar';

export function App() {
  const init = useStore((s) => s.init);
  const error = useStore((s) => s.error);
  const dismissError = useStore((s) => s.dismissError);
  const branchesOpen = useStore((s) => s.branchesOpen);
  const { ref, width, height } = useSize<HTMLDivElement>();
  // In the bottom panel the view is wide → log and details sit side by side;
  // moved to a (primary/secondary) side bar it becomes portrait → stack them.
  const vertical = width > 0 && height > width;

  useEffect(() => {
    void init();
  }, [init]);

  const logAndDetails = (
    <SplitPane
      storageKey="logDetailsRatio"
      defaultRatio={vertical ? 0.55 : 0.62}
      direction={vertical ? 'vertical' : 'horizontal'}
      left={<LogGraph />}
      right={<CommitDetails />}
    />
  );

  // Repository selection, fetch/pull/push, and refresh live in the panel's title
  // bar (view/title contributions), so the webview itself carries no toolbar.
  return (
    <div className="app" ref={ref}>
      <RebasePanel />

      <FilterBar />

      {branchesOpen ? (
        <SplitPane
          storageKey="branchesRatio"
          defaultRatio={vertical ? 0.3 : 0.18}
          min={0.1}
          max={0.45}
          direction={vertical ? 'vertical' : 'horizontal'}
          left={<BranchesPanel />}
          right={logAndDetails}
        />
      ) : (
        logAndDetails
      )}

      {error && (
        <div className="notification-toast" role="alert">
          <span className="codicon codicon-error" aria-hidden />
          <div className="notification-message">{error}</div>
          <button className="icon-button" title="Dismiss" aria-label="Dismiss" onClick={dismissError}>
            <span className="codicon codicon-close" aria-hidden />
          </button>
        </div>
      )}

      <RebaseDialog />
    </div>
  );
}
