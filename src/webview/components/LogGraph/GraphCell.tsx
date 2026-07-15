import type { GraphEdge, GraphRow } from '../../../shared/model';
import { laneColor, laneX, NODE_RADIUS, ROW_HEIGHT } from './graphConstants';

interface Props {
  row: GraphRow;
  /** Previous same-repo row's below-edges; their upper halves are drawn here. */
  aboveEdges?: GraphEdge[];
  /** Whether the next visible row belongs to the same repo (draw lower halves). */
  drawBelow: boolean;
  width: number;
}

const H = ROW_HEIGHT;
const MID = H / 2;

/**
 * Renders one row's slice of the graph. A full edge spanning the gap between two
 * rows is drawn in two halves that meet at the row boundary, so a virtualized
 * list of independent per-row SVGs still yields continuous lines.
 */
export function GraphCell({ row, aboveEdges, drawBelow, width }: Props) {
  const segments: JSX.Element[] = [];

  if (aboveEdges) {
    aboveEdges.forEach((e, i) => {
      const fromX = laneX(e.fromLane);
      const toX = laneX(e.toLane);
      const midX = (fromX + toX) / 2;
      segments.push(
        <line key={`a${i}`} x1={midX} y1={0} x2={toX} y2={MID} stroke={laneColor(e.color)} strokeWidth={1.5} />,
      );
    });
  }

  if (drawBelow) {
    row.edges.forEach((e, i) => {
      const fromX = laneX(e.fromLane);
      const toX = laneX(e.toLane);
      const midX = (fromX + toX) / 2;
      segments.push(
        <line key={`b${i}`} x1={fromX} y1={MID} x2={midX} y2={H} stroke={laneColor(e.color)} strokeWidth={1.5} />,
      );
    });
  }

  const cx = laneX(row.lane);
  return (
    <svg width={width} height={H} style={{ flex: '0 0 auto' }} aria-hidden>
      {segments}
      <circle
        cx={cx}
        cy={MID}
        r={row.isMerge ? NODE_RADIUS + 0.5 : NODE_RADIUS}
        fill={laneColor(row.color)}
        stroke="var(--vscode-editor-background)"
        strokeWidth={1}
      />
    </svg>
  );
}
