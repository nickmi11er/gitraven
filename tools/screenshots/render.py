#!/usr/bin/env python3
"""Render the README screenshots in media/screens from the mock pages.

The mocks are styled by the REAL compiled webview CSS: `dist/webview.css` is
injected at render time (with the codicon font inlined), so a `npm run build`
always propagates the product's current look. Seti file-type icons use the
bundled `assets/seti.woff`. Output PNGs get the screens' signature transparent
rounded corners and are verified before being copied into `media/screens`.
"""
import base64
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "media" / "screens"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Corner radius in device px (all renders are @2x). Changing this changes the
# brand look of every screenshot — don't.
RADIUS = 40

PAGES = [
    ("hero.html", "hero.png", "1440,900"),
    ("log-dark.html", "log-dark.png", "1180,440"),
    ("log-light.html", "log-light.png", "1180,440"),
    ("rebase-dark.html", "rebase-dark.png", "1180,440"),
]

# The blame close-up is the hero page with the VS Code window chrome hidden.
HIDE_CHROME = (
    "<style>.titlebar, .abar, .sidebar, .statusbar { display: none !important; } "
    ".win { background: #1f2028; }</style>"
)


def injected_styles() -> str:
    css_path = DIST / "webview.css"
    if not css_path.exists():
        sys.exit("dist/webview.css not found — run `npm run build` first")
    css = css_path.read_text(encoding="utf-8")

    def inline_codicon(m: re.Match) -> str:
        font = base64.b64encode((DIST / m.group(1)).read_bytes()).decode()
        return f'url("data:font/ttf;base64,{font}")'

    css = re.sub(r'url\("\./(codicon-[^".?]+\.ttf)[^"]*"\)', inline_codicon, css, count=1)

    seti = base64.b64encode((TOOLS / "assets" / "seti.woff").read_bytes()).decode()
    fonts = (
        "@font-face { font-family: 'seti-mock'; "
        f"src: url('data:font/woff;base64,{seti}') format('woff'); }}\n"
        ".file-ticon { flex: 0 0 16px; width: 16px; display: inline-flex; align-items: center; "
        "justify-content: center; font-family: 'seti-mock'; font-size: 150%; }"
    )
    return f"<style>{css}</style>\n<style>{fonts}</style>"


def render(html: str, out: Path, size: str, workdir: Path) -> None:
    page = workdir / f"render-{out.stem}.html"
    page.write_text(html, encoding="utf-8")
    subprocess.run(
        [CHROME, "--headless=new", f"--screenshot={out}", f"--window-size={size}",
         "--force-device-scale-factor=2", "--default-background-color=00000000",
         "--hide-scrollbars", "--disable-gpu", f"file://{page}"],
        check=True, capture_output=True,
    )
    page.unlink()


def round_corners(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    scale = 4
    mask = Image.new("L", (im.width * scale, im.height * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, im.width * scale - 1, im.height * scale - 1), radius=RADIUS * scale, fill=255
    )
    mask = mask.resize(im.size, Image.LANCZOS)
    im.putalpha(Image.composite(im.getchannel("A"), Image.new("L", im.size, 0), mask))
    im.save(path)


def verify(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    for cx, cy, dx, dy in [(0, 0, 1, 1), (w - 1, 0, -1, 1), (0, h - 1, 1, -1), (w - 1, h - 1, -1, -1)]:
        if px[cx, cy][3] != 0 or px[cx + 15 * dx, cy + 15 * dy][3] != 255:
            sys.exit(f"{path.name}: corner at ({cx},{cy}) is not rounded as expected")
    if px[w // 2, h // 2][3] != 255:
        sys.exit(f"{path.name}: center is transparent — did the page render at all?")


def main() -> None:
    styles = injected_styles()
    work = TOOLS / "pages"
    outputs = []
    for page_name, out_name, size in PAGES:
        html = (work / page_name).read_text(encoding="utf-8")
        assert "<!-- INJECT:CSS -->" in html, f"{page_name}: missing INJECT:CSS placeholder"
        html = html.replace("<!-- INJECT:CSS -->", styles, 1)
        out = OUT / out_name
        render(html, out, size, work)
        round_corners(out)
        verify(out)
        outputs.append(out_name)
        if page_name == "hero.html":
            blame = OUT / "blame-dark.png"
            render(html + HIDE_CHROME, blame, "1180,560", work)
            round_corners(blame)
            verify(blame)
            outputs.append("blame-dark.png")
    print("rendered:", ", ".join(outputs))


if __name__ == "__main__":
    main()
