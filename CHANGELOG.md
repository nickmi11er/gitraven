# Changelog

## Unreleased

- Log: a **Paths filter chip** — check files or folders in an expandable tree dialog
  (with search; in multi-repo workspaces the tree is grouped per repository and a repo's
  checkbox selects it whole) and the log narrows to commits touching them
  (`git log -- <paths>`); the chip menu keeps your recent selections one click away.
- Log: a **search-in-changes toggle** on the search box (git pickaxe, `-S`) — find
  commits whose diffs add or remove the text, not just mention it in the message.

- Commit view: checking **Amend** now prefills the last commit's message into the box,
  and unchecking restores the draft you had typed.
- Commit view: an IntelliJ-style **view options (eye) menu** groups files by repository
  and/or by directory with collapsible folders — turn both off for one flat list; the
  chosen mode is remembered.
- Commit view: **toolbar actions** — Refresh, Expand All and Collapse All.
- Commit view: empty sections now say what's empty ("No changed files.") and line up
  with the file rows instead of the italic "Nothing here.".
- Commit view: **right-click a file** for Open File, Show History, Copy Path,
  Add to .gitignore and Rollback.

## 0.1.3 — 2026-07-16

- File-count badges in the Commit view and commit details are now subtle muted
  numbers instead of filled theme-colored pills.
- File lists in the Commit view and in commit details now show real file-type
  icons from your active file icon theme (Seti, Material, …), exactly as in the
  Explorer — including the "no icons" setting.
- Blame annotations: right-click the editor's line numbers → "Annotate with Git Blame"
  to show each line's commit date and author, tinted by commit age, with full commit
  info on hover. While active, placing the caret on a line reveals that line's commit
  in the log panel below. "Clear Blame Annotations" turns it off.

## 0.1.2 — 2026-07-16

- The Commit view now picks up files created or modified outside VS Code
  (CLI tools, scripts, agents) — previously it refreshed only after an
  in-editor change.

## 0.1.1 — 2026-07-16

No functional changes — packaging and release infrastructure:

- CI on GitHub Actions: build, typecheck and the real-git test suite on Linux, macOS
  and Windows.
- Tag-triggered publishing to the VS Code Marketplace (Entra workload identity, no
  stored tokens) and Open VSX, with the VSIX attached to the GitHub release.
- Marketplace metadata: repository/bugs/homepage links, expanded keywords, and a
  five-times-smaller VSIX (README images are no longer bundled).

## 0.1.0 — 2026-07-15

Initial preview.

- Commit graph across all branches (virtualized SVG lanes), multi-repository log.
- Interactive rebase with drag-to-reorder and deterministic reword/squash.
- Log filters: branch, multiple users (`@me`), date, text/hash.
- Commit context menu: checkout, branch/tag, cherry-pick, revert, rebase-onto, reset,
  go to parent/child.
- Keyboard navigation, resizable columns, side-bar (portrait) layout.
- Native VS Code look: theme tokens, codicons, native diff.
- Commit view in the activity bar: per-repository changed/unversioned files with checkboxes,
  commits scoped to the checked files, amend, Commit and Push.
- Stash: create, apply, pop, drop, and expandable stash contents with per-file diffs.
- Row actions: stage (move to changed), unstage (move to unversioned), status-aware rollback.
- Live status: working-tree edits refresh the view; fixed phantom "modified" files caused by a
  stale git stat cache; untracked directories expand into individual files.
- The log panel is titled "Git"; new raven activity-bar icon.
