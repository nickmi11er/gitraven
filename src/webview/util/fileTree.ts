export interface DirNode<T> {
  /** Display segment(s) — a compacted chain shows as `a/b/c`. */
  name: string;
  /** Full repo-relative directory path; stable key for expand/collapse state. */
  path: string;
  dirs: DirNode<T>[];
  items: T[];
}

/** Group items into a directory tree by path, collapsing single-child folder chains. */
export function buildTree<T>(items: T[], pathOf: (item: T) => string): DirNode<T> {
  const root: DirNode<T> = { name: '', path: '', dirs: [], items: [] };
  for (const item of items) {
    const p = pathOf(item);
    const cut = p.lastIndexOf('/');
    const segs = cut < 0 ? [] : p.slice(0, cut).split('/');
    let node = root;
    let acc = '';
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.dirs.find((d) => d.path === acc);
      if (!child) {
        child = { name: seg, path: acc, dirs: [], items: [] };
        node.dirs.push(child);
      }
      node = child;
    }
    node.items.push(item);
  }
  const collapse = (node: DirNode<T>): DirNode<T> => {
    let n = node;
    while (n.path !== '' && n.items.length === 0 && n.dirs.length === 1) {
      const only = n.dirs[0];
      n = { name: `${n.name}/${only.name}`, path: only.path, dirs: only.dirs, items: only.items };
    }
    n.dirs = n.dirs.map(collapse).sort((a, b) => a.name.localeCompare(b.name));
    return n;
  };
  return collapse(root);
}
