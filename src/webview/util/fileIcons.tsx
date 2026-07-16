import { create } from 'zustand';
import { onEvent, request } from '../vscodeApi';
import type { FileIconDef, FileIconTheme } from '../../shared/model';

// Renders REAL file-icon-theme icons (the same ones the Explorer shows): the
// host reads the active theme's document and ships resolved glyphs/images as
// data: URIs. Names are resolved lazily and batched per animation tick.

interface IconState {
  theme?: FileIconTheme;
  icons: Record<string, FileIconDef | null>;
}

const useIconStore = create<IconState>(() => ({ icons: {} }));

let themeRequested = false;
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

async function loadTheme(): Promise<void> {
  try {
    const theme = await request<FileIconTheme>({ kind: 'getFileIconTheme' });
    applyFonts(theme);
    useIconStore.setState({ theme });
  } catch {
    themeRequested = false; // retry on the next queued name
  }
}

function applyFonts(theme: FileIconTheme): void {
  const id = 'gitraven-file-icon-fonts';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = theme.fonts
    .map(
      (f) =>
        `@font-face { font-family: 'fileicon-${f.id}'; src: url('${f.src}') format('${f.format}'); ` +
        `font-weight: ${f.weight ?? 'normal'}; font-style: ${f.style ?? 'normal'}; font-display: block; }`,
    )
    .join('\n');
}

function queue(name: string): void {
  if (!themeRequested) {
    themeRequested = true;
    void loadTheme();
  }
  pending.add(name);
  flushTimer ??= setTimeout(() => {
    flushTimer = undefined;
    const names = [...pending];
    pending = new Set();
    void request<Record<string, FileIconDef | null>>({ kind: 'getFileIcons', names })
      .then((icons) => useIconStore.setState((s) => ({ icons: { ...s.icons, ...icons } })))
      .catch(() => names.forEach((n) => pending.add(n)));
  }, 16);
}

onEvent((ev) => {
  if (ev.kind !== 'fileIconThemeChanged') return;
  themeRequested = false;
  useIconStore.setState({ theme: undefined, icons: {} });
});

export function FileTypeIcon({ name }: { name: string }) {
  const theme = useIconStore((s) => s.theme);
  const def = useIconStore((s) => s.icons[name]);
  if (def === undefined) queue(name);

  // Icons disabled in VS Code ("None" icon theme) — show none, like the Explorer.
  if (theme && theme.id === null) return null;
  if (!def) return <span className="file-ticon" aria-hidden />;

  if (def.image) {
    return (
      <>
        <img className="file-ticon-img ticon-dark" src={def.image.src} alt="" />
        <img className="file-ticon-img ticon-light" src={def.image.srcLight ?? def.image.src} alt="" />
      </>
    );
  }
  if (!def.font) return <span className="file-ticon" aria-hidden />;
  const font = theme?.fonts.find((f) => f.id === def.font!.fontId) ?? theme?.fonts[0];
  const style: React.CSSProperties & Record<string, string | undefined> = {
    fontFamily: font ? `fileicon-${font.id}` : undefined,
    fontSize: def.font.size ?? font?.size,
    '--ticon-color': def.font.color,
    '--ticon-color-light': def.font.colorLight,
  };
  return (
    <span className="file-ticon" style={style} aria-hidden>
      {def.font.character}
    </span>
  );
}
