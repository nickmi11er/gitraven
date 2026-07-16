import { useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList } from 'react-window';
import { useStore } from '../../store/store';
import { useSize } from '../../util/useSize';
import { getUiState, setUiState } from '../../vscodeApi';
import { CommitRow, type ColWidths, type RowData } from './CommitRow';
import { LANE_WIDTH, ROW_HEIGHT } from './graphConstants';
import { childIndexOf, parentIndexOf } from './navigation';
import { ContextMenu, type MenuItem } from '../common/ContextMenu';
import type { LogRow } from '../../../shared/model';

const DEFAULT_COLS: ColWidths = { author: 110, date: 62, sha: 60 };
const MIN_TEXT_COL = 36;
const MAX_TEXT_COL = 400;
const MAX_GRAPH_COL = 480;

export function LogGraph() {
  const rows = useStore((s) => s.rows);
  const repos = useStore((s) => s.repos);
  const loading = useStore((s) => s.loading);
  const selectedCommit = useStore((s) => s.selectedCommit);
  const selectCommit = useStore((s) => s.selectCommit);
  const startRebase = useStore((s) => s.startRebase);
  const runGuarded = useStore((s) => s.runGuarded);
  const { ref, width, height } = useSize<HTMLDivElement>();
  const listRef = useRef<FixedSizeList>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | undefined>();
  const [rootExpanded, setRootExpanded] = useState(false);
  const [cols, setCols] = useState<ColWidths>(() => ({
    ...DEFAULT_COLS,
    ...getUiState<Partial<ColWidths>>('logColumns'),
  }));
  const colsRef = useRef(cols);
  colsRef.current = cols;

  const computedGraphWidth = useMemo(() => {
    let max = 0;
    for (const r of rows) max = Math.max(max, r.graph.maxLane);
    return Math.max((max + 1) * LANE_WIDTH, LANE_WIDTH);
  }, [rows]);
  const graphWidth = Math.min(cols.graph ?? computedGraphWidth, MAX_GRAPH_COL);

  // Each divider follows the cursor: it resizes the graph column (its left
  // neighbor) or the fixed column to its right — the subject column flexes.
  const adjust = (key: keyof ColWidths, delta: number) =>
    setCols((c) => {
      if (key === 'graph') {
        const base = c.graph ?? computedGraphWidth;
        return { ...c, graph: Math.min(MAX_GRAPH_COL, Math.max(LANE_WIDTH, base + delta)) };
      }
      return { ...c, [key]: Math.min(MAX_TEXT_COL, Math.max(MIN_TEXT_COL, c[key] + delta)) };
    });
  const persist = () => setUiState('logColumns', colsRef.current);

  const multiRepo = useMemo(() => new Set(rows.map((r) => r.repoId)).size > 1, [rows]);
  const repoColors = useMemo(() => {
    const map = new Map<string, number>();
    repos.forEach((r, i) => map.set(r.id, i));
    return map;
  }, [repos]);

  const selectedIndex = useMemo(() => {
    if (!selectedCommit) return -1;
    return rows.findIndex((r) => r.repoId === selectedCommit.repoId && r.commit.sha === selectedCommit.sha);
  }, [rows, selectedCommit]);

  // Host-initiated reveal (blame caret → commit). The event can arrive before
  // the log has loaded (queued events flush on `ready`), so resolve it only
  // once rows are present; a genuinely missing sha surfaces the toast.
  const revealRequest = useStore((s) => s.revealRequest);
  useEffect(() => {
    if (!revealRequest || loading || rows.length === 0) return;
    const index = rows.findIndex((r) => r.repoId === revealRequest.repoId && r.commit.sha === revealRequest.sha);
    if (index >= 0) {
      void selectCommit(revealRequest.repoId, revealRequest.sha);
      listRef.current?.scrollToItem(index, 'smart');
      useStore.setState({ revealRequest: undefined });
    } else {
      useStore.setState({ revealRequest: undefined, error: 'Commit is older than the loaded log range' });
    }
  }, [revealRequest, rows, loading, selectCommit]);

  const goTo = (index: number) => {
    const row = rows[index];
    if (!row) return;
    void selectCommit(row.repoId, row.commit.sha);
    listRef.current?.scrollToItem(index, 'smart');
  };

  // Up/Down walk the list in display order; Left/Right are IntelliJ's
  // "Go to Child/Parent Commit" — they follow the graph, not the list.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    let target = -1;
    if (e.key === 'ArrowDown') target = selectedIndex < 0 ? 0 : Math.min(rows.length - 1, selectedIndex + 1);
    else if (e.key === 'ArrowUp') target = selectedIndex < 0 ? 0 : Math.max(0, selectedIndex - 1);
    else if (e.key === 'ArrowRight') target = parentIndexOf(rows, selectedIndex);
    else if (e.key === 'ArrowLeft') target = childIndexOf(rows, selectedIndex);
    else return;
    e.preventDefault();
    if (target >= 0) goTo(target);
  };

  const onContext = (e: React.MouseEvent, row: LogRow) => {
    e.preventDefault();
    e.stopPropagation();
    const sha = row.commit.sha;
    const repoId = row.repoId;
    const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);
    const index = rows.indexOf(row);
    const parentIdx = parentIndexOf(rows, index);
    const childIdx = childIndexOf(rows, index);
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, Math.max(8, window.innerHeight - 340)),
      items: [
        { label: 'Checkout Revision', action: () => void runGuarded({ kind: 'checkout', repoId, ref: sha }) },
        { label: 'New Branch…', action: () => void runGuarded({ kind: 'newBranchAt', repoId, sha }) },
        { label: 'New Tag…', action: () => void runGuarded({ kind: 'createTagAt', repoId, sha }) },
        { divider: true },
        { label: 'Cherry-Pick', action: () => void runGuarded({ kind: 'cherryPick', repoId, sha }) },
        { label: 'Revert Commit', action: () => void runGuarded({ kind: 'revert', repoId, sha }) },
        { divider: true },
        { label: 'Interactively Rebase from Here…', action: () => void startRebase(repoId, `${sha}^`) },
        { label: 'Rebase Current onto Selected', action: () => void runGuarded({ kind: 'rebase', repoId, upstream: sha }) },
        { label: 'Reset Current Branch to Here…', action: () => void runGuarded({ kind: 'resetTo', repoId, sha }), danger: true },
        { divider: true },
        { label: 'Go to Parent Commit', action: () => goTo(parentIdx), disabled: parentIdx < 0 },
        { label: 'Go to Child Commit', action: () => goTo(childIdx), disabled: childIdx < 0 },
        { divider: true },
        { label: 'Copy Revision Number', action: () => copy(sha) },
        { label: 'Copy Subject', action: () => copy(row.commit.subject) },
      ],
    });
  };

  const data: RowData = {
    rows,
    graphWidth,
    cols,
    multiRepo,
    repoColors,
    rootExpanded,
    onToggleRoot: () => setRootExpanded((v) => !v),
    onSelect: selectCommit,
    onContext,
  };
  if (selectedCommit) data.selectedSha = selectedCommit.sha;

  // Headerless, IntelliJ-style column resize: invisible hover zones centered
  // on each column boundary, spanning the whole list height. Offsets mirror
  // the row layout (6px gaps, 8px right padding).
  const leadWidth = multiRepo ? (rootExpanded ? 130 : 5) + 6 : 0;
  const graphBoundary = leadWidth + graphWidth + 3;
  const shaBoundary = 8 + cols.sha + 3;
  const dateBoundary = 8 + cols.sha + 6 + cols.date + 3;
  const authorBoundary = 8 + cols.sha + 6 + cols.date + 6 + cols.author + 3;

  return (
    <div className="log-graph">
      <div className="log-list" ref={ref} tabIndex={0} role="listbox" aria-label="Commits" onKeyDown={onKeyDown}>
        {rows.length === 0 && !loading && (
          <div className="empty-state">
            <span className="codicon codicon-git-commit" aria-hidden />
            <div>No commits to display</div>
          </div>
        )}
        {height > 0 && width > 0 && (
          <FixedSizeList
            ref={listRef}
            height={height}
            width={width}
            itemCount={rows.length}
            itemSize={ROW_HEIGHT}
            itemData={data}
            overscanCount={12}
          >
            {CommitRow}
          </FixedSizeList>
        )}
        {rows.length > 0 && (
          <>
            <ColResizer
              style={{ left: graphBoundary - 3.5 }}
              onDrag={(dx) => adjust('graph', dx)}
              onDone={persist}
              onReset={() => {
                setCols((c) => ({ ...c, graph: undefined }));
                persist();
              }}
            />
            <ColResizer style={{ right: authorBoundary - 3.5 }} onDrag={(dx) => adjust('author', -dx)} onDone={persist} />
            <ColResizer style={{ right: dateBoundary - 3.5 }} onDrag={(dx) => adjust('date', -dx)} onDone={persist} />
            <ColResizer style={{ right: shaBoundary - 3.5 }} onDrag={(dx) => adjust('sha', -dx)} onDone={persist} />
          </>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(undefined)} />}
    </div>
  );
}

function ColResizer({
  style,
  onDrag,
  onDone,
  onReset,
}: {
  style: React.CSSProperties;
  onDrag: (dx: number) => void;
  onDone: () => void;
  /** Double-click handler (e.g. reset the graph column to auto width). */
  onReset?: () => void;
}) {
  const lastX = useRef(0);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`col-resizer${dragging ? ' dragging' : ''}`}
      style={style}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        lastX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const dx = e.clientX - lastX.current;
        if (dx !== 0) {
          lastX.current = e.clientX;
          onDrag(dx);
        }
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
        onDone();
      }}
      onDoubleClick={onReset}
    />
  );
}
