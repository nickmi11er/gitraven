import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { log } from '../util/logger';
import { decodeFontCharacter, matchDefIds, parseIconTheme } from './iconThemeModel';
import type { LanguageIndex, RawIconTheme } from './iconThemeModel';
import type { FileIconDef, FileIconTheme } from '../../shared/model';

const FONT_MIME: Record<string, string> = {
  woff: 'font/woff',
  woff2: 'font/woff2',
  truetype: 'font/ttf',
  opentype: 'font/otf',
};

const IMAGE_MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

interface LoadedTheme {
  id: string;
  dir: string;
  raw: RawIconTheme;
  fonts: FileIconTheme['fonts'];
}

/**
 * Serves the user's ACTIVE file-icon theme (`workbench.iconTheme`) to the
 * webviews: reads the theme document from whichever extension contributes it,
 * inlines its fonts/images as data: URIs and resolves file names to icons.
 * Webviews cannot access the icon theme themselves — this is the bridge.
 */
export class FileIconService implements vscode.Disposable {
  private loaded?: LoadedTheme | null; // undefined = not loaded yet, null = icons disabled
  private languages?: LanguageIndex;
  private iconCache = new Map<string, FileIconDef | null>();
  private imageCache = new Map<string, string | undefined>();

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private readonly configSub: vscode.Disposable;

  constructor() {
    this.configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('workbench.iconTheme')) {
        this.loaded = undefined;
        this.iconCache.clear();
        this.imageCache.clear();
        this._onDidChange.fire();
      }
    });
  }

  dispose(): void {
    this.configSub.dispose();
    this._onDidChange.dispose();
  }

  async getTheme(): Promise<FileIconTheme> {
    const theme = await this.load();
    return theme ? { id: theme.id, fonts: theme.fonts } : { id: null, fonts: [] };
  }

  async resolve(names: string[]): Promise<Record<string, FileIconDef | null>> {
    const theme = await this.load();
    const out: Record<string, FileIconDef | null> = {};
    for (const name of names) {
      if (!theme) {
        out[name] = null;
        continue;
      }
      let icon = this.iconCache.get(name);
      if (icon === undefined) {
        icon = await this.buildIcon(theme, name);
        this.iconCache.set(name, icon);
      }
      out[name] = icon;
    }
    return out;
  }

  private async buildIcon(theme: LoadedTheme, name: string): Promise<FileIconDef | null> {
    const ids = matchDefIds(theme.raw, name, this.languageIndex());
    const main = ids.main ? theme.raw.iconDefinitions?.[ids.main] : undefined;
    if (!main) return null;
    const light = ids.light && ids.light !== ids.main ? theme.raw.iconDefinitions?.[ids.light] : undefined;

    if (main.iconPath) {
      const src = await this.imageDataUri(theme.dir, main.iconPath);
      if (!src) return null;
      const image: NonNullable<FileIconDef['image']> = { src };
      const srcLight = light?.iconPath ? await this.imageDataUri(theme.dir, light.iconPath) : undefined;
      if (srcLight) image.srcLight = srcLight;
      return { image };
    }
    if (main.fontCharacter) {
      const font: NonNullable<FileIconDef['font']> = { character: decodeFontCharacter(main.fontCharacter) };
      if (main.fontId) font.fontId = main.fontId;
      if (main.fontColor) font.color = main.fontColor;
      if (light?.fontColor) font.colorLight = light.fontColor;
      if (main.fontSize) font.size = main.fontSize;
      return { font };
    }
    return null;
  }

  private async imageDataUri(themeDir: string, relPath: string): Promise<string | undefined> {
    const key = relPath;
    if (this.imageCache.has(key)) return this.imageCache.get(key);
    let uri: string | undefined;
    try {
      const abs = path.join(themeDir, relPath);
      const mime = IMAGE_MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
      uri = `data:${mime};base64,${(await fs.readFile(abs)).toString('base64')}`;
    } catch {
      uri = undefined;
    }
    this.imageCache.set(key, uri);
    return uri;
  }

  private async load(): Promise<LoadedTheme | null> {
    if (this.loaded !== undefined) return this.loaded;
    this.loaded = null;
    const themeId = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme');
    if (!themeId) return this.loaded;
    try {
      for (const ext of vscode.extensions.all) {
        const themes = (ext.packageJSON as { contributes?: { iconThemes?: { id: string; path: string }[] } })
          .contributes?.iconThemes;
        const entry = themes?.find((t) => t.id === themeId);
        if (!entry) continue;
        const file = path.join(ext.extensionPath, entry.path);
        const raw = parseIconTheme(await fs.readFile(file, 'utf8'));
        const dir = path.dirname(file);
        this.loaded = { id: themeId, dir, raw, fonts: await this.loadFonts(raw, dir) };
        break;
      }
    } catch (e) {
      log.warn(`file icon theme '${themeId}' failed to load: ${String(e)}`);
      this.loaded = null;
    }
    return this.loaded;
  }

  private async loadFonts(raw: RawIconTheme, dir: string): Promise<FileIconTheme['fonts']> {
    const fonts: FileIconTheme['fonts'] = [];
    for (const f of raw.fonts ?? []) {
      const src = f.src[0];
      if (!src) continue;
      try {
        const bytes = await fs.readFile(path.join(dir, src.path));
        const mime = FONT_MIME[src.format] ?? 'application/octet-stream';
        const font: FileIconTheme['fonts'][number] = {
          id: f.id,
          src: `data:${mime};base64,${bytes.toString('base64')}`,
          format: src.format,
        };
        if (f.weight) font.weight = f.weight;
        if (f.style) font.style = f.style;
        if (f.size) font.size = f.size;
        fonts.push(font);
      } catch (e) {
        log.warn(`icon font ${f.id} failed to load: ${String(e)}`);
      }
    }
    return fonts;
  }

  private languageIndex(): LanguageIndex {
    if (this.languages) return this.languages;
    const byExtension = new Map<string, string>();
    const byFileName = new Map<string, string>();
    for (const ext of vscode.extensions.all) {
      const languages = (ext.packageJSON as {
        contributes?: { languages?: { id: string; extensions?: string[]; filenames?: string[] }[] };
      }).contributes?.languages;
      for (const lang of languages ?? []) {
        for (const e of lang.extensions ?? []) {
          const key = e.replace(/^\./, '').toLowerCase();
          if (!byExtension.has(key)) byExtension.set(key, lang.id);
        }
        for (const f of lang.filenames ?? []) {
          const key = f.toLowerCase();
          if (!byFileName.has(key)) byFileName.set(key, lang.id);
        }
      }
    }
    this.languages = { byExtension, byFileName };
    return this.languages;
  }
}
