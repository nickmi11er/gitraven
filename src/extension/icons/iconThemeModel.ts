// Pure model of a VS Code file-icon theme document (the JSON a theme extension
// contributes via `contributes.iconThemes[].path`). No vscode/Node imports so
// the matching logic is unit-testable.

export interface RawIconFont {
  id: string;
  src: { path: string; format: string }[];
  weight?: string;
  style?: string;
  size?: string;
}

export interface RawIconDefinition {
  fontCharacter?: string;
  fontColor?: string;
  fontSize?: string;
  fontId?: string;
  iconPath?: string;
}

interface RawAssociations {
  file?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  languageIds?: Record<string, string>;
}

export interface RawIconTheme extends RawAssociations {
  fonts?: RawIconFont[];
  iconDefinitions?: Record<string, RawIconDefinition>;
  light?: RawAssociations;
  highContrast?: RawAssociations;
}

/** Maps built from all extensions' `contributes.languages` (lowercased keys). */
export interface LanguageIndex {
  /** extension (no leading dot, may be multi-segment like `d.ts`) -> language id */
  byExtension: Map<string, string>;
  /** full file name -> language id */
  byFileName: Map<string, string>;
}

function suffixes(lowerName: string): string[] {
  const parts = lowerName.split('.');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(i).join('.'));
  return out;
}

function languageIdOf(lowerName: string, lang: LanguageIndex): string | undefined {
  const byName = lang.byFileName.get(lowerName);
  if (byName) return byName;
  for (const ext of suffixes(lowerName)) {
    const id = lang.byExtension.get(ext);
    if (id) return id;
  }
  return undefined;
}

function matchIn(assoc: RawAssociations | undefined, lowerName: string, langId: string | undefined): string | undefined {
  if (!assoc) return undefined;
  const byName = assoc.fileNames?.[lowerName];
  if (byName) return byName;
  for (const ext of suffixes(lowerName)) {
    const byExt = assoc.fileExtensions?.[ext];
    if (byExt) return byExt;
  }
  if (langId && assoc.languageIds?.[langId]) return assoc.languageIds[langId];
  return assoc.file;
}

/**
 * Resolve a file name to icon-definition ids, mirroring VS Code's precedence:
 * fileNames > fileExtensions (longest multi-dot suffix first) > languageIds >
 * the theme's `file` default. `light` is the id the light theme should use
 * (its own section first, falling back to the main match).
 */
export function matchDefIds(
  theme: RawIconTheme,
  fileName: string,
  lang: LanguageIndex,
): { main?: string; light?: string } {
  const lowerName = fileName.toLowerCase();
  const langId = languageIdOf(lowerName, lang);
  const main = matchIn(theme, lowerName, langId);
  const light = matchIn(theme.light, lowerName, langId) ?? main;
  const out: { main?: string; light?: string } = {};
  if (main) out.main = main;
  if (light) out.light = light;
  return out;
}

/**
 * `fontCharacter` uses CSS escape syntax (`\E060`) because VS Code injects it
 * into a `content:` rule where CSS decodes it; we render it as text, so the
 * escapes (backslash + 1-6 hex digits + optional space, or backslash + char)
 * must be decoded to the actual glyph here.
 */
export function decodeFontCharacter(value: string): string {
  return value.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_m, hex: string | undefined, ch: string | undefined) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : ch ?? '',
  );
}

/**
 * Tolerant parse for theme documents: real themes are JSON, but the format
 * officially allows comments and trailing commas (JSONC).
 */
export function parseIconTheme(text: string): RawIconTheme {
  try {
    return JSON.parse(text) as RawIconTheme;
  } catch {
    return JSON.parse(stripJsonc(text)) as RawIconTheme;
  }
}

function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  // trailing commas: `,}` and `,]` (whitespace between)
  return out.replace(/,(\s*[}\]])/g, '$1');
}
