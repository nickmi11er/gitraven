export const ROW_HEIGHT = 24;
export const LANE_WIDTH = 14;
export const NODE_RADIUS = 4;

/** Stable per-lane palette; layout colors are integer indices modulo this. */
export const LANE_COLORS = [
  '#3572b0',
  '#57a64a',
  '#c586c0',
  '#d19a66',
  '#e06c75',
  '#56b6c2',
  '#e5c07b',
  '#b57edc',
];

export function laneColor(color: number): string {
  return LANE_COLORS[color % LANE_COLORS.length];
}

export function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}
