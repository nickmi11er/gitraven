# GitRaven Backlog

Prioritized product backlog. Tiers: **Now** (next release), **Next** (the one after),
**Later** (worth doing, not yet scheduled). Sizes are rough: S ≈ a day, M ≈ a few days,
L ≈ a week or more.

## Guiding principles

- **The log is the product.** GitRaven wins on history: reading it, filtering it, rewriting it.
- **Rewriting history must feel safe.** Every destructive operation should be undoable — that's
  the brand ("the raven remembers").
- **Native everything.** VS Code theme tokens, codicons, native diff, QuickPick/InputBox. If it
  looks foreign, it's a bug.
- **Don't duplicate the built-in SCM.** Staging and simple commits already work well in VS Code;
  invest where we're differentiated.

## Now

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| 1 | **Operation journal + Undo** | L | Record every mutating op GitRaven runs (rebase, reset, cherry-pick, revert, merge) with the pre-op HEAD/branch tips; offer one-click Undo via reflog / `ORIG_HEAD`. Turns scary operations into safe ones — the trust feature. |
| 2 | **Path filter + pickaxe** | M | A fourth filter chip (`Paths:`) with file/folder picker (`git log -- <path>`), plus text search in changes (`-S`). Closes the "who touched this file and when" scenario. |
| 3 | ~~**CI on GitHub Actions**~~ ✓ | S | Build + typecheck + vitest on macOS/Linux/Windows. The real-git tests make the OS matrix genuinely useful. Replace the decorative README badge with a real one. |
| 4 | **Publish preview** | M | Claim the `gitraven` publisher, add the `repository` field, package and publish 0.1.x as a preview to the VS Code Marketplace and Open VSX. Feedback beats features at this stage. |
| 5 | **Load more & go to** | M | Log pagination past `maxCommits`, and "go to parent" that loads the next page when the parent is beyond it (today navigation stops at the loaded boundary). |

## Next

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| 6 | **Fixup into commit** | M | Context menu: "Fixup staged changes into this commit" — `git commit --fixup` + `rebase --autosquash` through the existing sequence-editor machinery. |
| 7 | **Multi-select in the log** | M | Shift/Cmd selection: cherry-pick a set, squash a set, diff a range between two commits. |
| 8 | **Cherry-pick / revert conflict panels** | M | Same Continue / Skip / Abort banner the rebase already has; symmetric conflict UX for all sequencer operations. |
| 9 | **Branches panel** | L | Local/remote branch tree beside the log: ahead/behind counts, checkout on double-click, compare with current branch. |
| 10 | **Open on remote** | S | Context menu: open commit/file on GitHub/GitLab, detected from the remote URL; copy permalink. |
| 11 | **Walkthrough + empty states** | S | Native `contributes.walkthroughs` onboarding; a helpful view when the workspace has no git repository. |
| 12 | **Rebase demo GIF** | S | Animated drag-to-reorder capture for the README (headless-render pipeline already exists for screenshots). |

## Commit window

The Commit view (primary side bar) shipped with: changed/unversioned/stash
sections grouped per repository, checkbox-scoped commits (`--only`), amend, commit-and-push,
stash contents with per-file diff, stage/unstage/rollback row actions. What's next, roughly
in priority order:

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| C1 | **Commit message history** | S | Dropdown with recent commit messages, persisted per workspace. |
| C2 | **Amend prefills the message** | S | Checking Amend loads HEAD's message into the box (and restores the draft when unchecked). |
| C3 | **Cmd/Ctrl+Enter to commit** | S | Plus list keyboard nav: arrows move, Space toggles the checkbox. |
| C4 | **File context menu** | M | Rollback, Add to .gitignore, Copy path, Open file, Show history — right-click on a row. |
| C5 | **Tree/flat toggle** | M | Group files by directory with collapsible folders; remember the chosen mode. |
| C6 | **Changes badge on the icon** | S | `view.badge` with the total changed-file count, like the built-in SCM view. |
| C7 | **Conflicted files section** | M | During merge/rebase show conflicts separately with Accept Ours/Theirs and Open Merge Editor. |
| C8 | **Stash: selected files + branch** | M | `stash push -- <checked paths>`, "New branch from stash…", and proper diffs for untracked files inside a stash (`stash@{n}^3`). |
| C9 | **Subject-line ruler** | S | Soft 50/72 markers in the message box, warn on a non-empty second line. |
| C10 | **Diff preview panel** | L | Inline peek diff inside the view (single click) instead of opening an editor tab; editor stays for double-click. |
| C11 | **Staged-but-missing clarity** | S | Files added to the index and then deleted from disk (the `AD` case) get an explicit label and a working rollback (`git restore --staged`). |

## Later

- **Reflog view** — browse and restore from reflog; extends the Undo story. (M)
- **Blame** — annotate a file with commit/author per line, linked back to the log. (L)
- **Incremental graph recompute** — append-only layout updates instead of full recompute;
  consider `git commit-graph` for big repos. (L)
- **Commit hover tooltips** — full message, refs, and stats on hover in the log. (S)
- **Stash UI** — list/apply/pop/drop; evaluate first whether the built-in SCM covers enough. (M)
- **Submodule operations** — update/init/sync from the repo picker. (M)
- **Staging/commit panel** — only if it can beat the built-in SCM experience; otherwise skip. (L)
- **Date format setting** — relative vs absolute timestamps in the log. (S)
- **Avatars** — optional gravatar column, off by default (privacy, offline). (S)
- **Accessibility pass** — ARIA roles/labels for rows and dialogs, screen-reader announcements
  for operation results. (M)

## Non-goals (for now)

- Full staging parity with the built-in SCM.
- GitHub/GitLab PR and issue integration — GitLens and the official extensions own that space.
- Any telemetry. Privacy is a feature.
