<p align="center">
  <img src="media/brand.png" width="400" alt="GitRaven — a raven perched on a forking commit graph. See history. Know why." />
</p>

<p align="center">
  A git client for VS Code: commit graph, multi-repository support,
  and a real interactive rebase.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=mi11er.gitraven"><img src="https://vsmarketplacebadges.dev/version-short/mi11er.gitraven.svg" alt="VS Code Marketplace" /></a>
  <img src="https://github.com/nickmi11er/gitraven/actions/workflows/ci.yml/badge.svg" alt="CI" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" />
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.90-007ACC" alt="VS Code ^1.90" />
  <img src="https://img.shields.io/badge/status-preview-orange" alt="Status: preview" />
</p>

---

GitRaven is the git log VS Code deserves: a readable graph across every branch, instant
filters, and an interactive rebase you can actually trust — native look, native diff,
system `git` underneath.

Like Odin's ravens Huginn and Muninn, GitRaven flies out to your remotes and brings the whole
story back: every branch, every commit, remembered.

<p align="center">
  <img src="media/screens/hero.png" width="900" alt="GitRaven in VS Code: the Commit view in the side bar with per-repository changes and stash, blame annotations in the editor, and the Git log panel with commit graph, filters and details" />
</p>

## Features

GitRaven lives on three surfaces: the **Commit** view in the activity bar, **blame
annotations** in the editor, and the **Git** log panel at the bottom. All of it is native —
VS Code theme tokens (light / dark / high-contrast), codicons, QuickPick/InputBox prompts —
and all of it is live: file-system watchers keep every view fresh, including changes made
outside VS Code (CLI tools, scripts, agents).

### The Commit view

Everyday committing, in the activity bar:

- **Commit exactly what you check** — changed and unversioned files with checkboxes, grouped
  per repository; the commit takes just the checked files (`--only`). Amend (which prefills
  the last commit message) and Commit-and-Push included.
- **View options** — the eye menu in the toolbar groups files by repository and/or by
  directory (collapsible folders); turn both off for one flat list. The choice is remembered.
- **Stash** — create, apply, pop, drop, and expandable stash contents with per-file diffs.
- **Row actions and file menu** — stage, unstage, and status-aware rollback on the rows;
  right-click for Open File, Show History, Copy Path, Add to .gitignore and Rollback.

### The editor

<p align="center">
  <img src="media/screens/blame-dark.png" width="900" alt="Blame annotations in the editor — date and author per line with an age tint — and the log panel below revealing the caret line's commit" />
</p>

- **Blame annotations** — right-click the line numbers and *Annotate with Git Blame*: date
  and author per line, tinted by commit age, full commit info on hover — with links to
  show the commit's diff, copy its sha, or *annotate the previous revision*: the file
  reopens as it was before that commit, re-blamed, so a line can be traced back through
  refactors hop by hop.
- **Blame is wired to the log** — put the caret on a line and the log panel below jumps
  straight to that commit, details and all. Blame and history work as one surface —
  something a blame-only tool can't offer.
- **Show History** — right-click in the editor, the Explorer, or the Commit view and the
  log panel narrows to that file's (or folder's) commits; with an editor selection, to
  the commits that touched exactly those lines (`git log -L`).
- **Compare with revision or branch** — diff the current file against any branch, tag or
  typed revision (`HEAD~2`, a sha) in the native diff editor.
- **Line permalinks** — *Open Line on Remote* or *Copy Line Permalink*: the caret line or
  selection as a GitHub/GitLab link pinned to the current commit.
- **Native diff** — every diff GitRaven opens uses VS Code's own diff editor.

### The log

Your project's history in the bottom panel — reading, filtering and rewriting it:

<p align="center">
  <img src="media/screens/log-dark.png" width="900" alt="The log panel: commit graph with ref badges, the commit context menu and the details pane" />
</p>

- **Commit graph** — an SVG lane graph across all branches with ref badges (branches, remotes,
  tags), author, date and hash, virtualized to stay smooth on histories of thousands of commits.
  Columns resize by grabbing the invisible boundary between them — no clutter.
- **Keyboard-first** — ↑/↓ walk the list; ←/→ jump to the child / parent commit, following
  the graph across interleaved branches (also available on the context menu).
- **Endless history** — long histories load in pages as you scroll; parent-navigation and
  blame reveal keep loading until they reach their commit.
- **Filters** — branch (the log opens on HEAD; switch to "All" for every branch),
  multiple users (`@me` included), date presets or a custom range,
  files and folders ("who touched this and when"), free-text / hash search — or flip the
  search into pickaxe mode (`git log -S`) to find commits whose *changes* contain the text.
- **Commit actions** — checkout, new branch/tag, cherry-pick, revert, rebase-onto, reset
  (soft / mixed / hard), fixup staged changes into any commit (auto-squashed in place),
  copy sha/subject, open the commit (or any of its files) on GitHub/GitLab — all on the
  context menu.
- **Undo — the raven remembers** — every rebase, reset, cherry-pick, revert, merge and
  fixup is journaled with the branch tip from before it ran. *Undo Last Git Operation*
  (palette, the log panel's ··· menu, or the toast a rewrite leaves behind) moves the
  branch back; uncommitted changes are carried along, never clobbered. The journal
  survives window reloads.
- **Multi-select** — Shift/Cmd-select several commits: cherry-pick or revert the set,
  squash it via a pre-filled interactive-rebase plan, and selecting exactly two shows
  the diff between them in the details pane.
- **Multi-repository** — discovers every repo in the workspace, nested repos and submodules
  included; per-repo colour strips keep them apart in a combined log.
- **Lives anywhere** — wide in the bottom panel (log and details side by side); moved to a side
  bar it goes portrait and stacks them vertically.
- **Interactive rebase** — a visual dialog: drag to reorder, pick / reword / edit /
  squash / fixup / drop per commit. Implemented over `git rebase -i` with a custom
  `GIT_SEQUENCE_EDITOR`, so reword/squash messages apply deterministically without a blocking
  editor. Conflicts surface a banner with a progress bar and Continue / Skip / Abort.

<p align="center">
  <img src="media/screens/rebase-dark.png" width="900" alt="Interactive rebase dialog with pick, squash, reword and drop actions over the commit log" />
</p>

### Every theme, light or dark

All colors come from your theme's tokens — no hardcoded palette:

<p align="center">
  <img src="media/screens/log-light.png" width="900" alt="The same log view rendered in a light theme" />
</p>

## Getting started

Install **GitRaven** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mi11er.gitraven)
(or [Open VSX](https://open-vsx.org/extension/mi11er/gitraven) for VSCodium and friends) —
in the Extensions view just search for "GitRaven".

Open any folder containing git repositories: the log lives in the **Git** view in the
bottom panel, committing and stashes in the **Commit** view in the activity bar.

To run from source instead, clone the repo, then:

```sh
npm install
npm run build
```

and press **F5** ("Run GitRaven Extension") — an Extension Development Host starts with
the extension loaded.

## Keyboard reference

| Keys | Action |
| --- | --- |
| ↑ / ↓ | Previous / next commit in display order |
| ← / → | Go to child / parent commit (follows the graph) |
| Shift+↑ / Shift+↓ | Grow / shrink the selection range |
| Shift+Click / Cmd/Ctrl+Click | Select a range / toggle a commit |
| Right-click | Commit actions menu (multi-commit actions on a selection) |
| Double-click the graph column boundary | Reset graph column to auto width |

## Architecture

- **Extension host** (TypeScript/Node) is the single source of truth. It shells out to the
  system `git` CLI (`src/extension/git`), computes the graph layout
  (`src/extension/graph/layout.ts`), and serves the webview.
- **Webview** (React + TypeScript, bundled by esbuild) renders the UI and talks to the host over
  a typed `postMessage` protocol (`src/shared/protocol.ts`).
- **Editor helpers** (`src/editor-helper`) are tiny Node scripts used as `GIT_SEQUENCE_EDITOR` /
  `GIT_EDITOR` during interactive rebase.
- **Diffs** reuse VS Code's native diff editor via a `gitraven-git:` content provider.

See `src/shared/model.ts` for the data model.

## Development

```sh
npm run watch        # incremental rebuild of all three bundles
npm test             # vitest: parsers, graph layout, navigation, webview mount + real-git tests
npm run typecheck    # extension + webview tsconfigs
npm run lint
```

Tests that exercise git behavior run against a real `git` binary in temp repositories — no
mocks. If you change anything git-facing, please add one.

The README screenshots are reproducible renders of mock pages styled by the real compiled
webview CSS — `python3 tools/screenshots/render.py` regenerates them (see
[tools/screenshots](tools/screenshots/)).

Describe user-visible changes under `## Unreleased` in CHANGELOG.md as you land them. To
release: `npm version <patch|minor|major> && git push --follow-tags` — the version hook stamps
the Unreleased section with the version and date, and CI publishes to the marketplaces with
that section as the release notes.

## Contributing

Issues and PRs are welcome. Keep changes small and focused; make sure `npm run typecheck` and
`npm test` pass. UI changes should use VS Code theme tokens (`--vscode-*`) and codicons — no
hardcoded colors, no emoji glyphs.

## Roadmap

See [BACKLOG.md](BACKLOG.md) for the prioritized backlog. Highlights: an operation journal
with one-click **Undo** for history rewrites, path filters and pickaxe search, file and
selection history straight from the editor, a branches panel, and multi-select commit
operations.

## License

[MIT](LICENSE)
