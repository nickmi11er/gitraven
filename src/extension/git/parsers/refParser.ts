import type { Ref, RefKind } from '../../../shared/model';
import { US } from './formats';

/** Parse `git for-each-ref` output using {@link REF_FORMAT}. */
export function parseRefs(output: string): Ref[] {
  const refs: Ref[] = [];
  for (const line of output.split('\n')) {
    if (line.trim().length === 0) continue;
    const [objectname, starObjectname, fullName, short, upstream, track, head] = line.split(US);
    const kind = classify(fullName);
    if (!kind) continue;
    const ref: Ref = {
      kind,
      fullName,
      name: short,
      targetSha: starObjectname || objectname,
      isHead: head === '*',
    };
    if (upstream) ref.upstream = upstream;
    const ab = parseTrack(track);
    if (ab) {
      ref.ahead = ab.ahead;
      ref.behind = ab.behind;
    }
    refs.push(ref);
  }
  return refs;
}

function classify(fullName: string): RefKind | undefined {
  if (fullName.startsWith('refs/heads/')) return 'head';
  if (fullName.startsWith('refs/remotes/')) return 'remote';
  if (fullName.startsWith('refs/tags/')) return 'tag';
  return undefined;
}

function parseTrack(track: string | undefined): { ahead: number; behind: number } | undefined {
  if (!track) return undefined;
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  if (!ahead && !behind) return undefined;
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 };
}
