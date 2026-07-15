# Changelog

## Unreleased

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
