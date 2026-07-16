import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../../store/store';
import { getUiState, setUiState } from '../../vscodeApi';
import { ContextMenu, type MenuItem } from '../common/ContextMenu';
import type { Ref } from '../../../shared/model';

/** Sections start collapsed; the ones the user opened persist across reloads. */
const EXPANDED_KEY = 'branchesExpanded';

/** A branch row: local heads keep their name; remote rows drop the remote prefix. */
interface BranchItem {
  ref: Ref;
  label: string;
}

interface RemoteGroup {
  remote: string;
  items: BranchItem[];
}

function groupRefs(refs: Ref[]): { local: BranchItem[]; remotes: RemoteGroup[] } {
  const local: BranchItem[] = [];
  const byRemote = new Map<string, BranchItem[]>();
  for (const ref of refs) {
    if (ref.name.endsWith('/HEAD')) continue;
    if (ref.kind === 'head') {
      local.push({ ref, label: ref.name });
    } else if (ref.kind === 'remote') {
      const cut = ref.name.indexOf('/');
      const remote = cut > 0 ? ref.name.slice(0, cut) : '';
      const arr = byRemote.get(remote) ?? [];
      arr.push({ ref, label: ref.name.slice(cut + 1) });
      byRemote.set(remote, arr);
    }
  }
  const sort = (a: BranchItem, b: BranchItem) => a.label.localeCompare(b.label);
  // The checked-out branch leads the local list.
  local.sort((a, b) => Number(b.ref.isHead) - Number(a.ref.isHead) || sort(a, b));
  const remotes = [...byRemote.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([remote, items]) => ({ remote, items: items.sort(sort) }));
  return { local, remotes };
}

export function BranchesPanel() {
  const repos = useStore((s) => s.repos);
  const selected = useStore((s) => s.selected);
  const refsByRepo = useStore((s) => s.refsByRepo);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const runGuarded = useStore((s) => s.runGuarded);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(getUiState<string[]>(EXPANDED_KEY) ?? []),
  );
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>();

  const shownRepos = useMemo(
    () => repos.filter((r) => selected.includes(r.id)),
    [repos, selected],
  );
  const multi = shownRepos.length > 1;

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setUiState(EXPANDED_KEY, [...next]);
      return next;
    });

  const checkout = (repoId: string, item: BranchItem) => {
    if (item.ref.isHead) return;
    // For a remote branch git dwims `checkout <short name>` into a tracking branch.
    const ref = item.ref.kind === 'remote' ? item.label : item.ref.name;
    void runGuarded({ kind: 'checkout', repoId, ref });
  };

  const showInLog = (branch: string) => void setFilters({ branch });

  const onContext = (e: React.MouseEvent, repoId: string, item: BranchItem) => {
    e.preventDefault();
    e.stopPropagation();
    const name = item.ref.name;
    const local = item.ref.kind === 'head';
    const items: MenuItem[] = [
      { label: 'Checkout', action: () => checkout(repoId, item), disabled: item.ref.isHead },
      { label: 'Show in Log', action: () => showInLog(name) },
      {
        label: 'Compare with Current Branch',
        action: () => showInLog(`HEAD..${name}`),
        disabled: item.ref.isHead,
      },
      { divider: true },
      {
        label: 'Merge into Current Branch',
        action: () => void runGuarded({ kind: 'merge', repoId, ref: name }),
        disabled: item.ref.isHead,
      },
      {
        label: 'Rebase Current onto This',
        action: () => void runGuarded({ kind: 'rebase', repoId, upstream: name }),
        disabled: item.ref.isHead,
      },
      { divider: true },
      { label: 'New Branch from Here…', action: () => void runGuarded({ kind: 'newBranchAt', repoId, sha: name }) },
    ];
    if (local) {
      items.push(
        { label: 'Rename…', action: () => void runGuarded({ kind: 'renameBranchPrompt', repoId, name }) },
        {
          label: 'Delete',
          danger: true,
          action: () => void runGuarded({ kind: 'deleteBranch', repoId, name, force: false }),
          disabled: item.ref.isHead,
        },
      );
    }
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 260),
      y: Math.min(e.clientY, Math.max(8, window.innerHeight - 300)),
      items,
    });
  };

  const branchRow = (repoId: string, item: BranchItem, depth: number) => {
    const { ref } = item;
    const filtered = filters.branch === ref.name;
    return (
      <div
        key={ref.fullName}
        className={`bp-row${ref.isHead ? ' current' : ''}${filtered ? ' filtered' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        title={ref.name}
        onClick={() => showInLog(ref.name)}
        onDoubleClick={() => checkout(repoId, item)}
        onContextMenu={(e) => onContext(e, repoId, item)}
      >
        <span className={`codicon codicon-${ref.isHead ? 'check' : 'git-branch'}`} aria-hidden />
        <span className="bp-name">{item.label}</span>
        {(ref.ahead ?? 0) > 0 && <span className="bp-track">{ref.ahead}↑</span>}
        {(ref.behind ?? 0) > 0 && <span className="bp-track">{ref.behind}↓</span>}
      </div>
    );
  };

  const sectionHeader = (key: string, label: string, depth: number, icon?: string) => {
    const open = expanded.has(key);
    return (
      <div className="bp-section" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => toggle(key)}>
        <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden />
        {icon && <span className={`codicon codicon-${icon}`} aria-hidden />}
        <span className="bp-section-name">{label}</span>
      </div>
    );
  };

  const repoTree = (repoId: string, depth: number): ReactNode => {
    const { local, remotes } = groupRefs(refsByRepo[repoId] ?? []);
    const localKey = `${repoId}:local`;
    return (
      <Fragment key={repoId}>
        {sectionHeader(localKey, 'Local', depth)}
        {expanded.has(localKey) && local.map((b) => branchRow(repoId, b, depth + 1))}
        {local.length === 0 && expanded.has(localKey) && (
          <div className="empty-hint bp-empty">No local branches.</div>
        )}
        {remotes.map((g) => {
          const key = `${repoId}:remote:${g.remote}`;
          return (
            <Fragment key={key}>
              {sectionHeader(key, g.remote, depth, 'cloud')}
              {expanded.has(key) && g.items.map((b) => branchRow(repoId, b, depth + 1))}
            </Fragment>
          );
        })}
      </Fragment>
    );
  };

  return (
    <div className="branches-panel">
      <div className="bp-list">
        {multi
          ? shownRepos.map((repo) => {
              const key = `${repo.id}:repo`;
              return (
                <Fragment key={repo.id}>
                  <div className="bp-section" style={{ paddingLeft: 6 }} onClick={() => toggle(key)}>
                    <span className={`codicon codicon-chevron-${expanded.has(key) ? 'down' : 'right'}`} aria-hidden />
                    <span className="codicon codicon-repo" aria-hidden />
                    <span className="bp-section-name">{repo.name}</span>
                  </div>
                  {expanded.has(key) && repoTree(repo.id, 1)}
                </Fragment>
              );
            })
          : shownRepos.map((repo) => repoTree(repo.id, 0))}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(undefined)} />}
    </div>
  );
}
