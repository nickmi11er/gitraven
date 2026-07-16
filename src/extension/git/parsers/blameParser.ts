import type { BlameLine } from '../../../shared/model';

interface CommitMeta {
  authorName: string;
  authorTime: number;
  summary: string;
}

/**
 * Parse `git blame --porcelain` output. Porcelain prints commit metadata
 * (author, summary, …) only on a sha's first occurrence in the stream, so it
 * is carried in a map and re-attached to every later line of the same commit.
 */
export function parseBlame(output: string): BlameLine[] {
  const lines: BlameLine[] = [];
  const metaBySha = new Map<string, CommitMeta>();
  let current: { sha: string; line: number } | undefined;

  for (const raw of output.split('\n')) {
    if (current === undefined) {
      const m = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(raw);
      if (m) current = { sha: m[1], line: Number(m[2]) };
      continue;
    }
    if (raw.startsWith('\t')) {
      const meta = metaBySha.get(current.sha);
      lines.push({
        line: current.line,
        sha: current.sha,
        authorName: meta?.authorName ?? '',
        authorTime: meta?.authorTime ?? 0,
        summary: meta?.summary ?? '',
      });
      current = undefined;
      continue;
    }
    const sp = raw.indexOf(' ');
    const tag = sp === -1 ? raw : raw.slice(0, sp);
    const value = sp === -1 ? '' : raw.slice(sp + 1);
    let meta = metaBySha.get(current.sha);
    if (!meta) {
      meta = { authorName: '', authorTime: 0, summary: '' };
      metaBySha.set(current.sha, meta);
    }
    if (tag === 'author') meta.authorName = value;
    else if (tag === 'author-time') meta.authorTime = Number(value);
    else if (tag === 'summary') meta.summary = value;
  }
  return lines;
}
