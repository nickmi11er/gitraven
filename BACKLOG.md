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
| 2 | ~~**Path filter + pickaxe**~~ ✓ | M | Fourth filter chip (`Paths:`) — IntelliJ-style menu with recent selections and a repo-scoped checkbox tree dialog over files/folders (`git log -- <paths>` per repository), plus a search-box toggle for text search in changes (`-S`). #13 builds the editor entry points on top of this. |
| 3 | ~~**CI on GitHub Actions**~~ ✓ | S | Build + typecheck + vitest on macOS/Linux/Windows. The real-git tests make the OS matrix genuinely useful. Replace the decorative README badge with a real one. |
| 4 | ~~**Publish preview**~~ ✓ | M | Shipped 0.1.0/0.1.1 to the VS Code Marketplace and Open VSX (tag-triggered publish via Entra OIDC, no stored tokens); `repository`/`bugs`/`homepage` metadata added and the VSIX attached to the GitHub release. Now gathering feedback. |
| 5 | ~~**Load more & go to**~~ ✓ | M | Scrolling past the end grows the loaded window (whole-window refetch keeps the graph and head-reachability correct); Go to Parent and blame reveal keep growing it until the target commit appears (capped per invocation). |
| 13 | ~~**Show History for File / Selection**~~ ✓ | L | Editor/Explorer context menu → log filtered to the file or folder (paths machinery from #2) or to the selected lines (`git log -L`, repo-scoped `lineRange` filter, `--no-patch` + old-git patch-bleed guard). The commit view's Show History routes here too (via `historySink` — the commit view is a second provider instance). |

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
| C2 | ~~**Amend prefills the message**~~ ✓ | S | Checking Amend loads HEAD's message into the box; unchecking restores the draft. |
| C3 | **Cmd/Ctrl+Enter to commit** | S | Plus list keyboard nav: arrows move, Space toggles the checkbox. |
| C4 | ~~**File context menu**~~ ✓ | M | Right-click a row: Open File, Show History, Copy Path, Add to .gitignore, Rollback. Show History opens the file's history in the log panel (#13). |
| C5 | ~~**Tree/flat toggle**~~ ✓ | M | View-options eye menu (IntelliJ-style): group by repository and/or directory; collapsible folders with single-child compaction; both off = flat list; persisted. |
| C6 | **Changes badge on the icon** | S | `view.badge` with the total changed-file count, like the built-in SCM view. |
| C7 | **Conflicted files section** | M | During merge/rebase show conflicts separately with Accept Ours/Theirs and Open Merge Editor. |
| C8 | **Stash: selected files + branch** | M | `stash push -- <checked paths>`, "New branch from stash…", and proper diffs for untracked files inside a stash (`stash@{n}^3`). |
| C9 | **Subject-line ruler** | S | Soft 50/72 markers in the message box, warn on a non-empty second line. |
| C10 | **Diff preview panel** | L | Inline peek diff inside the view (single click) instead of opening an editor tab; editor stays for double-click. |
| C11 | **Staged-but-missing clarity** | S | Files added to the index and then deleted from disk (the `AD` case) get an explicit label and a working rollback (`git restore --staged`). |

## Editor

The editor shipped with blame annotations (gutter menu → per-line date/author with an age
heatmap; the caret line's commit is revealed in the log panel). Follow-ups, roughly in
priority order — the big one, Show History for File / Selection, is #13 in **Now**:

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| E1 | **Blame hover actions** | S | Command links in the blame hover (`MarkdownString` command URIs): Show Diff, Copy Revision, and Annotate Previous Revision — re-blame at `<sha>^` to trace a line through refactors. |
| E2 | **Compare with Revision / Branch…** | S | Editor context menu → ref QuickPick → native diff of the current file against it; `GitContentProvider` already serves any ref. |
| E3 | **Open line on remote** | S | The editor half of #10: open the current line on GitHub/GitLab at the current commit, copy permalink. |

## Later

- **Reflog view** — browse and restore from reflog; extends the Undo story. (M)
- ~~**Blame**~~ ✓ — shipped: per-line date/author annotations from the gutter menu, age
  heatmap, caret-to-commit reveal in the log; with #5 done the reveal also works across
  the `maxCommits` boundary (follow-ups live in the **Editor** section). (L)
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
- Editor gutter change markers and per-chunk revert — the built-in SCM already does this well.
- Inline end-of-line blame and author CodeLens — GitLens' territory; our differentiated take
  is the blame column wired to the log panel.
- Any telemetry. Privacy is a feature.
