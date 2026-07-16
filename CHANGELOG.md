# Changelog

## Unreleased

- Fix: **reword in the rebase dialog now edits the whole message** — the editor
  prefills the commit's subject *and* body (and grows with the text). Previously only
  the subject was offered, so rewording silently dropped the original description.
- **Operation journal with one-click Undo** — every rebase, reset, cherry-pick, revert,
  merge and fixup GitRaven runs is journaled with the branch tip from before it ran.
  *Undo Last Git Operation* (or *Git Operation Journal…* for the full list, both in the
  palette and the log panel's ··· menu) moves the branch back — uncommitted changes are
  carried along, never clobbered. History rewrites (rebases, resets, fixups) also offer
  Undo right from a completion toast. The journal survives window reloads.
- Log: a **Paths filter chip** — check files or folders in an expandable tree dialog
  (with search; in multi-repo workspaces the tree is grouped per repository and a repo's
  checkbox selects it whole) and the log narrows to commits touching them
  (`git log -- <paths>`); the chip menu keeps your recent selections one click away.
- Log: a **search-in-changes toggle** on the search box (git pickaxe, `-S`) — find
  commits whose diffs add or remove the text, not just mention it in the message.
- Log: histories longer than `gitraven.log.maxCommits` now **load in pages** — scroll
  to the bottom to fetch more, and *Go to Parent Commit* or a blame reveal grow the
  log automatically until the target commit appears (previously navigation stopped
  at the loaded boundary with an error).
- Editor and Explorer: right-click → **Show History** filters the log panel to that
  file's (or folder's) commits; with an editor selection, **Show History for Selection**
  traces exactly those lines through history (`git log -L`). The Paths chip shows the
  active file or line range.
- Commit view: **Show History** on a file row now opens the file's history in the
  GitRaven log panel (previously it opened the native Timeline).
- Log: the **Branch filter defaults to HEAD** — the log opens on the current branch's
  history; pick "All" in the Branch chip to see every branch. "Clear all filters"
  returns to the HEAD default.
- Log: **Fixup Staged Changes into This Commit** on the context menu — commits the
  staged changes as `fixup!` and folds them into place with a non-interactive
  autosquash rebase; with an empty stage it offers to take all tracked changes.
- Log: **multi-select** — Shift+Click / Shift+↑↓ select a range, Cmd/Ctrl+Click toggles
  a commit. Right-click the selection to cherry-pick or revert the whole set, or to
  squash it (opens the interactive-rebase dialog with the plan pre-filled). Selecting
  exactly two commits shows the diff between them in the details pane, with per-file
  diffs on click.

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
- Editor: right-click → **Compare with Revision or Branch…** — pick a branch or tag
  (or type any revision: a sha, `HEAD~2`) and see the current file diffed against it
  in the native diff editor.
- Blame: the hover now carries **action links** — *Show Diff* opens the commit's change
  to the file, *Copy Revision* copies the full sha, and *Annotate Previous Revision*
  opens the file as it was before that commit and re-blames it there, so a line can be
  traced back through refactors hop by hop.
- Editor: **Open Line on Remote** and **Copy Line Permalink** — the caret line or
  selection as a GitHub/GitLab link pinned to the current commit (detected from the
  remote URL; https and ssh remotes both work). On an old file version opened from
  blame or a diff, the link pins to that revision.
- Log: **Open on Remote / Copy Permalink** on the commit context menu opens the commit
  on GitHub/GitLab (or copies its URL); right-clicking a file in the commit details
  does the same for the file pinned at that commit.

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
