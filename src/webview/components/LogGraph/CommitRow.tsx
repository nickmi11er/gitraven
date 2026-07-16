import type { CSSProperties } from 'react';
import type { LogRow, Ref } from '../../../shared/model';
import { GraphCell } from './GraphCell';
import { laneColor } from './graphConstants';
import { relativeDate, shortSha } from '../../util/format';

export interface ColWidths {
  /** Graph column width; undefined = auto (sized to the widest lane). */
  graph?: number;
  author: number;
  date: number;
  sha: number;
}

export interface RowData {
  rows: LogRow[];
  graphWidth: number;
  cols: ColWidths;
  multiRepo: boolean;
  repoColors: Map<string, number>;
  rootExpanded: boolean;
  onToggleRoot: () => void;
  selectedSha?: string;
  onSelect: (repoId: string, sha: string) => void;
  onContext: (e: React.MouseEvent, row: LogRow) => void;
}

const REF_ICON: Record<Ref['kind'], string> = {
  head: 'git-branch',
  remote: 'cloud',
  tag: 'tag',
};

function RefBadge({ r }: { r: Ref }) {
  return (
    <span className={`ref-badge ref-${r.kind}${r.isHead ? ' ref-current' : ''}`} title={r.fullName}>
      <span className={`codicon codicon-${REF_ICON[r.kind] ?? 'git-branch'}`} aria-hidden />
      {r.name}
    </span>
  );
}

export function CommitRow({ index, style, data }: { index: number; style: CSSProperties; data: RowData }) {
  const row = data.rows[index];
  // Index one past the rows: the load-more sentinel (present while more history exists).
  if (!row)
    return (
      <div className="load-more-row" style={style}>
        <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden />
        Loading more commits…
      </div>
    );
  const prev = data.rows[index - 1];
  const next = data.rows[index + 1];
  const selected = data.selectedSha === row.commit.sha;

  return (
    <div
      className={`commit-row${selected ? ' selected' : ''}${row.inCurrentBranch ? '' : ' other-branch'}`}
      style={style}
      onClick={() => data.onSelect(row.repoId, row.commit.sha)}
      onContextMenu={(e) => data.onContext(e, row)}
    >
      {data.multiRepo && (
        <div
          className={`repo-strip${data.rootExpanded ? ' expanded' : ''}`}
          style={{ background: laneColor(data.repoColors.get(row.repoId) ?? 0) }}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleRoot();
          }}
          title={row.repoId}
        >
          {data.rootExpanded && <span className="repo-strip-label">{repoName(row.repoId)}</span>}
        </div>
      )}
      <div className="graph-col" style={{ width: data.graphWidth }}>
        <GraphCell
          row={row.graph}
          aboveEdges={prev ? prev.graph.edges : undefined}
          drawBelow={!!next}
          width={data.graphWidth}
        />
      </div>
      <div className="commit-main">
        {row.refs.map((r) => (
          <RefBadge key={r.fullName} r={r} />
        ))}
        <span className="commit-subject">{row.commit.subject}</span>
      </div>
      <span className="commit-author" style={{ width: data.cols.author }}>
        {row.commit.authorName}
      </span>
      <span className="commit-date" style={{ width: data.cols.date }} title={row.commit.committerDate}>
        {relativeDate(row.commit.committerDate)}
      </span>
      <span className="commit-sha" style={{ width: data.cols.sha }}>
        {shortSha(row.commit.sha)}
      </span>
    </div>
  );
}

function repoName(id: string): string {
  return id.split(/[\\/]/).pop() ?? id;
}
