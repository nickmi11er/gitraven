// Runs from the npm `version` lifecycle: renames the "## Unreleased" section
// to the new version with today's date, so the stamped changelog lands in the
// same commit and tag that `npm version` creates. Fails if there is nothing
// to release — the changelog is written as features land, not at tag time.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.env.npm_package_version;
if (!version) {
  console.error('stamp-changelog: run via `npm version <bump>`');
  process.exit(1);
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n');
const start = lines.findIndex((l) => /^## Unreleased\s*$/i.test(l));
if (start < 0) {
  console.error('stamp-changelog: CHANGELOG.md has no "## Unreleased" section');
  process.exit(1);
}
let end = start + 1;
while (end < lines.length && !/^## /.test(lines[end])) end++;
if (!/\S/.test(lines.slice(start + 1, end).join('\n'))) {
  console.error('stamp-changelog: the Unreleased section is empty — describe the changes before releasing');
  process.exit(1);
}

const date = new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD
lines[start] = `## ${version} — ${date}`;
writeFileSync('CHANGELOG.md', lines.join('\n'));
console.log(`stamp-changelog: Unreleased -> ${version} — ${date}`);
