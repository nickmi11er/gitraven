---
name: screenshots
description: Regenerate the README screenshots in media/screens from the HTML mocks in tools/screenshots. Use whenever the webview UI changes, a new feature must appear on the screens, or the user asks to update/refresh screenshots.
---

# README screenshots

The five PNGs in `media/screens/` are NOT captured from a live VS Code — they are
renders of hand-maintained mock pages in `tools/screenshots/pages/`, styled by the REAL
compiled `dist/webview.css` (injected at render time), shot with headless Chrome and
post-processed. This keeps them pixel-consistent with the product and reproducible.

## Regenerate

```sh
npm run build                        # the mocks are styled by dist/webview.css
python3 tools/screenshots/render.py  # renders, rounds corners, verifies, writes media/screens
```

The script fails loudly if a corner isn't rounded or a page rendered blank. After a
successful run, ALWAYS view at least one output PNG yourself (Read the file) before
committing — the script can't judge visual regressions, only invariants.

## What each screen shows

| File | Page | Size (CSS px) | Content |
| --- | --- | --- | --- |
| hero.png | hero.html | 1440×900 | Full VS Code window: Commit view, editor with blame annotations, Git log panel with the caret line's commit revealed |
| blame-dark.png | hero.html + chrome hidden | 1180×560 | Editor close-up: blame column + log reveal (derived automatically from hero) |
| log-dark.png | log-dark.html | 1180×440 | Log panel with open commit context menu + details |
| log-light.png | log-light.html | 1180×440 | Same log in a light theme (theme-token proof) |
| rebase-dark.png | rebase-dark.html | 1180×440 | Interactive rebase dialog over the log |

## Editing the mocks

- Pages contain a `<!-- INJECT:CSS -->` placeholder — never inline `dist/webview.css`
  or font data into them; `render.py` injects fresh CSS and fonts at render time.
- Markup mirrors the real webview components' class names (`commit-row`, `file-row`,
  `cv-name`, `details-files`, …). When product markup/CSS changes shape, update the
  mocks the same way — check the component source first.
- When a NEW user-visible feature ships, decide whether the screens must show it
  (README must not drift — see CLAUDE.md); usually at least the hero should.
- File rows carry Seti file-type icons: `<span class="file-ticon" style="color:#519aba">…</span>`
  with the REAL decoded glyph character. Get glyphs/colors from the Seti theme document
  (`/Applications/Visual Studio Code.app/…/extensions/theme-seti/icons/vs-seti-icon-theme.json`);
  `fontCharacter` there is CSS-escaped (`\E099`) — decode to the actual character. Known ones:
  ts `\E099`, tsx/react `\E07D`, css `\E01D`, md `\E060`, default `\E023`; dark color
  `#519aba` (default `#d4d7d6`), light-theme pages use `#498ba7` (default `#bfc2c1`).
- Blame column cells are `<span class="bl h1|h2">YYYY-MM-DD Author…</span>` — keep the
  format in sync with BlameController (currently date 10ch + space + author 10ch ellipsized).
- Mock data conventions: everything in English; in-universe names only (repo `gitraven`,
  site `gitraven-site`, authors Nick Miller / Alice Reyes) — NEVER the user's real
  project names; keep dates/shas consistent between the log rows, details pane and blame.

## Hard invariants (learned the painful way)

1. **Transparent rounded corners on every screen** — radius 40 device px @2x, corner
   alpha profile along the diagonal: (0,0)=0 … (15,15)=255. `render.py` applies and
   verifies this; never ship a square-cornered screen.
2. **Pages must keep `<meta charset="utf-8">`** — without it Chrome guesses
   windows-1252 (the base64 blobs defeat its sniffing) and em-dashes/ellipses/glyphs
   become mojibake.
3. **Explicit `encoding='utf-8'`** in any Python that touches the pages.
4. Renders use `--force-device-scale-factor=2 --default-background-color=00000000
   --hide-scrollbars` (all encoded in `render.py` — don't screenshot any other way).

## After regenerating

- Check README image `alt` texts still describe what the screens show.
- Commit the PNGs together with the change that made them stale.
