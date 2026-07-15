import type { LogRow } from '../../../shared/model';

/** Index of the first of `from`'s parents present in the list (first-parent
 *  order, so merges follow the mainline), or -1. */
export function parentIndexOf(rows: LogRow[], from: number): number {
  const row = rows[from];
  if (!row) return -1;
  for (const parent of row.commit.parents) {
    const i = rows.findIndex((r) => r.repoId === row.repoId && r.commit.sha === parent);
    if (i >= 0) return i;
  }
  return -1;
}

/** Index of the child commit of `from` nearest above it in display order
 *  (children are newer, so they normally sit above); -1 if none. */
export function childIndexOf(rows: LogRow[], from: number): number {
  const row = rows[from];
  if (!row) return -1;
  let above = -1;
  let below = -1;
  rows.forEach((r, i) => {
    if (r.repoId !== row.repoId || !r.commit.parents.includes(row.commit.sha)) return;
    if (i < from) above = i;
    else if (below < 0 && i > from) below = i;
  });
  return above >= 0 ? above : below;
}
