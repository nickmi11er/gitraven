# GitRaven — instructions for Claude

GitRaven is a git client extension for VS Code (commit graph, interactive rebase,
commit view). Extension host in `src/extension`, React webviews in `src/webview`,
shared protocol in `src/shared`. Build with `npm run build`, verify with
`npm run typecheck && npm test` (tests drive a real git binary).

## Keep the docs in sync

- **README.md** — update it whenever a change affects anything the README shows or
  claims: features, screenshots, keyboard reference, getting started, architecture.
  Don't let it drift from the product.
- **CHANGELOG.md** — add entries under `## Unreleased` as user-visible changes land.
  Only things a *user of the extension* would notice belong there: features, fixes,
  UI changes. Internal refactors, test additions, CI tweaks, and doc edits do not.
  Never stamp versions by hand — `npm version` does that via `scripts/stamp-changelog.mjs`.

## Conventions

- All public-facing text (README, CHANGELOG, BACKLOG, marketplace metadata) is in
  English.
- Webview UI uses VS Code theme tokens (`--vscode-*`) and codicons only — no hardcoded
  colors, no emoji glyphs.
- Changes to git-facing behavior need a real-git test in `test/unit`.
