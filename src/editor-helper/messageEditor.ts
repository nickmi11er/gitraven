// Invoked from a rebase `exec` line to set a reword/squash commit message
// deterministically: `git commit --amend -F <file>`. Runs in the rebase cwd.
import { spawnSync } from 'node:child_process';

function main(): void {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--msg');
  const file = idx >= 0 ? args[idx + 1] : undefined;
  if (!file) {
    process.exit(0);
  }
  // verbatim: the message is user-supplied exactly; strip/default would drop
  // any line beginning with '#' (e.g. issue references), corrupting it.
  const result = spawnSync('git', ['commit', '--amend', '-F', file, '--cleanup=verbatim'], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 0);
}

main();
