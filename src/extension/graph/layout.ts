import type { GraphEdge, GraphRow } from '../../shared/model';

export interface CommitNode {
  sha: string;
  parents: string[];
}

interface Lane {
  /** The commit this lane is currently descending toward. */
  target: string;
  color: number;
  /** Column this lane's segment starts at, at the top of the pending gap. */
  sourceCol: number;
}

/**
 * Running layout state: appending more (older) commits continues the lanes
 * seamlessly, so a grown log window never recomputes what's already drawn.
 */
export interface LayoutState {
  lanes: (Lane | null)[];
  colorCounter: number;
  /** Last emitted row — its below-gap edges (and maxLane) complete when the
   *  NEXT commit arrives, possibly in a later batch; it is mutated in place. */
  lastRow: GraphRow | null;
}

export function newLayoutState(): LayoutState {
  return { lanes: [], colorCounter: 0, lastRow: null };
}

/**
 * Assign lanes/colors/edges to a topologically ordered commit list (children
 * before parents), producing rows ready for SVG rendering.
 *
 * `edges` on row r describe the segments drawn in the gap BELOW row r (between
 * row r and row r+1). They are filled in while processing row r+1, when the
 * destination columns become known. A lane keeps a fixed column for its whole
 * life; `sourceCol` only differs from that column for the single gap right after
 * the lane branches off a node, giving the diagonal merge/branch line.
 */
export function layout(commits: CommitNode[]): GraphRow[] {
  return layoutAppend(newLayoutState(), commits);
}

/** Continue a layout with more commits; returns rows for `commits` only.
 *  The previous batch's boundary row (`state.lastRow`) is completed in place. */
export function layoutAppend(state: LayoutState, commits: CommitNode[]): GraphRow[] {
  const rows: GraphRow[] = [];
  const nextColor = () => state.colorCounter++;

  for (const c of commits) {
    const lanes = state.lanes;

    // 1. Which existing lanes reach this commit, and where does its node sit?
    const incoming: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i]?.target === c.sha) incoming.push(i);
    }
    let nodeLane: number;
    let nodeColor: number;
    if (incoming.length > 0) {
      nodeLane = incoming[0];
      nodeColor = (lanes[nodeLane] as Lane).color;
    } else {
      nodeLane = firstFree(lanes);
      nodeColor = nextColor();
    }

    // 2. Fill the previous row's below-gap edges now that destinations are known.
    if (state.lastRow) {
      const edges: GraphEdge[] = [];
      for (let j = 0; j < lanes.length; j++) {
        const lane = lanes[j];
        if (!lane) continue;
        const convergesHere = lane.target === c.sha;
        const dest = convergesHere ? nodeLane : j;
        const from = lane.sourceCol;
        edges.push({
          fromLane: from,
          toLane: dest,
          color: lane.color,
          kind: from === dest ? 'straight' : convergesHere ? 'branch' : 'merge',
        });
      }
      state.lastRow.edges = edges;
      finalizeMaxLane(state.lastRow);
    }

    // Reset transient sources to each lane's own column; node-owned lanes
    // re-set theirs to the node column in step 3 (giving the diagonal).
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      if (lane) lane.sourceCol = i;
    }

    // 3. Transform lanes into this row's outgoing state.
    for (const j of incoming) {
      if (j !== nodeLane) lanes[j] = null;
    }
    if (c.parents.length >= 1) {
      lanes[nodeLane] = { target: c.parents[0], color: nodeColor, sourceCol: nodeLane };
    } else {
      lanes[nodeLane] = null;
    }
    for (let p = 1; p < c.parents.length; p++) {
      const parent = c.parents[p];
      const existing = lanes.findIndex((l) => l?.target === parent);
      if (existing !== -1) {
        (lanes[existing] as Lane).sourceCol = nodeLane;
      } else {
        const slot = firstFree(lanes);
        lanes[slot] = { target: parent, color: nextColor(), sourceCol: nodeLane };
      }
    }

    const row: GraphRow = {
      sha: c.sha,
      lane: nodeLane,
      color: nodeColor,
      isMerge: c.parents.length > 1,
      edges: [],
      maxLane: nodeLane,
    };
    rows.push(row);
    state.lastRow = row;

    state.lanes = trimTrailingNulls(lanes);
  }

  // Width per row = widest lane touched by the node or its below-gap edges.
  // The batch's final row settles when the next batch completes its edges.
  for (const row of rows) finalizeMaxLane(row);

  return rows;
}

function finalizeMaxLane(row: GraphRow): void {
  let max = row.lane;
  for (const e of row.edges) max = Math.max(max, e.fromLane, e.toLane);
  row.maxLane = max;
}

function firstFree(lanes: (Lane | null)[]): number {
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i] === null) return i;
  }
  return lanes.length;
}

function trimTrailingNulls(lanes: (Lane | null)[]): (Lane | null)[] {
  let end = lanes.length;
  while (end > 0 && lanes[end - 1] === null) end--;
  return end === lanes.length ? lanes : lanes.slice(0, end);
}
