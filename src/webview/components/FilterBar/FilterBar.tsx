import { useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { Dropdown, type DropdownGroup } from '../common/Dropdown';

type DatePreset = '' | '24h' | '7d' | 'custom';

const PRESET_SINCE: Record<Exclude<DatePreset, '' | 'custom'>, string> = {
  '24h': '24 hours ago',
  '7d': '7 days ago',
};

export function FilterBar() {
  const filters = useStore((s) => s.filters);
  const options = useStore((s) => s.filterOptions);
  const setFilters = useStore((s) => s.setFilters);
  const repos = useStore((s) => s.repos);

  const [datePreset, setDatePreset] = useState<DatePreset>('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [text, setText] = useState(filters.query ?? '');
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  if (repos.length === 0) return null;

  const heads = options.branches.filter((b) => b.kind === 'head');
  const remotes = options.branches.filter((b) => b.kind === 'remote');

  const branchGroups: DropdownGroup[] = [
    { items: [{ value: '', label: 'All' }, { value: 'HEAD', label: 'HEAD' }] },
  ];
  if (heads.length > 0)
    branchGroups.push({ label: 'Local', items: heads.map((b) => ({ value: b.name, label: b.name })) });
  if (remotes.length > 0)
    branchGroups.push({ label: 'Remote', items: remotes.map((b) => ({ value: b.name, label: b.name })) });

  const userGroups: DropdownGroup[] = [{ items: [{ value: '', label: 'All' }] }];
  if (options.me) userGroups[0].items.push({ value: '@me', label: `Me (${options.me.name})` });
  if (options.authors.length > 0)
    userGroups.push({ label: 'Authors', items: options.authors.map((a) => ({ value: a.email, label: a.name })) });

  const authors = filters.authors ?? [];
  const authorLabel = (v: string) =>
    v === '@me' ? 'Me' : options.authors.find((a) => a.email === v)?.name ?? v;
  const usersDisplay = authors.length === 0 ? 'All' : authors.map(authorLabel).join(', ');
  const toggleAuthor = (v: string) => {
    if (v === '') {
      void setFilters({ authors: undefined });
      return;
    }
    const next = authors.includes(v) ? authors.filter((a) => a !== v) : [...authors, v];
    void setFilters({ authors: next.length > 0 ? next : undefined });
  };

  const dateGroups: DropdownGroup[] = [
    {
      items: [
        { value: '', label: 'All' },
        { value: '24h', label: 'Last 24 hours' },
        { value: '7d', label: 'Last 7 days' },
        { value: 'custom', label: 'Custom…' },
      ],
    },
  ];

  const onDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === '') void setFilters({ since: undefined, until: undefined });
    else if (preset === 'custom') applyCustom(customFrom, customTo);
    else void setFilters({ since: PRESET_SINCE[preset], until: undefined });
  };

  const applyCustom = (from: string, to: string) => {
    void setFilters({ since: from || undefined, until: to ? `${to} 23:59:59` : undefined });
  };

  const onText = (value: string) => {
    setText(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void setFilters({ query: value.trim() || undefined }), 300);
  };

  const active =
    filters.branch || filters.authors?.length || filters.since || filters.until || filters.query;

  const clearAll = () => {
    setDatePreset('');
    setCustomFrom('');
    setCustomTo('');
    setText('');
    void setFilters({ branch: undefined, authors: undefined, since: undefined, until: undefined, query: undefined });
  };

  return (
    <div className="filter-bar">
      <Dropdown
        label="Branch"
        value={filters.branch ?? ''}
        groups={branchGroups}
        onSelect={(v) => void setFilters({ branch: v || undefined })}
      />
      <Dropdown
        label="User"
        multi
        values={authors}
        display={usersDisplay}
        groups={userGroups}
        onSelect={toggleAuthor}
      />
      <Dropdown
        label="Date"
        value={datePreset}
        groups={dateGroups}
        onSelect={(v) => onDatePreset(v as DatePreset)}
      />

      {datePreset === 'custom' && (
        <span className="filter-dates">
          <input
            type="date"
            className="filter-date"
            aria-label="From date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              applyCustom(e.target.value, customTo);
            }}
          />
          <span className="filter-dash">–</span>
          <input
            type="date"
            className="filter-date"
            aria-label="To date"
            value={customTo}
            onChange={(e) => {
              setCustomTo(e.target.value);
              applyCustom(customFrom, e.target.value);
            }}
          />
        </span>
      )}

      {active && (
        <button className="icon-button" title="Clear all filters" aria-label="Clear all filters" onClick={clearAll}>
          <span className="codicon codicon-clear-all" aria-hidden />
        </button>
      )}

      <div className="filter-search">
        <span className="codicon codicon-search" aria-hidden />
        <input
          type="text"
          placeholder="Message or hash…"
          aria-label="Filter by message or hash"
          value={text}
          onChange={(e) => onText(e.target.value)}
        />
        {text && (
          <button className="icon-button small" title="Clear search" aria-label="Clear search" onClick={() => onText('')}>
            <span className="codicon codicon-close" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
